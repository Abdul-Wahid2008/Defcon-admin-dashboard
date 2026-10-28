# BUILD STATUS (27–28 Oct 2026, verified on the real repo; W7–W9 and a hardening pass added after the first write-up)

Previous version (W1 only) is in git history (`c3fda66`). This file covers W2–W9. W2–W6 were written after those five slices were built, reviewed and committed; W7–W9 were added later the same day.

## Snapshot
- Branch `release/v1.2`, version `1.2.0-rc.1`. **Not pushed.** Working tree is clean after the final commit of this session.
- Done: P1–P17 (v1.1), W0, W1, **W2 health source, W3 security/roles/freeze/accounts, W4 lifecycle capabilities + service actions + agent client, W5 overview matrix + UI copy, W6 operator workflows**. **W7 perf/backup/soak tools (the 60-minute soak was not run; 10 + 20 minutes were), W9 final hardening, runbook and tag.** **W8 (club evidence gate) was NOT executed: it is blocked on club inputs.** The tonight dry-run (doc 12 §11) has not been done: it needs the club's real `scoreboard.json` URL and a roster.
- Runtime default is unchanged: `ADAPTER=mock` + `HEALTH_SOURCE=mock` → badge **SIMULATED**. `HEALTH_SOURCE=scoreboard|ingest` or `ADAPTER=real|docker-compose` → **PARTIAL**. **LIVE cannot be shown today**: it needs `EVIDENCE_GATE_PASSED=true` and an adapter reporting `capabilities.fullyReal`, and none does.
- Gates at the end of the session (final code, tag `v1.2.0-rc.2`): `npm run typecheck` 0 · `npm run lint` 0 errors, 64 warnings · `npm test` **403/403 in 19 files** (authz matrix 191) · `npm run build` exit 0 · `npm audit --omit=dev` 0 vulnerabilities · 60-minute soak passed (overview p95 21.8 ms, 0 errors, memory −4.6%) · fresh-clone rehearsal and black-box attack probes passed (details under W9 and the hardening pass).
- Commits since `c3fda66` (oldest first):
  - `7b01967` feat(health): scoreboard/ingest health source with staleness (W2)
  - `b108ca8` fix(health): apply W2 review findings
  - `19f80c3` feat(security): roles v1.2, freeze, organizer accounts, headers, login limiter, CSV guard (W3)
  - `e38f4b6` fix(security): apply W3 review findings
  - `17ac8ef` feat(lifecycle): capability-driven reset, service actions, agent client (W4)
  - `f6751bd` feat(ui): overview matrix, event clock, teams table, tabs, copy pass (W5) + W4 review fixes
  - `90b452b` feat(ops): incident view, command palette, alert ack, notes conflict guard, bulk progress (W6)
  - `2c4c3de` feat(ui): W5/W6 review findings, roster `external_team_id`, BUILD_STATUS for W2–W6
  - `f0f897b` perf: online backup, load/soak tools, `synchronous=NORMAL` (W7)
  - `51eaab7` chore(release): W8 status, runbook, README v1.2, `shadcn` to devDependencies (W8/W9)
  - `2b32acd` fix(ui): Delete disabled for non-admin
  - `fe991c8` fix(lifecycle): clear `failure_reason` on a later success
  - `a945b7e` chore(release): v1.2.0-rc.1 hardening and runbook, tagged `v1.2.0-rc.1`
  - final commit `feat(security): hardening and performance pass (rc.2)` (this pass, docs, this file), tagged `v1.2.0-rc.2`.
- Size of the change: 124+ files, about 5.9k lines added. 10 new API routes (route files: 24 → 34), 3 new migrations (003, 004 plus W2 had none beyond 002), 7 new test files.

---

## W2 — HealthSource (scoreboard pull, token ingest, staleness)

**What exists**
- `src/lib/server/health/`: `verdicts.ts` (verdict → checks, worst-of over the 3 flagstores), `apply.ts` (`applyHealthBatch`, one SQLite transaction), `scoreboard-source.ts` (server-side fetch + the isolated parser), `source.ts` (lazy single-flight pull, source state, staleness, frozen detection, first-adoption clearing), `badge.ts`. `src/lib/server/limits.ts` (capped body reader, fixed-window limiter).
- Config (`src/lib/config.ts`, fail-closed, tested): `HEALTH_SOURCE=mock|scoreboard|ingest`, `HEALTH_SCOREBOARD_URL` (http/https only), `HEALTH_ALLOWED_HOSTS` (default: the URL's own host), `HEALTH_POLL_SEC` (15), `INGEST_TOKEN` (≥32 chars). `STALE_AFTER_SEC` is the `stale_after_sec` setting (270). `CHECK_RELEASE=1` rejects an explicit `HEALTH_SOURCE=mock`; `check-env` knows all of these.
- Verdict mapping: OK → reach pass/func pass; OFFLINE → reach fail; MUMBLE → reach pass, func fail; INTERNAL_ERROR / anything unrecognised → UNKNOWN (checks unknown, plus an info alert `checker_error`, not blamed on the team). Nothing ever defaults to pass.
- `applyHealthBatch`: monotonic (older round or older `checkedAt` rejected as `older_than_stored`; a repeated round keeps its original `checked_at` so a frozen source ages into stale); unknown team / service / flagstore / bad round / bad or future (> 60 s) `checkedAt` come back in `rejected[]`, never thrown; checks recomputed per service; alerts use the existing dedupe keys `team-NN:service:reachability|functional` (+ `:checker_error`); alert open/resolve audited as actor `system` only when a row really changed.
- Pull is **lazy, no timers**: `sync()` fires `pullIfDue()` without awaiting it (a slow source must not delay an organizer's click). Single-flight, 5 s timeout, `redirect:'error'`, no cookies, 2 MB cap, host allow-list, errors recorded as short codes only (`timeout`, `http_502`, `SOURCE_SHAPE_UNKNOWN`, `all_rows_rejected`, …), never a URL. "Run check now" forces one pull (max 1 per 5 s) and returns stored data; audited `health.run`.
- Staleness is applied at read time: a service whose newest result is older than `stale_after_sec` shows `unknown` with detail `stale` and `Service.stale=true`. Frozen source = reachable but round unchanged for > 2 × `round_sec` (source state `frozen`). Overview counters are computed from the stale-aware view.
- Mock guard: when `HEALTH_SOURCE≠mock`, `MockAdapter` no longer overwrites checks on start/stop/delete, `runHealthChecks`, or demo fault injection (which now refuses).
- **First adoption** of a real source clears simulated check/flagstore results and closes simulated `service_down/degraded` alerts once (audited as `health.run`). Found in browser QA: seeded `round 42` otherwise outranks real rounds 1…N through the monotonic rule.
- `POST /api/ingest/check-results`: bearer token (SHA-256 digests compared with `timingSafeEqual`), no cookies, body ≤ 256 KB (declared and streamed), ≤ 200 rows, zod `.strict()`, every row needs `round` or `checkedAt`; 404 when `INGEST_TOKEN` is unset **or** `HEALTH_SOURCE≠ingest`; `GET` → 405; only authenticated calls are rate-limited (120/min) so a bad-token flood cannot lock the real checker out; bad-token audit rows capped at 10/min. Response `{accepted, rejected:[{index,reason}]}`. `ingest.write` is a machine principal in `permissions.ts`, not a role.
- `/api/meta`: `badge`, `sources{health,lifecycle,roster}`, `health{state,lastRound,lastOkAt,lastError,staleAfterSec}`, `capabilities`, `frozen`. Public callers get only the badge/capabilities; source detail and `frozen` need a session.
- UI: per-service flagstore chips (icon + F0/F1/F2 + tooltip text), stale marks, overview source-freshness line, banner text built from the real sources ("Health: live (scoreboard, round 23, updated just now) · Lifecycle: simulated"), sidebar footer now shows the real badge.
- `scripts/fake-scoreboard.ts` (rotating fixture, `/control` endpoint to force a verdict or freeze the round), `tests/fixtures/scoreboard.provisional.json`.

**PROVISIONAL, needs the club:** the scoreboard parser. No real sample exists in `docs/club-inputs/`. The shape in `parseScoreboard` is invented for the pipeline (`{currentRound, teams:[{teamId, services:[{key, flagstores:[{key, verdict, message?}]}]}]}`) and **anything else fails closed as `SOURCE_SHAPE_UNKNOWN`** (visible in the overview and banner). Fields to confirm against a real `/data/scoreboard.json`: the round field name; how teams are identified and whether that id is what we store as `external_team_id`; how services are keyed (name vs id vs manifest key); whether the file has **per-flagstore** verdicts or only a per-service verdict (the dashboard model is per flagstore); the exact verdict strings; whether a per-row check time exists; whether the file freezes in the last 30 minutes.

**Evidence (browser, production build, port 3100, temp DB, fake scoreboard on 3200):** healthy overview; forced MUMBLE on team-03 DocuVault flag1 → team Degraded, functional Fail, alert; killed the fake server → banner "scoreboard: error, the source could not be reached", every service `Unknown` + "Stale", never green; zero console errors after the final navigation. Screenshots: `docs/qa/w2-*.png`.

**W2 review (fresh subagent, 9 findings).** Applied: ingest rate limit before auth (DoS of the real checker); future `checkedAt` never goes stale; pull no longer awaited inside `sync()`; overview failure counters ignore stale rows; ingest requires `round` or `checkedAt`; ingest marks the source errored when every row is rejected; `/api/meta` detail only for a session. Not applied: (6) no admin action to reset the health baseline if the source restarts at a lower round; (9) the adoption audit row is written once per failed first attempt (cosmetic).

---

## W3 — Security, roles v1.2, freeze, organizer accounts

- Permissions: `service.restart`, `service.reset`, `alert.ack` (admin + operator), `user.manage` (admin). `env.reset` is gone from `team` unless `TEAM_SELF_RESET=true` (default false). `tests/permissions.test.ts` updated in the same commit, full matrix kept.
- **Authz matrix** (`tests/authz-matrix.test.ts` + declarative `tests/routes.authz.ts`): globs every `route.ts` (34 routes), asserts each exported method is listed (proved: adding an unlisted route fails the test, then removed), then per route × method × {no cookie, admin, operator, team own/other team}, plus cross-origin → 403, missing Origin → 403, and a **frozen sweep** (every mutating admin call → 423 unless listed `frozen:'exempt'` with a reason). 185 tests.
- **Freeze**: `settings.mutations_frozen`; `POST /api/settings/freeze` (admin, typed `FREEZE`, audited `settings.freeze`); `assertNotFrozen` after `can()` in every mutating service call, bulk, demo routes, user create/reset-password, alert ack, service actions → `MUTATIONS_FROZEN` 423 plus a `denied` audit row. Still working while frozen: reads, audit and CSV export, logout, unfreeze, revoke-sessions, disable user, ingest, **Run check now** (a read-refresh; deliberate, reviewer disagreed). Banner shown to everyone while frozen. Verified over real HTTP (curl): 422 without the word, 200 freeze, 423 on a create, 200 on reads/audit, 200 unfreeze.
- **Organizer accounts**: `GET/POST /api/users`, `POST /api/users/[id]/reset-password|revoke-sessions|disable`; passwords generated server-side (16 chars), shown once via the existing reveal dialog, `must_change_password=1`; `POST /api/auth/change-password` (≥ 12 chars, re-issues the cookie, bumps the epoch so other sessions die); while the flag is set every other API returns 403 `PASSWORD_CHANGE_REQUIRED` and the console shows a blocking dialog. JWT carries `epoch`; `requireUser` rejects inactive/unknown users and tokens older than `users.session_epoch` (the console layout checks the same, so a revoked user stops seeing pages). Cannot disable yourself or the last active admin. Login equalises timing with a dummy bcrypt hash. Verified over HTTP: revoked operator session → 401, fresh login works, operator → 403 on `/api/users`.
- **Login limiter**: pair (5/5 min → 1 min lock), per-IP (30/10 min), per-username (10/10 min → 5 min lock across IPs). `X-Forwarded-For` is read only with `TRUST_PROXY=true` (rightmost entry); without it all callers share the `'direct'` bucket and the per-IP bucket is skipped (otherwise 30 failures from anyone would lock everyone out). Maps are bounded (reset above 5000 live buckets). Login/logout now require same-origin (login-CSRF).
- **Headers** (`next.config.ts`): CSP (no `unsafe-eval` in production; `unsafe-inline` scripts remain, see limitations), `frame-ancestors 'none'`, `X-Frame-Options: DENY`, nosniff, `Referrer-Policy: no-referrer`, `Permissions-Policy`, `Cache-Control: no-store` on `/api/*`. Verified with `curl -I` on `/login` and `/api/meta` against the production build; dev server (with `unsafe-eval`) renders with zero console errors. Cookie: `HttpOnly; SameSite=Lax`, `Secure` when `COOKIE_SECURE=true` or `X-Forwarded-Proto: https` (previously `Secure` whenever `NODE_ENV=production`, which would have broken plain-HTTP LAN use).
- **CSV**: `src/lib/csv.ts` (quotes escaped, leading `= + - @ TAB CR` neutralised) used by the audit export (it previously did not escape quotes at all) and the credentials download. Team import: 40 rows (zod) and 128 KB body cap (413).
- `npm audit --omit=dev`: 2 findings, both transitive via `shadcn` (a CLI package listed under `dependencies`): `body-parser` (high, DoS on trailing bytes) and `fast-uri` (moderate). Not in the app's request path (nothing imports `shadcn`); **not upgraded** (instruction: no auto major upgrades). Suggested fix: move `shadcn` to `devDependencies`.
- Screenshots `docs/qa/w3-*.png` (settings with freeze card + banner; organizer accounts table).

**W3 review (12 findings).** Applied: demo routes bypassed the freeze; login/logout CSRF; limiter memory + username/password length caps; per-IP bucket skipped without TRUST_PROXY; only credential failures count; `createUser` race (hash first, then check+insert); epoch update in SQL; credentials CSV guard; frozen and cross-origin sweeps added to the matrix. Not applied: Run check exempt from freeze (reasoned above); CSV guard does not cover leading whitespace/newline and changes `-5` to `'-5` (accepted).

---

## W4 — Lifecycle semantics, service actions, agent client

- `EnvironmentAdapter.capabilities {resetKind, serviceLevelReset, terminalMode, flagstores, fullyReal}`; served in `/api/meta`. Mock = `restore_patch` (+ simulated service actions); deprecated docker-compose = `restart`; agent = whatever `GET /v1/capabilities` returns, conservative until it answers. `DockerComposeAdapter` is marked deprecated, not extended.
- **Service actions**: `POST /api/teams/[id]/services/[key]/restart|reset` (permissions `service.restart` / `service.reset`, frozen → 423, idempotency key, running environment and no pending action required). Reset needs `{reason ≥ 10 chars, confirmTeamId}` else 422 `CONFIRMATION_MISMATCH`. They use the environment's **single pending slot** (`pending_action = service_restart|service_reset`, `pending_service_key`), complete lazily, write `requested` + completion audit rows with the same `correlation_id`, never touch `accepted_patch_version`, and record `environment.lastServiceAction` so the UI can toast only for its own request. Migration 003 adds the columns.
- **Environment reset**: when `resetKind ≠ restore_patch` a reason (≥ 10 chars) and the typed team id are required (422 otherwise) and stored in the `requested` audit row. Dialog copy comes from `src/lib/reset-copy.ts` per kind; the `recreate_pristine` wording is the lead's sentence verbatim and tagged `TODO(club)` UNCONFIRMED. Idempotent replay is checked before the confirmation.
- **Agent client + adapter** (`src/lib/server/adapters/agent/`, `ADAPTER=real`): typed client for the docs/15 §3 proposal (bearer, 10 s timeout, GET-only retry, polling uses 3 s/no retry, zod responses, IDs regex-checked before they reach a URL, errors → `ADAPTER_ERROR` with a generic message). `AgentAdapter extends MockAdapter`: roster/participants/health reading stay dashboard-side; start/stop/reset/provision and service actions are **real agent jobs** that complete only when the job reports success/failure (not by the mock clock); failure text from the agent is control-char-stripped and capped; polling is parallel and never blocks `sync()`; a pending row with no job id is failed after 30 s; a 10-minute wait fails with "state unknown" wording; provisioning = agent `start`; **delete is refused** (the contract has no delete). Tested only against `scripts/fake-agent.ts`.
- `TERMINAL_URL_TEMPLATE` (`{port}`, `{team}`) for the agent adapter, validated (http/https, no credentials); never audited. `EVIDENCE_GATE_PASSED` + `capabilities.fullyReal` gate the LIVE badge.
- Evidence: all three reset dialogs in a browser (test-only `MOCK_RESET_KIND_TEST_ONLY`, ignored in production builds): `docs/qa/w4-1/3/4-*.png`; service reset dialog `w4-2`; an end-to-end `recreate_pristine` reset as operator: dialog → 202 → audit pair (`requested` with reason + `resetKind`, `success` same correlation id) → team back to running.

**W4 review (11 findings).** Applied: polling no longer stalls requests; **false-success toast for start/stop/reset (existing bug)** fixed with `lastActionAt ≥ response.startedAt`, and the dialog now stays open with the error instead of closing before the POST; stuck-pending recovery; provisioning-refused audit now comes after its `requested` row; job-id regex shared; `fullyReal` gate for LIVE; idempotency before confirmation; timeout wording. Not applied: orphan agent job if the DB write fails right after the agent accepted (logged as a limitation); client team-id regex limits teams to 99.

---

## W5 — UI humanisation and matrix view

- Defect list before changing anything (screenshots `docs/qa/w5-before/`): marketing copy on overview/login ("A calm read…", "Operations are quiet", "Keep every team moving forward", "Welcome back", login footer hard-coding "SIMULATED ENVIRONMENT"); the matrix would not fit above the fold (five 180 px stat cards plus a posture card); environment tiles clipped; decorative grid/gradient behind data views; teams table 66 px rows with a separate "Sort" dropdown and a full-page skeleton on every filter change; services table overflowed at 1280; terminal link always in the DOM; `--idle` text colour 3.6:1.
- Overview: event strip (phase + round + start time, or "Event clock not set." with a link), source freshness, compact counts, **teams × services matrix** (failing-first, sticky header, R/F glyphs + three flagstore dots with text in tooltip and screen-reader text, memoised rows, click or Enter opens the team), alerts, recent activity. `OverviewData.grid[].services[]` and `OverviewData.event` added; `eventStartIso` setting (admin, Settings page). Phase lengths 45/165/30 min are the event-flow draft's numbers, labelled "not confirmed by the club" on screen.
- Teams: sortable headers with `aria-sort` (state in the URL, sort whitelisted), 40 px rows, row actions menu (open, start/stop with the reason a disabled item is disabled, copy id), keyboard-focusable rows, `/` focuses the page's search, "N of M selected", `keepPreviousData` so filtering never blanks the table.
- Team detail: tabs Overview / Services / Participants / Activity / Settings; services table failing-first and no longer overflowing at 1280; terminal shows availability and a "Show terminal link" button (the URL is not in the DOM until clicked; it is still in the authenticated API response).
- Consistency: removed the grid/gradient/shadow on data views, `tabular-nums` on tables, `--idle` → `#94A3B8`, a unit test fails on marketing words in `src/`, and a test fails on hard-coded "SIMULATED" outside the badge components.
- Evidence: a contrast scan of every text node on `/teams` found exactly 2 failures (the idle colour), fixed; `/` focus, header sort toggling (`?sort=state` → `-state`) and row tabindex checked in the browser; zero console errors. Screenshots `docs/qa/w5-after/`: overview at 1280×800, 1024×768, 1920×1080; teams and team services at 1280. **Not done:** 1440×900 shots, 1920 for teams/detail, a Lighthouse run. `next build` (Turbopack) prints no per-route JS sizes; total client chunks are about 1.4 MB uncompressed. Tab order, dialog focus and Esc were checked for the new dialogs only, not for the whole app.

---

## W6 — Operator workflows

- **Incidents** (`/overview?view=incidents`): only teams with a failed environment, failing or stale services, worst first, each with the problem in words ("DocuVault: reachability fail (flag0 OFFLINE, …)"), Open team, Run check, and Restart <service> for failing services when the adapter supports it (the server still enforces permissions). Verified in a browser.
- **Command palette** (Ctrl/Cmd+K): recent teams, pages (Incidents; Settings only for admins), teams, "Run check" for running teams; **`?`** opens a shortcut list. A first version crashed on open (cmdk needs a `<Command>` root; the console `CommandDialog` does not add one) — found only by opening it in a browser, fixed and re-verified (open, filter, Esc closes, help opens/closes, zero console errors).
- **Alerts**: `POST /api/alerts/[id]/ack {note?, resolve?}` (permission `alert.ack`, freeze, audit `alert.ack` with the note). Acknowledge keeps the alert open and stops it counting; resolve closes it and the next real health result reopens it if the failure persists. `openAlertCount` drives a sidebar badge (verified 4 → 3 after an acknowledge, with the audit row). Migration 004.
- **Notes**: inline card on the team page, autosaves on blur, conflict-safe (`expectedNotes`; a mismatch is 409 with the other organizer's text, and the UI offers "Use their version" or "Overwrite with mine"). Verified in a browser by editing behind the editor's back. Recently opened teams: browser-local list (palette + teams page strip).
- **Bulk start/stop**: the dialog now stays open and shows per-team progress (In progress → Now running/stopped, Failed, Refused with code, Could not confirm); the success toast appears only when every accepted team's polled state matches, otherwise a persistent error lists the teams that did not. Verified on the two stopped seed teams.
- Audit CSV export with the current filters was already in place; verified it passes the filters and goes through the new CSV guard (unit-tested).
- Roster: `external_team_id` is now an optional third CSV column and an optional field on create/import (duplicates skipped or 409), because health rows are matched on it — without it the real dry-run could not have mapped any team.

**W5+W6 review (one combined review, 11 findings).** Applied: unacknowledged alerts could be unreachable (list ordering, limit 25, archived teams excluded from list and badge); false "acknowledged" toast on `already_*`; bulk dialog could hang forever (now "Could not confirm") and its key changed under the user (ids snapshotted); notes saved mid-typing were overwritten; manual-resolve copy now states the condition; Run check refreshes the overview and says "simulated check" under mock health; overview view switch is a `nav` with `aria-current` instead of fake tabs; NaN page/unvalidated sort from the URL; list key collision. Not applied: team-detail tabs still lack the full ARIA tabs pattern (no `tabpanel`, no arrow keys); the notes compare-and-set is two awaits (safe with better-sqlite3, would need one SQL statement for an async adapter); several UI flows are covered only by the browser runs above, not by component tests.
Note: W5 and W6 got one combined review, not one each as doc 13 asks.

---

## W7 — Performance, reliability, soak (27 Oct 2026)

**Approach: measure first.** The baseline already beat every target, so no query rewrite was made. Numbers below are from a production build (`next start`, port 3100), temp DB `data/w7.db` seeded with 30 teams (`SEED_TEAMS=30`; seed team names extended from 24 to 30), 3 simulated organizers, mock adapter, this Windows laptop.

| Run | /api/overview p50 / p95 / p99 | /api/teams p50 / p95 / p99 | max overview payload | 5xx / network errors |
|---|---|---|---|---|
| Before (2 min, 53 polls each) | 13.5 / 17.6 / 22.5 ms | 12.3 / 15.2 / 28.7 ms | 23.9 KB | 0 / 0 |
| After pragmas (10 min soak, 244 polls each) | 12.5 / 17.3 / 21.0 ms | 10.5 / 15.7 / 17.9 ms | 23.7 KB | 0 / 0 |

Targets (p95 < 150 ms, payload < 60 KB, zero 5xx): all met with about 8x headroom. Lifecycle actions during the soak: 29 stop + 29 start, all 2xx, p95 11.0 / 8.0 ms.
**Memory:** RSS 117 MB -> 126 MB (+8.3%) over 10.2 min (22 samples). The target is < 15% over 60 min. **The 60-minute soak was NOT run at this point (it was run later and passed, see the hardening pass below)**; only 10 minutes. The 8.3% includes warm-up, so it neither proves nor disproves stability at 60 min. Run `npm run soak` with `LT_PID` set on the demo machine.

**Not done, deliberately (numbers did not justify it).** The N+1 in `listTeams`/`getOverviewData` (`loadServicesForTeam` once per team, 2 queries each) was not batched: 30 teams cost about 13 ms end to end. Revisit only if team count or per-request latency grows. `EXPLAIN QUERY PLAN` on the hot queries: services, checks, flagstore, participants and environments lookups all use primary-key or existing indexes; `audit_log` recent uses `ix_audit_ts`. Full scans exist only on `environments` (due-pending check, 30 rows), `alerts` (recent/open count) and `idempotency_keys` (expiry delete) — all tiny, so no index was added.

**Changes**
- `src/lib/server/db.ts`: added `synchronous = NORMAL` (WAL and foreign_keys were already set; busy_timeout is already 5000 ms by better-sqlite3 default, so no pragma was added for it).
- `scripts/loadtest.ts` (`npm run loadtest`): login with `LT_USER`/`LT_PASS`, per-organizer polling of overview + teams every 5 s, one stop/start per minute, p50/p95/p99, max payload, 2xx/4xx/5xx/network counts, RSS growth with `LT_PID`, exit 1 if a target fails. `scripts/soak.ts` (`npm run soak`) is the same with a 60-minute default.
- `scripts/backup.ts` (`npm run backup`): online backup API to `data/backups/<UTC ts>.db`, converted to a single file (no -wal/-shm), `integrity_check`, keeps newest 12 (`BACKUP_KEEP`), removes the partial file on failure. Verified: 3 consecutive backups with `BACKUP_KEEP=2` left exactly 2 files; run while the server was up.
- Restore drill re-run on a temp copy: teams 30, participants 120, environments 30, services 120, checks 240, audit_log 62, users 2, alerts 4 identical to live; `integrity_check` ok; `user_version` 4.
- README: online backup, Windows Task Scheduler line (every 5 min), restore steps, load/soak tools. The Task Scheduler line was written but **not executed** on this machine.

**Client checks (Playwright on the production build, overview page, admin).** 16 s visible: 3 `/api/overview` + 1 `/api/meta` requests; after faking `visibilityState=hidden`: **0** API calls in 16 s; 1 on return to visible; 0 overlapping in-flight requests to the same endpoint; 0 console errors. Nothing sets `refetchIntervalInBackground: true`.
First-load JS per page (all chunks referenced by the served HTML, production build; `next build` itself prints no sizes): /login 744 KB raw / 237 KB gzip · /overview 1001 / 318 · /teams 1011 / 321 · /audit 993 / 316 · /settings 1005 / 319 · /teams/team-01 1018 / 324. Not optimised.

**W7 review (fresh subagent, static, 10 findings).** Applied: README schtasks line was corrupted by my own template string (tab/backspace instead of backslashes — the task would never have run; rewritten and checked with `cat -A`), `set "DB_PATH=..."&&` quoting, logged-on-only note and `/RU SYSTEM` hint; backup now closes the check connection in `finally` and retries cleanup on Windows, filenames carry milliseconds (same-second runs no longer collide; prune regex updated and verified: 6 files -> 2 kept, 4 pruned), `BACKUP_KEEP` must be >= 1; load test now counts any non-2xx on the polled endpoints as a failure (a 401/429 can no longer print PASS), percentile uses ceil, and each organizer logs how many stop/start pairs ran; the redundant `busy_timeout` pragma was removed (better-sqlite3 already defaults to 5000 ms); the `synchronous=NORMAL` power-loss trade-off is documented in the README. Not applied: none rejected. Re-ran after fixes: 1-min load test PASS (7 stop + 7 start), wrong password exits 2.

**Gates after W7:** typecheck 0 · lint 0 errors, 66 warnings before fixing 2 new `any` in loadtest.ts (back to 64; after review fixes 0 warnings in the three scripts) · tests 388/388 in 18 files (no new test files: the scripts are tools; their check is the load test and backup run above) · build exit 0.

---

## W8 — Evidence gate with the club (27 Oct 2026): NOT EXECUTED, blocked on the club

No input from the club exists in the repository (`docs/club-inputs/` holds only its README): no `template.compose.yml`, no real `scoreboard.json`, no verdict list, no roster export, no agent or named owner, and no recorded authorisation for a destructive test. So **no real read and no real mutation was performed, and no evidence is claimed.** Steps 1–3 of the slice (map the compose template, compare 3 teams against the club's view for 10 minutes, one test team through start/stop/restart/reset) are all still to do.

What was done instead (all recorded, nothing invented):
- `docs/club-evidence/2026-10-27-w8-status.md`: the missing inputs, what was verified without club access, and the exact steps to run W8 once inputs arrive.
- `docs/defcon-control-center/10_INTEGRATION_COORDINATION_PLAN.md` §6 release decision record filled: every Evidence cell is "none"; Mock = yes for all rows; Real read = provisional only for health and team identity; Real mutation = agent client vs `scripts/fake-agent.ts` only (start/stop/reset), none for delete/credentials. Release mode: **SIMULATED by default, PARTIAL with a real health source, LIVE not permitted.**
- `config/services.json`: unchanged, every entry still `nameConfirmed=false`.
- Badge honesty verified end to end on the fresh clone (W9): with default sources `/api/meta` returns `badge: SIMULATED, adapter mock, sources health/lifecycle mock, fullyReal false`, and starting the server with `EVIDENCE_GATE_PASSED=true` **still** returns `SIMULATED`.
- Unsupported actions: reset wording and service-level actions follow `/api/meta.capabilities`; the agent adapter starts conservative (`serviceLevelReset=false`, `resetKind=recreate_pristine`, `fullyReal=false`) until the agent answers `GET /v1/capabilities` (`tests/w4-lifecycle.test.ts`). Under the mock the reset dialog says "restored to the latest accepted patch (v2), not the original vulnerable baseline" because `resetKind=restore_patch` there (seen in the browser).

---

## W9 — Final hardening and freeze (27 Oct 2026)

**Full gate (final code, before the tag)**

| Check | Result |
|---|---|
| `npm run typecheck` | 0 errors |
| `npm run lint` | 0 errors, 64 warnings (legacy `any`; unchanged from before W7) |
| `npm test` | **389/389 in 18 files** (388 before W9; +1 regression test for the stale failure reason; two existing tests got one extra assertion each) |
| Authz matrix (`tests/authz-matrix.test.ts`) | 185/185 |
| `npm run build` | exit 0 |
| `npm audit --omit=dev` | **0 vulnerabilities** (was 2 via `shadcn`; `shadcn` is a CLI nothing imports at runtime and moved to devDependencies) |
| `npm run check-env` on the `.env.example` copy | **fails as it must**: placeholder `SESSION_SECRET`, default admin and operator passwords |
| `check-env` on a real release env | passes; with `CHECK_RELEASE=1` and `HEALTH_SOURCE=mock` it is refused ("not allowed in a release"); with `HEALTH_SOURCE=ingest` and a 48-hex `INGEST_TOKEN` it passes |

**Fresh-clone rehearsal** (new folder under `%TEMP%`, `git clone` of `release/v1.2`, not the working tree)
- `npm ci` **fails on this machine**: better-sqlite3 13.0.3 runs `node-gyp rebuild` and there is no Visual Studio C++ toolchain. The package ships a Windows prebuilt binary, and `npm ci --ignore-scripts` works (SQLite 3.53.4 loads, `tsx` runs). README and runbook now say `npm ci --ignore-scripts`. (npm 11.19.1 also lists better-sqlite3, esbuild and unrs-resolver as install scripts "not yet covered by allowScripts"; not changed.) `npm install --package-lock-only` needs `--legacy-peer-deps` because of an existing `vitest@5` peer range on `@types/node`.
- Release `.env` with random secrets (never printed or committed), seed (24 teams), `npm run build` 18 s, `PORT=3100 npm run start:release` (check-env ran first and passed). Port 3000 and `data/defcon.db` untouched.
- **3-minute demo script (docs/08 §3) run twice** with Playwright on the production build at 1280×800: login, overview (SIMULATED badge, simulated-health banner, 24 teams, 4 incidents), teams list (24 rows), team-13 detail (Down, DocuVault failing), create team with masked one-time credentials, tick "saved" and close, team provisions to Running, reset team-19 (failed), operator login, audit. Run 1 took 25.4 s of scripted time and run 2 24.7 s, both with **zero console errors** apart from one deliberate 403 probe in run 1. The 1024×768 audit screenshot was checked: sidebar and filters fit, and the table scrolls horizontally with the Message column clipped (desktop-first; not changed). The creation of a new team's Provisioning step was seen in the list on run 1 ("Provisioning…") and in the API on run 2 (`pending:provision` then `running`).
- **Success toast only after the final state**: reset showed an info toast "Reset requested for team-19" while Resetting and the success toast "team-19 reset complete — running" only once the polled state was Running (17.2 s in run 1, 19.6 s in run 2).
- Operator: Delete disabled with title "Only administrators can delete teams."; `DELETE /api/teams/team-13` as operator returns **403 FORBIDDEN** (`required: team.delete`), the team stays running, and the audit has a `denied` row (`env.delete`, organizer_operator).
- Audit pairs: `env.reset` has a `requested` row (admin) and a `success` row (system) with the same correlation id (`c_434747c834ae`, `c_e35d1a3900b9`).
- A harness slip, not an app bug: a first attempt at run 2 hung on a list row that was on page 2 (26 teams, page size 25); the stopped script kept running for a moment and reset team-13 instead of team-19, which is why team-13 shows healthy afterwards in that rehearsal DB. The DB was re-seeded before the rehearsal that is reported above.
- **Backup/restore once, on the clone**: `npm run backup` while the server was running, row counts of 9 tables identical to live, `integrity_check` ok, `user_version` 4; then a real restore (server stopped, backup copied over `DB_PATH`, `-wal`/`-shm` deleted, restarted): `/api/meta` ok, admin login 200, 24 teams, audit total 163 (162 backed up plus the new login).
- **Load test, 2 × 10 minutes on the final build** (24-team seed): window 1 overview p95 15.3 ms, teams p95 13.1 ms, payload 20.1 KB, 0 5xx; window 2 overview p95 13.5 ms, teams p95 10.8 ms, 0 5xx. Memory: **+14.8%** in window 1 (100 to 115 MB, includes warm-up) and **+0.6%** in window 2 (115 to 116 MB). The 60-minute soak was still NOT run; this is 20 minutes, and the plateau is evidence, not proof. Window 1 overlapped with a vitest run and the reviewer; latency was unaffected.
- The rehearsal ran on commit `fe991c8`; the review fixes (stale flagstore verdicts, CSV guard) and docs came after, and were verified by the unit tests, typecheck, lint and build only, not by a second browser pass.

**Bugs found by running the product and fixed (each committed)**
1. `2b32acd` Delete was enabled for the operator in the UI (the server already refused it). Now disabled with an explanation. Found only because the demo script says it must be disabled.
2. `fe991c8` A team that recovered kept showing "Environment needs attention. reset failed (simulated)" while Running and Healthy, because the success path never cleared `failure_reason` (mock and agent adapters share it). Fixed; the regression test fails without the fix (verified by reverting).
3. Review fixes (below): flagstore verdicts on a stale service now read UNKNOWN instead of OK; the CSV guard now also catches a leading space or newline before `=`, `+`, `-` or `@`.

**W9 review (fresh subagent over `c3fda66..HEAD`, static, 7 findings, no blockers; it also ran the suite: 389/389).**
- Applied: stale flagstore verdicts, CSV leading-whitespace guard (tests added).
- Not applied, with reasons: (a) `POST /health/run` has no freeze check: this is a recorded decision (Run check only refreshes data) and the runbook says so; (b) the adapter call runs before the `requested` audit row in `requestLifecycleAction` and the service actions, so a process crash in between would leave an action without a requested row: changing audit ordering is out of bounds for a freeze slice, logged as a known limit; (c) team-role sessions skip the epoch check: team logins are not enabled, noted; (d) three routes read bodies with a hand check instead of one zod schema: not exploitable; (e) two assertions in `permissions.test.ts` and `config.test.ts` were rewritten for documented decisions (team `env.reset` only with `TEAM_SELF_RESET`; `ADAPTER=real` is now valid with the agent adapter), and the reviewer confirmed nothing was weakened.
- Verified fine by the reviewer: route order everywhere (login and ingest are justified special cases), `can()` before the freeze check, denied rows, bearer-only ingest with constant-time compare, 256 KB body cap and 200-row cap, scoreboard fetch limited by host allow-list, `redirect:'error'`, 5 s timeout and 2 MB cap, unknown health values never `pass`, plaintext passwords only in create/reset responses, no secret logging, no emoji, marketing words or lorem text in the copy. It did not read the UI beyond a copy grep and did not read `apply.ts` in full.

**Docs and release files**
- `docs/EVENT_RUNBOOK.md`: start order, who holds which secret, freeze procedure, what to say when health is stale, backup cadence, rollback to the last tag, incident table, escalation placeholders (names and phones left blank on purpose), honest limits.
- README: v1.2 section (sources, capabilities, roles, freeze, ingest, release gate, Windows start), online backup with the Task Scheduler line (written, **not registered** on any machine), restore, load tools, `npm ci --ignore-scripts`.
- `09_CHANGELOG.md` v1.2.0-rc.1 entry; `01_BLUEPRINT` A20–A31 (UNCONFIRMED); `05_UI_SPEC` v1.2 additions; `06` and `07` marked as superseded by the W0–W9 prompt pack; `10_INTEGRATION_COORDINATION_PLAN` §6 filled. Docs 02, 03, 04 and 08 already carried v1.2 content from earlier slices (grep-checked, not re-audited line by line).
- Tag `v1.2.0-rc.1` created on the W9 commit; superseded by `v1.2.0-rc.2` (hardening pass below). Both are pushed with the branch.

---

## Hardening and performance pass (27 Oct 2026, after W9), version 1.2.0-rc.2

Requested scope: verify everything, find bugs and security holes, finish anything left from the nine prompts, make it production grade and fast. Method: attack the running production build black-box (two probe scripts, about 70 cases), read the auth/limits/proxy code, measure speed in a real browser, fix, re-probe, re-measure.

### What was found and fixed

| # | Finding (how it was found) | Severity | Fix |
|---|---|---|---|
| 1 | **Logout did not revoke the token**: a copied session cookie kept working for up to 8 h after logout (probe: `token reuse AFTER logout` → 200) | High | Tokens carry a `jti`; logout writes it to `revoked_sessions` (migration 005); `resolveSession` rejects listed `jti`s. Other sessions of the same user keep working; epoch revocation (password change, admin revoke) is unchanged. Probe now 401. |
| 2 | **No request size limit on any JSON route**: `req.json()` buffered whatever was sent (20 MB to the unauthenticated login route was read in full) | High (memory/CPU DoS) | `readJson()` in `limits.ts`: 64 KB default, checks `Content-Length` and caps the stream so a missing/false length does not bypass it; replaced all 17 `req.json()` calls. 413 `VALIDATION_ERROR`. Import (128 KB) and ingest (256 KB) keep their own caps. |
| 3 | **Login CPU flood**: every attempt (any username) costs a bcrypt hash; the limiters only counted failures per username/pair, and per-IP is off without `TRUST_PROXY` | Medium | Global ceiling of 120 login attempts per minute (429). Existing sessions are unaffected. |
| 4 | **Inline scripts allowed by CSP** (`script-src 'unsafe-inline'`), the one hole listed since W3 | Medium (XSS blast radius) | Per-request nonce CSP from `src/proxy.ts` (`'self' 'nonce-…' 'strict-dynamic'`), root layout forced dynamic so every page, incl. login and 404, carries a nonce; the static CSP in `next.config.ts` removed (two policies would intersect). Verified in the browser: login/overview/team/settings hydrate, all inline scripts carry the nonce, zero CSP violations. Styles keep `unsafe-inline` (React/UI-kit style attributes cannot carry a nonce). |
| 5 | `GET /api/teams?page=99999999999999999999` → **500** | Medium (crash path) | `intParam()` clamps `page` 1..100000 and `pageSize`/`limit` 1..100 on teams, audit and alerts. |
| 6 | Path with a malformed percent-escape (`/api/teams/%E0%A4%A`) → bare **500** | Low | Proxy answers 400 before routing. |
| 7 | `Idempotency-Key` of 5000 characters accepted and stored | Low (table bloat) | `idempotencyKeyFrom()`: 1–128 printable ASCII, else 400, on all 7 routes that read it. |
| 8 | `X-Powered-By: Next.js` exposed | Low | `poweredByHeader: false`. Added `Cross-Origin-Opener-Policy` and `Cross-Origin-Resource-Policy: same-origin`. |
| 9 | Organizer passwords were only checked for "not default" | Low | `check-env` also requires 12+ characters. |
| 10 | Server config parser (`config.ts`) was bundled into the **browser** because the client imported a polling constant from it (only env var names, no values, were present; verified by grepping the build output) | Low (footgun) | `POLLING_INTERVALS` moved to `src/lib/polling.ts`; `config.ts` re-exports it. |
| 11 | Unused dependencies `recharts`, `tw-animate-css` (never imported) | Low (supply chain) | Removed, lockfile regenerated. `npm audit --omit=dev`: 0. (`npm audit` including dev still lists 2 findings in the `shadcn` CLI tree, not shipped.) |

**Left as is, on purpose (documented):**
- **Username lockout is a denial-of-service lever**: 10 failures for a name from any address lock that name for 5 minutes (demonstrated: my own probe locked `admin`). Raising the limits would only help brute force and not help the DoS. Mitigation is network-level (organizer network only, assumption A27) plus the runbook recovery (restart clears the in-memory limiter; signed-in sessions are unaffected).
- Audit `requested` row is written after the adapter call (crash window); `POST /health/run` allowed while frozen (decision); team-role sessions have no epoch (team logins off); three routes parse bodies by hand instead of a zod schema (not exploitable).
- Cookie is `Secure` only behind HTTPS (`X-Forwarded-Proto`) or `COOKIE_SECURE=true`; on a plain-HTTP LAN it is not. Runbook says serve HTTPS or set the flag.
- `Math.random()` is used for request ids only (not a secret). The opt-in, deprecated Docker adapter uses `execFile` (no shell) and was not extended.
- No Supabase or other hosted backend was added. Rule from the repo ("no external hosted service in the request path") and the masterprompt still holds, and nothing in the nine prompts needs more than the SQLite state: a hosted database would add a network dependency and a new place for secrets to the event-day path. If you later want an off-site audit copy, that is a separate, explicit decision.

### Verified safe (attacked, held)
Unauthenticated sweep of 10 API routes (all 401), demo routes closed, cross-origin / missing / `null` Origin POSTs (403), `alg=none`, forged role, bad signature (401), operator on admin routes (403), SQL injection strings in `q`, `sort`, ids and audit filters (no effect, parameterised), `LIKE` wildcards, path traversal and NUL in ids (404), stored markup in team names and notes (rendered as text on 4 pages, no execution, no injected nodes), CSV export formula cells (none leading), error bodies (no stack, no paths), CORS (no `Access-Control-Allow-Origin`), 405 for wrong methods, same-origin enforcement on login/logout, 12 parallel stops on one team (exactly one accepted, 11 × 409, one `requested` audit row), 6 parallel creates of one name (one 201), 6 parallel requests with one idempotency key, forced password change gate, weak password rejection, case-insensitive duplicate usernames, admin cannot disable themselves, `revoke-sessions` kills that user's token, freeze returns 423 on mutations.

### Left over from the nine prompts, now finished
- **W3 CSP** without inline scripts (above). **W5** screenshots at 1440×900 and 1920×1080 (plus 1280×800 and 1024×768): no horizontal scroll, layout checked; ARIA tabs pattern (roving tabindex, arrows/Home/End, `tabpanel` with `aria-labelledby`) on the team page; keyboard path through tabs verified. **W7/W9** the full 60-minute soak (below, passed). Admin action to reset the health baseline (open limitation #6 since W2): new route, service, authz-matrix row, Settings card, tests (one-shot design, see the review below).
- Still open and honest: W8 with the club (blocked on club inputs), a screen-reader pass (not possible here), component tests for dialogs, the audit-before-adapter ordering, the Task Scheduler backup registration on the demo machine, and a Lighthouse score (the tool available here excludes performance; speed was measured directly instead).

### Speed (production build, this laptop, 30 teams)
Measured in headless Chrome with cache disabled. First contentful paint 144 ms (login), 180 ms (overview), 316 ms (teams), 180 ms (team detail), 252 ms (audit); largest contentful paint 296–448 ms; TTFB 24–74 ms; about 285 KB of gzipped JS per console page (200 KB on login); page load events complete in 227–314 ms. **During 22 s of normal 5 s polling on overview and teams: zero long tasks, 60 fps (p95 frame 17 ms, max 18 ms, zero frames over 50 ms).** Interactions: tab switch 157 ms, Reset dialog open 82 ms, Ctrl+K palette 96 ms, server-side search 362 ms (includes the debounce and a request). Layout shift per page 0.03–0.09 (under the 0.1 threshold); the one real source (the source banner appearing after `/api/meta` loads and pushing the page 35 px) now has reserved space. API: overview p95 about 13–17 ms, teams p95 about 11–16 ms at 24–30 teams. No change to the data layer was needed.

### 60-minute soak (the one that was missing since W7)
Production build rc.2 code, 30-team seed, 3 simulated organizers polling overview and teams every 5 s, one stop/start per minute each, server memory sampled every 30 s, run on the same laptop while nothing else heavy ran.

| Endpoint | polls | p50 | p95 | p99 | max payload | 2xx | 4xx | 5xx | network errors |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| `/api/overview` | 1437 | 15.6 ms | 21.8 ms | 28.6 ms | 24.5 KB | 1437 | 0 | 0 | 0 |
| `/api/teams` | 1437 | 13.0 ms | 20.8 ms | 29.4 ms | 6.0 KB | 1437 | 0 | 0 | 0 |
| stop (mock lifecycle) | 178 | 5.7 ms | 16.2 ms | 20.1 ms | 0.2 KB | 178 | 0 | 0 | 0 |
| start (mock lifecycle) | 178 | 6.8 ms | 9.8 ms | 14.6 ms | 0.2 KB | 178 | 0 | 0 | 0 |

**Memory: 130 MB to 124 MB (−4.6%) over 60.2 minutes, 122 samples** (target was growth under 15%). All targets met with about 7× headroom on latency. The soak ran on the build made before two late review fixes (baseline reset design, global-login-ceiling ordering); those paths are not on the polled endpoints and are covered by unit tests plus the final HTTP smoke below.

### Gates after this pass
Final code (rc.2), after the last change: `npm run typecheck` 0 errors · `npm run lint` 0 errors, 64 warnings (unchanged) · `npm test` **403/403 in 19 files** (389 before this pass; +14: hardening, logout revocation, nonce CSP, baseline reset, global login ceiling, body caps, pagination, idempotency key, malformed path) · authz matrix **191/191** (was 185; new route listed; matrix logout case now mints a throwaway token because logout really revokes) · `npm run build` exit 0 · `npm audit --omit=dev` 0 vulnerabilities · final HTTP smoke on the rebuilt server: version 1.2.0-rc.2, badge SIMULATED, no `X-Powered-By`, COOP/CORP and a nonce CSP present, login 200, `POST /api/settings/health-baseline` 200 `{armed:true}`, logout 204, the same token then 401.
Existing tests changed (none weakened): migration tests expect `user_version` 5; the freeze test re-issues the admin token after its logout step; the header test now reads the CSP from the proxy and additionally asserts no `unsafe-inline` for scripts, a fresh nonce per request and no second static policy.

### Review of this pass (fresh subagent, static; 2 medium, 4 low, no high)
- **Applied:** (1) The baseline reset first NULLed stored rounds, which made a replayed or frozen batch look freshly checked, reset the round-changed timer (blinding stuck-source detection) and erased `last_error`. It is now a one-shot flag (`settings.health_baseline_reset`) that only lets the next accepted batch pass the "older round" check; nothing stored is rewritten, `last_error` and the timer are untouched, and the flag clears itself (test asserts stored rounds/times are identical after arming and that going backwards is rejected again afterwards). (2) The global login ceiling is now counted after the per-name and per-address locks, so requests already refused do not eat the budget.
- **Accepted, documented:** the page proxy only verifies the token signature (a logged-out cookie still gets the HTML shell; every data call returns 401); tokens without a `jti` (issued before this pass) cannot be revoked individually and expire within 8 h; revoked rows are purged only on logout; the 400, redirects and JSON responses carry no CSP (harmless).
- **Confirmed fine by the reviewer:** the body cap cannot be bypassed (no `req.json()`/`req.text()` left; ingest and import use the capped reader), revocation order (jti before user lookup, epoch still applies, change-password re-issues), nonce plus `strict-dynamic` is correct and fresh per request, no weaker policy replaced the old one, the malformed-percent guard cannot break legitimate routes, baseline route order/authz/freeze/audit.

### Contract changes (additive; docs 03 and 04 updated in the same commit)
`POST /api/settings/health-baseline` (`{armed:true}`); request-size, pagination-clamp and `Idempotency-Key` rules; malformed-path 400; logout revokes the token; global login ceiling; session `jti`; migration 005 (`revoked_sessions`, `user_version` 5); per-request CSP, COOP/CORP headers; `check-env` 12-character password rule.

---

## CONTRACT CHANGES (all additive, documented in docs/03 and 04 in the same commits)
- `/api/meta`: `badge`, `sources`, `health`, `capabilities{resetKind,serviceLevelReset,terminalMode,flagstores,fullyReal}`, `frozen`.
- Types: `Service.stale`, `Environment.lastServiceAction`, `PendingAction.action` += `service_restart|service_reset` + `serviceKey`, `Alert.ackedAt/ackedBy/ackNote`, `OverviewData.healthSource/event/openAlertCount/grid[].services`, audit target type `user`.
- Routes: `POST /api/ingest/check-results`, `POST /api/settings/freeze`, `/api/users` (+3 actions), `POST /api/auth/change-password`, `POST /api/teams/[id]/services/[key]/restart|reset`, `POST /api/alerts/[id]/ack`. Behaviour changes: `PATCH /api/teams/[id]` takes `expectedNotes`; `PATCH /api/settings` takes `eventStartIso`; reset takes `{reason, confirmTeamId}`; bulk returns 403 up front for a role without the permission (it used to answer 200 with per-team rejections) and 423 while frozen; team import has a body cap and an optional `externalTeamId`; login/logout need same-origin.
- Errors: `MUTATIONS_FROZEN` (423). Audit actions: `alert.open|resolve|ack`, `ingest.rejected`, `settings.freeze`, `user.*`, `auth.password_change`, `service.restart|reset`.
- Permissions: `service.restart`, `service.reset`, `alert.ack`, `user.manage`; team lost `env.reset` by default.
- Migrations 003 (`environments.pending_service_key/pending_job_id/last_service_action_json`) and 004 (`alerts.acked_*`).
- New env vars (all in `.env.example`): `HEALTH_SOURCE`, `HEALTH_SCOREBOARD_URL`, `HEALTH_ALLOWED_HOSTS`, `HEALTH_POLL_SEC`, `INGEST_TOKEN`, `TEAM_SELF_RESET`, `TRUST_PROXY`, `COOKIE_SECURE`, `TERMINAL_URL_TEMPLATE`, `EVIDENCE_GATE_PASSED`, `CHECK_RELEASE`.

## Behaviour changes you might trip over
- Every API user must exist in `users` with an active flag and a matching `session_epoch`; tests that forge sessions need `tests/helpers/users.ts`. Existing browser sessions from before the W3 build lack `epoch` (treated as 0), so they keep working until someone revokes that account.
- Dev DBs created before W1 still have the old 5 services; before W3 they have no organizer must-change flag. Re-run `npm run seed`.
- `next dev` writes a generated "This is NOT the Next.js you know" block into `AGENTS.md`; `CLAUDE.md` now carries the same block so the two stay identical.
- Bulk reset no longer exists in the UI or API (it never did: only start/stop).

## How to rehearse the real-health path (no club access needed)
1. `npm run seed` on a temp DB with explicit passwords, `npx tsx --tsconfig tsconfig.scripts.json scripts/fake-scoreboard.ts` (PORT 3200).
2. `HEALTH_SOURCE=scoreboard HEALTH_SCOREBOARD_URL=http://127.0.0.1:3200/data/scoreboard.json HEALTH_POLL_SEC=5 SESSION_SECRET=<64 chars> DB_PATH=data/<temp>.db DEMO_CONTROLS=false npx next start -p 3100` (never 3000; the `.env` has `DEMO_CONTROLS=true`).
3. `curl "localhost:3200/control?team=3&service=docuvault&flagstore=flag1&verdict=MUMBLE"`; `?freeze=1` freezes the round; kill the fake to see "stale".
4. For the agent path: `npx tsx scripts/fake-agent.ts` (PORT 3300) and `ADAPTER=real ORCHESTRATOR_BASE_URL=http://127.0.0.1:3300 ORCHESTRATOR_TOKEN=fake-agent-token-fake-agent-token-0000 ORCHESTRATOR_TIMEOUT_MS=5000`.

---

## Open limitations (honest list)
**Data and club-dependent**
1. The scoreboard parser is a provisional shape; a real file will fail closed until the parser is rewritten (isolated in one function; fields listed under W2).
2. The agent contract is our proposal; no agent exists. Delete is unsupported, credentials/terminal/resources/sessions are not provisioned by the agent (resource numbers and session counts stay `// MOCK` and labelled), so `fullyReal` is false and LIVE is unreachable on purpose.
3. Reset semantics (spec says teams may reset; the chat says no): default is no self-reset and capability-driven copy, but the lead has not decided.
4. Service names, port offsets, 3 flagstores per service, 45/165/30-minute phases, 90 s rounds, the 270 s stale threshold: all UNCONFIRMED defaults, labelled in config/UI.
5. Pre-existing hazard: nothing has run against the club's real EnoEngine, nginx, compose template or EC2 host.

**Product gaps**
6. ~~No admin action to reset the health baseline~~ Done in the hardening pass (Settings, "Health source baseline", one-shot).
7. Operators can reset a single service; doc 12's matrix says "configurable off", which is not built.
8. Team-detail tabs lack the full ARIA tabs pattern; the notes compare-and-set is not a single SQL statement; the orphan-agent-job window after an accepted job whose DB write fails is not closed.
9. Mock health never refreshes flagstore results, so under `HEALTH_SOURCE=mock` the flagstore chips are seed data (labelled via the SIMULATED banner).
10. `/api/meta` is public for the badge; `terminal.url` is still in the authenticated team payload.
11. Roster arrives only by CSV/JSON import (no Supabase/TeamSource); the per-IP login bucket is disabled without `TRUST_PROXY`, so brute-force protection there rests on the pair and username limits.
12. Not done: the Task Scheduler backup line is documented but not registered on any machine; W8 (club evidence gate) is not executed; the audit `requested` row is written after the adapter call (crash window); `POST /health/run` is allowed while frozen by decision; team-role sessions have no epoch (team logins off). The 60-minute soak passed (hardening pass).

**Tooling and test**
13. 64 lint warnings (0 errors). The CSP no longer allows inline scripts (per-request nonce, hardening pass); styles still allow inline. The username lockout (10 failures, 5 minutes, any address) can be used to lock an organizer out; mitigation is the organizer-network-only deployment and the restart recovery in the runbook.
14. `npm audit --omit=dev`: 0 vulnerabilities after `shadcn` moved to devDependencies (W9). A plain `npm ci` fails on Windows without Visual Studio C++ build tools (better-sqlite3 compiles instead of using its prebuilt binary); use `npm ci --ignore-scripts`. `npm install` needs `--legacy-peer-deps` (vitest peer range).
15. UI flows covered only by browser runs, not component tests: ack dialog, notes conflict UI, bulk dialog, palette selection. The browser checks were run by me through scripted DOM events and screenshots; **keyboard-only and screen-reader passes were not done**, and no real-key presses beyond the `/` and Ctrl+K dispatches.
16. Lighthouse not run; 1440×900 screenshots not taken.
17. `next dev` reloads in a loop if a tool writes files inside the repo; browser QA was therefore done on production builds (the three reset-dialog variants needed a dev server and screenshots were written outside the repo for those).

## Decisions I made that you may want to reverse
- Run check now stays available while frozen (it only refreshes data).
- Acknowledge does not close an alert; it only mutes it from the badge count. Resolve is separate.
- A manual resolve is not sticky: the next real health result reopens it.
- Health batch rows with neither `round` nor `checkedAt` are refused at the ingest door (else monotonic order cannot be enforced).
- First real batch wipes simulated results once (audited), so a seeded DB switches cleanly to a real source.
- LIVE needs an operator-set flag **and** an adapter that claims `fullyReal`; no adapter does yet.
- `AgentAdapter` provisions a new team by calling the agent's `start`.
- `AGENTS.md`/`CLAUDE.md` both carry the Next.js-generated block.

## Open questions
**For the club / lead (answers needed before the dry-run and W8)**
1. A real `/data/scoreboard.json` sample and its URL from the dashboard host; per-flagstore or per-service verdicts; verdict strings; the field that identifies a team and whether it is what registration calls the team id; does the file freeze in the last 30 minutes (then an unfrozen status file or push is needed)?
2. Option B: can the checker push to `POST /api/ingest/check-results`? How often?
3. Reset: may players reset themselves; what does an admin reset restore; does it wipe service data? (Also whether moderators may reset a service.)
4. Who owns the EC2 lifecycle (allow-listed agent vs. compose on the host); a `template.compose.yml`; compose project naming; is there a delete/teardown operation; how are participant credentials and the terminal provisioned; per-team ttyd or shared; the terminal URL pattern (without credentials).
5. Final service names (PulseChat vs CampusPortal, "Service 4"), port offsets, number of teams (20 vs 30), event start time and phase lengths, round length.
6. Registration export sample (3 rows): does it include the engine team id?
7. Is "moderator" our `organizer_operator`, and what must a moderator not be able to do?
8. Confirmation that the dashboard is reachable only from the organizer network.

**For you (project owner)**
9. Push `release/v1.2`? Nothing has been pushed.
10. Is the CSP with `'unsafe-inline'` scripts acceptable for the event, or should login become dynamic so a nonce CSP can be used?
11. Move `shadcn` to `devDependencies` to clear the production audit findings?
12. Should operators keep `service.reset`, and should "Run check now" be blocked during a freeze?
13. Combined W5+W6 review instead of two: acceptable, or should I run a separate one?
14. Next: dry-run as soon as item 1 arrives, then W8 with the club. W7 and W9 are done (see their sections); the 60-minute soak and the backup task registration remain for the demo machine.

## Hazards
- Port 3000 and `data/defcon.db` belong to a pre-existing server and were never touched. During this session one broad `pkill -f "next start"` was attempted and **blocked by the permission system before it ran**; afterwards servers were stopped only by the PID listening on 3100/3101/3200. QA used ports 3100, 3101, 3200 and temp DBs `data/w2qa.db`, `w3qa.db`, `w4qa.db`, `w6qa.db` (gitignored, left on disk).
- The local `.env` has `DEMO_CONTROLS=true`, which makes `next start` fail closed; pass explicit env as in the rehearsal steps.
- `.playwright-mcp/` (browser tool output) is gitignored and can be deleted.
- W9 rehearsal artifacts: a fresh clone under `%TEMP%\dcc-clone-*` (deleted at the end), temp DBs `data/w7.db`, `data/w7-backups/` and earlier `w2qa`/`w3qa`/`w4qa`/`w6qa` (gitignored, left on disk), random rehearsal credentials only in `%TEMP%` files that were deleted. Ports used: 3100 only; port 3000 and `data/defcon.db` were never touched.

## Next step
1. Get the club inputs (questions 1–2, 5–6) and do the dry-run (doc 12 §11): import the real roster with `external_team_id`, point `HEALTH_SCOREBOARD_URL` at the real file, fix the parser, compare 3 teams against the club's scoreboard, record `docs/club-evidence/2026-10-27-dryrun.md`.
2. Run **W8** with the club (steps in `docs/club-evidence/2026-10-27-w8-status.md`); only then consider `EVIDENCE_GATE_PASSED=true`.
3. On the demo machine: register the Task Scheduler backup, fill the escalation table in `docs/EVENT_RUNBOOK.md`, do one rehearsal from the runbook (the 60-minute soak is done).
4. Decide whether to push `release/v1.2` and `v1.2.0-rc.1` (nothing has been pushed), and whether the freeze/deadline is known yet.
To resume: `git status`; `npm run typecheck && npm test` (expect 403/403); read this file, `docs/EVENT_RUNBOOK.md` and docs 12–15; QA on ports 3100/3101 only, on a production build; install with `npm ci --ignore-scripts`.

## Session 28 Oct 2026 (docs-only) — U1 and leaderboard planning added, nothing implemented
**Code state is unchanged:** branch `release/v1.2` at `1232f84` (v1.2.0-rc.2). No source, test, config or dependency file was touched this session, so the rc.2 validation gate above (typecheck 0, lint 0 errors, 403/403 tests, build 0, audit 0, 60-minute soak) still describes the code. I did not re-run it in this session.

**Added (documents only):**
- `16_LEADERBOARD_SPEC_AND_PROMPTS.md` — scope change D24 (from Abdul, **not yet confirmed by the club lead**): the leaderboard becomes a separate participant-facing application, not a page in the admin console. Contains facts/assumptions/decisions, a masterprompt and slices L0–L6. Until the club confirms, CLAUDE.md "out of scope: leaderboard" still stands.
- `17_UI_ALIGNMENT_AND_POLISH_PROMPT.md` — slice **U1**: layout diagnosis and foundation fix, visual polish, login lockout fix, gate and 10-minute soak, tag `v1.2.0-rc.3` on a new branch `release/v1.2-ui`.

**U1 status: NOT started.** The "right side looks broken" report is unverified. Suspects to confirm with `scripts/qa-layout.ts` before editing: `h-screen overflow-hidden` shell silently clipping wide children, a 1440 px content cap against a full-width Topbar on wide screens, and the custom scrollbar changing the right gutter. The lockout problem (username lockout lets anyone on the network lock the admin out) is a known availability bug for the live event and is scheduled as U1 step 4 (block per IP+username, per-IP ceiling, `npm run unlock`, runbook entry).

**Open items carried forward (unchanged):** club inputs (real `scoreboard.json` sample, `template.compose.yml`, verdicts, reset semantics, agent owner), W8 evidence gate, dry-run, backup task registration and escalation table on the demo machine, freeze date unknown. New question for the club lead: confirm D24 (we build the leaderboard).

**Next:** run U1 on `release/v1.2-ui` (diagnose first, then foundation, lockout fix, gate, soak, reviewer), then the dry-run when the scoreboard sample arrives. Leaderboard slices L0–L6 wait for D24 confirmation.

## U1 — dashboard alignment, layout foundation and login lockout fix (28 Oct 2026, v1.2.0-rc.3)
Branch `release/v1.2-ui` (from `release/v1.2` at `81c7a83`), tag `v1.2.0-rc.3`. **Not pushed, not merged to main or `release/v1.2`.** Spec: `17_UI_ALIGNMENT_AND_POLISH_PROMPT.md`.

### Step 1 — diagnosis (measured before any layout change)
`npm run qa:layout` (new, `scripts/qa-layout.ts`) seeds a temp DB, starts the production build on port 3100 with explicit env (port 3000 and `data/defcon.db` untouched), drives headless Chrome over CDP and, for 7 widths (1024, 1280, 1366, 1440, 1536, 1920, 2560; heights 768/900/1080) × routes, records: document horizontal overflow, clipping or unplanned horizontal scroll by any container, topbar/banner/content edge alignment, ellipsis truncation without a title, console errors, and a screenshot per case (`qa-out/layout/`, gitignored). Routes: `/login`; as admin `/overview`, `/overview?view=incidents`, `/teams`, `/teams/team-01` and each of its 5 tabs, `/audit`, `/settings`; as operator overview, teams, team detail, audit. Exit 1 on any defect.

Before-table (rc.2 build, 150 defects):

| Defect | Count | Root cause |
|---|---|---|
| Topbar inner edges (256..W-16) vs content (264..W-24): 8 px offset each side, every width, every route | 140 | Topbar used `px-4`, content `px-6`, banners `px-4`; content capped at 1440 px while the topbar spans the full width, so on wide screens the content floats with empty bands |
| Unplanned horizontal scroll: overview matrix, Teams table, team Services tab, Audit table at 1024 | 10 | Tables wider than the content column with no scroll affordance; the Teams row-actions column was cut off at the right edge (the most likely "right side looks broken" report) |
| Hard clipping by `overflow-hidden` ancestors | 0 | The suspected silent clipping did not occur: `main` is `overflow-y-auto`, which makes overflow-x auto, so wide content scrolled instead of being hidden. Found by measurement, not assumed. |

The raw before-output file was deleted by mistake before this report; the table is from the run's printed output.

### Step 2 — what changed
- One `.page-container` (`--page-gutter: clamp(16px, 2vw, 32px)`, `--page-max: 1680px`, centred) used by the Topbar inner box, both banners and the page content; their inner edges match at every width.
- One scroll region, `.console-scroll` (replaces `main` as the scroller), with `scrollbar-gutter: stable`; Topbar and banners are one sticky block inside it, so they share the page width and gutter. Shell uses `h-dvh`. The global 6 px WebKit scrollbar is replaced by `scrollbar-width: thin` (no layout change).
- Wide tables scroll in their own `[data-qa-scroll]` container (shared `Table` component and the service matrix) with edge shadows. The Teams table (`.sticky-cols`) keeps checkbox + team name on the left and the actions column on the right; cell padding tightened so it fits at 1024; `scroll-padding-inline` keeps a focused cell out from under the sticky columns.
- Banners: 16 px icons, opaque background (they are sticky), loading placeholder height matched to the real banner (37 px).
- `package.json` version 1.2.0-rc.3; `.gitignore` adds `qa-out/`.

### Step 3 — visual review
Screenshots read: 2560 overview (content and topbar aligned, no empty bands), 1024 teams (all columns and the actions menu visible; the first sticky version hid the "Updated" header sort icon, fixed by the padding change), 1024 audit (Message column scrolls inside the card with an edge shadow), 1024 team detail. `npm run qa:layout` after the changes: PASS at all 7 widths, all routes, both roles.

**Not done (honest scope):** the 5-size typographic scale, the 8 px spacing audit, 36/44 px row-density modes, sticky headers on the Teams and Audit tables (their scroll container only scrolls horizontally, so a sticky header would need an inner height limit), noise reduction of borders/shadows and unified button sizes were not applied systematically. Only the foundation, banners, tables and the Teams page were touched. No computed-style contrast pass was run. The Audit filter row still wraps the "Team" select onto its own line at 1024.

### Step 4 — login lockout fix
- Root cause: a per-username block (10 failures → 5 min, any address) let anyone who could reach the login page lock `admin` out; with `TRUST_PROXY` off every caller also shares the address `direct`, so the pair block (5 failures → 1 min) did the same.
- Now (`src/lib/server/auth.ts`): ip+username (5 / 5 min → 1 min) and per-ip (30 / 10 min) block **only when the real address is known (`TRUST_PROXY=true`)**. Failures against a username add a delay to the next attempts (250 ms per failure after the 4th, max 3 s, `loginDelayMs`, applied in the login route before the password check) but never block. Global 120/min ceiling unchanged. With `TRUST_PROXY` off, guessing is bounded only by the delay and the global ceiling.
- `npm run unlock` (`scripts/unlock.ts`) calls `POST /api/auth/unlock-limiter`: machine route, bearer = HMAC-SHA256 of `SESSION_SECRET` (so it needs the server's `.env`), cookies never authenticate it, 503 if `SESSION_SECRET` is unset or short, only bad-token attempts are rate limited (10/min), writes audit `auth.limiter_reset`. Clears the in-memory limiter without a restart. Documented in `docs/EVENT_RUNBOOK.md`. **I did not run `npm run unlock` against a live server.** The route is covered by the authz matrix (401 without a token) and the limiter by unit tests, but unlock with a valid token end to end is untested.
- CONTRACT CHANGE (additive, in `03_API_CONTRACT.md`): route `/api/auth/unlock-limiter`; audit action `auth.limiter_reset` (TypeScript type, zod enum and audit page label map).
- Tests: the old "username locked for 5 min from any address" test was replaced because the policy changed. New: other IPs never blocked, delay grows and caps, an attacker IP cannot lock another IP, `direct` never blocks, `resetLoginLimiter` clears all counters. The pair, per-ip, global 120/min and success-clears tests pass unchanged.

### Step 5 — gate
| Check | Result |
|---|---|
| `npm run typecheck` | 0 errors |
| `npm run lint` | 0 errors, 69 warnings (64 legacy + 5 in the new scripts/tests) |
| `npm test` | 409/409, 19 files (was 403) |
| `npm run build` | 0 |
| `npm audit --omit=dev` | 0 vulnerabilities |
| `npm run qa:layout` | PASS, 7 widths |
| authz matrix | unchanged except the new machine-route entry |
| 10-minute soak (3 organizers, 24 teams, temp DB, port 3100) | overview p95 21.7 ms (p50 15.0, p99 27.9), teams p95 19.4 ms, max payload 20.1 KB, 29 stop + 29 start, 0 4xx/5xx/network errors, RSS 108 → 114 MB (+5.3%) |

The soak ran on the build at commit `c663121`, before the reviewer-driven fixes below; the final code was not soaked again. The earlier 60-minute rc.2 soak predates the rc.2 security pass.

### Reviewer (fresh subagent, diff `release/v1.2..HEAD`)
Applied: (1) the unlock token was a public constant if `SESSION_SECRET` was unset → the route now fails closed with 503; (2) with `TRUST_PROXY` off a shared `direct:admin` pair block still let anyone lock admin out → pair and per-ip blocks skipped for `direct`, test added; (3) the unlock rate limit counted all calls, so an attacker could deny the operator's recovery → only bad tokens are counted; (4) sticky columns lacked `scroll-padding` → added.
Rejected: (5) scroll shadows hidden behind opaque sticky cells on the Teams table; cosmetic, and the cells are opaque on purpose so rows do not show through.
No defects reported in the login delay (capped at 3 s, at most ~6 concurrent sleepers under the 120/min ceiling) or in moving the scroller off `main` (nothing queries `main` or `scrollTo`; dialogs are `z-50`, above the topbar's `z-30`). The reviewer ran nothing, so its findings come from reading.

### Hazards
Port 3000 and `data/defcon.db` untouched. I attempted `taskkill /IM chrome.exe` once while debugging; the permission system blocked it before it ran (it would have closed your own Chrome). Chrome and servers were stopped only by the PIDs the scripts started. Temp DBs and Chrome profiles live under `%TEMP%` and are removed by the scripts. `qa-out/` and `soak10.log` are local only.

### Open / next
Finish the prompt-17 items listed under "Not done"; run `npm run unlock` against a live server once; push or merge `release/v1.2-ui` when you decide (nothing pushed); then the dry-run with the club's scoreboard sample and W8.

## U1 polish — remaining prompt-17 items, finished and verified (28 Oct 2026, still v1.2.0-rc.3)
Commits `a55b024` (polish) and the follow-up with the reviewer fixes and the `npm run unlock` repair. Not pushed. This section supersedes the "Not done" paragraph and the "I did not run `npm run unlock`" sentence of the U1 section above.

### What changed (prompt 17 step 2.4–2.8)
- **Type scale, five sizes:** title 24 (`text-2xl`), section 16 (`text-base`), body 14 (`text-sm`), secondary 12 (`text-xs`), caption 11 (`text-caption`, new token in `globals.css`). Replaced every `text-[10px]`, `text-[11px]`, `text-[13px]`, `text-lg`, `text-xl`, `text-3xl` and the button `text-[0.8rem]`; login CSS sizes 9/10/13/15 px moved onto the scale. The login hero heading (clamp 42–64 px) is display type and exempt. Mono only for ids, ports, times (unchanged).
- **Icons 16 px everywhere** (about 90 call sites, status badges, button default `size-4`). Exceptions: login brand mark (27 px) and the flagstore chips (12 px inside 11 px text; marked `data-qa-icon-exempt`). Global `svg.lucide { flex-shrink: 0 }`: the gate found icons being squeezed to 12 px inside wrapping flex rows at 1024.
- **Tables:** body rows 44 px (`h-11`), header 36 px (`h-9`); matrix rows stay 36 px; header row sticky inside a height-limited container (Teams and Audit use `containerClassName="max-h-[calc(100dvh-…)]"`), corner cells above both axes, `scroll-padding-top` so a focused row is not hidden under the header; selected rows tinted (`data-state=selected`); hairline rows, no zebra; Participants column right-aligned; matrix headers no longer wrap; Audit has no second scroll wrapper.
- **Cards:** one ring colour (`--border`) and no second border (`.console-surface` no longer adds one); one rhythm: a card header with a divider is followed by content that starts one `--card-spacing` (16 px) below it. Equal-height cards and aligned headings in one row are checked.
- **Noise/consistency:** account status now shows icon + colour + text (Teams table and team detail, previously colour+text only); Audit filters are a grid (the Team select no longer wraps to its own line); sidebar subtitle reduced to the version (it wrapped as "v1.2.0-" / "rc.3").
- **Root cause found by the new gate:** the service matrix's screen-reader-only spans were absolutely positioned relative to the page, so they escaped the scroll container and made the whole page scroll sideways at 1024. Fixed with `relative` on the matrix container.

### `npm run qa:layout` now also checks (and each detector was proven with `QA_SELFTEST=1`, which injects violations)
text contrast from computed colours (4.5:1, 3:1 for large text; elements over gradients/images are skipped), keyboard focus indicators (60 Tab stops per route, compares focused vs blurred style; fails if fewer than 3 stops land inside `<main>`, so it cannot pass blind), focused row hidden under the sticky header, equal card height and heading offset, wrapped buttons/tabs/badges/column headers/sidebar text, row height below 44 px, font size outside the five-size scale, icons not 16 px, plus a **frozen** pass (freeze banner alignment). Matrix: 7 widths × admin/operator/frozen × routes and every team tab.

### Verification (final code)
| Check | Result |
|---|---|
| `npm run typecheck` | 0 errors |
| `npm run lint` | 0 errors, 71 warnings (64 legacy, rest in the new QA scripts) |
| `npm test` | 409/409, 19 files |
| `npm run build` | 0 |
| `npm audit --omit=dev` | 0 vulnerabilities |
| `npm run qa:layout` | PASS (7 widths, all routes, admin/operator/frozen, contrast, focus, scale, icons) |
| `QA_SELFTEST=1 npm run qa:layout` | FAIL as intended: contrast, card-alignment, wrapped-control, no-focus-indicator all reported |
| 10-minute soak on the polish build (`a55b024`), 3 organizers, 24 teams | overview p95 23.3 ms (p99 94.8), teams p95 19.5 ms, 29 stop + 29 start, 0 4xx/5xx/network errors, RSS 111 → 114 MB (+2.2%) |
| Live `npm run unlock` (1-minute run on the final build, `TRUST_PROXY=true`) | 5 wrong logins from one address → 6th is 429; another address still 401; bad unlock token 401; `npm run unlock` prints "Login limiter cleared."; the locked address then gets 401 again |

**Bug found by that live check and fixed:** `scripts/unlock.ts` used top-level `await`, which the CJS script build rejects, so `npm run unlock` crashed on every call (the unit tests could not catch it, and I had not run it live before). It now runs inside an async function. The 10-minute soak ran before this one-file fix; the fix touches only `scripts/unlock.ts`, `scripts/qa-*.{ts,js}` and one CSS line (`scroll-padding-top`), none of which changes server behaviour.

### Reviewer (fresh subagent, read-only, nothing run)
Applied: (1) sticky header could hide a focused row → `scroll-padding-top: 40px`; (2) focus gate only pressed 14 Tab stops and never reached table rows, and accepted any box-shadow as a ring → 60 stops, focused-vs-blurred comparison, blind-gate failure, under-header check; (3) row-height gate was 35.5 px against a 44 px spec → 43.5; (4, partly) contrast report cap raised from 8 to 20.
Not applied, by choice: contrast gate skips elements over gradients (the login page) and input values/placeholders, and hover/selected states are not measured; a selected row has no extra hover tint (the unlayered selected rule wins); the card-spacing rule overrides explicit `pt-*` on cards with a divider (intended, all current cards are header + content); the sticky `th` background is `--panel`, which may differ slightly from a dialog background in the credentials table (no layout break; not visually checked in a dialog).

### Still not done / honest limits
- Banners reserve space only while the meta request is in flight; toggling the freeze later adds a 37–55 px banner and moves the page down once (a permanent empty reserve would be worse). The frozen banner wraps to two lines at 1024.
- Contrast was measured by computed colour, not by eye, and only for the states the gate visits (no hover, disabled, dialogs, toasts, dropdown menus). The login page is excluded from contrast. Keyboard/screen-reader QA of dialogs remains manual.
- Dialogs, dropdowns and toasts were not screenshotted at every width.
- Button sizes: tables/toolbars use `sm` (28 px), everywhere else default (32 px); not enforced by a gate.
- Soak was 10 minutes, not 60.

## Session 29 Oct 2026 — leaderboard overnight job started (separate repo); dashboard code unchanged
**Dashboard state:** branch `release/v1.2-ui`, version `1.2.0-rc.3`, no source, test, config or dependency file changed this session. The U1/rc.3 gate above still describes the code; I did not re-run it. Nothing was pushed or merged. Doc 17 (U1) was read: its five steps are all recorded as done in the two U1 sections above; nothing in it is outstanding except the items already listed under "Still not done / honest limits".

**Documents committed this session (dashboard repo):** `16_LEADERBOARD_SPEC_AND_PROMPTS.md` (v2, decisions D25–D36, public contract, Supabase rules, checklist P1–P14), `16_LEADERBOARD_SPEC_AND_PROMPTS.v1-superseded.md`, `18_LEADERBOARD_OVERNIGHT_MASTERPROMPT.md`. D24/A32 (we build the leaderboard; EnoEngine alone computes points) is from Abdul and is **not yet confirmed by the club lead**, so the "leaderboard is out of scope" line in CLAUDE.md still stands for this repo; the leaderboard lives in its own repo.

### Leaderboard repo: `C:\Users\tipty\defcon-leaderboard` (branch `main`, local only, no remote, nothing pushed)
Run in this session by pasting doc 18 as the brief. **Only L0 and L1 were executed. L2–L7 were NOT started.**

| Slice | Commit / tag | Status |
|---|---|---|
| L0 scaffold | `5d0da14`, `lb-L0` | done |
| L1 source, parser, ranking | `3760863`, `lb-L1` (+ `42db23e` wording) | done |
| L2 stores (memory, JSONL, Supabase) | none | **not started** |
| L3 collector, freeze, CLI, public API | none | **not started** |
| L4 UI and `qa:layout` | none | **not started** |
| L5 attack pass and load test | none | **not started** |
| L6 DEPLOY / RUNBOOK / GOLIVE docs | none | **not started** |
| L7 morning report | none | **not started** (this section is the interim report) |

**L0 (evidence).** Next 16.4.2 / React 19.3 / Tailwind 4 / zod 4 / Vitest 5, TS strict. Lazy fail-closed `getConfig()` (zod), pure `checkEnv()` + `npm run check-env`, per-request CSP nonce in `src/proxy.ts` (shared header module, no `unsafe-inline` scripts, no third-party origins), static security headers, `/api/healthz`. Gates: typecheck 0, lint 0 errors, build 0. Verified against the running production build on 127.0.0.1:3200: `/api/healthz` 200 `{"ok":true}`; nonce present on every script tag and different per request; malformed percent path 400; no CORS, cookie, HSTS or `X-Powered-By`. `check-env` exits 1 with a bad release env (names only, no values) and 0 with a good one.

**L1 (evidence).** `src/lib/source/`: fetcher (host allow-list, 5 s timeout, `redirect:'error'`, no credentials, 2 MB streamed cap, content-type check, errors are short codes with no URL or host), mapping-driven parser (`config/source-map.json`, own-property dotted paths, all-or-nothing, unknown shape = `SOURCE_SHAPE_UNKNOWN`), name sanitiser, competition ranker with `tied` and `rankDelta`, round decision, roster overrides (display names only). **The mapping and fixture are PROVISIONAL**: no real `scoreboard.json` has been seen; `docs/SOURCE_MAPPING.md` lists what to confirm, and a test parses `docs/club-inputs/scoreboard.sample.json` as soon as it exists (skipped until then). Gates after review fixes: typecheck 0, lint 0 errors, vitest 129 passed + 1 skipped in 8 files, build 0, coverage of `src/lib/source` branches 98.19% (target 95%).

**Reviewer (fresh subagent, read-only, ran nothing, L0+L1 together): 12 findings, all applied** — release gate failed open on `CHECK_RELEASE=TRUE`/`yes`; lone surrogates, blank-looking fillers (U+3164, U+2800, …) and Zalgo passed the name sanitiser; total bound off by one against `numeric(14,3)`; ranking compared raw doubles while storage keeps 3 decimals; a mapped optional field missing in the source was silently dropped (now fails closed); timestamp accepted V8 legacy junk (now ISO only, stored as UTC); `-0`; response body not cancelled before a refusal; hyphens in map paths; `BASE_PATH` `//`. Partly applied: the bind check only errors on a non-loopback `HOSTNAME`/`HOST` (unset cannot be told from "not exported"; `npm start` hardcodes `-H 127.0.0.1`). Not done: map keys containing dots or spaces.

**Supabase:** `list_projects` shows only `pitch-under-pressure` (INACTIVE) — **not touched**. Project `defcon-leaderboard` was **not created**: the brief requires `get_cost` to show no recurring charge and this session has no `get_cost` tool, so the cost could not be verified (BLOCKERS B1). No Supabase call other than `list_projects` was made.

**Decisions made without asking** (all in `docs/OVERNIGHT_LOG.md`): relative imports in `src/lib` so `tsx` scripts need no alias; `vitest.config.mts`; `vite` added as devDependency because Vitest 5 needs it as a peer (same as the dashboard); `npm install --ignore-scripts --legacy-peer-deps`; npm scripts for later slices are added by the slice that creates them, not as dead stubs.

### Not done, and why (honest)
- L2–L7 (see table). The session stopped after L1 so the end-of-session commit and this write-up could be done accurately; nothing from those slices is claimed.
- Pre-flight items 1–4 of doc 18 belong to Abdul and were not done by me: power settings, `claude mcp list`, and the push/ff-merge of `release/v1.2-ui` into `release/v1.2` (not performed; nothing pushed).
- No browser/headless-Chrome check, `qa:layout`, load test or security pass exists for the leaderboard yet (L4/L5). The only UI is a placeholder page.
- The 60-minute dashboard soak still predates the rc.2 security pass (unchanged).

### Hazards
- Ports used: 3200 only (the leaderboard production server). I stopped it by the PID listening on 127.0.0.1:3200 (7756, started by me). 3000, 3100, 3201, 3290 and 9333 were not used. Dashboard `data/` untouched.
- A mistyped `npx tsc` (before dependencies finished installing) made npx fetch an unrelated deprecated package `tsc@2.0.4` into the npx cache and print its banner; it did nothing to the repo. A stray empty `python` heredoc hung and was stopped. Neither affected files.

### Resume
`cd C:\Users\tipty\defcon-leaderboard`, start Claude Code there with `--add-dir C:\Users\tipty\defcon-control-center`, and paste: `Read CLAUDE.md, docs/OVERNIGHT_LOG.md and BLOCKERS.md. Continue with L2. Last commit: 42db23e.` The full brief is doc 18; L2 begins with the store contract suite and `supabase/migrations/lb_init.sql`.
