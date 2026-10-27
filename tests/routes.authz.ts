/**
 * Declarative authorization table for every route under src/app/api (docs/12 §9 S1).
 * tests/authz-matrix.test.ts globs the route files and FAILS when a route or an exported method is missing here.
 *
 * Exp:
 *   'allow' → the request passes authn/authz (any status except 401/403; validation or state errors are fine)
 *   'deny'  → 403
 *   number  → exactly that status
 * Bodies must be valid, because zod runs before the permission check in the services.
 */
export type Exp = 'allow' | 'deny' | number;
export type Method = 'GET' | 'POST' | 'PATCH' | 'DELETE';

export interface AuthzCase {
  method: Method;
  params?: Record<string, string>;
  query?: string;
  body?: unknown;
  /** 'session' = cookie auth (default); 'public' = no auth needed; 'machine' = bearer token, never cookies */
  kind?: 'session' | 'public' | 'machine';
  admin?: Exp;
  operator?: Exp;
  /** team-01 session acting on team-01 */
  team?: Exp;
  /** team-01 session acting on team-02 (only for routes with a teamId) */
  teamOther?: Exp;
  /** Mutating session routes must answer 423 for an admin while frozen, unless listed here as exempt (with the reason). */
  frozen?: 'exempt';
  /** public/machine routes: the single expectation for every caller */
  any?: Exp;
}

const T1 = { teamId: 'team-01' };
const T2 = { teamId: 'team-02' };

const organizerOnly = { admin: 'allow', operator: 'allow', team: 'deny' } as const;
const adminOnly = { admin: 'allow', operator: 'deny', team: 'deny' } as const;

export const AUTHZ: Record<string, AuthzCase[]> = {
  '/api/alerts': [{ method: 'GET', ...organizerOnly }],
  '/api/audit': [{ method: 'GET', ...organizerOnly }],
  '/api/audit/export.csv': [{ method: 'GET', ...organizerOnly }],

  '/api/auth/login': [{ method: 'POST', kind: 'public', body: {}, any: 400 }],
  '/api/auth/logout': [{ method: 'POST', kind: 'public', any: 204 }],
  '/api/auth/me': [{ method: 'GET', admin: 'allow', operator: 'allow', team: 'allow' }],
  '/api/auth/change-password': [{ method: 'POST', body: {}, admin: 400, operator: 400, team: 'deny', frozen: 'exempt' }], // own credentials, not event state

  '/api/demo/fail-next': [{ method: 'POST', admin: 404, operator: 'deny', team: 'deny', frozen: 'exempt' }], // 404 first while demo controls are off
  '/api/demo/inject': [{ method: 'POST', admin: 404, operator: 'deny', team: 'deny', frozen: 'exempt' }], // 404 first while demo controls are off
  '/api/demo/reseed': [{ method: 'POST', admin: 404, operator: 'deny', team: 'deny', frozen: 'exempt' }], // 404 first while demo controls are off

  '/api/environments/bulk': [{ method: 'POST', body: { action: 'start', teamIds: ['team-01'] }, ...organizerOnly }],

  // Machine route: 404 while INGEST_TOKEN is unset; a session cookie never authenticates it.
  '/api/ingest/check-results': [
    { method: 'POST', kind: 'machine', body: { results: [] }, any: 404 },
    { method: 'GET', kind: 'machine', any: 405 },
  ],

  '/api/meta': [{ method: 'GET', kind: 'public', any: 200 }],
  '/api/overview': [{ method: 'GET', ...organizerOnly }],

  '/api/settings': [
    { method: 'GET', ...organizerOnly },
    { method: 'PATCH', body: { competitionStatus: 'running' }, ...adminOnly },
  ],
  '/api/settings/freeze': [{ method: 'POST', body: { frozen: false }, ...adminOnly, frozen: 'exempt' }], // must work to unfreeze

  '/api/teams': [
    { method: 'GET', ...organizerOnly },
    { method: 'POST', body: { name: 'Matrix Team' }, ...organizerOnly },
  ],
  '/api/teams/import': [{ method: 'POST', body: { rows: [{ name: 'Matrix Import' }], dryRun: true }, ...organizerOnly }],
  '/api/teams/[teamId]': [
    { method: 'GET', params: T1, admin: 'allow', operator: 'allow', team: 'allow', teamOther: 'deny' },
    { method: 'PATCH', params: T1, body: { notes: 'matrix' }, ...organizerOnly },
    { method: 'DELETE', params: T1, body: { confirmName: 'definitely not the name' }, admin: 422, operator: 'deny', team: 'deny' },
  ],
  '/api/teams/[teamId]/credentials/rotate': [{ method: 'POST', params: T1, body: {}, ...organizerOnly }],
  '/api/teams/[teamId]/environment/reset': [{ method: 'POST', params: T1, ...organizerOnly }],
  '/api/teams/[teamId]/environment/start': [{ method: 'POST', params: T1, ...organizerOnly }],
  '/api/teams/[teamId]/environment/stop': [{ method: 'POST', params: T1, ...organizerOnly }],
  '/api/teams/[teamId]/health': [
    { method: 'GET', params: T1, admin: 'allow', operator: 'allow', team: 'allow', teamOther: 'deny' },
  ],
  '/api/teams/[teamId]/health/run': [{ method: 'POST', params: T1, ...organizerOnly, frozen: 'exempt' }], // read-refresh of health, not a state change
  '/api/teams/[teamId]/services/[key]/restart': [
    { method: 'POST', params: { ...T1, key: 'docuvault' }, ...organizerOnly },
  ],
  '/api/teams/[teamId]/services/[key]/reset': [
    { method: 'POST', params: { ...T1, key: 'docuvault' }, body: { reason: 'matrix test reset', confirmTeamId: 'team-01' }, ...organizerOnly },
  ],
  '/api/teams/[teamId]/participants': [
    { method: 'GET', params: T1, admin: 'allow', operator: 'allow', team: 'allow', teamOther: 'deny' },
    { method: 'POST', params: T1, body: { name: 'Matrix Person' }, ...organizerOnly },
  ],
  '/api/teams/[teamId]/participants/[participantId]': [
    { method: 'DELETE', params: { ...T1, participantId: 'p_missing' }, ...organizerOnly },
  ],

  '/api/users': [
    { method: 'GET', ...adminOnly },
    { method: 'POST', body: { username: 'matrix.user', displayName: 'Matrix', role: 'organizer_operator' }, ...adminOnly },
  ],
  '/api/users/[id]/disable': [{ method: 'POST', params: { id: 'u_target' }, ...adminOnly, frozen: 'exempt' }], // security action
  '/api/users/[id]/reset-password': [{ method: 'POST', params: { id: 'u_target' }, ...adminOnly }],
  '/api/users/[id]/revoke-sessions': [{ method: 'POST', params: { id: 'u_target' }, ...adminOnly, frozen: 'exempt' }], // security action
};

export { T2 };
