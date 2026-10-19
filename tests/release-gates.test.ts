import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

// requireUser reads cookies() outside a Next request scope in tests,
// so the cookie source is replaced with an in-memory holder.
const cookieState = vi.hoisted(() => ({ token: undefined as string | undefined }));

vi.mock('next/headers', () => ({
  cookies: async () => ({
    get: (name: string) =>
      name === 'dc_session' && cookieState.token
        ? { name, value: cookieState.token }
        : undefined,
  }),
}));

import {
  assertSameOrigin,
  createSession,
  requireUser,
  type SessionUser,
} from '../src/lib/server/auth';
import { AppError, errorResponse, toHttpStatus } from '../src/lib/server/errors';
import { MockAdapter } from '../src/lib/server/adapters/mock';
import type { IssuedCredential, TeamDetail, TeamQuery } from '../src/lib/server/adapters/types';
import { appendCompletionAudits } from '../src/lib/server/audit';
import { dbHelper } from '../src/lib/server/db';
import {
  createTeam,
  deleteTeam,
  getTeam,
  listTeams,
  requestLifecycleAction,
} from '../src/lib/server/services/teams';
import { getOverview } from '../src/lib/server/services/overview';
import { sync } from '../src/lib/server/services/sync';
import { GET as getMeta } from '../src/app/api/meta/route';

const admin: SessionUser = {
  id: 'u_admin',
  username: 'admin',
  displayName: 'Admin',
  role: 'organizer_admin',
};

const operator: SessionUser = {
  id: 'u_operator',
  username: 'operator',
  displayName: 'Operator',
  role: 'organizer_operator',
};

function stateChangeRequest(method: string, origin?: string, host = 'console.local:3000'): Request {
  return new Request('http://console.local:3000/api/teams', {
    method,
    headers: { host, ...(origin ? { origin } : {}) },
  });
}

describe('same-origin protection for state-changing requests', () => {
  it('rejects a state-changing request without an Origin header', () => {
    expect(() => assertSameOrigin(stateChangeRequest('POST'))).toThrowError(
      new AppError('FORBIDDEN', 'Origin header required for state-changing requests.'),
    );
  });

  it('rejects a cross-origin state-changing request', () => {
    expect(() => assertSameOrigin(stateChangeRequest('POST', 'https://evil.example'))).toThrowError(
      new AppError('FORBIDDEN', 'Cross-origin request rejected.'),
    );
  });

  it('rejects an unparseable Origin header', () => {
    expect(() => assertSameOrigin(stateChangeRequest('POST', 'not-a-url'))).toThrowError(
      new AppError('FORBIDDEN', 'Invalid Origin header.'),
    );
  });

  it('accepts a same-origin state-changing request', () => {
    expect(() => assertSameOrigin(stateChangeRequest('POST', 'http://console.local:3000'))).not.toThrow();
    expect(() => assertSameOrigin(stateChangeRequest('DELETE', 'http://console.local:3000'))).not.toThrow();
  });

  it('keeps GET/HEAD/OPTIONS compatible without an Origin header', () => {
    expect(() => assertSameOrigin(stateChangeRequest('GET'))).not.toThrow();
    expect(() => assertSameOrigin(stateChangeRequest('HEAD'))).not.toThrow();
    expect(() => assertSameOrigin(stateChangeRequest('OPTIONS'))).not.toThrow();
  });
});

describe('unauthenticated requests return the documented 401 shape', () => {
  const hadSecret = 'SESSION_SECRET' in process.env;
  const previousSecret = process.env.SESSION_SECRET;

  beforeAll(() => {
    process.env.SESSION_SECRET = 'r'.repeat(48); // test-only session signing key
  });

  afterAll(() => {
    if (hadSecret) process.env.SESSION_SECRET = previousSecret;
    else delete process.env.SESSION_SECRET;
  });

  it('maps a missing session to 401 with the documented error body', async () => {
    cookieState.token = undefined;
    await expect(requireUser(new Request('http://console.local:3000/api/teams'))).rejects.toMatchObject({
      code: 'UNAUTHENTICATED',
    });

    const response = errorResponse(
      new AppError('UNAUTHENTICATED', 'Authentication required.'),
      'r_auth_test',
    );
    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({
      error: {
        code: 'UNAUTHENTICATED',
        message: 'Authentication required.',
        requestId: 'r_auth_test',
      },
    });
    expect(toHttpStatus('UNAUTHENTICATED')).toBe(401);
  });

  it('accepts a valid signed session and rejects a tampered one with 401', async () => {
    const token = await createSession(admin);
    cookieState.token = token;
    const user = await requireUser(new Request('http://console.local:3000/api/teams'));
    expect(user.role).toBe('organizer_admin');

    cookieState.token = `${token.slice(0, -4)}zzzz`;
    await expect(requireUser(new Request('http://console.local:3000/api/teams'))).rejects.toMatchObject({
      code: 'UNAUTHENTICATED',
    });
    cookieState.token = undefined;
  });
});

describe('restart during a pending MockAdapter transition', () => {
  it('resolves the pending transition lazily on the next read and keeps audit correlation', async () => {
    let virtualNow = Date.now();
    const clock = () => new Date(virtualNow).toISOString();

    // Process 1: team created, provisioning pending; crash before completion is read.
    const first = new MockAdapter(clock);
    const created = await first.createTeam({ name: 'Restart Rehearsal Team' });
    const teamId = created.team.id;
    const provisionCorrelation = dbHelper.get<{ c: string }>(
      'SELECT pending_correlation_id as c FROM environments WHERE team_id = ?',
      teamId,
    )?.c;
    expect(provisionCorrelation).toBeTruthy();
    expect((await first.getTeam(teamId))?.environment.lifecycleState).toBe('provisioning');
    virtualNow += 7000;

    // Process 2: fresh adapter over the same SQLite file; first read resolves due work.
    const second = new MockAdapter(clock);
    appendCompletionAudits(await second.resolveDue());
    expect((await second.getTeam(teamId))?.environment.lifecycleState).toBe('running');
    const provisionCompletion = dbHelper.get<{ correlation_id: string | null }>(
      `SELECT correlation_id FROM audit_log
       WHERE target_id = ? AND action = 'env.provision' AND outcome = 'success'`,
      teamId,
    );
    expect(provisionCompletion?.correlation_id).toBe(provisionCorrelation);

    // A stop is requested, then the process crashes again while it is pending.
    const stopResult = await second.requestAction(teamId, 'stop', { correlationId: 'c_restart_stop' });
    expect('transition' in stopResult).toBe(true);
    expect((await second.getTeam(teamId))?.environment.lifecycleState).toBe('stopping');
    virtualNow += 3000;

    // Process 3: restart completes the pending stop on the next read only.
    const third = new MockAdapter(clock);
    const completions = await third.resolveDue();
    expect(completions).toHaveLength(1);
    appendCompletionAudits(completions);
    expect((await third.getTeam(teamId))?.environment.lifecycleState).toBe('stopped');

    const stopCompletions = dbHelper.all<{ correlation_id: string | null }>(
      `SELECT correlation_id FROM audit_log
       WHERE target_id = ? AND action = 'env.stop' AND outcome = 'success'`,
      teamId,
    );
    expect(stopCompletions).toHaveLength(1);
    expect(stopCompletions[0]?.correlation_id).toBe('c_restart_stop');

    // A further read is a no-op: no duplicate completion audit rows.
    expect(await third.resolveDue()).toHaveLength(0);
    expect(
      dbHelper.get<{ count: number }>(
        `SELECT COUNT(*) as count FROM audit_log WHERE target_id = ? AND action = 'env.stop'`,
        teamId,
      )?.count,
    ).toBe(1);
  });
});

// Without an idempotency key, createTeam can only return its 201 branch
// (the stored-response replay branch requires opts.idempotencyKey).
type CreateTeamSuccess = {
  status: 201;
  body: { team: TeamDetail; credentials: IssuedCredential[] };
  softCapExceeded: boolean;
  replay: boolean;
};

describe('service release gates', () => {
  let createResult: CreateTeamSuccess;
  let teamId: string;
  let teamName: string;

  beforeAll(async () => {
    createResult = (await createTeam(
      admin,
      { name: 'Release Candidate Team' },
      { requestId: 'r_rc_create' },
    )) as CreateTeamSuccess;
    teamId = createResult.body.team.id;
    teamName = createResult.body.team.name;
  });

  it('returns plaintext credentials only in the create response', () => {
    expect(createResult.status).toBe(201);
    const plaintext = createResult.body.credentials[0]?.password;
    expect(plaintext).toBeTruthy();
    expect(JSON.stringify(createResult.body.team)).not.toMatch(/password/i);

    const stored = dbHelper.get<{ password_hash: string }>(
      'SELECT password_hash FROM participants WHERE team_id = ?',
      teamId,
    );
    expect(stored?.password_hash).toBeTruthy();
    expect(stored?.password_hash).not.toBe(plaintext);
  });

  it('keeps credentials out of list, detail, overview, audit, and meta payloads', async () => {
    const listed = await listTeams(admin, {} as TeamQuery);
    expect(JSON.stringify(listed)).not.toMatch(/password/i);

    const detail = await getTeam(admin, teamId);
    expect(JSON.stringify(detail)).not.toMatch(/password/i);

    const overview = await getOverview(admin);
    expect(JSON.stringify(overview)).not.toMatch(/password/i);

    const auditRows = dbHelper.all('SELECT * FROM audit_log WHERE target_id = ?', teamId);
    expect(auditRows.length).toBeGreaterThan(0);
    expect(JSON.stringify(auditRows)).not.toMatch(/password/i);

    const meta = await (await getMeta()).json();
    expect(JSON.stringify(meta)).not.toMatch(/secret|password|token/i);
  });

  it('reaches the authoritative running final state by polling the detail path', async () => {
    const deadline = Date.now() + 10_000;
    let state = '';
    while (Date.now() < deadline) {
      await sync();
      state = (await getTeam(admin, teamId)).environment.lifecycleState;
      if (state === 'running') break;
      await new Promise((resolve) => setTimeout(resolve, 150));
    }
    expect(state).toBe('running');
  }, 15_000);

  it('rejects an organizer_operator delete server-side and audits the denial', async () => {
    await expect(
      deleteTeam(operator, teamId, teamName, { requestId: 'r_op_delete' }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });

    const denied = dbHelper.all<{ outcome: string }>(
      `SELECT outcome FROM audit_log WHERE target_id = ? AND action = 'env.delete'`,
      teamId,
    );
    expect(denied.some((row) => row.outcome === 'denied')).toBe(true);

    // The team survives the denied request.
    const rows = dbHelper.get<{ archived_at: string | null }>(
      'SELECT archived_at FROM teams WHERE id = ?',
      teamId,
    );
    expect(rows?.archived_at).toBeNull();
  });

  it('replays the same idempotency key without duplicate audit and rejects a colliding pending action', async () => {
    const stopRows = () =>
      dbHelper.all<{ outcome: string }>(
        `SELECT outcome FROM audit_log WHERE target_id = ? AND action = 'env.stop'`,
        teamId,
      );

    const first = await requestLifecycleAction(admin, teamId, 'stop', {
      requestId: 'r_stop_1',
      idempotencyKey: 'k-stop-1',
    });
    expect(first.status).toBe(202);
    expect(first.replay).toBe(false);
    expect(stopRows()).toHaveLength(1);

    const replay = await requestLifecycleAction(admin, teamId, 'stop', {
      requestId: 'r_stop_2',
      idempotencyKey: 'k-stop-1',
    });
    expect(replay.status).toBe(202);
    expect(replay.replay).toBe(true);
    expect(JSON.stringify(replay.body)).toBe(JSON.stringify(first.body));
    expect(stopRows()).toHaveLength(1);

    await expect(
      requestLifecycleAction(admin, teamId, 'reset', {
        requestId: 'r_collision',
        idempotencyKey: 'k-reset-1',
      }),
    ).rejects.toThrow('ACTION_IN_PROGRESS');
    expect(stopRows()).toHaveLength(1);
  });

  it('shares one correlation_id between the requested and completion audit rows', async () => {
    const deadline = Date.now() + 6_000;
    let state = '';
    while (Date.now() < deadline) {
      await sync();
      state = (await getTeam(admin, teamId)).environment.lifecycleState;
      if (state === 'stopped') break;
      await new Promise((resolve) => setTimeout(resolve, 150));
    }
    expect(state).toBe('stopped');

    const rows = dbHelper.all<{ outcome: string; correlation_id: string | null }>(
      `SELECT outcome, correlation_id FROM audit_log WHERE target_id = ? AND action = 'env.stop'`,
      teamId,
    );
    expect(rows).toHaveLength(2);
    const requested = rows.find((row) => row.outcome === 'requested');
    const success = rows.find((row) => row.outcome === 'success');
    expect(requested?.correlation_id).toBeTruthy();
    expect(success?.correlation_id).toBe(requested?.correlation_id);
  }, 10_000);
});
