# 03 — API CONTRACT (v1.1)

> v1.1 changes are **additive** (terminal endpoint, `Service.placeholder`, `checker_error` alert kind, `docker-compose` adapter value, bulk and import endpoints). See §6 and `09_CHANGELOG`.

This is the single contract between the UI, the route handlers, and any future orchestrator. It is also the page to send to the club's backend developers: if their API can supply these shapes, `RealAdapter` is a thin mapping layer.

## 1. Conventions

- Base path `/api`. JSON only. UTF-8. Timestamps are UTC ISO-8601 strings (`2026-10-18T09:30:00.000Z`).
- Auth: session cookie `dc_session` (httpOnly JWT) set by `POST /api/auth/login`. Every route except `login` and `meta` requires it.
- Mutating requests (`POST`, `PATCH`, `DELETE`) must send `Content-Type: application/json` and a same-origin `Origin` header.
- Lifecycle actions accept an optional `Idempotency-Key` header (UUID). Same key + same user + same route → the original response is replayed (header `Idempotent-Replay: true`). Keys expire after 24 h.
- Every response carries `X-Request-Id`. Errors echo it in the body.
- Pagination: `?page=1&pageSize=25` (max 100). Responses: `{ items, page, pageSize, total }`.
- IDs: team `team-01`…`team-99`; participant `p_<8 hex>`; audit `integer`; alert `a_<8 hex>`; correlation `c_<12 hex>`.

### Error body (all non-2xx)

```json
{ "error": { "code": "INVALID_TRANSITION", "message": "Cannot reset a stopped environment.", "details": { "from": "stopped", "action": "reset" }, "requestId": "r_9f3c1a2b4d" } }
```

| HTTP | code | When |
|---|---|---|
| 400 | `VALIDATION_ERROR` | zod failure; `details.fieldErrors` |
| 401 | `UNAUTHENTICATED` | no/invalid session |
| 403 | `FORBIDDEN` | role lacks permission; `details.required` |
| 404 | `NOT_FOUND` | team/participant/alert missing (also for demo routes when disabled) |
| 409 | `INVALID_TRANSITION` | action not allowed from current state |
| 409 | `ACTION_IN_PROGRESS` | environment already has a pending transition |
| 409 | `CONFLICT` | duplicate team name, etc. |
| 422 | `CONFIRMATION_MISMATCH` | delete without matching `confirmName` |
| 429 | `RATE_LIMITED` | login lockout; `Retry-After` header |
| 500 | `INTERNAL` | unexpected; never leaks stack traces |
| 502 | `ADAPTER_ERROR` | real orchestrator failed/unreachable (real mode) |

## 2. Shared types (TypeScript, mirrored by zod in `src/lib/schemas`)

```ts
type Role = 'organizer_admin' | 'organizer_operator' | 'team';
type LifecycleState = 'provisioning' | 'running' | 'stopping' | 'stopped' | 'starting'
                    | 'resetting' | 'deleting' | 'deleted' | 'failed';
type LifecycleAction = 'start' | 'stop' | 'reset' | 'delete';
type Health = 'healthy' | 'degraded' | 'down' | 'unknown';
type CheckType = 'reachability' | 'functional';
type CheckStatus = 'pass' | 'fail' | 'unknown';
type AccountStatus = 'active' | 'suspended';

interface User { id: string; username: string; displayName: string; role: Role }

interface PendingAction {
  action: LifecycleAction | 'provision';
  correlationId: string;
  from: LifecycleState;
  to: LifecycleState;          // target stable state on success
  startedAt: string;
  estimatedEndsAt: string;
}

interface Check { type: CheckType; status: CheckStatus; detail: string | null; lastCheckedAt: string | null }
// detail carries the checker verdict text, e.g. 'OFFLINE: connection refused' / 'MUMBLE: login failed' (A17)
interface Service { key: string; name: string; port: number; placeholder: boolean; checks: Check[]; flagstores?: FlagstoreResult[] }  // v1.2: one per entry of config/services.json (default 4), 3 flagstores each
interface FlagstoreResult { key: 'flag0'|'flag1'|'flag2'; verdict: 'OK'|'MUMBLE'|'OFFLINE'|'INTERNAL_ERROR'|'UNKNOWN'; message: string|null; round: number|null; checkedAt: string|null }  // UNCONFIRMED A24/A25

interface ResourceUsage {
  cpu:       { usedPct: number; limitCores: number };
  memory:    { usedMb: number;  limitMb: number };
  processes: { used: number;    limit: number };
  storage:   { usedMb: number;  limitMb: number };
  isMock: boolean;
}

// Terminal endpoint (A15). url is sensitive: expose only on team detail, never in lists/audit/logs.
interface Terminal { kind: 'ttyd'; mode: 'per_team'|'shared'; port: number; url: string | null; isMock: boolean }  // port = ttydBase + team seq (config/services.json, UNCONFIRMED A23)

interface Environment {
  lifecycleState: LifecycleState;
  health: Health;
  pending: PendingAction | null;
  acceptedPatchVersion: number;                 // read-only here
  lastDeploy: { version: number; result: 'accepted' | 'rejected' | 'rolled_back'; at: string } | null; // read-only
  services: Service[];
  resources: ResourceUsage | null;              // null unless running
  activeSessions: number;                       // simulated in mock
  terminal: Terminal | null;                    // null unless running
  failureReason: string | null;
  lastActionAt: string | null;
  lastHealthCheckAt: string | null;
}

interface Participant { id: string; name: string; username: string; credentialIssuedAt: string; credentialVersion: number; active: boolean }

interface TeamSummary {
  id: string; name: string; accountStatus: AccountStatus;
  lifecycleState: LifecycleState; health: Health; pending: PendingAction | null;
  participantCount: number; updatedAt: string;
}
interface TeamDetail extends TeamSummary { notes: string; createdAt: string; participants: Participant[]; environment: Environment }

interface IssuedCredential { participantId: string; username: string; password: string }   // plaintext: ONLY in create/rotate responses

interface AuditEntry {
  id: number; ts: string;
  actorId: string | null; actorName: string; actorRole: Role | 'system' | 'anonymous';
  action: AuditAction; targetType: 'team' | 'participant' | 'session' | 'settings' | 'system'; targetId: string | null;
  outcome: 'requested' | 'success' | 'failure' | 'denied' | 'noop';
  message: string; requestId: string | null; correlationId: string | null;
  details: Record<string, unknown> | null;
}
type AuditAction =
  | 'auth.login' | 'auth.login_failed' | 'auth.logout'
  | 'team.create' | 'team.update' | 'team.suspend' | 'team.reactivate' | 'team.delete'
  | 'env.provision' | 'env.start' | 'env.stop' | 'env.reset' | 'env.delete'
  | 'participant.add' | 'participant.remove' | 'credential.issue' | 'credential.rotate'
  | 'health.run' | 'settings.update' | 'demo.inject' | 'demo.fail_next' | 'demo.reseed';

interface Alert { id: string; teamId: string | null; severity: 'info' | 'warning' | 'critical';
  kind: 'service_down' | 'service_degraded' | 'action_failed' | 'environment_failed' | 'checker_error';
  message: string; createdAt: string; resolvedAt: string | null }

interface Page<T> { items: T[]; page: number; pageSize: number; total: number }
```

## 3. Endpoints

Permission column uses the permission strings from `04 §3`.

### 3.1 Meta and auth

| Method | Path | Perm | Body → Response |
|---|---|---|---|
| GET | `/api/meta` | public | → `{ adapter: 'mock'|'real'|'docker-compose', version: string, serverTime: string, demoControls: boolean, limits: { softTeamCap: 30 } }` |
| POST | `/api/auth/login` | public | `{ username, password }` → `200 { user }` + cookie · `401 UNAUTHENTICATED` · `429 RATE_LIMITED` |
| POST | `/api/auth/logout` | any | → `204` |
| GET | `/api/auth/me` | any | → `{ user }` |

### 3.2 Overview

`GET /api/overview` · `team.read` →

```json
{
  "adapter": "mock",
  "serverTime": "2026-10-18T09:30:00.000Z",
  "totals": { "teams": 24, "running": 21, "stopped": 2, "failed": 1, "transitioning": 0, "deleted": 0 },
  "healthTotals": { "healthy": 18, "degraded": 2, "down": 1, "unknown": 3 },
  "services": { "total": 105, "failingReachability": 1, "failingFunctional": 2 },
  "activeSessions": 71,
  "competitionStatus": null,
  "grid": [ { "teamId": "team-01", "name": "…", "lifecycleState": "running", "health": "healthy", "pending": false } ],
  "recentAlerts": [ /* Alert[] up to 10, open first */ ],
  "recentActivity": [ /* AuditEntry[] up to 10, outcome != 'requested' */ ]
}
```

Invariant (AC-11): `totals` and `healthTotals` are computed from the same query as the directory (excluding `deleted` from "teams" unless `?includeDeleted=1`).

### 3.3 Teams

| Method | Path | Perm | Notes |
|---|---|---|---|
| GET | `/api/teams` | `team.read` | Query: `q` (name or id, case-insensitive), `state` (comma list), `health` (comma list), `account` (`active|suspended`), `includeDeleted` (`0|1`, default 0), `sort` (`id|name|state|health|updated`, prefix `-` for desc, default `id`), `page`, `pageSize` → `Page<TeamSummary>` |
| POST | `/api/teams` | `team.create` | Body `{ name: string(2..60), notes?: string(≤500), participantNames?: string[] (0..8; default: generate "Participant 1..4"), autoProvision?: boolean (default true) }` → **201** `{ team: TeamDetail, credentials: IssuedCredential[] }`. Team ID assigned server-side (next free `team-NN`). 409 on duplicate name (case-insensitive). If active (non-deleted) teams ≥ soft cap, response still 201 with header `X-Soft-Cap-Exceeded: true`. Audit: `team.create` + `env.provision` (`requested`, later completion). |
| GET | `/api/teams/:teamId` | `team.read` | → `TeamDetail`. Triggers lazy resolution first. |
| PATCH | `/api/teams/:teamId` | `team.update` | Body any of `{ name?, notes?, accountStatus? }` → `TeamDetail`. `accountStatus` change audits `team.suspend` / `team.reactivate`; other edits `team.update` with `details.changed` field list. Cannot edit a `deleted` team (409 `INVALID_TRANSITION`). |
| DELETE | `/api/teams/:teamId` | `team.delete` | Body `{ confirmName: string }` must equal the team name exactly (else 422). → **202** action response (below). Archives team, removes environment resources. |
| POST | `/api/teams/import` | `team.create` | **P2 (F23).** Body `{ rows: { name: string, participantNames?: string[] }[] (1..40), autoProvision?: boolean, dryRun?: boolean }`. The client parses a CSV with columns `team_name,participants` (participants separated by `;`). `dryRun=true` validates every row without writing. → 200 `{ created: [{ team, credentials }], skipped: [{ row, reason }] }`. One `team.create` audit entry per created team. Team IDs assigned in row order. |

### 3.4 Lifecycle actions

`POST /api/teams/:teamId/environment/start|stop|reset` · perms `env.start` / `env.stop` / `env.reset` · optional header `Idempotency-Key`. No body.

**202 Accepted**
```json
{ "teamId": "team-07", "action": "reset", "correlationId": "c_8a1f03b2e9d1",
  "transition": { "from": "running", "to": "running", "via": "resetting", "startedAt": "…", "estimatedEndsAt": "…" } }
```
**200 No-op** (e.g. stop on a stopped env): `{ "teamId": "team-07", "action": "stop", "noop": true, "reason": "Environment is already stopped." }` (audit `outcome=noop`).
**409** `INVALID_TRANSITION` or `ACTION_IN_PROGRESS`; **404**; **403**.

Completion is observed by polling `GET /api/teams/:id` until `environment.pending === null`; the final state is authoritative. A failed transition leaves `lifecycleState = 'failed'` with `failureReason`.

**Bulk start/stop (P2, F17):** `POST /api/environments/bulk` · perms `env.start` or `env.stop` per `action`. Body `{ action: 'start' | 'stop', teamIds: string[] (1..40), confirm?: 'START ALL' | 'STOP ALL' }` (`confirm` required when `teamIds.length ≥ 5`, else 422 `CONFIRMATION_MISMATCH`). Each team is processed independently with exactly the single-team rules (noop, invalid transition, in-progress). → 200 `{ results: [{ teamId, status: 'accepted' | 'noop' | 'rejected', code?: string, correlationId?: string }] }`. Audit: normal per-team rows only. **Reset and delete are intentionally not bulkable.**

### 3.5 Participants and credentials

| Method | Path | Perm | Notes |
|---|---|---|---|
| GET | `/api/teams/:teamId/participants` | `team.read` | → `Participant[]` (never passwords) |
| POST | `/api/teams/:teamId/participants` | `credential.manage` | Body `{ name }` (max 8 active per team) → 201 `{ participant, credential: IssuedCredential }` |
| DELETE | `/api/teams/:teamId/participants/:participantId` | `credential.manage` | Deactivates; credential becomes invalid → 204 |
| POST | `/api/teams/:teamId/credentials/rotate` | `credential.manage` | Body `{ participantId?: string }` (omit = all active) → `{ credentials: IssuedCredential[] }`. Old password stops working immediately; `credentialVersion` increments. Audit `credential.rotate`. |

Plaintext passwords exist **only** in these create/rotate responses. The UI shows them once in `CredentialsRevealDialog` and offers a CSV download generated client-side from that response (columns: team_id, team_name, participant, username, password). Closing the dialog discards them.

### 3.6 Health and alerts

| Method | Path | Perm | Notes |
|---|---|---|---|
| GET | `/api/teams/:teamId/health` | `team.read` | → `{ health, services: Service[], lastHealthCheckAt }` |
| POST | `/api/teams/:teamId/health/run` | `env.start` (P1) | Re-runs checks now (mock: re-derive from forced faults) → same shape. Audit `health.run`. Rejected with 409 if environment not `running`. |
| GET | `/api/alerts` | `team.read` | Query `status=open|resolved`, `limit` (default 20) → `Alert[]` |

### 3.7 Audit

| Method | Path | Perm | Notes |
|---|---|---|---|
| GET | `/api/audit` | `audit.read` | Query: `actor` (user id or `system`), `action` (comma list), `team` (target id), `outcome` (comma list), `from`, `to` (ISO), `q` (substring of message), `page`, `pageSize` (default 50, max 200). Sorted newest first. → `Page<AuditEntry>` |
| GET | `/api/audit/export.csv` | `audit.read` | P1 (promoted). Same filters, streams CSV, capped at 10 000 rows. |

No `PUT`/`PATCH`/`DELETE` exists for audit. Attempts return 404/405.

### 3.8 Settings (P2)

`GET /api/settings` (`team.read`) → `{ competitionStatus: 'not_started'|'running'|'paused'|'ended' }` · `PATCH /api/settings` (`settings.update`) same shape → audited as `settings.update`. This is a **dashboard display label**, not an orchestrator feature (spec has no such concept).

### 3.9 Demo controls (mock only)

Return **404** unless `DEMO_CONTROLS=true`, adapter is `mock`, and caller is `organizer_admin`. All audited.

| Method | Path | Body | Effect |
|---|---|---|---|
| POST | `/api/_demo/inject` | `{ teamId, serviceKey, checkType, mode: 'fail'|'clear', detail?: string }` | Forces a check to fail/clear → health recomputed, alert opened/resolved |
| POST | `/api/_demo/fail-next` | `{ teamId, action: LifecycleAction | 'provision' }` | The next such transition ends in `failed` |
| POST | `/api/_demo/reseed` | `{ teams?: number }` | Wipes mock tables (NOT the audit log) and reseeds; writes `demo.reseed` |

## 4. Route handler template (every handler follows this order)

```ts
export async function POST(req: Request, ctx: { params: { teamId: string } }) {
  const requestId = newRequestId();
  try {
    const user = await requireUser(req);                       // 401
    assertSameOrigin(req);                                     // 403 on bad Origin
    await services.sync();                                     // resolveDue + completion audit rows
    const out = await services.lifecycle.request({ user, teamId: ctx.params.teamId, action: 'reset',
                   idempotencyKey: req.headers.get('Idempotency-Key'), requestId });  // can() → 403 + denied audit
    return json(out.status, out.body, requestId);
  } catch (e) { return errorResponse(e, requestId); }
}
```

## 5. Real orchestrator mapping (for the club)

| We need | Minimum the orchestrator exposes |
|---|---|
| Team list/detail | `GET teams`, `GET teams/{id}` incl. environment status |
| Create/update/delete | `POST/PATCH/DELETE teams` |
| Lifecycle | `POST teams/{id}/environment/{action}` returning a job id; `GET jobs/{id}` (or the environment status) for completion |
| Checks | Latest result per service per check type with timestamp and failure detail |
| Resources | CPU/memory/process/storage usage + limits per environment |
| Credentials | Issue/rotate returning one-time secrets (or accept ours) |
| History | Accepted patch version + deployment/rollback history (read-only) |
| Terminal | Per-environment terminal URL (ttyd on 7681 behind a tunnel, per group chat) and whether it requires credentials |
| Checker verdicts | Latest verdict per service per team (OK / OFFLINE / MUMBLE / INTERNAL_ERROR + message) so we can map to reachability/functional checks (`04 §4.1`) |

Anything the orchestrator cannot supply is shown as "not available" in the UI (`null` fields) rather than faked.


## 6. Change log

**v1.1 (17 Oct 2026) — additive only; nothing renamed.** Added: `Terminal` type and `Environment.terminal`; `Service.placeholder`; `Alert.kind = 'checker_error'`; `/api/meta` `adapter` may be `'docker-compose'` (badge `PARTIAL`); `POST /api/teams/import` (P2); `POST /api/environments/bulk` (P2); audit CSV export promoted to P1; overview example numbers aligned with the 24-team seed (21 running, 2 stopped, 1 failed; 5 services each).

**v1.2 W1 (27 Oct 2026) — CONTRACT CHANGE, additive only.** `Service.flagstores?` (`FlagstoreResult[]`, 3 per service) and `Terminal.mode` (`'per_team'|'shared'`, default `per_team`). Service ports now follow `10000 + seq*10 + portOffset`; terminal port `7600 + seq`. Service keys come from `config/services.json` (default `docuvault, pulsechat, swiftshop, service-4`); the old `funsplash, svc-3..5` keys no longer exist. All UNCONFIRMED (docs/12 C3, C6, A23, A24).
