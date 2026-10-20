# CLAUDE.md — DEFCON Control Center (repo rules)

> Also provided as `AGENTS.md` for other coding tools. Keep the two identical.

## STATUS (update at the end of every work session)
- Date/slice: 21 Oct 2026 — Post-R8 audit query alignment & console refinement pass complete; test suite at 63/63 passing. All work committed and pushed to origin/main (head: 5b61b5d).
- Done: P1–P17, including ordered CSV import, dry-run preview, one-time credential reveal, typed-confirmation bulk start/stop, unified audit filtering, console audit explorer enhancements, and team details notes/name editing state refinement.
- Audit unification & UI (21 Oct): `buildAuditWhere` in `audit.ts` unifies paginated queries and CSV export. Action tokens support group prefixes (`env` matches `env.*`) and exact dot codes (`env.stop`). Team filters match both the team target and participant targets belonging to that team. UI `/teams/[teamId]` activity tab correctly passes `team: teamId`. Audit Explorer UI has full filter controls (search, range, actor, team, action chips, outcome chips, hide requested rows), clickable target team links, and copyable Request/Correlation IDs. Team details tab provides controlled editing and saving of team names and operational notes.
- R7 evidence (19 Oct): typecheck/lint/tests (58)/build green; local production rehearsal on a temporary DB verified 401/403 shapes, same-origin enforcement, operator delete denial audit, idempotent replay, correlation IDs, restart-during-pending lazy completion, and a full SQLite backup/restore drill; runtime remains `SIMULATED`, no orchestrator implemented, no `LIVE` claim.
- R8 evidence (19 Oct): demo handlers moved to the routable folder `src/app/api/demo/` (endpoints `/api/demo/*`; `docs/03` §3.9 updated in the same pass) with 4 new fail-closed tests (62 total); release-config HTTP probes verified 401 unauthenticated / 403 operator / 404 admin-with-demo-controls-off / 403 cross-origin on all three endpoints; AC-08 failure beat verified end-to-end over HTTP in mock dev mode (fail-next → reset 202 → polled `failed` → `action_failed` alert → `env.reset/failure` audit row); authenticated headless-Chrome QA passed (login → overview → teams, 24 rows, zero console errors/exceptions); hazard found: a local `.env` with `DEMO_CONTROLS=true` makes `next start` fail closed with 500s — release deployments must ship `DEMO_CONTROLS=false`.
- Validation gate (21 Oct): `npm run typecheck` 0 · `npm run lint` 0 errors / 58 legacy warnings · `npm test` 63/63 across 8 files · `npm run build` 0 · `git diff --check` 0.
- Known bugs: Tailwind v4/Turbopack emits non-blocking CSS parser warnings (observed in earlier builds; not reproduced in R7's cached builds); legacy explicit-`any` warnings remain; Docker/real smoke needs the club template/runtime and named authorization; keyboard/screen-reader accessibility QA remains manual (authenticated headless-Chrome visual/console QA passed in R8).
- Security hardening: typed startup configuration now requires SESSION_SECRET (32+ characters), durable production DB_PATH, and supported adapter configuration; login redirects accept same-origin paths only; state-changing API requests require a same-origin Origin header.
- UI hardening: semantic `--accent` and `--muted` tokens must not be redefined as surface colors; use dedicated surface tokens for Tailwind mappings.
- Decisions made since blueprint: default remains the persistent SQLite `MockAdapter` (`SIMULATED`); Docker Compose remains opt-in and `PARTIAL`; import credentials are cleared when the reveal dialog closes.
- Deadline: emergency release window 19–20 Oct 2026; freeze at the end of 20 Oct unless the club supplies a different hard deadline.

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
