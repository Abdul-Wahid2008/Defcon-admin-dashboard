# BUILD STATUS (27 Oct 2026, verified on the real repo)

Previous version (W1 only) is in git history (`c3fda66`). This file covers W2–W6, written after all five were built, reviewed and committed.

## Snapshot
- Branch `release/v1.2`, version `1.2.0-rc.1`. **Not pushed.** Working tree is clean after the final commit of this session.
- Done: P1–P17 (v1.1), W0, W1, **W2 health source, W3 security/roles/freeze/accounts, W4 lifecycle capabilities + service actions + agent client, W5 overview matrix + UI copy, W6 operator workflows**. Not started: W7 (soak/perf/backup), W8 (evidence gate with the club), W9 (final hardening, tag, freeze). The tonight dry-run (doc 12 §11) has not been done: it needs the club's real `scoreboard.json` URL and a roster.
- Runtime default is unchanged: `ADAPTER=mock` + `HEALTH_SOURCE=mock` → badge **SIMULATED**. `HEALTH_SOURCE=scoreboard|ingest` or `ADAPTER=real|docker-compose` → **PARTIAL**. **LIVE cannot be shown today**: it needs `EVIDENCE_GATE_PASSED=true` and an adapter reporting `capabilities.fullyReal`, and none does.
- Gates at the end of the session: `npm run typecheck` 0 errors · `npm run lint` 0 errors, 64 warnings (58 before this work; the 6 new ones are unused-variable / `any` warnings in new code and tests, not fixed) · `npm test` **388/388 in 18 files** (was 81/81 in 10 files) · `npm run build` exit 0.
- Commits since `c3fda66` (oldest first):
  - `7b01967` feat(health): scoreboard/ingest health source with staleness (W2)
  - `b108ca8` fix(health): apply W2 review findings
  - `19f80c3` feat(security): roles v1.2, freeze, organizer accounts, headers, login limiter, CSV guard (W3)
  - `e38f4b6` fix(security): apply W3 review findings
  - `17ac8ef` feat(lifecycle): capability-driven reset, service actions, agent client (W4)
  - `f6751bd` feat(ui): overview matrix, event clock, teams table, tabs, copy pass (W5) + W4 review fixes
  - `90b452b` feat(ops): incident view, command palette, alert ack, notes conflict guard, bulk progress (W6)
  - plus the final commit with W5/W6 review fixes, roster `external_team_id`, docs and this file.
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
6. No admin action to reset the health baseline when a source restarts at a lower round (all rows then reject as `older_than_stored`; the overview shows `all_rows_rejected`; workaround: restart the dashboard DB's flagstore rows manually).
7. Operators can reset a single service; doc 12's matrix says "configurable off", which is not built.
8. Team-detail tabs lack the full ARIA tabs pattern; the notes compare-and-set is not a single SQL statement; the orphan-agent-job window after an accepted job whose DB write fails is not closed.
9. Mock health never refreshes flagstore results, so under `HEALTH_SOURCE=mock` the flagstore chips are seed data (labelled via the SIMULATED banner).
10. `/api/meta` is public for the badge; `terminal.url` is still in the authenticated team payload.
11. Roster arrives only by CSV/JSON import (no Supabase/TeamSource); the per-IP login bucket is disabled without `TRUST_PROXY`, so brute-force protection there rests on the pair and username limits.
12. W7 (soak, backup cron, load test), W8, W9 are not started. No 60-minute polling soak, no 20–30 team load test, no backup drill since W1.

**Tooling and test**
13. 64 lint warnings (0 errors). CSP keeps `'unsafe-inline'` scripts (Next inline hydration + a statically prerendered login page).
14. `npm audit --omit=dev`: 2 transitive findings via `shadcn` (see W3).
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
14. Next: do the dry-run as soon as item 1 arrives, then W7 (soak/backup) before W8/W9.

## Hazards
- Port 3000 and `data/defcon.db` belong to a pre-existing server and were never touched. During this session one broad `pkill -f "next start"` was attempted and **blocked by the permission system before it ran**; afterwards servers were stopped only by the PID listening on 3100/3101/3200. QA used ports 3100, 3101, 3200 and temp DBs `data/w2qa.db`, `w3qa.db`, `w4qa.db`, `w6qa.db` (gitignored, left on disk).
- The local `.env` has `DEMO_CONTROLS=true`, which makes `next start` fail closed; pass explicit env as in the rehearsal steps.
- `.playwright-mcp/` (browser tool output) is gitignored and can be deleted.

## Next step
1. Get the club inputs (questions 1–2, 5–6) and do the dry-run (doc 12 §11): import the real roster with `external_team_id`, point `HEALTH_SCOREBOARD_URL` at the real file, fix the parser, compare 3 teams against the club's scoreboard, record `docs/club-evidence/2026-10-27-dryrun.md`.
2. W7: 60-minute soak with 24 teams and the fake scoreboard, backup script (db + wal + shm), load test with 30 teams.
3. W8 evidence gate with one real team once an agent exists; only then consider `EVIDENCE_GATE_PASSED=true`.
4. W9: final hardening, tag, freeze.
To resume: `git status`; `npm run typecheck && npm test` (expect 388/388); read this file and docs 12–15; QA on ports 3100/3101 only, on a production build.
