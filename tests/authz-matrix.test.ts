import { beforeAll, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const cookieState = vi.hoisted(() => ({ token: undefined as string | undefined }));
vi.mock('next/headers', () => ({
  cookies: async () => ({
    get: (name: string) => (name === 'dc_session' && cookieState.token ? { name, value: cookieState.token } : undefined),
  }),
}));

import { createSession, type SessionUser } from '../src/lib/server/auth';
import { MockAdapter } from '../src/lib/server/adapters/mock';
import { dbHelper } from '../src/lib/server/db';
import { ensureUserRow } from './helpers/users';
import { AUTHZ, T2, type AuthzCase, type Exp } from './routes.authz';

const API_ROOT = path.join(process.cwd(), 'src', 'app', 'api');

function listRouteFiles(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap(e =>
    e.isDirectory() ? listRouteFiles(path.join(dir, e.name)) : e.name === 'route.ts' ? [path.join(dir, e.name)] : []);
}

const routes = listRouteFiles(API_ROOT).map(file => {
  const key = '/api/' + path.relative(API_ROOT, path.dirname(file)).split(path.sep).join('/');
  const src = fs.readFileSync(file, 'utf8');
  const methods = [...src.matchAll(/export (?:async )?function (GET|POST|PUT|PATCH|DELETE)\b/g)].map(m => m[1]);
  return { key: key === '/api/.' ? '/api' : key, file, methods };
}).sort((a, b) => a.key.localeCompare(b.key));

const admin: SessionUser = { id: 'u_admin', username: 'admin', displayName: 'Admin', role: 'organizer_admin' };
const operator: SessionUser = { id: 'u_op', username: 'operator', displayName: 'Operator', role: 'organizer_operator' };
const team: SessionUser = { id: 'u_team', username: 'team-01', displayName: 'Team 01', role: 'team', teamId: 'team-01' };

const HOST = 'localhost';

async function call(route: (typeof routes)[number], c: AuthzCase, opts: { token?: string; teamId?: string; origin?: string | null }) {
  cookieState.token = opts.token;
  const mod = await import(/* @vite-ignore */ route.file.split(path.sep).join('/'));
  let url = 'http://' + HOST + route.key;
  const params: Record<string, string> = { ...(c.params ?? {}) };
  if (opts.teamId && params.teamId) params.teamId = opts.teamId;
  for (const [k, v] of Object.entries(params)) url = url.replace(`[${k}]`, v);
  if (c.query) url += `?${c.query}`;
  const headers: Record<string, string> = { host: HOST, 'content-type': 'application/json' };
  if (opts.origin !== null) headers.origin = opts.origin ?? `http://${HOST}`;
  const init: RequestInit = { method: c.method, headers };
  if (c.method !== 'GET' && c.body !== undefined) init.body = JSON.stringify(c.body);
  const res: Response = await mod[c.method](new Request(url, init), { params: Promise.resolve(params) });
  return res.status;
}

function matches(status: number, exp: Exp): boolean {
  if (exp === 'allow') return status !== 401 && status !== 403;
  if (exp === 'deny') return status === 403;
  return status === exp;
}

let tokens: { admin: string; operator: string; team: string };

beforeAll(async () => {
  process.env.SESSION_SECRET = 'm'.repeat(48);
  delete process.env.DEMO_CONTROLS;
  delete process.env.INGEST_TOKEN;
  ensureUserRow(admin);
  ensureUserRow(operator);
  ensureUserRow({ id: 'u_target', username: 'target', displayName: 'Target', role: 'organizer_operator' });
  const adapter = new MockAdapter();
  await adapter.createTeam({ name: 'Matrix One' });
  await adapter.createTeam({ name: 'Matrix Two' });
  dbHelper.run(`UPDATE teams SET name = 'Matrix One' WHERE id = 'team-01'`);
  tokens = { admin: await createSession(admin), operator: await createSession(operator), team: await createSession(team) };
});

describe('route table coverage', () => {
  it('finds the route files', () => {
    expect(routes.length).toBeGreaterThan(25);
  });

  it.each(routes.map(r => [r.key, r] as const))('%s is listed in routes.authz.ts with every exported method', (key, r) => {
    expect(AUTHZ[key], `Add ${key} to tests/routes.authz.ts`).toBeDefined();
    const declared = (AUTHZ[key] ?? []).map(c => c.method).sort();
    expect(declared, `${key}: exported methods ${r.methods} vs table ${declared}`).toEqual([...r.methods].sort());
  });

  it('has no table entries for routes that do not exist', () => {
    const real = new Set(routes.map(r => r.key));
    expect(Object.keys(AUTHZ).filter(k => !real.has(k))).toEqual([]);
  });
});

describe('authorization matrix (route × method × principal)', () => {
  for (const route of routes) {
    for (const c of AUTHZ[route.key] ?? []) {
      const label = `${c.method} ${route.key}`;
      const mutating = c.method !== 'GET';

      if (c.kind === 'public' || c.kind === 'machine') {
        it(`${label} → ${c.any} for every caller (no cookie, admin cookie)`, async () => {
          expect(matches(await call(route, c, {}), c.any!)).toBe(true);
          expect(matches(await call(route, c, { token: tokens.admin }), c.any!)).toBe(true);
        });
        continue;
      }

      it(`${label} → 401 without a session`, async () => {
        expect(await call(route, c, {})).toBe(401);
      });
      it(`${label} → admin ${c.admin}, operator ${c.operator}, team ${c.team}`, async () => {
        for (const [who, token, exp] of [
          ['admin', tokens.admin, c.admin], ['operator', tokens.operator, c.operator], ['team', tokens.team, c.team],
        ] as const) {
          const status = await call(route, c, { token });
          expect(matches(status, exp!), `${label} as ${who}: got ${status}, expected ${exp}`).toBe(true);
        }
      });
      if (c.teamOther) {
        it(`${label} → team-01 session on team-02 is ${c.teamOther}`, async () => {
          const status = await call(route, c, { token: tokens.team, teamId: T2.teamId });
          expect(matches(status, c.teamOther!), `got ${status}`).toBe(true);
        });
      }
      if (mutating) {
        it(`${label} → 403 for a cross-origin request with a valid admin session`, async () => {
          expect(await call(route, c, { token: tokens.admin, origin: 'http://evil.example' })).toBe(403);
        });
        it(`${label} → 403 when the Origin header is missing`, async () => {
          expect(await call(route, c, { token: tokens.admin, origin: null })).toBe(403);
        });
      }
    }
  }
});
