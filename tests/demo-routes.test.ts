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

import { createSession, type SessionUser } from '../src/lib/server/auth';
import { POST as injectFault } from '../src/app/api/demo/inject/route';
import { POST as failNext } from '../src/app/api/demo/fail-next/route';
import { POST as reseed } from '../src/app/api/demo/reseed/route';

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

type DemoHandler = (req: Request) => Promise<Response>;

const handlers: Array<{ name: string; path: string; handler: DemoHandler }> = [
  { name: 'inject', path: '/api/demo/inject', handler: injectFault },
  { name: 'fail-next', path: '/api/demo/fail-next', handler: failNext },
  { name: 'reseed', path: '/api/demo/reseed', handler: reseed },
];

function postRequest(path: string, origin?: string): Request {
  return new Request(`http://console.local:3000${path}`, {
    method: 'POST',
    headers: { host: 'console.local:3000', ...(origin ? { origin } : {}) },
  });
}

const hadSecret = 'SESSION_SECRET' in process.env;
const previousSecret = process.env.SESSION_SECRET;
const hadDemoControls = 'DEMO_CONTROLS' in process.env;
const previousDemoControls = process.env.DEMO_CONTROLS;

beforeAll(() => {
  process.env.SESSION_SECRET = 'r'.repeat(48); // test-only session signing key
  // Release default: demo controls disabled.
  delete process.env.DEMO_CONTROLS;
});

afterAll(() => {
  if (hadSecret) process.env.SESSION_SECRET = previousSecret;
  else delete process.env.SESSION_SECRET;
  if (hadDemoControls) process.env.DEMO_CONTROLS = previousDemoControls;
  else delete process.env.DEMO_CONTROLS;
  cookieState.token = undefined;
});

describe('demo control routes are fail-closed (DEMO_CONTROLS disabled)', () => {
  it('returns 401 without a session', async () => {
    cookieState.token = undefined;
    for (const { path, handler } of handlers) {
      const res = await handler(postRequest(path, 'http://console.local:3000'));
      expect(res.status, path).toBe(401);
      const body = await res.json();
      expect(body.error.code, path).toBe('UNAUTHENTICATED');
    }
  });

  it('returns 403 for organizer_operator (admin-only demo controls)', async () => {
    cookieState.token = await createSession(operator);
    for (const { path, handler } of handlers) {
      const res = await handler(postRequest(path, 'http://console.local:3000'));
      expect(res.status, path).toBe(403);
      const body = await res.json();
      expect(body.error.code, path).toBe('FORBIDDEN');
    }
  });

  it('rejects an admin request without an Origin header (same-origin gate)', async () => {
    cookieState.token = await createSession(admin);
    for (const { path, handler } of handlers) {
      const res = await handler(postRequest(path));
      expect(res.status, path).toBe(403);
      const body = await res.json();
      expect(body.error.code, path).toBe('FORBIDDEN');
    }
  });

  it('returns 404 for an admin when demo controls are disabled (release config)', async () => {
    cookieState.token = await createSession(admin);
    for (const { path, handler } of handlers) {
      const res = await handler(postRequest(path, 'http://console.local:3000'));
      expect(res.status, path).toBe(404);
      const body = await res.json();
      expect(body.error.code, path).toBe('NOT_FOUND');
      expect(body.error.requestId, path).toBeTruthy();
    }
  });
});
