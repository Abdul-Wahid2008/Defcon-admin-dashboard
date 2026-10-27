import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { getAdapter as getAdapterRaw, createAdapter } from '../src/lib/server/adapters';
import type { MockAdapter } from '../src/lib/server/adapters/mock';
import { AgentAdapter } from '../src/lib/server/adapters/agent';
import { AgentClient } from '../src/lib/server/adapters/agent/client';
import { dbHelper } from '../src/lib/server/db';
import { appendCompletionAudits } from '../src/lib/server/audit';
import { sync } from '../src/lib/server/services/sync';
import { requestServiceAction } from '../src/lib/server/services/service-actions';
import { requestLifecycleAction } from '../src/lib/server/services/teams';
import { loadConfig } from '../src/lib/config';
import { isResetConfirmed, resetCopy } from '../src/lib/reset-copy';
import { ResetFields } from '../src/components/teams/ResetFields';
import { startFakeAgent, type FakeAgent } from '../scripts/fake-agent';
import type { SessionUser } from '../src/lib/server/auth';

const T0 = Date.parse('2026-10-27T10:00:00Z');
const TOKEN = 'agent-token-agent-token-agent-token-1234';
const admin: SessionUser = { id: 'u_admin', username: 'admin', displayName: 'Admin', role: 'organizer_admin' };
const operator: SessionUser = { id: 'u_op', username: 'operator', displayName: 'Operator', role: 'organizer_operator' };
const teamUser: SessionUser = { id: 'u_team', username: 'team-01', displayName: 'Team', role: 'team', teamId: 'team-01' };

const getAdapter = () => getAdapterRaw() as MockAdapter; // MockAdapter exposes a writable `capabilities` for tests
const at = (ms: number) => vi.setSystemTime(T0 + ms);
const opts = (n = 'r') => ({ requestId: `r_${n}` });
const audit = (action: string, outcome?: string) =>
  dbHelper.all<{ outcome: string; correlation_id: string | null; details_json: string | null; message: string }>(
    `SELECT outcome, correlation_id, details_json, message FROM audit_log WHERE action = ? ${outcome ? 'AND outcome = ?' : ''} ORDER BY id`,
    ...(outcome ? [action, outcome] : [action]));

function clearAll() {
  for (const t of ['flagstore_results', 'checks', 'alerts', 'services', 'environments', 'participants', 'teams', 'idempotency_keys']) {
    dbHelper.run(`DELETE FROM ${t}`);
  }
  dbHelper.run(`UPDATE settings SET value = '0' WHERE key = 'mutations_frozen'`);
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  at(0);
  clearAll();
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
});

async function runningMockTeam() {
  const adapter = getAdapter();
  const { team } = await adapter.createTeam({ name: 'Svc Team' });
  at(7000);
  await sync();
  expect((await adapter.getTeam(team.id))!.lifecycleState).toBe('running');
  return team.id;
}

describe('capability-driven reset copy', () => {
  it('restore_patch keeps the spec text; the others never claim a patch restore', () => {
    const a = resetCopy('restore_patch', 4);
    expect(a.body).toContain('latest accepted patch (v4)');
    expect(a.requiresConfirmation).toBe(false);

    const b = resetCopy('recreate_pristine', 4);
    expect(b.body).toBe("Resets this team's environment from the pristine image. Player patches and the service database may be erased and the team may lose SLA points. Flags and scores are held by the game server and are not affected by this action.");
    expect(b.body).not.toContain('latest accepted patch');
    expect(b.requiresConfirmation).toBe(true);

    const c = resetCopy('restart', 4);
    expect(c.body).toMatch(/Patch restore is not available/);
    expect(c.body).not.toContain('latest accepted patch');
    expect(c.requiresConfirmation).toBe(true);
  });

  it('requires a 10-character reason and the typed team id only when the copy demands it', () => {
    const strict = resetCopy('recreate_pristine', 1);
    expect(isResetConfirmed(strict, '', '', 'team-01')).toBe(false);
    expect(isResetConfirmed(strict, 'too short', 'team-01', 'team-01')).toBe(false);
    expect(isResetConfirmed(strict, 'container is ruined', 'team-02', 'team-01')).toBe(false);
    expect(isResetConfirmed(strict, 'container is ruined', 'team-01', 'team-01')).toBe(true);
    expect(isResetConfirmed(resetCopy('restore_patch', 1), '', '', 'team-01')).toBe(true);
  });

  it('the confirmation fields render with the team id to type', () => {
    const html = renderToStaticMarkup(createElement(ResetFields, {
      teamId: 'team-07', reason: '', typedTeamId: '', onReason: () => undefined, onTypedTeamId: () => undefined, idPrefix: 't',
    }));
    expect(html).toContain('team-07');
    expect(html).toContain('at least 10 characters');
  });
});

describe('service actions (mock)', () => {
  it('restart: operator allowed, async with a requested row and a completion row sharing a correlation id', async () => {
    const teamId = await runningMockTeam();
    const patchBefore = dbHelper.get<{ accepted_patch_version: number }>(`SELECT accepted_patch_version FROM environments WHERE team_id = ?`, teamId)!;
    const res = await requestServiceAction(operator, teamId, 'docuvault', 'restart', {}, opts('1'));
    expect(res.status).toBe(202);
    const requested = audit('service.restart', 'requested');
    expect(requested).toHaveLength(1);

    // one pending slot per environment
    await expect(requestServiceAction(operator, teamId, 'swiftshop', 'restart', {}, opts('2'))).rejects.toMatchObject({ code: 'ACTION_IN_PROGRESS' });
    await expect(requestLifecycleAction(admin, teamId, 'stop', opts('3'))).rejects.toMatchObject({ code: 'ACTION_IN_PROGRESS' });

    const pending = (await getAdapter().getTeam(teamId))!.environment.pending!;
    expect(pending).toMatchObject({ action: 'service_restart', serviceKey: 'docuvault' });

    at(7000 + 2500);
    await sync();
    const done = audit('service.restart', 'success');
    expect(done).toHaveLength(1);
    expect(done[0].correlation_id).toBe(requested[0].correlation_id);
    const env = (await getAdapter().getTeam(teamId))!.environment;
    expect(env.pending).toBeNull();
    expect(env.lifecycleState).toBe('running');
    expect(env.lastServiceAction).toMatchObject({ kind: 'restart', serviceKey: 'docuvault', outcome: 'success', correlationId: requested[0].correlation_id });
    expect(dbHelper.get(`SELECT accepted_patch_version FROM environments WHERE team_id = ?`, teamId)).toEqual(patchBefore);
  });

  it('reset needs a 10-character reason and the typed team id (422), then records the reason', async () => {
    const teamId = await runningMockTeam();
    for (const input of [{}, { reason: 'short', confirmTeamId: teamId }, { reason: 'long enough reason', confirmTeamId: 'team-99' }, { reason: 'long enough reason' }]) {
      await expect(requestServiceAction(admin, teamId, 'docuvault', 'reset', input, opts())).rejects.toMatchObject({ code: 'CONFIRMATION_MISMATCH' });
    }
    expect(audit('service.reset', 'requested')).toHaveLength(0);
    const res = await requestServiceAction(operator, teamId, 'docuvault', 'reset', { reason: '  checker says DB is corrupt ', confirmTeamId: teamId }, opts());
    expect(res.status).toBe(202);
    expect(JSON.parse(audit('service.reset', 'requested')[0].details_json!)).toMatchObject({ serviceKey: 'docuvault', reason: 'checker says DB is corrupt' });
  });

  it('denies the team role (audited), refuses unknown services and non-running environments', async () => {
    const teamId = await runningMockTeam();
    await expect(requestServiceAction({ ...teamUser, teamId }, teamId, 'docuvault', 'restart', {}, opts())).rejects.toMatchObject({ code: 'FORBIDDEN' });
    expect(audit('service.restart', 'denied')).toHaveLength(1);
    await expect(requestServiceAction(admin, teamId, 'nope', 'restart', {}, opts())).rejects.toMatchObject({ code: 'NOT_FOUND' });

    await requestLifecycleAction(admin, teamId, 'stop', opts());
    at(7000 + 3000);
    await sync();
    await expect(requestServiceAction(admin, teamId, 'docuvault', 'restart', {}, opts())).rejects.toMatchObject({ code: 'INVALID_TRANSITION' });
  });

  it('is refused with MUTATIONS_FROZEN while frozen, after the permission check', async () => {
    const teamId = await runningMockTeam();
    dbHelper.run(`UPDATE settings SET value = '1' WHERE key = 'mutations_frozen'`);
    await expect(requestServiceAction(operator, teamId, 'docuvault', 'restart', {}, opts())).rejects.toMatchObject({ code: 'MUTATIONS_FROZEN' });
    await expect(requestServiceAction({ ...teamUser, teamId }, teamId, 'docuvault', 'restart', {}, opts())).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });

  it('replays an idempotent request without a second pending action or audit row', async () => {
    const teamId = await runningMockTeam();
    const before = audit('service.restart', 'requested').length;
    const first = await requestServiceAction(operator, teamId, 'docuvault', 'restart', {}, { ...opts(), idempotencyKey: 'k-1' });
    const again = await requestServiceAction(operator, teamId, 'docuvault', 'restart', {}, { ...opts(), idempotencyKey: 'k-1' });
    expect(again.replay).toBe(true);
    expect(again.body).toEqual(first.body);
    expect(audit('service.restart', 'requested')).toHaveLength(before + 1);
  });

  it('is unavailable when the adapter reports serviceLevelReset=false', async () => {
    const teamId = await runningMockTeam();
    const adapter = getAdapter();
    const original = adapter.capabilities;
    adapter.capabilities = { ...original, serviceLevelReset: false };
    try {
      await expect(requestServiceAction(admin, teamId, 'docuvault', 'restart', {}, opts())).rejects.toMatchObject({ code: 'CONFLICT' });
    } finally {
      adapter.capabilities = original;
    }
  });
});

describe('environment reset confirmation follows capabilities', () => {
  it('restore_patch needs nothing extra; recreate_pristine and restart need a reason and the typed team id', async () => {
    const teamId = await runningMockTeam();
    const adapter = getAdapter();
    const original = adapter.capabilities;
    try {
      adapter.capabilities = { ...original, resetKind: 'recreate_pristine' };
      await expect(requestLifecycleAction(admin, teamId, 'reset', opts())).rejects.toMatchObject({ code: 'CONFIRMATION_MISMATCH' });
      await expect(requestLifecycleAction(admin, teamId, 'reset', { ...opts(), reason: 'container ruined by RCE', confirmTeamId: 'team-77' })).rejects.toMatchObject({ code: 'CONFIRMATION_MISMATCH' });
      const ok = await requestLifecycleAction(admin, teamId, 'reset', { ...opts(), reason: 'container ruined by RCE', confirmTeamId: teamId });
      expect(ok.status).toBe(202);
      const requested = audit('env.reset', 'requested').pop()!;
      expect(JSON.parse(requested.details_json!)).toMatchObject({ reason: 'container ruined by RCE', resetKind: 'recreate_pristine' });
      at(7000 + 6000);
      await sync();

      adapter.capabilities = { ...original, resetKind: 'restart' };
      await expect(requestLifecycleAction(admin, teamId, 'reset', opts())).rejects.toMatchObject({ code: 'CONFIRMATION_MISMATCH' });

      adapter.capabilities = { ...original, resetKind: 'restore_patch' };
      expect((await requestLifecycleAction(admin, teamId, 'reset', opts())).status).toBe(202);
    } finally {
      adapter.capabilities = original;
    }
  });
});

describe('AgentClient against the fake agent', () => {
  let agent: FakeAgent;
  beforeEach(async () => { agent = await startFakeAgent({ token: TOKEN, jobMs: 10 }); });
  afterEach(async () => { await agent.close(); });
  const client = (extra: Partial<ConstructorParameters<typeof AgentClient>[0]> = {}) =>
    new AgentClient({ baseUrl: agent.url, token: TOKEN, timeoutMs: 500, ...extra });

  it('reads capabilities and status, starts a job with an Idempotency-Key and reads it back', async () => {
    const c = client();
    expect(await c.capabilities()).toEqual({ resetKind: 'recreate_pristine', serviceLevelReset: true });
    expect((await c.status('team-01')).state).toBe('running');
    const job = await c.teamAction('team-01', 'reset', 'corr-1');
    expect(job.jobId).toMatch(/^job_/);
    expect(agent.requests.find(r => r.path === '/v1/teams/team-01/reset')).toMatchObject({ method: 'POST', idempotencyKey: 'corr-1', authorized: true });
    expect((await c.serviceAction('team-01', 'docuvault', 'restart', 'corr-2')).jobId).toMatch(/^job_/);
    expect((await c.job(job.jobId)).jobId).toBe(job.jobId);
  });

  it('never builds a URL from an invalid team id, service key or job id', async () => {
    const c = client();
    await expect(c.teamAction('team-1/../../x', 'start', 'k')).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
    await expect(c.serviceAction('team-01', '../x', 'restart', 'k')).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
    await expect(c.job('a/b')).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
    expect(agent.requests).toHaveLength(0);
  });

  it('retries a GET on 5xx but never a POST', async () => {
    agent.respondWith(503);
    await expect(client({ getRetries: 2 }).capabilities()).rejects.toMatchObject({ code: 'ADAPTER_ERROR' });
    expect(agent.requests.filter(r => r.path === '/v1/capabilities')).toHaveLength(3);
    await expect(client({ getRetries: 2 }).teamAction('team-01', 'start', 'k')).rejects.toMatchObject({ code: 'ADAPTER_ERROR' });
    expect(agent.requests.filter(r => r.method === 'POST')).toHaveLength(1);
  });

  it('maps timeout, bad token, 404 and an invalid body to safe errors without leaking the URL or token', async () => {
    agent.delay(300);
    const timeout = await client({ timeoutMs: 50, getRetries: 0 }).capabilities().catch(e => e);
    expect(timeout).toMatchObject({ code: 'ADAPTER_ERROR' });
    agent.delay(0);

    const bad = await new AgentClient({ baseUrl: agent.url, token: 'x'.repeat(40), timeoutMs: 500 }).capabilities().catch(e => e);
    expect(bad).toMatchObject({ code: 'ADAPTER_ERROR' });
    expect(await client().job('job_999').catch(e => e)).toMatchObject({ code: 'NOT_FOUND' });

    agent.garbage(true);
    const garbage = await client().capabilities().catch(e => e);
    expect(garbage).toMatchObject({ code: 'ADAPTER_ERROR' });
    agent.garbage(false);

    for (const err of [timeout, bad, garbage]) {
      const text = JSON.stringify({ m: err.message, d: err.details });
      expect(text).not.toContain(TOKEN);
      expect(text).not.toContain('127.0.0.1');
      expect(text).not.toContain(String(agent.port));
    }
  });
});

describe('AgentAdapter (ADAPTER=real) against the fake agent', () => {
  let agent: FakeAgent;
  let adapter: AgentAdapter;
  beforeEach(async () => {
    agent = await startFakeAgent({ token: TOKEN, jobMs: 1000 });
    adapter = new AgentAdapter({ baseUrl: agent.url, token: TOKEN, timeoutMs: 500 });
  });
  afterEach(async () => { await agent.close(); });

  const resolve = async () => { const c = await adapter.resolveDue(); appendCompletionAudits(c); return c; };

  it('createAdapter builds it only with ORCHESTRATOR_* set and reports mode real', () => {
    const cfg = loadConfig({ NODE_ENV: 'test', ADAPTER: 'real', ORCHESTRATOR_BASE_URL: agent.url, ORCHESTRATOR_TOKEN: TOKEN, ORCHESTRATOR_TIMEOUT_MS: '500' } as NodeJS.ProcessEnv);
    expect(createAdapter(cfg).mode).toBe('real');
    expect(() => createAdapter({ ...cfg, orchestratorToken: undefined })).toThrow('requires ORCHESTRATOR_BASE_URL');
  });

  it('starts conservative, then adopts what the agent reports', async () => {
    expect(adapter.capabilities).toMatchObject({ resetKind: 'recreate_pristine', serviceLevelReset: false });
    await adapter.refreshCapabilities(true);
    expect(adapter.capabilities.serviceLevelReset).toBe(true);
  });

  it('provisions through an agent job and completes only when the job succeeds, not by the clock', async () => {
    vi.stubEnv('TERMINAL_URL_TEMPLATE', 'https://term.example/{port}/');
    const provisioned = audit('env.provision', 'success').length;
    const { team } = await adapter.createTeam({ name: 'Agent Team' });
    expect(agent.requests.find(r => r.path === `/v1/teams/${team.id}/start`)).toMatchObject({ authorized: true });
    expect(agent.requests.find(r => r.path === `/v1/teams/${team.id}/start`)!.idempotencyKey).toMatch(/^c_/);

    at(500); // well inside the 1000 ms job: the mock clock would not have completed it either way
    expect(await resolve()).toEqual([]);
    expect((await adapter.getTeam(team.id))!.lifecycleState).toBe('provisioning');

    at(5000); // job finished (>= 1000 ms), poll gap passed
    const done = await resolve();
    expect(done).toMatchObject([{ teamId: team.id, action: 'provision', outcome: 'success' }]);
    const detail = (await adapter.getTeam(team.id))!;
    expect(detail.lifecycleState).toBe('running');
    expect(detail.environment.terminal).toMatchObject({ url: 'https://term.example/7601/', isMock: false });
    expect(audit('env.provision', 'success').length).toBeGreaterThan(provisioned);
  });

  it('stop/start/reset are agent jobs; a failed job fails the environment with a sanitised reason', async () => {
    const { team } = await adapter.createTeam({ name: 'Agent Team' });
    at(5000);
    await resolve();

    const res = await adapter.requestAction(team.id, 'stop', { correlationId: 'c_stop1' });
    expect('transition' in res && res.transition.to).toBe('stopped');
    expect(agent.requests.find(r => r.path === `/v1/teams/${team.id}/stop`)!.idempotencyKey).toBe('c_stop1');
    await expect(adapter.requestAction(team.id, 'start', { correlationId: 'c_x' })).rejects.toMatchObject({ code: 'ACTION_IN_PROGRESS' });
    at(5000 + 5000);
    expect((await resolve())[0]).toMatchObject({ action: 'stop', outcome: 'success' });
    expect((await adapter.getTeam(team.id))!.lifecycleState).toBe('stopped');

    agent.failNext('disk full\u0007\nsecret=abc');
    await adapter.requestAction(team.id, 'start', { correlationId: 'c_start1' });
    at(5000 + 5000 + 5000);
    expect((await resolve())[0]).toMatchObject({ action: 'start', outcome: 'failure' });
    const failed = (await adapter.getTeam(team.id))!;
    expect(failed.lifecycleState).toBe('failed');
    expect(failed.environment.failureReason).not.toMatch(/[\u0000-\u001f]/);
    expect(failed.environment.failureReason).toContain('disk full');
  });

  it('refuses delete (no operation in the agent contract) and an unreachable agent commits nothing', async () => {
    const { team } = await adapter.createTeam({ name: 'Agent Team' });
    at(5000);
    await resolve();
    await expect(adapter.requestAction(team.id, 'delete', { correlationId: 'c_d' })).rejects.toMatchObject({ code: 'ADAPTER_ERROR' });

    agent.respondWith(500);
    const err = await adapter.requestAction(team.id, 'stop', { correlationId: 'c_s' }).catch(e => e);
    expect(err).toMatchObject({ code: 'ADAPTER_ERROR' });
    expect(JSON.stringify([err.message, err.details])).not.toContain(TOKEN);
    const env = dbHelper.get<{ pending_action: string | null; lifecycle_state: string }>(`SELECT pending_action, lifecycle_state FROM environments WHERE team_id = ?`, team.id)!;
    expect(env).toEqual({ pending_action: null, lifecycle_state: 'running' });
  });

  it('service actions are agent jobs, need the agent to allow them, and complete on job status', async () => {
    const { team } = await adapter.createTeam({ name: 'Agent Team' });
    at(5000);
    await resolve();
    (adapter as MockAdapter).capabilities = { ...adapter.capabilities, serviceLevelReset: false }; // as before the agent answered
    await expect(adapter.requestServiceAction(team.id, 'docuvault', 'restart', { correlationId: 'c_a' })).rejects.toMatchObject({ code: 'CONFLICT' });

    await adapter.refreshCapabilities(true);
    const r = await adapter.requestServiceAction(team.id, 'docuvault', 'reset', { correlationId: 'c_svc1' });
    expect(r.kind).toBe('reset');
    expect(agent.requests.find(r2 => r2.path.endsWith('/services/docuvault/reset'))!.idempotencyKey).toBe('c_svc1');
    at(5000 + 5000);
    expect((await resolve())[0]).toMatchObject({ action: 'service_reset', outcome: 'success', correlationId: 'c_svc1' });
    expect((await adapter.getTeam(team.id))!.environment.lastServiceAction).toMatchObject({ kind: 'reset', outcome: 'success' });
  });

  it('fails a pending row that was never handed to the agent instead of wedging the environment', async () => {
    const { team } = await adapter.createTeam({ name: 'Agent Team' });
    at(5000);
    await resolve();
    dbHelper.run(
      `UPDATE environments SET pending_action = 'stop', pending_correlation_id = 'c_orphan', pending_from_state = 'running',
        pending_to_state = 'stopped', pending_started_at = ?, pending_ends_at = ?, lifecycle_state = 'stopping', pending_job_id = NULL WHERE team_id = ?`,
      new Date(T0 + 5000).toISOString(), new Date(T0 + 65_000).toISOString(), team.id);
    at(5000 + 10_000);
    expect(await resolve()).toEqual([]); // inside the 30 s grace: createTeam/requestAction may still be mid-flight
    at(5000 + 40_000);
    expect((await resolve())[0]).toMatchObject({ teamId: team.id, action: 'stop', outcome: 'failure' });
    expect((await adapter.getTeam(team.id))!.environment.failureReason).toContain('not handed to the agent');
  });

  it('a refused provisioning is audited after the requested row, via the next resolveDue', async () => {
    agent.respondWith(500);
    const { team } = await adapter.createTeam({ name: 'Refused Team' });
    expect((await adapter.getTeam(team.id))!.lifecycleState).toBe('failed');
    const before = audit('env.provision', 'failure').length;
    const done = await resolve();
    expect(done).toMatchObject([{ teamId: team.id, action: 'provision', outcome: 'failure' }]);
    expect(audit('env.provision', 'failure').length).toBe(before + 1);
    expect(await resolve()).toEqual([]);
  });

  it('never reports fullyReal (credentials, resources and sessions are still dashboard-side)', () => {
    expect(adapter.capabilities.fullyReal).toBe(false);
  });

  it('fails a job the agent no longer knows and one that never finishes', async () => {
    const { team } = await adapter.createTeam({ name: 'Agent Team' });
    at(5000);
    await resolve();
    await adapter.requestAction(team.id, 'stop', { correlationId: 'c_gone' });
    dbHelper.run(`UPDATE environments SET pending_job_id = 'job_missing' WHERE team_id = ?`, team.id);
    at(5000 + 5000);
    expect((await resolve())[0]).toMatchObject({ outcome: 'failure' });
    expect((await adapter.getTeam(team.id))!.environment.failureReason).toContain('no longer knows');
  });

  it('a mid-flight agent outage keeps the pending state until the 10-minute timeout', async () => {
    const { team } = await adapter.createTeam({ name: 'Agent Team' });
    at(5000);
    await resolve();
    await adapter.requestAction(team.id, 'stop', { correlationId: 'c_out' });
    agent.respondWith(502);
    at(5000 + 60_000);
    expect(await resolve()).toEqual([]);
    expect((await adapter.getTeam(team.id))!.environment.pending).not.toBeNull();
    at(5000 + 11 * 60_000);
    expect((await resolve())[0]).toMatchObject({ outcome: 'failure' });
  });
});

describe('config', () => {
  const env = (o: Record<string, string> = {}) => ({ NODE_ENV: 'test', ...o }) as NodeJS.ProcessEnv;
  it('validates TERMINAL_URL_TEMPLATE', () => {
    expect(loadConfig(env({ TERMINAL_URL_TEMPLATE: 'https://host/{port}/' })).terminalUrlTemplate).toBe('https://host/{port}/');
    expect(() => loadConfig(env({ TERMINAL_URL_TEMPLATE: 'not a url' }))).toThrow('valid URL');
    expect(() => loadConfig(env({ TERMINAL_URL_TEMPLATE: 'ftp://host/{port}' }))).toThrow('http or https');
    expect(() => loadConfig(env({ TERMINAL_URL_TEMPLATE: 'https://u:p@host/{port}' }))).toThrow('credentials');
  });
});
