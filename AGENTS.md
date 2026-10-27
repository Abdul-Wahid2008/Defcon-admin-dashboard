# CLAUDE.md — DEFCON Control Center (repo rules)

> Also provided as `AGENTS.md` for other coding tools. Keep the two identical.

## STATUS (update at the end of every work session)
- Date/slice: 27 Oct 2026 — v1.2 in progress on branch `release/v1.2`; slice W1 (config-driven manifest, flagstores, migration 002, seed) done after W0. Head: see `git log`.
- Done: P1–P17 (v1.1) plus W0, W1. Manifest = `config/services.json` via `src/lib/event-config.ts` (names UNCONFIRMED); migrations run through `src/lib/migrate.ts` (001, 002). Teams pages share `src/components/teams/CredentialsReveal.tsx` for one-time credential reveal.
- Validation gate (27 Oct): `npm run typecheck` 0 · `npm run lint` 0 errors (legacy warnings only) · `npm test` 81/81 across 10 files (74 + 7 in w1-manifest) · `npm run build` 0 · authenticated headless-Chrome QA of /teams and /teams/team-01 at 1280×800 and 1024×768 on a temp DB: 24 rows, zero console errors/exceptions.
- Runtime: `ADAPTER=mock` → `SIMULATED`; no real adapter; no real health source. Never claim `LIVE`.
- Release gate: `npm run check-env` (pure logic in `src/lib/check-env.ts`) fails on short/placeholder SESSION_SECRET, DEMO_CONTROLS or ALLOW_DEFAULT_PASSWORDS true, DB_PATH unset or `:memory:`, default/unset organizer passwords, invalid ADAPTER. `npm run start:release` = check-env then `next start`. A local `.env` with `DEMO_CONTROLS=true` makes `next start` fail closed; release deployments ship `DEMO_CONTROLS=false`.
- Version: single source is `package.json` (1.2.0-rc.1), served by `/api/meta`.
- Known gaps (v1.2 roadmap, see docs/defcon-control-center/12 and 14): no real health source (W2; mock `flagstore_results` are not refreshed when checks change), roles/freeze/security headers (W3), real lifecycle adapter (W4), UI copy pass (W5–W6), soak/perf (W7). Club inputs still missing: template.compose.yml, scoreboard sample, verdict list, reset semantics.
- Known bugs: Tailwind v4/Turbopack non-blocking CSS parser warnings on cold builds; legacy explicit-`any` lint warnings; keyboard/screen-reader QA is manual.
- Security hardening: typed startup config requires SESSION_SECRET (32+), durable production DB_PATH, supported adapter config; login redirects same-origin only; state-changing API requests require same-origin Origin.
- UI hardening: semantic `--accent` and `--muted` tokens must not be redefined as surface colors; use dedicated surface tokens for Tailwind mappings.
- Decisions: default remains persistent SQLite `MockAdapter` (`SIMULATED`); Docker Compose opt-in and `PARTIAL`; import credentials cleared when the reveal dialog closes.
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
