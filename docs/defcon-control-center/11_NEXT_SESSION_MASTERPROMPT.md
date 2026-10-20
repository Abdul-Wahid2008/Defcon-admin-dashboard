# NEXT-SESSION MASTERPROMPT — paste the block below into a new chat

> Generated at the end of the Audit Alignment & Console Refinement pass (21 Oct 2026; head d267839, pushed — this handover doc is the following commit).
> Paste everything between the fences as the new session's instructions file.

```AGENTS.md
# CLAUDE.md — DEFCON Control Center (repo rules)

> Also provided as `AGENTS.md` for other coding tools. Keep the two identical.

## STATUS (21 Oct 2026, post-R8 audit refinement & moderator details pass)
- Slice: P1–P17 complete. R7 (release-candidate verification), R8 (production-finish pass), 21 Oct audit alignment, and moderator console refinement complete. All work committed and pushed to origin/main (head: 5b61b5d).
- Validation gate (all green, re-run after the last change): `npm run typecheck` 0 · `npm run lint` 0 errors / 58 legacy warnings · `npm test` 63/63 across 8 files · `npm run build` 0 · `git diff --check` 0.
- Runtime: persistent SQLite `MockAdapter`, badge `SIMULATED`. No real orchestrator. No `LIVE` claim anywhere.
- Deadline: emergency release window 19–20 Oct 2026; freeze at the end of 20 Oct unless the club supplies a different hard deadline.
- Decision gate: real control is enabled only after the one-team evidence gate with the club's orchestrator (docs/10).

## What this is
Organizer-facing admin dashboard + team environment control panel for DEFCON 2.0 (Technozion, NIT Warangal, ham arc club). 20–30 teams: team CRUD, participant credentials, start/stop/reset/delete of environments, service health, alerts, resource usage, append-only audit log, overview. The club's real orchestrator is not verified in this repository → we run a persistent mock backend (SQLite state machine) behind an `EnvironmentAdapter`; the UI always shows a SIMULATED/PARTIAL/LIVE badge from `/api/meta`.

## Read first, in this order
`docs/01_BLUEPRINT.md` → `docs/02_SPEC_DIGEST.md` → `docs/10_INTEGRATION_COORDINATION_PLAN.md` → the doc for your slice: `03` API, `04` data/rules, `05` UI, `06` plan, `07` prompts, `08` tests/demo. `docs/BUILD_STATUS.md` carries the full R7/R8 and 21 Oct verification evidence. Spec PDF is in `docs/`. Spec > club lead's written decisions > blueprint > your ideas.

## Stack
Next.js 16 (App Router, TypeScript strict), Tailwind v4 + shadcn/ui, TanStack Query, zod, SQLite (`better-sqlite3`), `bcryptjs`, `jose`, Recharts, lucide-react, sonner, Vitest. No other UI kit, ORM, state library, WebSocket, or external service without asking.

## Architecture rules
1. UI → `/api/*` only. Client code never imports `src/lib/server/**` (those files use `import 'server-only'`).
2. Route handlers are thin: `requireUser` → `assertSameOrigin` → `services.sync()` → zod validate → service call → `errorResponse`. Order is fixed.
3. Only the service layer touches the adapter; only `MockAdapter` touches mock tables; only `db.ts` opens SQLite.
4. Canonical names live in `docs/03` (types, endpoints, errors) and `docs/04` (states, permissions, schema). Do not rename enums, states, endpoints or fields; if truly needed, update the doc in the same commit.
5. Lifecycle transitions follow `docs/04 §1` exactly. One pending transition per environment. Async transitions resolve lazily by timestamp (`resolveDue`), never with timers.
6. Audit is append-only (DB triggers). Async actions write `requested` then a completion row with the same `correlation_id`. Denied requests write `denied` rows.
7. Reset restores the latest accepted patch and must not touch `accepted_patch_version`, `last_deploy_*`, audit, flags/scores/app data. Stop retains. Delete archives the team and removes environment resources. The three are distinct.
8. Permissions: always `can(user, permission, resource)` server-side. UI disables controls with a tooltip; it never replaces server checks.
9. Passwords: bcrypt (cost ≥ 10); plaintext appears only in create/rotate responses; never logged, never stored.
10. Time: store UTC ISO strings; adapter and tests use an injectable `now()` clock.

## Honesty rules
- Badge comes from `/api/meta`; `SIMULATED` while mock, `PARTIAL` if mixed, `LIVE` only if every environment-affecting call is real and tested. Never hard-code LIVE.
- Success toast only after the polled final state matches the expected outcome; show failures persistently; never fake success.
- Mock-only numbers are marked `// MOCK` in code and labelled in the UI.
- Never invent spec facts. Unresolved: flag rotation interval, point values, idle timeout, health-check interval, backup policy, challenge catalogue, deployment mechanism.

## UI rules
Dark navy ops-console look (tokens in `docs/05 §1`). Status = colour + icon + text. Every data view has loading, empty, error, forbidden states. Confirmation dialogs per `docs/05 §4` (exact copy). Poll with TanStack Query (5 s, 2 s while pending, paused when the tab is hidden). Desktop-first ≥ 1280 px. Dialogs trap focus, restore it on close, and close on Escape (R8).

## Working rules
- One vertical slice at a time; plan first when >3 files or touching adapter/permissions/audit/idempotency.
- Before declaring done: `npm run typecheck && npm run lint && npm test` all green, production build passes, and the screen checked in the browser (recipe below).
- Do not add dependencies without a one-line reason. Do not add features outside the current slice. Do not "simplify" the state machine, audit rules or idempotency.
- Never print secrets or `.env` contents. Never commit `.env*`, `data/`.
- Commit messages: `feat(scope): …`, `fix(scope): …`, `test(scope): …`, `docs: …`.
- Out of scope (do not build): orchestrator, terminal gateway, flag/scoring engine, patch capture/rollback, participant UI, leaderboard.

## Commands
`npm run dev` · `npm run typecheck` · `npm run lint` · `npm test` · `npm run seed` · `npm run reset-demo` · `npm run build && npm start`

## Environment facts for this Windows machine
- Rehearsal ports: use 3100 for `next start` and 3101 for `next dev`. Port 3000 hosts a pre-existing deployed server (PID changes; leave it untouched); `data/defcon.db` is its database (leave it).
- HAZARD: the local `.env` contains `DEMO_CONTROLS=true`; `next start` inherits it and fails closed with 500s on every route (module-load `loadConfig()` throw). Always start rehearsal servers with explicit overrides: `DEMO_CONTROLS=false ALLOW_DEFAULT_PASSWORDS=false SESSION_SECRET=<64-hex> DB_PATH=data/<temp>.db npx next start -p 3100`. For demo-mode dev probes: `DEMO_CONTROLS=true ALLOW_DEFAULT_PASSWORDS=true SESSION_SECRET=<64-hex> DB_PATH=data/<temp>-dev.db npx next dev -p 3101`.
- Seed rehearsal DBs with explicit credentials: `ALLOW_DEFAULT_PASSWORDS=true ORGANIZER_ADMIN_PASSWORD=<pw> ORGANIZER_OPERATOR_PASSWORD=<pw> DB_PATH=data/<temp>.db npm run seed`. Seeded logins then work against a server started with `ALLOW_DEFAULT_PASSWORDS=false`.
- Playwright is NOT installed. Browser QA recipe that works: launch `"/c/Program Files/Google/Chrome/Application/chrome.exe" --headless=new --remote-debugging-port=9223 --user-data-dir=$TEMP/<profile> about:blank` in the background, then drive it from a temp Node script using the built-in `WebSocket` (Node 24) against `http://127.0.0.1:9223/json/list`: `Runtime.enable` + `Page.enable` + `Network.enable`, `Page.navigate`, poll `Runtime.evaluate` for conditions, fill React inputs via the native value setter + `input` event, click via `el.click()`, assert `location.pathname` changes, capture screenshots with `Page.captureScreenshot`, and assert zero `Runtime.consoleAPICalled` errors and zero `Runtime.exceptionThrown`. Wait for hydration before clicking (a click issued too early silently does nothing).
- API response shapes for probes: `/api/teams` → `{ items, page, pageSize, total }` with `lifecycleState` top-level per item; team detail exposes `environment.lifecycleState`; `/api/alerts` and `/api/audit` → `{ items, … }`.
- `git status` shows CRLF warnings on this machine; they are harmless. `git mv` on locked folders fails with Permission denied — move the inner folders out first, then delete the shell.

## Verified evidence (do not re-verify blindly; re-run only what your change touches)
- R7: production rehearsal on a temp DB — 401/403 shapes, same-origin enforcement, operator delete denial audit, idempotent replay, correlation IDs, restart-during-pending lazy completion, SQLite backup/restore drill.
- R8: `/api/demo/*` renamed to the routable `src/app/api/demo/` (docs/03 §3.9 updated in the same commit); 4 fail-closure tests; release-config HTTP probes 401 unauthenticated / 403 operator / 403 cross-origin / 404 admin-with-demo-controls-off on all three endpoints; AC-08 failure beat end-to-end over HTTP in mock dev mode (fail-next → reset 202 → polled `failed` → `action_failed` alert → `env.reset/failure` audit row); authenticated headless-Chrome QA (login → overview → teams, 24 rows, zero console errors/exceptions).
- 21 Oct: audit filtering unified across paginated query and CSV export (`buildAuditWhere` in `audit.ts`): group prefixes (`env` matches `env.*`), exact dot codes (`env.stop`), team filter matches both team and its participants' targets, `actor=system` matches `actor_role='system'`; team detail page activity tab correctly passes `team: teamId`; audit explorer UI with search, date range, actor, team, action chips, outcome chips, hide requested rows, clickable team links, and copyable IDs; release-gate test verifying the whole matrix passes.
- Test totals history: 31 → 42 → 58 (R7) → 62 (R8) → 63 (21 Oct audit) across 8 files.

## Known bugs / limitations (current)
- Tailwind v4/Turbopack emits non-blocking CSS parser warnings on cold builds (not reproduced on cached builds).
- 58 legacy lint warnings (mostly explicit `any`); the command exits 0. Do not burn release time reducing them.
- Docker/real smoke is blocked: no Docker daemon on this machine, no `teams-template/docker-compose.yml`, no named club authorization. The Compose adapter fails closed without the template.
- Keyboard/screen-reader accessibility QA remains manual (headless-Chrome visual/console QA passed).
- The 60-minute live polling soak remains a manual demo-machine task.
- Build output warns that `package-lock.json` is outside the repository root.

## Release deployment checklist (Track A, on the target machine)
1. `npm ci` · 2. copy `.env.example` → `.env` and set: unique `SESSION_SECRET` (32+ chars), durable `DB_PATH`, `ADAPTER=mock`, `DEMO_CONTROLS=false`, `ALLOW_DEFAULT_PASSWORDS=false`, real organizer passwords · 3. `npm run build && npm start` · 4. confirm `/api/meta` shows `demoControls:false` and the UI badge reads SIMULATED · 5. `npm run seed` on the rehearsal DB, then rehearse clean-start + backup/restore (procedure in README) · 6. bind to LAN only; participants must not reach the control plane · 7. run the 3-minute demo script (docs/08 §3) twice.

## Club coordination (docs/10)
- Track A (deployment): rehearsal on the actual demo machine — pending.
- Track B/D (real control): blocked until the club provides the compose template/orchestrator contract + named authorization; then implement the one-team evidence gate and only flip the badge when every environment-affecting call is real and tested.

## When resuming after a tool/limit switch
State: "Read AGENTS.md and docs/. We are on slice P<n> after 21 Oct audit alignment. Last commit: <hash/message>." Then check `git status`, run `npm test`, and continue.
```

---
End of masterprompt. If STATUS facts change in your session, update `AGENTS.md`/`CLAUDE.md` (keep identical) and regenerate this file's STATUS section.
