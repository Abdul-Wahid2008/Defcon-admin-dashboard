# 06 — TWO-DAY RELEASE, INTEGRATION AND REHEARSAL PLAN

**Effective date:** 19 Oct 2026
**Target freeze:** end of 20 Oct 2026
**Current state:** P1–P17 are implemented in the repository. The default release is a persistent SQLite `MockAdapter` reported as `SIMULATED`. Real control is not proven until the club provides and passes the Track B gate in this document.

This is not a feature-development schedule. It is a release-control schedule for a live four-hour attack-defense event. The dashboard can ship safely in simulated mode; actual team control is a separate, evidence-based integration outcome.

## 1. Release objectives

### Objective A — Dashboard release candidate

- Runs from a clean checkout on the target machine.
- Persists state and audit history across restart.
- Allows organizers to find teams, inspect health, manage credentials, and perform lifecycle actions with server-side permissions.
- Has no fake success, no leaked credentials, and no ambiguous runtime badge.
- Has a cold-start runbook and a seeded fallback.

### Objective B — Real-control decision

- Integrate only the operations the club actually exposes.
- Reconcile registered teams from the authoritative source.
- Prove one real environment before touching the full team set.
- Prove failure, retry, permission, audit and recovery behavior.
- Keep `PARTIAL` or `SIMULATED` if any critical operation remains unverified.

### Objective C — Cross-team handoff

- Service owners provide the service manifest and checker projection.
- Orchestrator owner provides lifecycle/status/auth contract.
- Terminal/network owner proves team-scoped access and isolation.
- Dashboard owner maps these contracts without duplicating their systems.

## 2. Non-negotiable freeze rules

1. Do not add a leaderboard, participant UI, vulnerability UI, scoring engine, flag engine, patch engine, terminal gateway or new telemetry system.
2. Do not replace the adapter architecture with direct UI-to-Docker or UI-to-game-server calls.
3. Do not change canonical lifecycle states, permission names, audit semantics or reset preservation rules without a written contract update.
4. Do not enable `DEMO_CONTROLS=true`, `ALLOW_DEFAULT_PASSWORDS=true` or public free-host deployment in the release environment.
5. Do not import live registration data until the source owner confirms format, authority and reconciliation behavior.
6. Do not claim `LIVE` based on a successful list or start call alone.
7. If integration becomes uncertain, stop integration work and finish Track A release verification.

## 3. Day 1 — 19 Oct: contract, integration and release-candidate verification

### 3.1 First 30 minutes — coordination lock

Send one message to the club technical lead and create a shared response thread. Ask for:

- orchestrator owner and availability window;
- actual event/deployment deadline;
- target server address/network and access method;
- authoritative team-registration source;
- lifecycle API/command examples;
- checker result projection;
- terminal/gateway owner and authentication model;
- resource limits and one-team test target.

Do not wait for replies before continuing Track A.

### 3.2 Morning — freeze the dashboard contract

Run and record:

```powershell
git status
git log -5 --oneline
npm run typecheck
npm run lint
npm test
npm run build
git diff --check
```

Then verify:

- `.env.example` contains every required variable and no secret.
- production `.env` has a 32+ character `SESSION_SECRET`;
- `DB_PATH` is on durable storage;
- `ADAPTER=mock` is explicit for fallback;
- demo controls and default passwords are disabled;
- no client import reaches `src/lib/server/**`;
- no logs contain passwords, hashes, tokens or terminal URLs.

### 3.3 Midday — target-environment rehearsal

On the actual deployment machine:

1. install/use the locked Node version;
2. install dependencies from the lockfile;
3. run `npm run reset-demo`;
4. run `npm run build && npm start`;
5. verify `/login`, `/api/meta`, unauthenticated redirect and authenticated API paths;
6. test two organizer sessions;
7. run the 3-minute demo twice;
8. leave `/overview` polling for at least 30 minutes while performing lifecycle actions;
9. record CPU, memory, SQLite file growth and browser console errors.

### 3.4 Afternoon — one-team real-control gate

Only if the club supplies a usable contract:

1. configure the real adapter in a separate environment file;
2. select one disposable test team;
3. verify list/detail mapping;
4. verify status freshness and timeout behavior;
5. verify start or provision;
6. verify stop;
7. verify reset semantics or explicitly mark reset unavailable;
8. verify delete only if the club authorizes a disposable environment;
9. verify checker health mapping;
10. verify audit correlation and error mapping;
11. revert to `ADAPTER=mock` after the test unless the full gate passes.

Never test destructive real actions on all teams during the first integration run.

### 3.5 Day 1 exit check

Track A passes when:

- all automated gates pass;
- the target machine can cold-start;
- the demo repeats twice;
- credentials, permissions and audit behavior are verified;
- fallback mode is documented.

Track B passes Day 1 only when:

- the contract is written;
- one-team read and at least one lifecycle action are proven;
- failures are observable;
- no secret or terminal URL is exposed in logs or list responses.

## 4. Day 2 — 20 Oct: deployment, recovery, rehearsal and freeze

### 4.1 Morning — integration decision

Choose exactly one release mode and record it in `BUILD_STATUS.md`:

| Mode | Condition | Required UI badge |
|---|---|---|
| `SIMULATED` | No trusted real contract or insufficient smoke evidence | SIMULATED |
| `PARTIAL` | Some real operations work, but one or more environment-affecting operations remain unavailable/unverified | PARTIAL |
| `LIVE` | Every environment-affecting operation is real, tested, permissioned, observable and recoverable | LIVE |

The default expectation is `SIMULATED` or `PARTIAL` unless the club proves otherwise.

### 4.2 Morning — deployment hardening

- deploy only from a clean commit/tag;
- persist SQLite on durable storage;
- configure a process supervisor or documented restart command;
- bind only to the intended organizer network;
- keep the dashboard off public free hosts and quick tunnels;
- back up the database before rehearsal;
- verify system time and UTC handling;
- verify firewall rules and inbound exposure;
- verify logs redact secrets;
- verify graceful restart during a mock pending transition.

The dashboard is not a replacement for the club’s container/network security. It must not be given Docker socket or host privileges unless the club explicitly accepts and secures that design outside this repository.

### 4.3 Midday — recovery and concurrency checks

Run:

- two-admin/operator sessions;
- duplicate lifecycle request with the same idempotency key;
- different request with the same key must not silently replay;
- pending action collision;
- adapter timeout;
- checker error;
- team missing from registration source;
- stale team or renamed team;
- server restart during a pending mock action;
- database backup and restore rehearsal;
- one failure followed by recovery.

### 4.4 Afternoon — final rehearsal

Run the exact scenario from `08` twice from a clean seeded state. A teammate must follow the runbook without verbal rescue.

The rehearsal must show:

1. runtime badge and honest boundary;
2. overview counts;
3. team search/detail;
4. service health and checker detail;
5. a safe lifecycle action;
6. final state after polling;
7. audit correlation;
8. permission denial;
9. recovery/fallback behavior.

### 4.5 Freeze and handoff

At freeze:

- tag the release;
- save the commit hash;
- export the runbook and contract;
- record release mode;
- record known blockers;
- record the responsible person for each external dependency;
- stop all demo controls;
- take a database backup;
- keep a known-good simulated release package.

No feature work after freeze. Only release-blocking fixes are allowed.

## 5. External-team coordination matrix

| Partner | They must provide | Dashboard consumes | Acceptance evidence |
|---|---|---|---|
| Orchestrator owner | lifecycle/status/auth/job contract | adapter responses and job state | one-team lifecycle matrix |
| Game server/checker owner | service IDs, verdict schema, timestamps, checker errors | health projection | table-driven verdict mapping |
| Vulnerability service owners | image/version, port, readiness, reset expectations | service manifest/readiness | one team with every service checked |
| Terminal/network owner | gateway auth, team scope, URL lifecycle, isolation | terminal metadata only | unauthorized cross-team access denied |
| Registration owner | authoritative export/API, stable IDs, duplicate policy | import/reconciliation input | dry-run and mismatch report |
| Infrastructure owner | host capacity, firewall, backup, restart process | deployment environment | cold-start and restore run |
| Organizer lead | permissions and operational policy | role mapping and runbook | admin/operator sign-off |

## 6. Reconciliation rules for registered teams

Until the club confirms otherwise:

- the registration source is authoritative for prospective team membership;
- the environment/orchestrator source is authoritative for runtime state;
- the dashboard’s local database is authoritative only for organizer actions, local audit and adapter cache/state;
- matching must use an immutable external team identifier if available, not display name;
- duplicate external IDs stop the import and produce a report;
- missing external teams are not silently deleted;
- renamed teams require an explicit mapping/audit event;
- partial imports report row-level errors and do not claim all teams were synchronized.

## 7. Cut order under pressure

Cut first:

1. charts and resource visual polish;
2. demo controls UI;
3. bulk actions;
4. CSV import UI if the registration owner cannot provide a stable export;
5. credential rotation UI, while retaining secure initial issue;
6. nonessential settings labels.

Never cut:

- authentication and server-side permissions;
- append-only audit;
- lifecycle confirmations;
- idempotency and pending-action protection;
- honest adapter badge;
- final-state polling;
- one-time credential handling;
- backup/restart runbook;
- simulated fallback.

## 8. Required artifacts at handoff

- release commit/tag;
- `README.md` and operator runbook;
- `.env.example`;
- sanitized API contract;
- one-team integration evidence;
- test output;
- browser/rehearsal checklist;
- database backup and restore instructions;
- list of unresolved club questions;
- explicit `SIMULATED`/`PARTIAL`/`LIVE` decision.
