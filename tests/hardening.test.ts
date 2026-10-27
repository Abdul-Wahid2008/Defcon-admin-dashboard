import { beforeAll, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const cookieState = vi.hoisted(() => ({ token: undefined as string | undefined }));
vi.mock('next/headers', () => ({
  cookies: async () => ({
    get: (name: string) => (name === 'dc_session' && cookieState.token ? { name, value: cookieState.token } : undefined),
  }),
}));

import { checkLoginRateLimit, createSession, requireUser, resetLoginLimiterForTests, type SessionUser } from '../src/lib/server/auth';
import { idempotencyKeyFrom, intParam, readJson } from '../src/lib/server/limits';
import { GET as teamsGet, POST as teamsPost } from '../src/app/api/teams/route';
import { POST as logoutRoute } from '../src/app/api/auth/logout/route';
import { proxy } from '../src/proxy';
import { ensureUserRow } from './helpers/users';

const admin: SessionUser = { id: 'u_hard_admin', username: 'hardadmin', displayName: 'Admin', role: 'organizer_admin' };
const HOST = 'localhost';
const req = (path: string, init: RequestInit & { json?: unknown } = {}) =>
  new Request(`http://${HOST}${path}`, {
    method: init.method ?? 'GET',
    headers: { host: HOST, origin: `http://${HOST}`, 'content-type': 'application/json', ...(init.headers as Record<string, string>) },
    body: init.json !== undefined ? JSON.stringify(init.json) : init.body,
  });

beforeAll(() => {
  process.env.SESSION_SECRET = 'h'.repeat(48);
  ensureUserRow(admin);
});

describe('server-side logout', () => {
  it('stops the presented token working at once, but not the same user\'s other sessions', async () => {
    const copied = await createSession(admin); // e.g. a cookie someone copied
    const other = await createSession(admin);
    cookieState.token = copied;
    expect((await requireUser(req('/api/teams'))).id).toBe(admin.id);
    expect((await logoutRoute(req('/api/auth/logout', { method: 'POST' }))).status).toBe(204);

    cookieState.token = copied;
    await expect(requireUser(req('/api/teams'))).rejects.toMatchObject({ code: 'UNAUTHENTICATED' });
    cookieState.token = other;
    expect((await requireUser(req('/api/teams'))).id).toBe(admin.id);
  });
});

describe('request size and parameter limits', () => {
  it('readJson: parses small bodies, falls back on bad JSON, 413s on oversized ones (declared or streamed)', async () => {
    expect(await readJson(req('/x', { method: 'POST', json: { a: 1 } }), null)).toEqual({ a: 1 });
    expect(await readJson(req('/x', { method: 'POST', body: '{bad' }), 'fallback')).toBe('fallback');
    const big = JSON.stringify({ pad: 'x'.repeat(70 * 1024) });
    await expect(readJson(req('/x', { method: 'POST', body: big }), null)).rejects.toMatchObject({ httpStatus: 413 });
    // no Content-Length (chunked): the stream itself is capped
    const stream = new ReadableStream<Uint8Array>({ start(c) { c.enqueue(new TextEncoder().encode(big)); c.close(); } });
    const chunked = new Request(`http://${HOST}/x`, { method: 'POST', body: stream, duplex: 'half' } as RequestInit);
    await expect(readJson(chunked, null)).rejects.toMatchObject({ httpStatus: 413 });
  });

  it('a 70 KB body to POST /api/teams is a 413, not a 500', async () => {
    cookieState.token = await createSession(admin);
    const res = await teamsPost(req('/api/teams', { method: 'POST', body: JSON.stringify({ name: 'Big Team', notes: 'x'.repeat(70 * 1024) }) }));
    expect(res.status).toBe(413);
  });

  it('intParam clamps and defaults; an absurd page no longer crashes the list', async () => {
    expect(intParam('99999999999999999999', 1, 1, 100000)).toBe(100000);
    expect(intParam('-5', 1, 1, 100000)).toBe(1);
    expect(intParam('abc', 25, 1, 100)).toBe(25);
    expect(intParam(null, 25, 1, 100)).toBe(25);
    cookieState.token = await createSession(admin);
    expect((await teamsGet(req('/api/teams?page=99999999999999999999&pageSize=100000'))).status).toBe(200);
  });

  it('Idempotency-Key must be 1-128 printable ASCII characters', async () => {
    expect(idempotencyKeyFrom(req('/x', { headers: {} }))).toBeNull();
    expect(idempotencyKeyFrom(req('/x', { headers: { 'Idempotency-Key': 'abc-123' } }))).toBe('abc-123');
    expect(() => idempotencyKeyFrom(req('/x', { headers: { 'Idempotency-Key': 'k'.repeat(129) } }))).toThrow(/Idempotency-Key/);
    expect(() => idempotencyKeyFrom(req('/x', { headers: { 'Idempotency-Key': 'has space' } }))).toThrow(/Idempotency-Key/);
    cookieState.token = await createSession(admin);
    const res = await teamsPost(req('/api/teams', { method: 'POST', json: { name: 'Key Team' }, headers: { 'Idempotency-Key': 'k'.repeat(5000) } }));
    expect(res.status).toBe(400);
  });
});

describe('global login ceiling', () => {
  it('refuses the 121st attempt in a minute whatever the username, and recovers when the window passes', () => {
    resetLoginLimiterForTests();
    const t0 = 1_000_000;
    for (let i = 0; i < 120; i++) expect(() => checkLoginRateLimit('direct', `user${i}`, t0)).not.toThrow();
    expect(() => checkLoginRateLimit('direct', 'someone-else', t0 + 1000)).toThrow(/Too many login attempts/);
    expect(() => checkLoginRateLimit('direct', 'someone-else', t0 + 61_000)).not.toThrow();
    resetLoginLimiterForTests();
  });
});

describe('proxy', () => {
  it('answers a malformed percent-escape with 400', async () => {
    const res = await proxy(new NextRequest(`http://${HOST}/api/teams/%E0%A4%A`));
    expect(res.status).toBe(400);
  });
});
