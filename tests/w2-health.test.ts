import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// requireUser reads cookies() outside a Next request scope in tests, so the cookie is an in-memory holder.
const cookieState = vi.hoisted(() => ({ token: undefined as string | undefined }));
vi.mock('next/headers', () => ({
  cookies: async () => ({
    get: (name: string) => (name === 'dc_session' && cookieState.token ? { name, value: cookieState.token } : undefined),
  }),
}));

import fs from 'node:fs';
import { MockAdapter } from '../src/lib/server/adapters/mock';
import { dbHelper } from '../src/lib/server/db';
import { applyHealthBatch, type HealthRow } from '../src/lib/server/health/apply';
import { deriveChecks, normalizeVerdict } from '../src/lib/server/health/verdicts';
import { fetchScoreboardJson, parseScoreboard } from '../src/lib/server/health/scoreboard-source';
import { getHealthSourceStatus, pullIfDue, resetPullStateForTests } from '../src/lib/server/health/source';
import { resetLimits } from '../src/lib/server/limits';
import { badgeFor } from '../src/lib/server/health/badge';
import { loadConfig } from '../src/lib/config';
import { machineCan } from '../src/lib/server/permissions';
import { GET as getMeta } from '../src/app/api/meta/route';
import { GET as ingestGet, POST as ingestPost } from '../src/app/api/ingest/check-results/route';
import { createSession } from '../src/lib/server/auth';
import { getOverview } from '../src/lib/server/services/overview';

const T0 = Date.parse('2026-10-27T10:00:00Z');
const TOKEN = 't'.repeat(40);
const URL_OK = 'http://score.example:8080/data/scoreboard.json';

let clock = new Date(T0);
let adapter: MockAdapter;
let teamId = '';

function clearAll() {
  for (const t of ['flagstore_results', 'checks', 'alerts', 'services', 'environments', 'participants', 'teams', 'health_source_state']) {
    dbHelper.run(`DELETE FROM ${t}`);
  }
  dbHelper.run(`DELETE FROM settings WHERE key = 'health_round_changed_at'`);
}

async function makeTeam(ext = '1') {
  const { team } = await adapter.createTeam({ name: `Team ${ext}` });
  dbHelper.run(`UPDATE teams SET external_team_id = ? WHERE id = ?`, ext, team.id);
  return team.id;
}

const row = (over: Partial<HealthRow> = {}): HealthRow => ({
  externalTeamId: '1', serviceKey: 'docuvault', flagstore: 'flag0', verdict: 'OK', round: 1, ...over,
});
const allFlags = (verdict: string, over: Partial<HealthRow> = {}) =>
  ['flag0', 'flag1', 'flag2'].map(flagstore => row({ flagstore, verdict, ...over }));

const checkOf = (type: string, service = 'docuvault') =>
  dbHelper.get<{ status: string; detail: string | null }>(
    `SELECT status, detail FROM checks WHERE team_id = ? AND service_key = ? AND check_type = ?`, teamId, service, type)!;
const openAlerts = () => dbHelper.all<{ dedupe_key: string; kind: string; severity: string }>(
  `SELECT dedupe_key, kind, severity FROM alerts WHERE resolved_at IS NULL ORDER BY dedupe_key`);
const auditCount = (action: string) => dbHelper.get<{ n: number }>(`SELECT COUNT(*) AS n FROM audit_log WHERE action = ?`, action)!.n;

const board = (round: number, verdict = 'OK') => ({
  currentRound: round,
  teams: [{ teamId: '1', services: [{ key: 'docuvault', flagstores: ['flag0', 'flag1', 'flag2'].map(key => ({ key, verdict })) }] }],
});
const okFetch = (body: unknown) => vi.fn(async () => new Response(JSON.stringify(body), { status: 200 })) as unknown as typeof fetch;

function useScoreboard() {
  vi.stubEnv('HEALTH_SOURCE', 'scoreboard');
  vi.stubEnv('HEALTH_SCOREBOARD_URL', URL_OK);
  vi.stubEnv('HEALTH_POLL_SEC', '15');
}

beforeEach(async () => {
  clearAll();
  resetPullStateForTests();
  resetLimits();
  clock = new Date(T0);
  adapter = new MockAdapter(() => clock.toISOString());
  teamId = await makeTeam('1');
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('verdict mapping', () => {
  it.each([
    ['OK', 'pass', 'pass'],
    ['OFFLINE', 'fail', 'unknown'],
    ['MUMBLE', 'pass', 'fail'],
    ['INTERNAL_ERROR', 'unknown', 'unknown'],
    ['UNKNOWN', 'unknown', 'unknown'],
  ] as const)('%s on all flagstores → reach %s, func %s', (verdict, reach, func) => {
    const d = deriveChecks([verdict, verdict, verdict]);
    expect([d.reachability, d.functional]).toEqual([reach, func]);
    expect(d.checkerError).toBe(verdict === 'INTERNAL_ERROR');
  });

  it('is worst-of across flagstores and never passes on partial data', () => {
    expect(deriveChecks(['OK', 'MUMBLE', 'OK'])).toMatchObject({ reachability: 'pass', functional: 'fail' });
    expect(deriveChecks(['OK', 'OFFLINE', 'OK'])).toMatchObject({ reachability: 'fail' });
    expect(deriveChecks(['OK', 'UNKNOWN', 'OK'])).toMatchObject({ reachability: 'pass', functional: 'unknown' });
    expect(deriveChecks([])).toMatchObject({ reachability: 'unknown', functional: 'unknown' });
  });

  it('maps unrecognised strings to UNKNOWN, never OK', () => {
    for (const v of ['nope', 'SUCCESS', 'healthy', '', null, undefined, 1, {}]) {
      expect(normalizeVerdict(v)).toBe('UNKNOWN');
    }
    expect(normalizeVerdict(' ok ')).toBe('OK');
    expect(normalizeVerdict('MUMBLE')).toBe('MUMBLE');
  });
});

describe('applyHealthBatch', () => {
  it('derives checks, opens an alert with the dedupe key, and resolves it, auditing both as system', () => {
    applyHealthBatch(allFlags('OK'), 'ingest', '2026-10-27T10:00:01.000Z');
    expect(checkOf('reachability').status).toBe('pass');
    expect(checkOf('functional').status).toBe('pass');

    const opened = auditCount('alert.open');
    applyHealthBatch([row({ flagstore: 'flag1', verdict: 'MUMBLE', round: 2, message: 'flag not found' }), row({ round: 2 }), row({ flagstore: 'flag2', round: 2 })], 'ingest', '2026-10-27T10:01:30.000Z');
    expect(checkOf('functional').status).toBe('fail');
    expect(checkOf('functional').detail).toContain('flag1: MUMBLE (flag not found)');
    expect(checkOf('reachability').status).toBe('pass');
    expect(openAlerts()).toEqual([{ dedupe_key: `${teamId}:docuvault:functional`, kind: 'service_degraded', severity: 'warning' }]);
    expect(auditCount('alert.open')).toBe(opened + 1);

    // same failure again: no duplicate alert, no extra audit row
    applyHealthBatch([row({ flagstore: 'flag1', verdict: 'MUMBLE', round: 3 })], 'ingest', '2026-10-27T10:03:00.000Z');
    expect(openAlerts()).toHaveLength(1);
    expect(auditCount('alert.open')).toBe(opened + 1);

    const resolved = auditCount('alert.resolve');
    applyHealthBatch(allFlags('OK', { round: 4 }), 'ingest', '2026-10-27T10:04:30.000Z');
    expect(openAlerts()).toEqual([]);
    expect(auditCount('alert.resolve')).toBe(resolved + 1);
    const a = dbHelper.get<{ actor_name: string; actor_role: string }>(`SELECT actor_name, actor_role FROM audit_log WHERE action = 'alert.open' ORDER BY id DESC LIMIT 1`)!;
    expect(a).toEqual({ actor_name: 'system', actor_role: 'system' });
  });

  it('OFFLINE is a critical reachability alert', () => {
    applyHealthBatch(allFlags('OFFLINE'), 'ingest');
    expect(checkOf('reachability').status).toBe('fail');
    expect(openAlerts()).toEqual([{ dedupe_key: `${teamId}:docuvault:reachability`, kind: 'service_down', severity: 'critical' }]);
  });

  it('INTERNAL_ERROR is an info checker_error alert and is not blamed on the team', () => {
    applyHealthBatch(allFlags('INTERNAL_ERROR'), 'ingest');
    expect(checkOf('reachability').status).toBe('unknown');
    expect(checkOf('functional').status).toBe('unknown');
    expect(openAlerts()).toEqual([{ dedupe_key: `${teamId}:docuvault:checker_error`, kind: 'checker_error', severity: 'info' }]);
    applyHealthBatch(allFlags('OK', { round: 2 }), 'ingest');
    expect(openAlerts()).toEqual([]);
  });

  it('an unrecognised verdict is stored as UNKNOWN and leaves checks unknown', () => {
    applyHealthBatch(allFlags('SUCCESS'), 'ingest');
    expect(checkOf('reachability').status).toBe('unknown');
    const v = dbHelper.get<{ verdict: string }>(`SELECT verdict FROM flagstore_results WHERE team_id = ? AND flagstore = 'flag0' AND service_key = 'docuvault'`, teamId);
    expect(v?.verdict).toBe('UNKNOWN');
  });

  it('ignores rows older than the stored round or time (monotonic)', () => {
    applyHealthBatch(allFlags('OFFLINE', { round: 5 }), 'ingest', '2026-10-27T10:05:00.000Z');
    const r = applyHealthBatch(allFlags('OK', { round: 4 }), 'ingest', '2026-10-27T10:06:00.000Z');
    expect(r.accepted).toBe(0);
    expect(r.rejected.map(x => x.reason)).toEqual(['older_than_stored', 'older_than_stored', 'older_than_stored']);
    expect(checkOf('reachability').status).toBe('fail');

    // no round to compare: older checkedAt is ignored, newer one is applied
    expect(applyHealthBatch([row({ round: null, checkedAt: '2026-10-27T09:00:00Z' })], 'ingest').rejected).toEqual([{ index: 0, reason: 'older_than_stored' }]);
    expect(applyHealthBatch([row({ round: null, checkedAt: '2026-10-27T11:00:00Z' })], 'ingest').accepted).toBe(1);
  });

  it('a repeated round keeps the original checked_at so staleness stays honest', () => {
    applyHealthBatch(allFlags('OK', { round: 7 }), 'scoreboard', '2026-10-27T10:00:00.000Z');
    const r = applyHealthBatch(allFlags('OK', { round: 7 }), 'scoreboard', '2026-10-27T10:03:00.000Z');
    expect(r).toMatchObject({ accepted: 0, unchanged: 3 });
    const at = dbHelper.get<{ checked_at: string }>(`SELECT checked_at FROM flagstore_results WHERE team_id = ? AND flagstore = 'flag0' AND service_key = 'docuvault'`, teamId)!.checked_at;
    expect(at).toBe('2026-10-27T10:00:00.000Z');
  });

  it('rejects unknown team, service, flagstore and bad values without throwing; valid rows still apply', () => {
    const r = applyHealthBatch([
      row({ externalTeamId: '999' }),
      row({ serviceKey: 'nope' }),
      row({ flagstore: 'flag9' }),
      row({ round: -1 }),
      row({ checkedAt: 'not a date' }),
      row({ flagstore: 'flag1' }),
    ], 'ingest');
    expect(r.rejected).toEqual([
      { index: 0, reason: 'unknown_team' },
      { index: 1, reason: 'unknown_service' },
      { index: 2, reason: 'unknown_flagstore' },
      { index: 3, reason: 'invalid_round' },
      { index: 4, reason: 'invalid_checked_at' },
    ]);
    expect(r.accepted).toBe(1);
  });

  it('rejects rows for an archived team', () => {
    dbHelper.run(`UPDATE teams SET archived_at = '2026-10-27T00:00:00Z' WHERE id = ?`, teamId);
    expect(applyHealthBatch([row()], 'ingest').rejected).toEqual([{ index: 0, reason: 'team_archived' }]);
  });

  it('rejects a checkedAt in the future so it can never keep data fresh or block later rows', () => {
    const r = applyHealthBatch([row({ round: null, checkedAt: '2099-01-01T00:00:00Z' })], 'ingest', '2026-10-27T10:00:00.000Z');
    expect(r.rejected).toEqual([{ index: 0, reason: 'invalid_checked_at' }]);
    expect(applyHealthBatch([row({ round: null, checkedAt: '2026-10-27T10:00:30Z' })], 'ingest', '2026-10-27T10:00:00.000Z').accepted).toBe(1); // within 60 s skew
  });

  it('rolls the whole batch back if the database throws mid-batch', () => {
    applyHealthBatch(allFlags('OK', { round: 1 }), 'ingest', '2026-10-27T10:00:00.000Z');
    const realRun = dbHelper.run.bind(dbHelper);
    let calls = 0;
    vi.spyOn(dbHelper, 'run').mockImplementation(((sql: string, ...params: unknown[]) => {
      if (sql.includes('INSERT INTO flagstore_results') && ++calls === 2) throw new Error('disk full');
      return realRun(sql, ...(params as never[]));
    }) as typeof dbHelper.run);
    expect(() => applyHealthBatch(allFlags('OFFLINE', { round: 2 }), 'ingest', '2026-10-27T10:02:00.000Z')).toThrow('disk full');
    vi.restoreAllMocks();
    const verdicts = dbHelper.all<{ verdict: string; round: number }>(`SELECT verdict, round FROM flagstore_results WHERE team_id = ? AND service_key = 'docuvault'`, teamId);
    expect(verdicts.every(v => v.verdict === 'OK' && v.round === 1)).toBe(true);
    expect(openAlerts()).toEqual([]);
  });
});

describe('scoreboard source', () => {
  it('parses the provisional fixture and refuses any other shape', () => {
    const fixture = JSON.parse(fs.readFileSync('tests/fixtures/scoreboard.provisional.json', 'utf8'));
    const snap = parseScoreboard(fixture);
    expect(snap.currentRound).toBe(41);
    expect(snap.rows).toHaveLength(3);
    for (const bad of [null, [], {}, { currentRound: '41', teams: [] }, { currentRound: 1, teams: [{ teamId: 1 }] }, { round: 1, teams: [] }]) {
      expect(() => parseScoreboard(bad)).toThrow(expect.objectContaining({ code: 'SOURCE_SHAPE_UNKNOWN' }));
    }
  });

  it('requests with timeout, no redirects, no cookies; refuses hosts off the allow-list', async () => {
    const f = okFetch(board(1));
    await fetchScoreboardJson(URL_OK, ['score.example:8080'], f);
    const init = (f as unknown as ReturnType<typeof vi.fn>).mock.calls[0][1] as RequestInit;
    expect(init).toMatchObject({ method: 'GET', redirect: 'error', credentials: 'omit' });
    expect(init.signal).toBeInstanceOf(AbortSignal);
    await expect(fetchScoreboardJson(URL_OK, ['other.example'], f)).rejects.toMatchObject({ code: 'host_not_allowed' });
    await expect(fetchScoreboardJson('ftp://score.example:8080/x', ['score.example:8080'], f)).rejects.toMatchObject({ code: 'host_not_allowed' });
  });

  it.each([
    ['timeout', () => { throw new DOMException('t', 'TimeoutError'); }, 'timeout'],
    ['redirect', () => { throw Object.assign(new TypeError('fetch failed'), { cause: new Error('unexpected redirect') }); }, 'redirect_refused'],
    ['network', () => { throw new TypeError('fetch failed'); }, 'network_error'],
  ])('maps a %s failure to a safe code', async (_n, impl, code) => {
    await expect(fetchScoreboardJson(URL_OK, ['score.example:8080'], (async () => impl()) as unknown as typeof fetch))
      .rejects.toMatchObject({ code });
  });

  it('refuses redirect responses, HTTP errors, invalid JSON and oversize bodies', async () => {
    const hosts = ['score.example:8080'];
    const resp = (r: Response) => (async () => r) as unknown as typeof fetch;
    await expect(fetchScoreboardJson(URL_OK, hosts, resp(new Response('', { status: 302 })))).rejects.toMatchObject({ code: 'redirect_refused' });
    await expect(fetchScoreboardJson(URL_OK, hosts, resp(new Response('', { status: 502 })))).rejects.toMatchObject({ code: 'http_502' });
    await expect(fetchScoreboardJson(URL_OK, hosts, resp(new Response('<html>', { status: 200 })))).rejects.toMatchObject({ code: 'invalid_json' });
    await expect(fetchScoreboardJson(URL_OK, hosts, resp(new Response('x', { status: 200, headers: { 'content-length': String(3 * 1024 * 1024) } })))).rejects.toMatchObject({ code: 'too_large' });
    await expect(fetchScoreboardJson(URL_OK, hosts, resp(new Response('x'.repeat(2 * 1024 * 1024 + 1), { status: 200 })))).rejects.toMatchObject({ code: 'too_large' });
  });

  it('error codes never contain the URL', async () => {
    try {
      await fetchScoreboardJson('http://user:secret@score.example:8080/x?token=abc', ['score.example:8080'], (async () => { throw new TypeError('fetch failed'); }) as unknown as typeof fetch);
    } catch (e) {
      expect(String((e as Error).message)).not.toMatch(/secret|token|score\.example/);
    }
  });
});

describe('lazy pull, staleness and frozen detection', () => {
  it('is a no-op for HEALTH_SOURCE=mock', async () => {
    const f = okFetch(board(1));
    await pullIfDue({ fetchImpl: f, nowMs: T0 });
    expect(f).not.toHaveBeenCalled();
  });

  it('pulls once per interval, single-flight, and applies the data', async () => {
    useScoreboard();
    const f = okFetch(board(41, 'MUMBLE'));
    await Promise.all([pullIfDue({ fetchImpl: f, nowMs: T0 }), pullIfDue({ fetchImpl: f, nowMs: T0 })]);
    expect(f).toHaveBeenCalledTimes(1);
    expect(checkOf('functional').status).toBe('fail');
    await pullIfDue({ fetchImpl: f, nowMs: T0 + 10_000 }); // inside HEALTH_POLL_SEC
    expect(f).toHaveBeenCalledTimes(1);
    await pullIfDue({ fetchImpl: f, nowMs: T0 + 16_000 });
    expect(f).toHaveBeenCalledTimes(2);
    expect(getHealthSourceStatus(T0 + 16_000)).toMatchObject({ source: 'scoreboard', state: 'ok', lastRound: 41, lastError: null });
  });

  it('force is rate limited to one pull per 5 s', async () => {
    useScoreboard();
    const f = okFetch(board(1));
    await pullIfDue({ fetchImpl: f, nowMs: T0, force: true });
    await pullIfDue({ fetchImpl: f, nowMs: T0 + 3000, force: true });
    expect(f).toHaveBeenCalledTimes(1);
    await pullIfDue({ fetchImpl: f, nowMs: T0 + 6000, force: true });
    expect(f).toHaveBeenCalledTimes(2);
  });

  it('records a safe error, keeps old data, and the data ages into stale/unknown', async () => {
    useScoreboard();
    await pullIfDue({ fetchImpl: okFetch(board(1)), nowMs: T0 });
    expect(getHealthSourceStatus(T0).state).toBe('ok');
    clock = new Date(T0 + 20_000);
    expect((await adapter.getTeam(teamId))!.environment.services[0].checks.map(c => c.status)).toEqual(['pass', 'pass']);

    const failing = (async () => { throw new DOMException('t', 'TimeoutError'); }) as unknown as typeof fetch;
    await pullIfDue({ fetchImpl: failing, nowMs: T0 + 20_000 });
    expect(getHealthSourceStatus(T0 + 20_000)).toMatchObject({ state: 'error', lastError: 'timeout' });

    // 271 s after the last good data (stale_after_sec = 270): unknown, flagged stale, never green
    clock = new Date(T0 + 271_000);
    const svc = (await adapter.getTeam(teamId))!.environment.services.find(s => s.key === 'docuvault')!;
    expect(svc.stale).toBe(true);
    expect(svc.checks.every(c => c.status === 'unknown' && c.detail === 'stale')).toBe(true);
    expect((await adapter.getTeam(teamId))!.health).toBe('unknown');
  });

  it('unrecognised file shape is recorded as SOURCE_SHAPE_UNKNOWN and changes nothing', async () => {
    useScoreboard();
    await pullIfDue({ fetchImpl: okFetch({ rounds: [] }), nowMs: T0 });
    expect(getHealthSourceStatus(T0)).toMatchObject({ state: 'error', lastError: 'SOURCE_SHAPE_UNKNOWN' });
    expect(checkOf('reachability').status).toBe('unknown');
  });

  it('reports all_rows_rejected when no row matches a dashboard team', async () => {
    useScoreboard();
    dbHelper.run(`UPDATE teams SET external_team_id = '77'`);
    await pullIfDue({ fetchImpl: okFetch(board(3)), nowMs: T0 });
    expect(getHealthSourceStatus(T0)).toMatchObject({ state: 'error', lastError: 'all_rows_rejected' });
  });

  it('detects a frozen source: reachable, but the round has not moved for more than 2 rounds', async () => {
    useScoreboard();
    const f = okFetch(board(41));
    for (const s of [0, 60, 120, 170]) await pullIfDue({ fetchImpl: f, nowMs: T0 + s * 1000 });
    expect(getHealthSourceStatus(T0 + 170_000).state).toBe('ok'); // 170 s < 2 × 90 s
    await pullIfDue({ fetchImpl: f, nowMs: T0 + 200_000 });
    expect(getHealthSourceStatus(T0 + 200_000)).toMatchObject({ state: 'frozen', lastRound: 41, lastError: null });
    await pullIfDue({ fetchImpl: okFetch(board(42)), nowMs: T0 + 220_000 });
    expect(getHealthSourceStatus(T0 + 220_000).state).toBe('ok');
  });

  it('goes stale when nothing arrives for stale_after_sec', async () => {
    useScoreboard();
    await pullIfDue({ fetchImpl: okFetch(board(1)), nowMs: T0 });
    expect(getHealthSourceStatus(T0 + 271_000).state).toBe('stale');
  });

  it('clears simulated results on first adoption so a seeded high round cannot block real data', async () => {
    useScoreboard();
    dbHelper.run(`UPDATE flagstore_results SET verdict = 'MUMBLE', round = 42, checked_at = '2026-10-27T08:00:00Z'`);
    dbHelper.run(`INSERT INTO alerts (id, team_id, severity, kind, dedupe_key, message, created_at) VALUES ('a_seed', ?, 'warning', 'service_degraded', 'seed:key', 'seeded', '2026-10-27T08:00:00Z')`, teamId);
    await pullIfDue({ fetchImpl: okFetch(board(3)), nowMs: T0 });
    expect(checkOf('functional').status).toBe('pass');
    expect(openAlerts()).toEqual([]);
    expect(dbHelper.get<{ round: number }>(`SELECT round FROM flagstore_results WHERE flagstore = 'flag0' AND service_key = 'docuvault'`)!.round).toBe(3);
  });

  it('shows overview source freshness', async () => {
    useScoreboard();
    await pullIfDue({ fetchImpl: okFetch(board(9)), nowMs: T0 });
    const o = await getOverview({ id: 'u', username: 'a', displayName: 'A', role: 'organizer_admin' });
    expect(o.healthSource).toMatchObject({ source: 'scoreboard', lastRound: 9 });
  });
});

describe('mock guard', () => {
  it('lifecycle transitions, health runs and fault injection do not overwrite real checks', async () => {
    useScoreboard();
    // bring the environment to running (provisioning takes 6 s), then apply real data
    clock = new Date(T0 + 7000);
    await adapter.resolveDue();
    applyHealthBatch(allFlags('OFFLINE', { round: 3 }), 'scoreboard', new Date(T0 + 7000).toISOString());
    expect(checkOf('reachability').status).toBe('fail');

    const f = okFetch(board(3, 'OFFLINE'));
    vi.stubGlobal('fetch', f);
    const snap = await adapter.runHealthChecks(teamId);
    expect(snap.services.find(s => s.key === 'docuvault')!.checks.find(c => c.type === 'reachability')!.status).toBe('fail');

    await adapter.requestAction(teamId, 'stop', { correlationId: 'c_1' });
    clock = new Date(T0 + 12_000);
    await adapter.resolveDue();
    await adapter.requestAction(teamId, 'start', { correlationId: 'c_2' });
    clock = new Date(T0 + 17_000);
    await adapter.resolveDue();
    expect((await adapter.getTeam(teamId))!.lifecycleState).toBe('running');
    expect(checkOf('reachability').status).toBe('fail'); // not reset to unknown by stop, not to pass by start
    expect(openAlerts().some(a => a.kind === 'service_down')).toBe(true);

    await expect(adapter.injectFault(teamId, 'docuvault', 'reachability', 'clear')).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
  });

  it('with HEALTH_SOURCE=mock the existing simulated behaviour is unchanged', async () => {
    clock = new Date(T0 + 7000);
    await adapter.resolveDue();
    const snap = await adapter.runHealthChecks(teamId);
    expect(snap.health).toBe('healthy');
  });
});

describe('ingest route', () => {
  const url = 'http://localhost/api/ingest/check-results';
  const post = (body: unknown, headers: Record<string, string> = { authorization: `Bearer ${TOKEN}` }, raw?: string) =>
    ingestPost(new Request(url, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: raw ?? JSON.stringify(body) }));
  const good = { results: [{ teamId: '1', serviceKey: 'docuvault', flagstore: 'flag1', verdict: 'MUMBLE', round: 4, checkedAt: '2026-10-27T10:00:00Z' }] };

  beforeEach(() => {
    vi.stubEnv('HEALTH_SOURCE', 'ingest');
    vi.stubEnv('INGEST_TOKEN', TOKEN);
  });

  it('accepts a valid batch and reports rejected rows by index', async () => {
    const res = await post({ results: [...good.results, { ...good.results[0], teamId: '404' }] });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ accepted: 1, rejected: [{ index: 1, reason: 'unknown_team' }] });
    expect(getHealthSourceStatus()).toMatchObject({ source: 'ingest', state: 'ok', lastRound: 4 });
    expect(auditCount('ingest.rejected')).toBeGreaterThan(0);
  });

  it('returns 404 when the token is unset or another source is selected', async () => {
    vi.stubEnv('INGEST_TOKEN', '');
    expect((await post(good)).status).toBe(404);
    vi.stubEnv('INGEST_TOKEN', TOKEN);
    vi.stubEnv('HEALTH_SOURCE', 'mock');
    expect((await post(good)).status).toBe(404);
  });

  it('rejects missing, wrong, short and non-bearer tokens with 401, and cookies do not authenticate', async () => {
    const before = auditCount('ingest.rejected');
    expect((await post(good, {})).status).toBe(401);
    expect((await post(good, { authorization: `Bearer ${'x'.repeat(40)}` })).status).toBe(401);
    expect((await post(good, { authorization: 'Bearer short' })).status).toBe(401);
    expect((await post(good, { authorization: `Basic ${TOKEN}` })).status).toBe(401);
    expect((await post(good, { cookie: `dc_session=${TOKEN}` })).status).toBe(401);
    expect(auditCount('ingest.rejected')).toBe(before + 5);
  });

  it('caps audit writes and then rate-limits repeated bad tokens', async () => {
    const before = auditCount('ingest.rejected');
    for (let i = 0; i < 15; i++) await post(good, { authorization: 'Bearer nope' });
    expect(auditCount('ingest.rejected') - before).toBe(10);
  });

  it('bad tokens never lock out the real checker', async () => {
    for (let i = 0; i < 200; i++) await post(good, { authorization: 'Bearer nope' });
    expect((await post(good)).status).toBe(200);
  });

  it('requires round or checkedAt on every row', async () => {
    const { checkedAt: _c, round: _r, ...bare } = good.results[0];
    void _c; void _r;
    expect((await post({ results: [bare] })).status).toBe(400);
  });

  it('does not mark the source ok when every row is rejected', async () => {
    await post({ results: [{ ...good.results[0], teamId: '404' }] });
    expect(getHealthSourceStatus()).toMatchObject({ state: 'error', lastError: 'all_rows_rejected' });
  });

  it('rate-limits the overall request rate', async () => {
    let last = 0;
    for (let i = 0; i < 125; i++) last = (await post(good)).status;
    expect(last).toBe(429);
  });

  it('rejects bodies over 256 KB (declared and streamed), invalid JSON, extra fields and more than 200 rows', async () => {
    const big = JSON.stringify({ results: [{ ...good.results[0], message: 'a'.repeat(300 * 1024) }] });
    expect((await post(null, { authorization: `Bearer ${TOKEN}`, 'content-length': String(big.length) }, big)).status).toBe(413);
    expect((await post(null, { authorization: `Bearer ${TOKEN}` }, big)).status).toBe(413);
    expect((await post(null, { authorization: `Bearer ${TOKEN}` }, '{nope')).status).toBe(400);
    expect((await post({ results: good.results, extra: 1 })).status).toBe(400);
    expect((await post({ results: [{ ...good.results[0], surprise: true }] })).status).toBe(400);
    expect((await post({ results: [] })).status).toBe(400);
    expect((await post({ results: Array.from({ length: 201 }, () => good.results[0]) })).status).toBe(400);
    expect((await post({ results: Array.from({ length: 200 }, () => good.results[0]) })).status).toBe(200);
  });

  it('answers GET with 405', () => {
    expect(ingestGet().status).toBe(405);
  });

  it('is a machine principal, not a role', () => {
    expect(machineCan('ingest', 'ingest.write')).toBe(true);
  });
});

describe('config and /api/meta', () => {
  const env = (o: Record<string, string> = {}) => ({ NODE_ENV: 'test', ...o }) as NodeJS.ProcessEnv;

  it('validates HEALTH_SOURCE and its dependencies, failing closed', () => {
    expect(loadConfig(env()).healthSource).toBe('mock');
    expect(() => loadConfig(env({ HEALTH_SOURCE: 'nope' }))).toThrow('HEALTH_SOURCE must be one of');
    expect(() => loadConfig(env({ HEALTH_SOURCE: 'scoreboard' }))).toThrow('requires HEALTH_SCOREBOARD_URL');
    expect(() => loadConfig(env({ HEALTH_SOURCE: 'scoreboard', HEALTH_SCOREBOARD_URL: 'ftp://h/x' }))).toThrow('http or https');
    expect(() => loadConfig(env({ HEALTH_SOURCE: 'scoreboard', HEALTH_SCOREBOARD_URL: 'not a url' }))).toThrow('valid URL');
    expect(() => loadConfig(env({ HEALTH_SOURCE: 'scoreboard', HEALTH_SCOREBOARD_URL: URL_OK, HEALTH_ALLOWED_HOSTS: 'other.example' }))).toThrow('HEALTH_ALLOWED_HOSTS');
    expect(() => loadConfig(env({ INGEST_TOKEN: 'short' }))).toThrow('INGEST_TOKEN must be at least 32');
    expect(() => loadConfig(env({ HEALTH_POLL_SEC: '0' }))).toThrow('HEALTH_POLL_SEC');
  });

  it('defaults the allow-list to the URL host and the poll interval to 15 s', () => {
    const c = loadConfig(env({ HEALTH_SOURCE: 'scoreboard', HEALTH_SCOREBOARD_URL: URL_OK }));
    expect(c.healthAllowedHosts).toEqual(['score.example:8080']);
    expect(c.healthPollSec).toBe(15);
  });

  it('rejects an explicit HEALTH_SOURCE=mock only when CHECK_RELEASE=1', () => {
    expect(() => loadConfig(env({ CHECK_RELEASE: '1', HEALTH_SOURCE: 'mock' }))).toThrow('not allowed in a release');
    expect(loadConfig(env({ CHECK_RELEASE: '1' })).healthSource).toBe('mock');
    expect(loadConfig(env({ HEALTH_SOURCE: 'mock' })).healthSource).toBe('mock');
  });

  it('badge matrix', () => {
    expect(badgeFor('mock', 'mock')).toBe('SIMULATED');
    expect(badgeFor('mock', 'scoreboard')).toBe('PARTIAL');
    expect(badgeFor('mock', 'ingest')).toBe('PARTIAL');
    expect(badgeFor('docker-compose', 'mock')).toBe('PARTIAL');
    expect(badgeFor('real', 'mock')).toBe('PARTIAL');
    expect(badgeFor('real', 'scoreboard')).toBe('LIVE');
  });

  it('/api/meta gives public callers only the badge, not source detail', async () => {
    useScoreboard();
    const body = await (await getMeta(new Request('http://localhost/api/meta'))).json() as Record<string, unknown>;
    expect(body).toMatchObject({ badge: 'PARTIAL', sources: { health: 'mock' }, health: { state: 'mock', lastError: null, lastRound: null }, frozen: false });
  });

  it('/api/meta reports sources, capabilities and badge without secrets or URLs', async () => {
    useScoreboard();
    vi.stubEnv('INGEST_TOKEN', TOKEN);
    vi.stubEnv('SESSION_SECRET', 's'.repeat(40));
    cookieState.token = await createSession({ id: 'u', username: 'a', displayName: 'A', role: 'organizer_admin' });
    const body = await (await getMeta(new Request('http://localhost/api/meta'))).json() as Record<string, unknown>;
    cookieState.token = undefined;
    expect(body).toMatchObject({
      badge: 'PARTIAL',
      sources: { health: 'scoreboard', lifecycle: 'mock', roster: 'manual' },
      capabilities: { resetKind: 'restore_patch', serviceLevelReset: false, terminalMode: 'per_team', flagstores: 3 },
      frozen: false,
    });
    const text = JSON.stringify(body);
    expect(text).not.toContain(TOKEN);
    expect(text).not.toContain('score.example');
  });
});
