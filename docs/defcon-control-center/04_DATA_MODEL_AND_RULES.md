# 04 — DATA MODEL AND DOMAIN RULES

Canonical definitions. If code and this file disagree, fix the code (or update this file deliberately and note it in the commit).

## 1. Lifecycle state machine

States: `provisioning`, `running`, `stopping`, `stopped`, `starting`, `resetting`, `deleting`, `deleted`, `failed`.

| Current state | Action | Intermediate state | End state (success) | Allowed? | Notes |
|---|---|---|---|---|---|
| *(none)* | create team (autoProvision) | `provisioning` | `running` | yes | Team ID assigned at creation |
| `running` | `stop` | `stopping` | `stopped` | yes | Environment retained (spec p5) |
| `running` | `reset` | `resetting` | `running` | yes | Restore latest accepted patch; preserves 5 categories (A2) |
| `running` | `delete` | `deleting` | `deleted` | yes | Removes assigned resources (spec p5) |
| `running` | `start` | — | — | **noop** (200) | Already running |
| `stopped` | `start` | `starting` | `running` | yes | A1 |
| `stopped` | `delete` | `deleting` | `deleted` | yes | |
| `stopped` | `stop` | — | — | **noop** (200) | |
| `stopped` | `reset` | — | — | **409 INVALID_TRANSITION** | A3 — start first |
| `failed` | `reset` | `resetting` | `running` | yes | Primary recovery path |
| `failed` | `delete` | `deleting` | `deleted` | yes | |
| `failed` | `start` / `stop` | — | — | **409 INVALID_TRANSITION** | |
| `provisioning`, `starting`, `stopping`, `resetting`, `deleting` | any | — | — | **409 ACTION_IN_PROGRESS** | One transition at a time |
| `deleted` | any | — | — | **409 INVALID_TRANSITION** | Terminal |

**Failure rule:** when a transition resolves as a failure (only via demo control `fail-next` in mock; real errors in real mode), the environment goes to `failed`, `failure_reason` is set, an alert of kind `action_failed` (or `environment_failed`) is opened, and a `failure` audit row is appended. Exception: a failed `delete` leaves the environment `failed` (resources may remain) — the UI shows "Delete failed — retry".

**Spec-vs-assumption labelling:** the existence of `stop`, `reset`, `delete` and their meanings are spec (p5). `start`, post-reset state, and reset-not-from-stopped are assumptions A1–A3.

## 2. Action semantics (what each action does and preserves)

| Action | Environment | Preserved | Lost / removed | Dialog weight |
|---|---|---|---|---|
| **Stop** | Retained but not serving; services unreachable | Everything (all 5 persistent categories, patches, credentials) | Active terminal sessions end (`activeSessions=0`) | Light confirm |
| **Start** | Brought up from retained state | Everything | — | Light confirm |
| **Reset** | Returns to **latest accepted patch** (not original baseline) | **Flags + challenge state; scores + submissions; accepted patches; audit + deployment history; application data** | Anything not in an accepted patch `[A13 — confirm]` | Medium confirm, lists preserved items |
| **Delete** | Assigned resources removed; team archived | Audit history; score/submission records kept for history (A6) | Environment, credentials (deactivated), team becomes non-editable | Heavy confirm: type team name |

Mock implementation of "preserved": the mock never touches `accepted_patch_version`, `last_deploy_*`, audit rows, or (simulated) score fields on reset/stop/start. A unit test asserts those fields are byte-identical before/after a reset.

## 3. Roles and permissions

Permission strings: `team.read`, `team.create`, `team.update`, `team.delete`, `env.start`, `env.stop`, `env.reset`, `credential.manage`, `audit.read`, `settings.update`, `demo.use`.

| Permission | organizer_admin | organizer_operator | team |
|---|---|---|---|
| team.read | ✔ any | ✔ any | ✔ own team only |
| team.create | ✔ | ✔ | ✘ |
| team.update | ✔ | ✔ | ✘ |
| team.delete | ✔ | ✘ | ✘ |
| env.start | ✔ | ✔ | ✘ |
| env.stop | ✔ | ✔ | ✘ |
| env.reset | ✔ any | ✔ any | ✔ **own team only** |
| credential.manage | ✔ | ✔ | ✘ |
| audit.read | ✔ | ✔ | ✘ |
| settings.update | ✔ | ✘ | ✘ |
| demo.use | ✔ | ✘ | ✘ |

Signature: `can(user: {id, role, teamId?}, permission: Permission, resource?: { teamId?: string }): boolean`. For role `team`, any permission that is allowed must also satisfy `resource.teamId === user.teamId`; if no resource is given for a team-scoped permission, deny. Organizer roles ignore `teamId`.

Denied requests: HTTP 403 `FORBIDDEN` with `details.required = permission`; audit row `outcome=denied`, `actor` populated.

UI behaviour: disallowed actions are **disabled with a tooltip** ("Requires organizer_admin") rather than hidden, so the role model is visible in the demo. Sidebar items the role cannot open are hidden.

Seeded users: `admin` (organizer_admin), `operator` (organizer_operator). No `team` users exist in the database; the `team` role is exercised by unit tests only (D11).

## 4. Health derivation

Per service, two checks: `reachability` and `functional` (A8; spec p3: detect stopped/unreachable services; verify workflows not just ports).

Environment health:

| Condition | Health |
|---|---|
| Lifecycle ≠ `running` (stopped, failed, any transition, deleted) | `unknown` |
| Running and every check `pass` | `healthy` |
| Running and any **reachability** check `fail` | `down` |
| Running, all reachability pass, any **functional** check `fail` | `degraded` |
| Running and any check `unknown` with none failing | `unknown` |

(Evaluate rows top to bottom; first match wins; `down` outranks `degraded`.)

Alerts: a check turning `fail` opens an alert (`service_down` for reachability → severity `critical`; `service_degraded` for functional → `warning`), de-duplicated per (team, service, check type) while open. A check returning to `pass` resolves the alert (`resolved_at`). Lifecycle `failed` opens `environment_failed` (`critical`).

Health-check interval and idle-session timeout are **TBD in the spec**. In config they are named constants (`HEALTH_INTERVAL_SEC`, `IDLE_SESSION_TIMEOUT_MIN`) with value `null` = "not defined by spec"; the mock re-evaluates checks on every read, which is a mock behaviour, not a claim about the spec.

### 4.1 Checker verdict mapping (A17 — verify against the club's `checker.py`)

The club's per-service checker plants flags and checks service behaviour. If it follows the enowars convention, its verdicts map to our two check types per service like this:

| Checker verdict | Reachability check | Functional check | Alert |
|---|---|---|---|
| OK | `pass` | `pass` | resolves open alerts for the service |
| OFFLINE | `fail` (detail "OFFLINE: …") | `unknown` | `service_down` (critical) |
| MUMBLE | `pass` | `fail` (detail "MUMBLE: …") | `service_degraded` (warning) |
| INTERNAL_ERROR | `unknown` | `unknown` | `checker_error` (info) — a checker fault, **not** counted as a team/service failure |

Health derivation (above) then applies unchanged. In mock mode these verdicts are generated by the seed and demo controls; the mock never emits `INTERNAL_ERROR` unless a test asks for it. The checker's flag-placement result (putflag/getflag) is **not** part of the contract; add it only if the club exposes it.

## 5. SQLite schema (migration `001_init.sql`)

```sql
PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;

CREATE TABLE users (
  id            TEXT PRIMARY KEY,
  username      TEXT NOT NULL UNIQUE COLLATE NOCASE,
  password_hash TEXT NOT NULL,
  display_name  TEXT NOT NULL,
  role          TEXT NOT NULL CHECK (role IN ('organizer_admin','organizer_operator')),
  active        INTEGER NOT NULL DEFAULT 1,
  created_at    TEXT NOT NULL
);

CREATE TABLE teams (
  id             TEXT PRIMARY KEY,                 -- 'team-01'
  seq            INTEGER NOT NULL UNIQUE,
  name           TEXT NOT NULL COLLATE NOCASE,
  notes          TEXT NOT NULL DEFAULT '',
  account_status TEXT NOT NULL DEFAULT 'active' CHECK (account_status IN ('active','suspended')),
  archived_at    TEXT,                             -- set on delete
  created_at     TEXT NOT NULL,
  updated_at     TEXT NOT NULL
);
-- names unique among non-archived teams
CREATE UNIQUE INDEX uq_teams_name_active ON teams(name) WHERE archived_at IS NULL;

CREATE TABLE participants (
  id                   TEXT PRIMARY KEY,
  team_id              TEXT NOT NULL REFERENCES teams(id),
  name                 TEXT NOT NULL,
  username             TEXT NOT NULL UNIQUE COLLATE NOCASE,   -- e.g. 'team-07-p1'
  password_hash        TEXT NOT NULL,
  credential_version   INTEGER NOT NULL DEFAULT 1,
  credential_issued_at TEXT NOT NULL,
  active               INTEGER NOT NULL DEFAULT 1
);
CREATE INDEX ix_participants_team ON participants(team_id);

CREATE TABLE environments (
  team_id                TEXT PRIMARY KEY REFERENCES teams(id),
  lifecycle_state        TEXT NOT NULL CHECK (lifecycle_state IN
    ('provisioning','running','stopping','stopped','starting','resetting','deleting','deleted','failed')),
  pending_action         TEXT,                     -- provision|start|stop|reset|delete
  pending_correlation_id TEXT,
  pending_from_state     TEXT,
  pending_to_state       TEXT,
  pending_started_at     TEXT,
  pending_ends_at        TEXT,
  accepted_patch_version INTEGER NOT NULL DEFAULT 1,   -- never modified by lifecycle actions
  last_deploy_result     TEXT,                         -- accepted|rejected|rolled_back
  last_deploy_at         TEXT,
  active_sessions        INTEGER NOT NULL DEFAULT 0,
  failure_reason         TEXT,
  last_action_at         TEXT,
  last_health_check_at   TEXT,
  terminal_url           TEXT,                         -- MOCK: fake *.invalid URL while running; sensitive (A15)
  fail_next_action       TEXT                          -- MOCK ONLY
);

CREATE TABLE services (
  team_id TEXT NOT NULL REFERENCES teams(id),
  key     TEXT NOT NULL,                              -- manifest key from config/services.json, e.g. 'docuvault' | 'pulsechat' | 'swiftshop' | 'service-4'
  name    TEXT NOT NULL,
  port    INTEGER NOT NULL,
  placeholder INTEGER NOT NULL DEFAULT 0,             -- 1 = not a real challenge service yet (A9)
  PRIMARY KEY (team_id, key)
);

CREATE TABLE checks (
  team_id         TEXT NOT NULL,
  service_key     TEXT NOT NULL,
  check_type      TEXT NOT NULL CHECK (check_type IN ('reachability','functional')),
  status          TEXT NOT NULL CHECK (status IN ('pass','fail','unknown')),
  detail          TEXT,
  last_checked_at TEXT,
  forced_fail     INTEGER NOT NULL DEFAULT 0,         -- MOCK ONLY (demo inject)
  forced_detail   TEXT,
  PRIMARY KEY (team_id, service_key, check_type),
  FOREIGN KEY (team_id, service_key) REFERENCES services(team_id, key)
);

CREATE TABLE alerts (
  id          TEXT PRIMARY KEY,
  team_id     TEXT,
  severity    TEXT NOT NULL CHECK (severity IN ('info','warning','critical')),
  kind        TEXT NOT NULL,
  dedupe_key  TEXT,                                   -- e.g. 'team-07:web:reachability'
  message     TEXT NOT NULL,
  created_at  TEXT NOT NULL,
  resolved_at TEXT
);
CREATE UNIQUE INDEX uq_alerts_open ON alerts(dedupe_key) WHERE resolved_at IS NULL AND dedupe_key IS NOT NULL;

CREATE TABLE audit_log (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  ts             TEXT NOT NULL,
  actor_id       TEXT,
  actor_name     TEXT NOT NULL,
  actor_role     TEXT NOT NULL,                       -- organizer_admin|organizer_operator|team|system|anonymous
  action         TEXT NOT NULL,
  target_type    TEXT NOT NULL,
  target_id      TEXT,
  outcome        TEXT NOT NULL CHECK (outcome IN ('requested','success','failure','denied','noop')),
  message        TEXT NOT NULL,
  request_id     TEXT,
  correlation_id TEXT,
  details_json   TEXT
);
CREATE INDEX ix_audit_ts ON audit_log(ts DESC);
CREATE INDEX ix_audit_target ON audit_log(target_id, ts DESC);
CREATE TRIGGER audit_no_update BEFORE UPDATE ON audit_log
BEGIN SELECT RAISE(ABORT, 'audit_log is append-only'); END;
CREATE TRIGGER audit_no_delete BEFORE DELETE ON audit_log
BEGIN SELECT RAISE(ABORT, 'audit_log is append-only'); END;

CREATE TABLE idempotency_keys (
  key           TEXT NOT NULL,
  actor_id      TEXT NOT NULL,
  route         TEXT NOT NULL,
  status        INTEGER NOT NULL,
  response_json TEXT NOT NULL,
  created_at    TEXT NOT NULL,
  PRIMARY KEY (key, actor_id, route)
);

CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
```

Notes: store timestamps as ISO strings. The audit table is deliberately not foreign-keyed to teams so history survives archival and `demo.reseed`. `demo.reseed` truncates mock tables only.

## 6. Mock engine rules

### 6.1 Durations (config, scaled by `MOCK_DURATION_SCALE`) — A11

`provision 6 s · start 3 s · stop 2 s · reset 5 s · delete 3 s`.

### 6.2 `requestAction` algorithm (inside one DB transaction)

1. Load environment; call `resolveDueFor(team)` first.
2. Look up `(state, action)` in the transition table → noop / invalid / in-progress / accepted.
3. Accepted: set `lifecycle_state` = intermediate; `pending_*` = {action, new correlation id, from, to, now, now + duration}; `last_action_at = now`; set `active_sessions = 0` for stop/reset/delete.
4. Return transition info; the service layer writes the `requested` audit row in the **same** transaction.

### 6.3 `resolveDue()` algorithm (idempotent; runs at the start of every read/mutation)

For each environment with `pending_ends_at <= now` (in a transaction, re-checking `pending_action IS NOT NULL`):

- If `fail_next_action == pending_action`: `lifecycle_state='failed'`, `failure_reason = '<action> failed (simulated)'`, clear pending and `fail_next_action`, open alert, return a `failure` completion.
- Else set `lifecycle_state = pending_to_state`; on `provision/start/reset` set checks to `pass` (respecting `forced_fail`), `last_health_check_at = ends_at`, `active_sessions` = a deterministic value 0–6 for running; on `stop` all checks `unknown`; on `delete` set `teams.archived_at`, deactivate participants, checks `unknown`.
- Clear `pending_*`; return a `success` completion with `ts = pending_ends_at`.

The service layer then appends one completion audit row per returned item (`outcome` success/failure, same `correlation_id`, `ts` = completion time). Because resolution runs inside a transaction that clears `pending_*`, two concurrent reads cannot produce duplicate completion rows.

### 6.4 Resource usage (when `running`, else `null`)

Deterministic pseudo-random from `hash(teamId + floor(now/5000))`, smoothed: CPU 8–70 %, memory 20–75 % of limit, processes 15–60 % of limit, storage 10–60 % of limit. Flag `isMock: true`. Limits per A10.

### 6.5 Active sessions

Simulated integer 0–6 per running team, deterministic per (teamId, 30 s bucket). Overview sums them. Labelled simulated in tooltips.

### 6.6 Credentials

Username `team-07-p1`, `-p2`, …. Password 12 chars from `ABCDEFGHJKMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789`, `crypto.randomInt`. bcrypt cost 10. Rotation increments `credential_version`, sets `credential_issued_at`. Suspended teams: `account_status='suspended'` is stored and shown; the mock has no gateway to enforce it, so the UI notes "enforced by the terminal gateway when integrated" `[A-note]`.

### 6.7 Team ID assignment

`seq = (max(seq) over ALL teams including archived) + 1`; `id = 'team-' + pad2(seq)`; never reuse an archived team's number. If `seq > 99` return 409 `CONFLICT` ("team capacity exceeded").

### 6.8 Idempotency

For lifecycle POSTs with `Idempotency-Key`: before acting, look up `(key, actor, route)`; if found, return stored status+body with `Idempotent-Replay: true` and **write no new audit rows**. After acting, store the response. Same key on a different route is a different record. Without a key, retries rely on state-machine idempotency (noop / ACTION_IN_PROGRESS).

### 6.9 Terminal endpoint (mock, A15)

While `lifecycle_state='running'` the environment exposes `terminal = { kind:'ttyd', port:7681, url:'https://<teamId>-<4 hex>.terminal.invalid/', isMock:true }`; the 4 hex characters are regenerated on every provision/start/reset (imitating changing quick-tunnel URLs). In every other state `terminal_url` is NULL and `terminal` is `null`. The URL is returned only by `GET /api/teams/:id` (detail), never in list/overview/audit payloads or logs.

### 6.10 Service manifest (D14)

**v1.2 (supersedes the five-service manifest; `funsplash` was never a DEFCON service).** The only manifest is `config/services.json`, validated fail-closed by `src/lib/event-config.ts` (zod: unique keys, unique `portOffset`, offset < stride, `flagstores` = 3). Defaults, **all names UNCONFIRMED** (`nameConfirmed:false`): `docuvault` (+0), `pulsechat` (+2, placeholder, shown as "PulseChat / CampusPortal (unconfirmed)"), `swiftshop` (+3), `service-4` (+4, placeholder). Port = `10000 + seq*10 + portOffset`; ttyd port = `7600 + seq`; constants live in the config (UNCONFIRMED A23). Creating a team with `seq > ports.softTeamCap` (20) logs a warning, it does not fail. `terminalMode` (`per_team`|`shared`) is config too (C6). Provisioning inserts per manifest entry: one `services` row, two `checks` rows (reachability, functional) and three `flagstore_results` rows (`flag0..2`, verdict `UNKNOWN`). The mock does not yet refresh `flagstore_results` when checks change (W2 owns health).

## 7. Seed data (`npm run seed`; `SEED_TEAMS` default 24)

- 2 users (admin, operator) from env; hashes created at seed time.
- 24 fictional teams (`team-01` … `team-24`) with fictional names (e.g. "Null Pointers", "Packet Pirates", "Root Cause", "Zero Day Zealots", "Stack Smashers", "Byte Bandits", "Shell Shockers", "Cipher Syndicate", "Kernel Panic", "Ghost Protocol", "Red Herring", "Port Scanners", "Sudo Squad", "Hash Collision", "Rubber Duckies", "Lambda Lurkers", "Buffer Overflowers", "Daemon Hunters", "Fork Bomb", "Segfault Society", "Trojan Horsepower", "Phantom Pings", "Rootkit Rebels", "Brute Force Brigade"); all clearly fake demo data.
- 4 participants each (A5): "Participant 1–4", usernames per 6.6, passwords random (never displayed; rotate to reveal).
- Four services per team from the manifest (§6.10), each with reachability + functional checks (8 checks per team) and 3 flagstore rows (12 per team); `external_team_id = String(seq)` (MOCK); running environments get a fake terminal URL (§6.9).
- State mix: 18 running healthy, 2 running degraded (functional fail on the first non-placeholder manifest service, `docuvault` by default, flagstore `flag1` = MUMBLE; `team-05` and `team-17`), 1 running down (reachability fail on the same service, all 3 flagstores OFFLINE, `team-13`), 2 stopped, 1 failed (`team-19`, reason "reset failed (simulated)").
- Accepted patch versions random 1–5; `last_deploy_result` mostly `accepted`, a couple `rolled_back`/`rejected` (display only).
- Seed audit history (~40 rows over the last 6 hours, actor `admin`/`operator`/`system`) so the audit page is not empty on first open. Mark `details.seeded = true`.
- Seed alerts matching the degraded/down/failed teams.
- `npm run reset-demo` = truncate mock tables + reseed (keeps audit, then writes `demo.reseed`). Use before every rehearsal.

## 8. Invariants (assert in tests)

1. At most one pending transition per environment.
2. `accepted_patch_version`, `last_deploy_*` unchanged by start/stop/reset.
3. Every `requested` audit row has exactly one completion row with the same `correlation_id` once its transition has resolved.
4. Audit rows can never be updated or deleted (trigger).
5. A `deleted` team cannot be edited or acted on.
6. Overview totals equal directory totals computed with the same filters.
7. No response other than create/rotate ever contains a plaintext password.
8. `team` role can only touch its own team and only `env.reset` / `team.read`.
9. Team names unique (case-insensitive) among non-archived teams; team IDs never reused.
10. Health is `unknown` whenever lifecycle ≠ `running`.
11. Every non-deleted environment has exactly the manifest's services, two checks each; `placeholder` mirrors the manifest.
12. `terminal.url` is non-null only while lifecycle = `running`, and never appears outside the team-detail response.

## 9. Migration 002 (v1.2 W1, `migrations/002_v1_2.sql`)

Runner: `src/lib/migrate.ts` (`PRAGMA user_version`; used by `db.ts`, `scripts/seed.ts` and tests). Applies `NNN_*.sql` in order; 001 runs bare (it contains PRAGMAs), later files run in a transaction; any failure throws (fail closed). Existing v1 databases upgrade in place.

- `teams.external_team_id TEXT` (NULL allowed) + partial unique index `uq_teams_external_team_id` (SQLite cannot `ADD COLUMN ... UNIQUE`).
- `users.session_epoch INTEGER NOT NULL DEFAULT 0`, `users.must_change_password INTEGER NOT NULL DEFAULT 0`, `users.last_login_at TEXT`.
- `flagstore_results(team_id, service_key, flagstore CHECK IN ('flag0','flag1','flag2'), verdict CHECK IN ('OK','MUMBLE','OFFLINE','INTERNAL_ERROR','UNKNOWN'), message, round, checked_at, PRIMARY KEY(team_id, service_key, flagstore), FOREIGN KEY (team_id, service_key) REFERENCES services ON DELETE CASCADE)`. Cascade keeps the existing `DELETE FROM services` in reseed/tests working.
- `health_source_state(source PK, last_round, last_fetch_at, last_ok_at, last_error, last_etag)`.
- `settings` defaults (INSERT OR IGNORE): `stale_after_sec=270`, `round_sec=90`, `mutations_frozen='0'`.
- Audit triggers are untouched; `tests/w1-manifest.test.ts` asserts UPDATE/DELETE on `audit_log` still abort after migration.

## 10. Health source rules (v1.2 W2)
- Verdict → checks per service, worst-of over its 3 flagstores: reachability = `fail` if any OFFLINE, else `pass` if any OK/MUMBLE, else `unknown`; functional = `fail` if any MUMBLE, `pass` only if all three are OK, else `unknown`. `INTERNAL_ERROR` and any unrecognised string → `UNKNOWN`/unknown plus an info alert `checker_error` (dedupe `team-NN:service:checker_error`); never `pass`. Alerts for failures use `team-NN:service:reachability|functional`.
- Monotonic: a row with a lower round (or an older `checkedAt` when rounds are not comparable) than stored is rejected `older_than_stored`. A repeated round without `checkedAt` is `unchanged` and keeps the original `checked_at`, so a frozen source ages into stale.
- Batches apply in one SQLite transaction (flagstore upsert → checks → alerts → `last_health_check_at`).
- First batch from a real source clears simulated results (`flagstore_results`, `checks`) and closes simulated `service_down/degraded` alerts once (audited as `health.run`), so seeded rounds cannot outrank real ones.
- Staleness is applied at read time (`stale_after_sec`, default 270). Frozen = scoreboard reachable but round unchanged > 2 × `round_sec`.
- Scoreboard parser is PROVISIONAL (docs/12 A21); unknown shape → `SOURCE_SHAPE_UNKNOWN`.
