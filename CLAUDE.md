# CLAUDE.md — DEFCON Control Center (repo rules)

> Also provided as `AGENTS.md` for other coding tools. Keep the two identical.

## STATUS (update at the end of every work session)
- Date/slice: 28 Oct 2026 — U1 (layout foundation + login lockout fix) done on branch `release/v1.2-ui`, tag `v1.2.0-rc.3` (not pushed, not merged); `release/v1.2` stays at rc.2. W0–W7, W9 and the rc.2 hardening pass done earlier. **W8 (club evidence gate) NOT executed: blocked on club inputs.** Next: dry-run with the real club inputs (doc 12 §11), W8 with the club, backup task registration + escalation table on the demo machine; leaderboard (doc 16) waits for the club to confirm D24. Full detail: `docs/defcon-control-center/BUILD_STATUS.md`; event procedures: `docs/EVENT_RUNBOOK.md`.
- Leaderboard (separate repo `C:/Users/tipty/defcon-leaderboard`, 29 Oct 2026, local only): L0 (`lb-L0`) and L1 (`lb-L1`) done; L2–L7 NOT started. Docs 16 (v2) and 18 added. D24/A32 not yet confirmed by the club lead. Detail: BUILD_STATUS.md "Session 29 Oct 2026".
- Done: P1–P17 (v1.1), W0–W7. `npm run backup` (online SQLite backup, keeps 12), `npm run loadtest` / `npm run soak` (scripts/loadtest.ts). Manifest = `config/services.json` via `src/lib/event-config.ts` (names UNCONFIRMED); migrations 001–005 via `src/lib/migrate.ts`. Health pipeline in `src/lib/server/health/` (scoreboard pull + token ingest + staleness). Agent lifecycle client in `src/lib/server/adapters/agent/` (tested only against `scripts/fake-agent.ts`).
- Validation gate (28 Oct, tag `v1.2.0-rc.3`): `npm run typecheck` 0 · `npm run lint` 0 errors (71 warnings: 64 legacy + new QA scripts) · `npm test` 409/409 across 19 files (authz matrix includes the new unlock route) · `npm run build` 0 · `npm audit --omit=dev` 0 · `npm run qa:layout` PASS (7 widths 1024–2560; admin, operator, frozen; clipping, edge alignment, contrast, focus rings, card alignment, five-size type scale, 16 px icons; detectors proven with `QA_SELFTEST=1`) · 10-minute soak on the polish build (overview p95 23.3 ms, 0 errors, RSS +2.2%) and a live `npm run unlock` check passed; the 60-minute rc.2 soak predates the security pass and was not repeated. Type scale: 24/16/14/12/11 px (`text-2xl`/`base`/`sm`/`xs`/`text-caption`).
- Runtime: default `ADAPTER=mock` + `HEALTH_SOURCE=mock` → `SIMULATED`. `HEALTH_SOURCE=scoreboard|ingest` or `ADAPTER=real|docker-compose` → `PARTIAL`. `LIVE` is unreachable until `EVIDENCE_GATE_PASSED=true` **and** the adapter reports `capabilities.fullyReal` (no adapter does). The scoreboard parser is PROVISIONAL (no real `scoreboard.json` sample yet): unknown shape → `SOURCE_SHAPE_UNKNOWN`, never healthy. The agent contract (docs/15 §3) is a proposal, not a club fact.
- Release gate: `npm run check-env` (pure logic in `src/lib/check-env.ts`) fails on short/placeholder SESSION_SECRET, DEMO_CONTROLS or ALLOW_DEFAULT_PASSWORDS true, DB_PATH unset or `:memory:`, default/unset organizer passwords, invalid ADAPTER, invalid HEALTH_SOURCE, scoreboard without URL, ingest without a 32+ char INGEST_TOKEN, explicit `HEALTH_SOURCE=mock` when `CHECK_RELEASE=1`. `npm run start:release` = check-env then `next start`. A local `.env` with `DEMO_CONTROLS=true` makes `next start` fail closed; release deployments ship `DEMO_CONTROLS=false`.
- Version: single source is `package.json` (1.2.0-rc.3), served by `/api/meta`.
- Measured (prod build, 3 organizers, 24-30 teams): overview p95 14-22 ms, teams p95 11-21 ms, payload 20-24 KB, 0 5xx over a 60-minute soak, memory −4.6%; first contentful paint 144-316 ms, zero long tasks and 60 fps during polling. Known gaps: banner space is reserved only while meta loads (freeze toggle shifts the page once); backup task not registered (README has the schtasks line); W8 evidence gate with the club; agent adapter has no delete operation and keeps credentials/resources/sessions dashboard-side; the audit `requested` row is written after the adapter call; plain `npm ci` fails without VS C++ build tools (use `npm ci --ignore-scripts`). Club inputs still missing: template.compose.yml, real scoreboard sample, verdict list, reset semantics, agent owner.
- Known bugs: Tailwind v4/Turbopack non-blocking CSS parser warnings on cold builds; legacy explicit-`any` lint warnings (64 warnings, 0 errors); keyboard/screen-reader QA is manual. `next dev` reloads in a loop if a tool writes files inside the repo (use the production build for browser QA).
- Security hardening: typed startup config; login redirects same-origin only; every mutating route requires same-origin Origin (login/logout included); session epoch revocation plus server-side logout (`revoked_sessions`, jti); per-IP/per-user/pair login limits plus a global 120/min ceiling (per-IP bucket off without TRUST_PROXY); mutation freeze (423); 64 KB cap on JSON bodies (`readJson`), clamped pagination, 1-128 char `Idempotency-Key`; per-request nonce CSP in `src/proxy.ts` (no inline scripts), COOP/CORP, no `X-Powered-By`; `tests/authz-matrix.test.ts` fails when a route is not listed in `tests/routes.authz.ts`; CSV formula guard (`src/lib/csv.ts`); organizer passwords 12+ chars in `check-env`. Login limiter (U1): per ip+username and per-ip blocks only with TRUST_PROXY; failures against a username never block it, they add a delay (250 ms per failure after the 4th, max 3 s); `npm run unlock` clears the limiter of a running server (`POST /api/auth/unlock-limiter`, bearer = HMAC of SESSION_SECRET, 503 without a secret).
- UI hardening: semantic `--accent` and `--muted` tokens must not be redefined as surface colors; use dedicated surface tokens for Tailwind mappings. `--idle` is now `#94A3B8` (4.5:1). Layout (U1): topbar, banners and content share `.page-container` (`--page-gutter`, `--page-max` 1680 px); the single scroll region is `.console-scroll`, not `main`; wide tables scroll inside a `[data-qa-scroll]` container; `npm run qa:layout` must stay green; table rows are 44 px, header 36 px, icons 16 px.
- Decisions: default remains persistent SQLite `MockAdapter` (`SIMULATED`); Docker Compose adapter deprecated (do not extend); import credentials cleared when the reveal dialog closes; team self-reset off by default (`TEAM_SELF_RESET`); reset copy and required confirmation follow `/api/meta.capabilities.resetKind`.
- Deadline: UNCONFIRMED. The earlier 19–20 Oct emergency window has passed; do not assume a freeze date until the club states one.

## What this is
Organizer-facing admin dashboard + team environment control panel for **DEFCON 2.0** (Technozion, NIT Warangal, ham arc club). Manages 20–30 teams: team CRUD, participant credentials, start/stop/reset/delete of environments, service health, alerts, resource usage, append-only audit log, overview. The club's real orchestrator is not verified in this repository → we run a **persistent mock backend** (SQLite state machine) behind an `EnvironmentAdapter`; the UI always shows a SIMULATED/PARTIAL/LIVE badge from `/api/meta`. Real control is enabled only after the one-team evidence gate.

## Read first, in this order
`docs/01_BLUEPRINT.md` → `docs/02_SPEC_DIGEST.md` → `docs/10_INTEGRATION_COORDINATION_PLAN.md` → the doc for your slice: `03` API, `04` data/rules, `05` UI, `06` plan, `07` prompts, `08` tests/demo. The spec PDF is in `docs/`. Spec > club lead's written decisions > blueprint > your ideas.

## Stack
Next.js (App Router, TypeScript strict), Tailwind + shadcn/ui, TanStack Query, zod, SQLite (`better-sqlite3`), `bcryptjs`, `jose`, Recharts, lucide-react, sonner, Vitest. No other UI kit, ORM, state library, WebSocket, or external service without asking.

## Architecture rules
1. UI → `/api/*` only. Client code never imports from `src/lib/server/**` (use `import 'server-only'` there).
2. Route handlers are thin: `requireUser` → same-origin check → `services.sync()` → zod validate → service call → error mapping. Order is fixed.
3. Only the service layer touches the adapter; only `MockAdapter` touches mock tables; only `db.ts` opens SQLite.
4. Canonical names live in `docs/03` (types, endpoints, errors) and `docs/04` (states, permissions, schema). **Do not rename enums, states, endpoints or fields.** If a change is truly needed, say so and update the doc in the same commit.
5. Lifecycle transitions follow the table in `docs/04 §1` exactly. One pending transition per environment. Async transitions resolve **lazily by timestamp** (`resolveDue`), never with timers.
6. Audit is **append-only** (DB triggers). Async actions write a `requested` row then a completion row with the same `correlation_id` and `ts` = completion time. Denied requests write `denied` rows.
7. Reset restores the **latest accepted patch** and must not touch `accepted_patch_version`, `last_deploy_*`, audit, flags/scores/app data. Stop retains. Delete archives the team and removes environment resources. The three are distinct.
8. Permissions: always `can(user, permission, resource)` server-side. UI disables controls with an explanatory tooltip; it never replaces server checks.
9. Passwords: bcrypt (cost ≥ 10); plaintext appears only in create/rotate responses; never logged, never stored.
10. Time: store UTC ISO strings; adapter and tests use an injectable `now()` clock.

## Honesty rules
- Badge from `/api/meta`; never hard-code LIVE. `SIMULATED` while mock; `PARTIAL` if mixed; `LIVE` only if every environment-affecting call is real and tested.
- Success toast only after the polled final state matches the expected outcome; show failures persistently; never fake success.
- Mock-only numbers are marked `// MOCK` in code and labelled in UI.
- Never invent spec facts. Unresolved: flag rotation interval, point values, idle timeout, health-check interval, backup policy, challenge catalogue, deployment mechanism. Assumptions are labelled `A1–A14` (see blueprint §6).

## UI rules
Dark navy ops-console look using tokens in `docs/05 §1`. Status = colour + icon + text. Every data view has loading, empty, error, forbidden states. Confirmation dialogs per `docs/05 §4` (exact copy). Poll with TanStack Query (5 s, 2 s while pending, paused when tab hidden). Desktop-first ≥ 1280 px.

## Working rules
- One vertical slice at a time; plan first when >3 files or touching adapter/permissions/audit/idempotency.
- Before declaring done: `npm run typecheck && npm run lint && npm test` all green, and the screen checked in the browser.
- Do not add dependencies without a one-line reason. Do not add features outside the current slice. Do not "simplify" the state machine, audit rules or idempotency.
- Never print secrets or `.env` contents. Never commit `.env*`, `data/`.
- Commit messages: `feat(scope): …`, `fix(scope): …`, `test(scope): …`, `docs: …`.
- Out of scope (do not build): orchestrator, terminal gateway, flag/scoring engine, patch capture/rollback, participant UI, leaderboard.

## Commands
`npm run dev` · `npm run typecheck` · `npm run lint` · `npm test` · `npm run seed` · `npm run reset-demo` · `npm run build && npm start`

## When resuming after a tool/limit switch
State: "Read AGENTS.md and docs/. We are on slice P<n>. Last commit: <hash/message>." Then check `git status`, run the test suite, and continue.

<!-- BEGIN:nextjs-agent-rules -->

## This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
