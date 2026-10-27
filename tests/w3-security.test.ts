import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import bcrypt from 'bcryptjs';

const cookieState = vi.hoisted(() => ({ token: undefined as string | undefined }));
vi.mock('next/headers', () => ({
  cookies: async () => ({
    get: (name: string) => (name === 'dc_session' && cookieState.token ? { name, value: cookieState.token } : undefined),
  }),
}));

import {
  checkLoginRateLimit, clearLoginAttempts, createSession, getClientIp, login, recordLoginFailure,
  requireUser, resetLoginLimiterForTests, setSessionCookie, clearSessionCookie, type SessionUser,
} from '../src/lib/server/auth';
import { dbHelper } from '../src/lib/server/db';
import { csvCell } from '../src/lib/csv';
import { appendAudit } from '../src/lib/server/audit';
import { exportAuditCsv } from '../src/lib/server/services/audit';
import { createUser, disableUser, listUsers, resetPassword, revokeSessions } from '../src/lib/server/services/users';
import { POST as freezeRoute } from '../src/app/api/settings/freeze/route';
import { GET as teamsGet, POST as teamsPost } from '../src/app/api/teams/route';
import { GET as auditGet } from '../src/app/api/audit/route';
import { POST as logoutRoute } from '../src/app/api/auth/logout/route';
import { POST as changePassword } from '../src/app/api/auth/change-password/route';
import { POST as importRoute } from '../src/app/api/teams/import/route';
import { POST as bulkRoute } from '../src/app/api/environments/bulk/route';
import { ensureUserRow } from './helpers/users';

const admin: SessionUser = { id: 'u_admin', username: 'admin', displayName: 'Admin', role: 'organizer_admin' };
const admin2: SessionUser = { id: 'u_admin2', username: 'admin2', displayName: 'Admin Two', role: 'organizer_admin' };
const operator: SessionUser = { id: 'u_op', username: 'operator', displayName: 'Operator', role: 'organizer_operator' };
const teamUser: SessionUser = { id: 'u_team', username: 'team-01', displayName: 'Team', role: 'team', teamId: 'team-01' };

const HOST = 'localhost';
const req = (path: string, init: RequestInit & { json?: unknown } = {}) =>
  new Request(`http://${HOST}${path}`, {
    method: init.method ?? 'GET',
    headers: { host: HOST, origin: `http://${HOST}`, 'content-type': 'application/json', ...(init.headers as Record<string, string>) },
    body: init.json !== undefined ? JSON.stringify(init.json) : init.body,
  });
const as = async (u: SessionUser) => { cookieState.token = await createSession(u); };
const auditCount = (action: string, outcome?: string) =>
  dbHelper.get<{ n: number }>(
    `SELECT COUNT(*) AS n FROM audit_log WHERE action = ? ${outcome ? 'AND outcome = ?' : ''}`, ...(outcome ? [action, outcome] : [action]))!.n;

beforeAll(() => {
  process.env.SESSION_SECRET = 'w'.repeat(48);
  ensureUserRow(admin);
  ensureUserRow(admin2);
  ensureUserRow(operator);
});
beforeEach(() => { cookieState.token = undefined; resetLoginLimiterForTests(); });
afterEach(() => { vi.unstubAllEnvs(); });

describe('mutation freeze', () => {
  const freeze = (json: unknown) => freezeRoute(req('/api/settings/freeze', { method: 'POST', json }));

  it('requires the typed word FREEZE, admin only, and is audited', async () => {
    await as(operator);
    expect((await freeze({ frozen: true, confirm: 'FREEZE' })).status).toBe(403);
    await as(admin);
    expect((await freeze({ frozen: true })).status).toBe(422);
    expect((await freeze({ frozen: true, confirm: 'freeze' })).status).toBe(422);
    expect((await freeze({ frozen: true, confirm: 'FREEZE' })).status).toBe(200);
    expect(auditCount('settings.freeze', 'success')).toBe(1);
    expect((await freeze({ frozen: false })).status).toBe(200);
  });

  it('refuses mutations with 423 MUTATIONS_FROZEN, keeps reads/audit/logout working, and can be unfrozen', async () => {
    await as(admin);
    await freeze({ frozen: true, confirm: 'FREEZE' });
    const denied = auditCount('team.create', 'denied');

    const create = await teamsPost(req('/api/teams', { method: 'POST', json: { name: 'Frozen Team' } }));
    expect(create.status).toBe(423);
    expect((await create.json()).error.code).toBe('MUTATIONS_FROZEN');
    expect(auditCount('team.create', 'denied')).toBe(denied + 1);

    const bulk = await bulkRoute(req('/api/environments/bulk', { method: 'POST', json: { action: 'stop', teamIds: ['team-01'], confirm: 'STOP 1 TEAMS' } }));
    expect(bulk.status).toBe(423); // refused as a whole, not a 200 envelope of per-team rejections

    expect((await teamsGet(req('/api/teams'))).status).toBe(200);
    expect((await auditGet(req('/api/audit'))).status).toBe(200);
    expect((await logoutRoute(req('/api/auth/logout', { method: 'POST' }))).status).toBe(204);
    await as(admin); // logout revoked that token for real

    expect((await freeze({ frozen: false })).status).toBe(200);
    expect((await teamsPost(req('/api/teams', { method: 'POST', json: { name: 'Thawed Team' } }))).status).toBeLessThan(300);
  });

  it('a denied caller still gets 403, not 423, while frozen', async () => {
    await as(admin);
    await freeze({ frozen: true, confirm: 'FREEZE' });
    await as(teamUser);
    expect((await teamsPost(req('/api/teams', { method: 'POST', json: { name: 'Nope Team' } }))).status).toBe(403);
    await as(admin);
    await freeze({ frozen: false });
  });
});

describe('session revocation and organizer accounts', () => {
  const opts = { requestId: 'r_test' };

  it('a revoked, disabled or deleted account is rejected with 401', async () => {
    const victim: SessionUser = { id: 'u_victim', username: 'victim', displayName: 'Victim', role: 'organizer_operator' };
    ensureUserRow(victim);
    await as(victim);
    expect((await requireUser(req('/api/teams'))).id).toBe('u_victim');

    revokeSessions(admin, 'u_victim', opts);
    await expect(requireUser(req('/api/teams'))).rejects.toMatchObject({ code: 'UNAUTHENTICATED' });

    await as({ ...victim, epoch: 1 }); // a fresh login carries the new epoch
    expect((await requireUser(req('/api/teams'))).id).toBe('u_victim');

    disableUser(admin, 'u_victim', opts);
    await expect(requireUser(req('/api/teams'))).rejects.toMatchObject({ code: 'UNAUTHENTICATED' });

    dbHelper.run(`DELETE FROM users WHERE id = 'u_victim'`);
    await as({ ...victim, epoch: 99 });
    await expect(requireUser(req('/api/teams'))).rejects.toMatchObject({ code: 'UNAUTHENTICATED' });
  });

  it('creates an organizer with a one-time password, forces a change, and never writes the password to the audit log', async () => {
    const { user, password } = await createUser(admin, { username: 'newbie', displayName: 'New Bie', role: 'organizer_operator' }, opts);
    expect(password).toHaveLength(16);
    expect(user).toMatchObject({ username: 'newbie', active: true, mustChangePassword: true });
    expect(JSON.stringify(listUsers(admin, opts))).not.toContain(password);
    const rows = dbHelper.all<{ message: string; details_json: string | null }>(`SELECT message, details_json FROM audit_log WHERE action = 'user.create'`);
    expect(JSON.stringify(rows)).not.toContain(password);
    const stored = dbHelper.get<{ password_hash: string }>(`SELECT password_hash FROM users WHERE id = ?`, user.id)!;
    expect(stored.password_hash).not.toContain(password);
    expect(bcrypt.getRounds(stored.password_hash)).toBeGreaterThanOrEqual(10);
    await expect(createUser(admin, { username: 'NEWBIE', displayName: 'Dup', role: 'organizer_operator' }, opts)).rejects.toMatchObject({ code: 'CONFLICT' });
  });

  it('only admins manage accounts', async () => {
    await expect(createUser(operator, { username: 'x1x1', displayName: 'X', role: 'organizer_operator' }, opts)).rejects.toMatchObject({ code: 'FORBIDDEN' });
    expect(() => listUsers(operator, opts)).toThrow();
    expect(() => revokeSessions(operator, 'u_admin', opts)).toThrow();
    expect(auditCount('user.revoke_sessions', 'denied')).toBeGreaterThan(0);
  });

  it('cannot disable yourself or the last active admin', () => {
    expect(() => disableUser(admin, 'u_admin', opts)).toThrow('own account');
    dbHelper.run(`UPDATE users SET active = 0 WHERE id = 'u_admin2'`);
    // only u_admin is an active admin now; a different admin actor cannot be simulated, so disable via admin2 (inactive row, active session)
    expect(() => disableUser(admin2, 'u_admin', opts)).toThrow('last active admin');
    dbHelper.run(`UPDATE users SET active = 1 WHERE id = 'u_admin2'`);
    expect(disableUser(admin, 'u_admin2', opts).user.active).toBe(false);
    dbHelper.run(`UPDATE users SET active = 1 WHERE id = 'u_admin2'`);
  });

  it('reset-password issues a new one-time password, forces a change and ends existing sessions', async () => {
    const t: SessionUser = { id: 'u_reset', username: 'resetme', displayName: 'Reset Me', role: 'organizer_operator' };
    ensureUserRow(t);
    await as(t);
    const { password, user } = await resetPassword(admin, 'u_reset', opts);
    expect(user.mustChangePassword).toBe(true);
    expect(password).toHaveLength(16);
    await expect(requireUser(req('/api/teams'))).rejects.toMatchObject({ code: 'UNAUTHENTICATED' });
  });
});

describe('must_change_password', () => {
  it('blocks the console until the password is changed, then revokes old sessions', async () => {
    dbHelper.run(
      `INSERT OR REPLACE INTO users (id, username, password_hash, display_name, role, active, created_at, must_change_password)
       VALUES ('u_mc', 'mustchange', ?, 'Must Change', 'organizer_operator', 1, '2026-10-27T00:00:00Z', 1)`,
      bcrypt.hashSync('temporary-pass-1', 10));
    const { token, user } = await login('mustchange', 'temporary-pass-1');
    expect(user.mustChangePassword).toBe(true);
    cookieState.token = token;

    const blocked = await teamsGet(req('/api/teams'));
    expect(blocked.status).toBe(403);
    expect((await blocked.json()).error.details.reason).toBe('PASSWORD_CHANGE_REQUIRED');

    const wrong = await changePassword(req('/api/auth/change-password', { method: 'POST', json: { currentPassword: 'nope-nope-nope', newPassword: 'a-brand-new-pass-9' } }));
    expect(wrong.status).toBe(401);
    const short = await changePassword(req('/api/auth/change-password', { method: 'POST', json: { currentPassword: 'temporary-pass-1', newPassword: 'short' } }));
    expect(short.status).toBe(400);
    const ok = await changePassword(req('/api/auth/change-password', { method: 'POST', json: { currentPassword: 'temporary-pass-1', newPassword: 'a-brand-new-pass-9' } }));
    expect(ok.status).toBe(200);
    expect(ok.headers.get('set-cookie')).toMatch(/dc_session=.+HttpOnly/);

    await expect(requireUser(req('/api/teams'))).rejects.toMatchObject({ code: 'UNAUTHENTICATED' }); // old token revoked
    const again = await login('mustchange', 'a-brand-new-pass-9');
    expect(again.user.mustChangePassword).toBe(false);
    cookieState.token = again.token;
    expect((await teamsGet(req('/api/teams'))).status).toBe(200);
    await expect(login('mustchange', 'temporary-pass-1')).rejects.toMatchObject({ code: 'UNAUTHENTICATED' });
  });

  it('a disabled account and an unknown account get the same login error', async () => {
    dbHelper.run(`UPDATE users SET active = 0 WHERE id = 'u_mc'`);
    const a = await login('mustchange', 'a-brand-new-pass-9').catch(e => e);
    const b = await login('nobody-here', 'whatever').catch(e => e);
    expect(a.message).toBe(b.message);
    expect(a.code).toBe('UNAUTHENTICATED');
  });
});

describe('login limiter', () => {
  const T = 1_000_000;

  it('locks ip+username after 5 failures for a minute', () => {
    for (let i = 0; i < 5; i++) recordLoginFailure('1.1.1.1', 'bob', T + i);
    expect(() => checkLoginRateLimit('1.1.1.1', 'bob', T + 10)).toThrow(/Too many/);
    expect(() => checkLoginRateLimit('1.1.1.1', 'alice', T + 10)).not.toThrow();
    expect(() => checkLoginRateLimit('1.1.1.1', 'bob', T + 61_000)).not.toThrow();
  });

  it('has a per-IP ceiling of 30 failures across usernames', () => {
    for (let i = 0; i < 30; i++) recordLoginFailure('2.2.2.2', `user${i}`, T);
    expect(() => checkLoginRateLimit('2.2.2.2', 'fresh-name', T + 1000)).toThrow(/Too many/);
    expect(() => checkLoginRateLimit('3.3.3.3', 'fresh-name', T + 1000)).not.toThrow();
    expect(() => checkLoginRateLimit('2.2.2.2', 'fresh-name', T + 10 * 60_000 + 1)).not.toThrow();
  });

  it('locks a username for 5 minutes after 10 failures from any addresses', () => {
    for (let i = 0; i < 10; i++) recordLoginFailure(`10.0.0.${i}`, 'Victim', T);
    expect(() => checkLoginRateLimit('99.9.9.9', 'victim', T + 1000)).toThrow(/Too many/);
    expect(() => checkLoginRateLimit('99.9.9.9', 'victim', T + 5 * 60_000 + 1)).not.toThrow();
  });

  it('a successful login clears the pair and username counters', () => {
    for (let i = 0; i < 4; i++) recordLoginFailure('4.4.4.4', 'carol', T);
    clearLoginAttempts('4.4.4.4', 'carol');
    recordLoginFailure('4.4.4.4', 'carol', T);
    expect(() => checkLoginRateLimit('4.4.4.4', 'carol', T)).not.toThrow();
  });

  it('ignores X-Forwarded-For unless TRUST_PROXY=true, then uses the rightmost entry', () => {
    const r = new Request('http://localhost/x', { headers: { 'x-forwarded-for': '6.6.6.6, 7.7.7.7' } });
    expect(getClientIp(r)).toBe('direct');
    vi.stubEnv('TRUST_PROXY', 'true');
    expect(getClientIp(r)).toBe('7.7.7.7');
    expect(getClientIp(new Request('http://localhost/x'))).toBe('direct');
  });
});

describe('session cookie flags', () => {
  const res = () => new Response(null);
  const cookieOf = (r: Response) => r.headers.get('set-cookie')!;

  it('is HttpOnly, SameSite=Lax, not Secure on plain HTTP', () => {
    const c = cookieOf(setSessionCookie(res(), 't', new Request('http://localhost/x')));
    expect(c).toContain('HttpOnly');
    expect(c).toContain('SameSite=Lax');
    expect(c).not.toContain('Secure');
  });

  it('is Secure behind HTTPS (X-Forwarded-Proto) or with COOKIE_SECURE=true, including on logout', () => {
    expect(cookieOf(setSessionCookie(res(), 't', new Request('http://localhost/x', { headers: { 'x-forwarded-proto': 'https' } })))).toContain('Secure');
    vi.stubEnv('COOKIE_SECURE', 'true');
    expect(cookieOf(setSessionCookie(res(), 't'))).toContain('Secure');
    expect(clearSessionCookie()).toContain('Secure');
  });
});

describe('CSV hardening', () => {
  it('neutralises formula prefixes and escapes quotes', () => {
    expect(csvCell('=1+1')).toBe(`"'=1+1"`);
    expect(csvCell('+SUM(A1)')).toBe(`"'+SUM(A1)"`);
    expect(csvCell('-2')).toBe(`"'-2"`);
    expect(csvCell('@cmd')).toBe(`"'@cmd"`);
    expect(csvCell(' =1+1')).toBe(`"' =1+1"`);
    expect(csvCell('\n=1+1')).toBe(`"'\n=1+1"`);
    expect(csvCell('\tTAB')).toBe(`"'\tTAB"`);
    expect(csvCell('\rCR')).toBe(`"'\rCR"`);
    expect(csvCell('say "hi", ok')).toBe('"say ""hi"", ok"');
    expect(csvCell(null)).toBe('""');
    expect(csvCell(42)).toBe('"42"');
  });

  it('the audit export guards hostile names and messages', () => {
    appendAudit({ actorName: '=HYPERLINK("http://evil")', actorRole: 'anonymous', action: 'auth.login_failed', targetType: 'session', outcome: 'failure', message: '@SUM(1)," injected' });
    const csv = exportAuditCsv(admin, {});
    expect(csv).toContain(`"'=HYPERLINK(""http://evil"")"`);
    expect(csv).toContain(`"'@SUM(1),"" injected"`);
    expect(csv).not.toMatch(/(^|,)"?[=@]HYPERLINK/m);
  });
});

describe('import caps', () => {
  it('rejects more than 40 rows and bodies over 128 KB', async () => {
    await as(admin);
    const rows = Array.from({ length: 41 }, (_, i) => ({ name: `Cap Team ${i}` }));
    expect((await importRoute(req('/api/teams/import', { method: 'POST', json: { rows, dryRun: true } }))).status).toBe(400);
    const big = { rows: [{ name: 'Big', participantNames: ['x'.repeat(200 * 1024)] }], dryRun: true };
    expect((await importRoute(req('/api/teams/import', { method: 'POST', json: big }))).status).toBe(413);
    const ok = await importRoute(req('/api/teams/import', { method: 'POST', json: { rows: rows.slice(0, 40), dryRun: true } }));
    expect(ok.status).toBe(200);
  });
});

describe('security headers', () => {
  async function headersFor(nodeEnv: string) {
    vi.resetModules();
    vi.stubEnv('NODE_ENV', nodeEnv);
    const cfg = (await import('../next.config')).default;
    const list = await cfg.headers!();
    const all = Object.fromEntries(list.find(h => h.source === '/:path*')!.headers.map(h => [h.key, h.value]));
    const api = list.find(h => h.source === '/api/:path*')!.headers;
    // the CSP is per request (nonce) and comes from the proxy
    const { NextRequest } = await import('next/server');
    const { proxy } = await import('../src/proxy');
    const res = await proxy(new NextRequest('http://localhost/login'));
    const csp = res.headers.get('Content-Security-Policy') ?? '';
    const again = (await proxy(new NextRequest('http://localhost/login'))).headers.get('Content-Security-Policy') ?? '';
    return { all, api, csp, again, poweredBy: cfg.poweredByHeader };
  }

  it('production: CSP without unsafe-eval, frame-ancestors none, nosniff, no-referrer, no-store on /api', async () => {
    const { all, api, csp, again, poweredBy } = await headersFor('production');
    expect(csp).toContain("frame-ancestors 'none'");
    expect(csp).not.toContain('unsafe-eval');
    expect(csp).toContain("object-src 'none'");
    expect(csp).not.toMatch(/script-src[^;]*'unsafe-inline'/); // inline scripts only with this request's nonce
    expect(csp).toMatch(/script-src 'self' 'nonce-[A-Za-z0-9+/=]{20,}' 'strict-dynamic'/);
    expect(again).not.toBe(csp); // a fresh nonce per request
    expect(all['Content-Security-Policy']).toBeUndefined(); // no second, weaker static policy
    expect(poweredBy).toBe(false);
    expect(all['X-Content-Type-Options']).toBe('nosniff');
    expect(all['Referrer-Policy']).toBe('no-referrer');
    expect(all['X-Frame-Options']).toBe('DENY');
    expect(all['Permissions-Policy']).toContain('camera=()');
    expect(api).toEqual([{ key: 'Cache-Control', value: 'no-store' }]);
  });

  it('development allows unsafe-eval for React refresh only', async () => {
    const { csp } = await headersFor('development');
    expect(csp).toContain("'unsafe-eval'");
  });
});
