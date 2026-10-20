# BUILD STATUS

This status uses the canonical P1–P17 slices from `07_CLAUDE_CODE_PLAYBOOK.md §4`.

## Executive summary — 21 Oct 2026

### Audit filter alignment & console refinement pass — 21 Oct 2026

Files changed in this pass:
- `src/lib/server/services/audit.ts`: Unified `buildAuditWhere` across `queryAudit` and `exportAuditCsv`. Bare action tokens act as group prefixes (`env` matches `env.*`), while dotted tokens match exact actions (`env.stop`). Team filter matches `target_id = ?` as well as participant targets belonging to that team (`target_id IN (SELECT id FROM participants WHERE team_id = ?)`). Actor filter supports `actor=system` (`actor_role = 'system'`).
- `src/app/(console)/teams/[teamId]/page.tsx`: Fixed Activity tab query parameter (`useAudit({ team: teamId })`); encapsulated `TeamDetailsForm` with controlled name and notes editing, live save validation, and feedback toasts without React cascading renders.
- `src/app/(console)/audit/page.tsx`: Full interactive audit explorer interface with date range selector, actor filter, team filter, action category chips, outcome chips, "hide requested rows" toggle, clickable team links, friendly action descriptions, and paginated navigation with count summaries.
- `src/components/console/DashboardPrimitives.tsx`: Added `CopyableId` helper to easily copy Request and Correlation IDs.
- `docs/defcon-control-center/03_API_CONTRACT.md`: Documented action-filter group prefix semantics, team participant mapping, and CSV export equivalence.
- `tests/release-gates.test.ts`: Added release-gate test verifying group prefix matching, exact action code matching, participant-to-team mapping, CSV export row and header consistency, and forbidden non-admin/operator role rejection. Total tests: 63 across 8 files.
- `CLAUDE.md`, `AGENTS.md`, `docs/defcon-control-center/11_NEXT_SESSION_MASTERPROMPT.md`: Updated STATUS section with 21 Oct validation records and latest commit references.

Validation results:
- `npm run typecheck`: clean (0 errors)
- `npm run lint`: 0 errors, 58 pre-existing legacy warnings
- `npm test`: 63/63 passed across 8 test suites
- `npm run build`: pass, static & dynamic routes compiled
- `git diff --check`: 0 errors

## Executive summary — 19 Oct 2026

### Release-hardening pass — 19 Oct 2026

This pass added typed fail-closed configuration validation and focused release tests. Files changed for this pass: `.env.example`, `README.md`, `CLAUDE.md`, `AGENTS.md`, `src/lib/config.ts`, `src/lib/server/db.ts`, `src/lib/server/adapters/index.ts`, `src/lib/server/adapters/mock.ts`, `src/app/api/meta/route.ts`, `src/app/api/_demo/fail-next/route.ts`, `src/app/api/_demo/inject/route.ts`, `src/app/api/_demo/reseed/route.ts`, `tests/config.test.ts`, `docs/defcon-control-center/01_BLUEPRINT.md`, and `docs/defcon-control-center/08_TEST_AND_DEMO.md`.

`SESSION_SECRET` is mandatory at runtime outside tests and must be at least 32 characters. Production requires an explicit durable `DB_PATH`; `:memory:` is rejected. `ADAPTER` accepts only `mock`, `real`, or `docker-compose`; requested real mode requires the three orchestrator settings and then fails clearly because no verified real client exists, while Docker Compose requires the club template and never falls back to mock. Demo controls, default passwords, and scaled mock timing are restricted to mock development/rehearsal use. `/api/meta` returns only public adapter metadata.

Validation for this pass: `npm run typecheck` passed; `npm run lint` passed with 58 pre-existing warnings; `npm test` passed with 42 tests (R2 baseline at that pass — 42 = 31 pre-existing + 11 new `tests/config.test.ts`; the R7 final gate below records 58); `npm run build` passed with the existing Next.js package-lock and Tailwind/Turbopack warnings; `git diff --check` passed. Runtime remains the persistent SQLite `MockAdapter` and `SIMULATED`; no real orchestrator was implemented and no `LIVE` claim was introduced.

Next operator action: copy `.env.example` to the target deployment configuration, set a unique 32+ character `SESSION_SECRET` and durable `DB_PATH`, keep `ADAPTER=mock`, demo controls and default passwords disabled, then perform the clean-start/backup/restore rehearsal on the target machine.

### R7 release-candidate verification pass — 19 Oct 2026

Files changed in this session: `tests/release-gates.test.ts` (new), `tests/config.test.ts`, `tests/demo-routes.test.ts` (new), `src/app/api/_demo/` → `src/app/api/demo/` (renamed), `src/lib/api-client.ts`, `docs/defcon-control-center/03_API_CONTRACT.md`, `docs/defcon-control-center/07_CLAUDE_CODE_PLAYBOOK.md`, `docs/defcon-control-center/BUILD_STATUS.md`, `docs/defcon-control-center/08_TEST_AND_DEMO.md`, `README.md`, `CLAUDE.md`, `AGENTS.md`.

Commands and results (all run this session, exit status captured with pipefail):

| Command | Result |
|---|---|
| `npm test -- --run tests/config.test.ts` (pre-edit baseline) | pass, 11 tests |
| `npm run typecheck` | pass, 0 errors |
| `npm run lint` | pass, 0 errors, 58 warnings (unchanged from baseline; the new test file adds none) |
| `npm test` | pass, **58 tests** across 7 files (42 baseline + 16 new) |
| `npm run build` | pass; warnings: Next.js `package-lock.json` outside the repository (1 observed this session); the earlier three Tailwind/Turbopack CSS parser warnings were not reproduced in R7's builds (CSS build cached) |
| `git diff --check` | pass |

### R8 production-finish pass — 19 Oct 2026

Files changed in this pass: `src/app/api/_demo/` → `src/app/api/demo/` (renamed), `src/lib/api-client.ts`, `tests/demo-routes.test.ts` (new), `docs/defcon-control-center/03_API_CONTRACT.md`, `docs/defcon-control-center/07_CLAUDE_CODE_PLAYBOOK.md`, `docs/defcon-control-center/08_TEST_AND_DEMO.md`, `docs/defcon-control-center/BUILD_STATUS.md`, `CLAUDE.md`, `AGENTS.md`.

| Command / check | Result |
|---|---|
| `npx vitest run tests/demo-routes.test.ts` | pass, 4 tests (401/403/404/no-Origin fail-closed matrix) |
| `npm test` | pass, **62 tests** across 8 files |
| Release-config HTTP probes (`next start`, temp DB, explicit `DEMO_CONTROLS=false ALLOW_DEFAULT_PASSWORDS=false`) | `/api/demo/inject`, `/api/demo/fail-next`, `/api/demo/reseed` → 401 unauthenticated, 403 operator, 403 cross-origin, 404 admin with demo controls off; `/api/meta` reports `demoControls:false` |
| AC-08 failure beat (mock dev server, `DEMO_CONTROLS=true`) | fail-next reset → 200; reset → 202; polled final state `failed`; open alert `action_failed` ("reset failed (simulated)"); audit rows `demo.fail_next/success`, `env.reset/requested`, `env.reset/failure` |
| Authenticated headless-Chrome QA (production build) | login page renders with SIMULATED badge and dark navy console theme; login as admin → `/overview` (badge, 24-team stats); `/teams` renders 24 rows with search; **zero console warnings/errors and zero uncaught exceptions**; screenshots captured |
| Config hazard found and documented | a leftover local `.env` containing `DEMO_CONTROLS=true` makes `next start` fail closed (module-load `loadConfig()` throw → 500s on every route). Release deployments must ship `DEMO_CONTROLS=false`; explicit process env overrides `.env` and was used for all release probes. |
| Cleanup | rehearsal DBs (`data/r8*.db`), cookie jars and session secret removed; rehearsal servers and headless Chrome stopped; only the pre-existing `data/defcon.db` and the untouched port-3000 server remain. |
| focused configuration tests (after additions) | pass, 13 tests |

Target-machine verification: **not performed** — no target machine is available to this session; the closest local production-mode rehearsal was run instead and target-machine Track A remains blocked.

Backup/restore rehearsal: **performed** on the temporary, explicitly named `data/r7-rehearsal.db` (gitignored `data/` area). Procedure: seeded → harmless PATCH (audit 50→52) → process stopped → copied `db`+`-wal`+`-shm` to `data/r7-backup/` → restarted → second PATCH (audit 52→54, notes changed) → stopped → restored the three-file backup set → restarted → verified audit back at 52 (+ login rows), team-01 notes reverted to the pre-backup value, 24 teams with consistent lifecycle states, no credentials in payloads, `/api/meta` reporting `mock`. Append-only triggers rejected direct `UPDATE`/`DELETE` on the restored database. All temporary `r7*` files were removed afterwards; only the pre-existing `data/defcon.db*` remains.

Authentication and permission evidence: unauthenticated `GET /api/teams` → 401 with the documented `{error:{code:"UNAUTHENTICATED",message,requestId}}` shape; unauthenticated `/overview` → 307 redirect to `/login?next=...`; admin and operator logins → 200 with role-correct session cookies; operator `DELETE /api/teams/team-01` (with valid `confirmName`) → 403 `FORBIDDEN` with `details.required="team.delete"` and a matching `env.delete`/`denied` audit row naming Operator/`organizer_operator`.

Same-origin evidence: authenticated `POST` without `Origin` → 403 "Origin header required for state-changing requests."; with `Origin: https://evil.example` → 403 "Cross-origin request rejected."; same-origin `POST` → accepted (202); `GET`/`HEAD`/`OPTIONS` remain accepted without `Origin` (unit-tested).

Lifecycle/idempotency/audit evidence: admin `start` of stopped team-22 → 202 with correlation ID, detail endpoint polled to authoritative `running`; HTTP `Idempotency-Key` replay → second response 202 with `Idempotent-Replay: true`, byte-identical body, and still only one `requested` audit row; `requested` and `success` rows for the same action share one non-null `correlation_id` (e.g. `c_506a4fb1c5e5`).

Restart-during-pending evidence: server killed while team-22 `stop` was pending (`stopping`, ends 2s out); after restart the **first** detail read returned `stopped` with no pending action, and the completion audit row's `ts` equalled the pending end time with the same correlation ID as the requested row.

Secret/configuration evidence: `SESSION_SECRET` was generated per-process in the environment and never printed or written to any file; server log contained 0 matches for credentials, passwords, or `terminal.invalid`; `/api/meta` returned only public fields; list/detail/overview/audit payloads contained no password fields and no terminal URLs (terminal URL appears only on running team detail); no `.env`, database, or runtime file is tracked by git; the diff contains no secret values.

New test coverage added this session (`tests/release-gates.test.ts`): same-origin matrix, 401 response shape and tampered-session rejection, restart-during-pending lazy resolution with correlation preservation, credential non-leakage across list/detail/overview/audit/meta, service-level operator delete denial + denied audit, idempotent replay without duplicate audit rows, pending-transition collision, and requested/completion correlation. `tests/config.test.ts` additionally covers missing production `DB_PATH` and `MOCK_DURATION_SCALE ≠ 1` rejection.

Resolved (19 Oct 2026, R8): `/api/_demo/*` handlers sat under the Next.js private folder `_demo` and were excluded from routing in both `next dev` and `next start` (HTTP probe returned the HTML 404 page even with `DEMO_CONTROLS=true`). The folder is now `src/app/api/demo/` — endpoints `/api/demo/inject`, `/api/demo/fail-next`, `/api/demo/reseed` — and `docs/03_API_CONTRACT.md` §3.9 was updated in the same commit (path change only; request/response shapes unchanged). The handlers were re-verified fail-closed over HTTP: 401 unauthenticated, 403 for non-admins, 404 with release config (`DEMO_CONTROLS` unset), and the full inject → fail → alert → audit flow succeeds with `DEMO_CONTROLS=true` in a mock development server.

Remaining known blockers: no target machine (Track A rehearsal on the deployment host pending); no club orchestrator/compose template or named authorization (Track B/Docker smoke pending); Docker daemon unavailable on this machine; the 60-minute live polling soak remains a manual demo-machine task; package-lock warning in build/start output.

Runtime mode: **SIMULATED** (persistent SQLite `MockAdapter`). No real orchestrator was implemented in this session. **No `LIVE` claim was introduced.** Docker Compose was not exercised (daemon absent, template absent).

Next operator action: run the Track A target-machine rehearsal from this session's checklist — clean checkout, `.env.example` → `.env` with a unique 32+ character `SESSION_SECRET` and durable `DB_PATH`, `ADAPTER=mock`, demo controls and default passwords disabled, then the clean-start / two-login / restart-during-pending / backup-restore / 60-minute polling sequence — and record the results here.

### Current release decision

The repository is in an emergency two-day release window. P1–P17 are complete. The guaranteed release is the persistent SQLite `MockAdapter`, labelled `SIMULATED`. Real orchestrator integration is not verified and must remain a separate Track B decision. The club has not yet supplied a complete, tested orchestrator/checker/terminal handoff in this repository.

The current roadmap is:

1. Lock the club integration contract and owners.
2. Verify target-machine deployment and fallback release.
3. Integrate one disposable real team only if authorized.
4. Run checker, credential, terminal, permission, audit and recovery gates.
5. Freeze as `SIMULATED`, `PARTIAL` or `LIVE` based on evidence—not intention.

See `06_BUILD_PLAN_5_DAYS.md`, `07_CLAUDE_CODE_PLAYBOOK.md §11`, and `10_INTEGRATION_COORDINATION_PLAN.md`.

### Latest release note — Teams overlay accessibility hardening

The Teams create, import, bulk-action, and one-time credential reveal overlays now expose labelled dialog semantics, trap keyboard focus, restore focus to the invoking control, lock page scrolling while open, support Escape only for dismissible overlays, and keep the credential reveal non-dismissible until acknowledgement. Typecheck, lint, unit tests, production build, and public-route smoke checks pass. Authenticated browser verification confirmed Overview, Teams, Audit, and Settings rendering; the import dialog received focus, trapped focus within the dialog, closed on Escape, restored focus to its trigger, and had no horizontal overflow at 1024px or 1280px. A stale pre-restart Next.js chunk caused an initial Teams navigation error; restarting the production server against the fresh build cleared it.

### Latest release note — Tailwind utility regression fix

The authenticated shell visual regression was traced to missing Tailwind v4 PostCSS integration: authored CSS loaded, but utility classes such as `flex`, `grid`, spacing, typography, and responsive variants were not emitted. The fix adds the official `@tailwindcss/postcss` plugin, a repository-level `postcss.config.mjs`, and an explicit source declaration in `globals.css`. A fresh production build now emits the expected utility selectors (`flex`, `grid`, `px-4`, and `md:flex`); the live login page computes as a grid at desktop width with no current console errors after a cache-busting navigation.

### Latest release note — organizer usability and feature pass

The authenticated UI now has shareable, paginated team filters (search, lifecycle, health, account status, and sort), a global team search field with `/` keyboard focus, resource usage bars, icon-plus-text service check states, copyable simulated terminal endpoints, participant add and credential rotation/reveal flows, account suspend/reactivate controls, participant-aware team creation, audited mock demo controls on Settings, and audit export that preserves active filters. These changes preserve the existing API/state/permission contracts and do not add a new dependency.

### Latest release note — 21:33 IST

The authenticated console received a coherent production hardening and redesign pass across the shared shell, overview, teams directory, team detail, audit log, and settings. The pass adds responsive mobile navigation, clearer operational surface hierarchy, stronger attention/health grouping, an implemented settings screen, masked one-time credential reveals, accessible lifecycle dialogs with typed delete confirmation, final-state lifecycle feedback, and a stricter same-origin requirement for all state-changing API requests. API contracts, permissions, adapter labeling, polling semantics, and simulated-runtime honesty were preserved.

The polished login build is deployed on the demo machine at `127.0.0.1:3000`. The latest committed UI pass is `aa1be08` (`feat(ui): polish editorial login layout`), pushed to `origin/main`. The login route returns HTTP 200, renders the editorial organizer-facing layout and principle content, and no longer renders the historical blank-screen fallback.

The `ai-team-orchestration` plugin was installed from the registered `awesome-copilot` marketplace for the next implementation session. This is development tooling only and does not change the application runtime, security model, adapter behavior, or production release claims.

The repository now contains a working organizer-facing DEFCON Control Center built around the documented Next.js, TypeScript, SQLite, Zod, TanStack Query, and adapter architecture. The default runtime is deliberately the persistent SQLite `MockAdapter`; it is not a live orchestrator and the UI/API report `SIMULATED`. The opt-in Docker Compose path is implemented as an experimental `PARTIAL` adapter and is never selected implicitly.

The P1–P16 implementation is verified by typecheck, lint, unit tests, production build, seeded authenticated API smoke tests, lifecycle completion/audit checks, and authorization checks. P17 is now complete: the documented import and bulk endpoints have focused coverage, and the teams directory provides CSV dry-run/import with one-time credential reveal plus typed-confirmation bulk start/stop controls.

This is production-grade dashboard infrastructure around a mock/adapter contract, not a claim that the club's missing orchestrator, terminal gateway, scoring system, challenge catalogue, or patch service has been built.

## Verified implementation

- [x] P1/P1b: schemas, configuration, and v1.1 contract additions
- [x] P2: SQLite schema, migrations, and append-only audit triggers
- [x] P3: role/permission checks
- [x] P4: persistent mock adapter and lazy timestamp state machine
- [x] P5: auth, errors, idempotency, audit, and service layer
- [x] P6: repeatable 24-team demo seed/reset
- [x] P7: authenticated API route handlers
- [x] P8: shell, adapter badge, simulation banner, query/polling data layer
- [x] P9–P13: overview, teams, team detail, audit, participants, health, and demo controls
- [x] P14: baseline hardening and production build gates
- [x] P15: handover documentation and honest adapter/runtime labeling
- [x] P16: gated Docker Compose adapter with safe command arrays and unit tests
- [x] P17: bulk actions and CSV import — ordered partial-success import, dry-run preview, one-time credential reveal, and typed-confirmation bulk start/stop UI are complete

## Validation evidence

- `npm run typecheck` — pass
- `npm run lint` — pass; legacy explicit-`any` warnings remain
- `npm test` — pass; 62 tests (R8, 19 Oct 2026; earlier passes recorded 31, 42 and 58)
- `npm run build` — pass; Turbopack emits three non-failing Tailwind v4 CSS parser warnings
- Tailwind utility regression fix — production CSS grew from 14,791 bytes without utilities to 89,906 bytes with generated `flex`, `grid`, spacing, and responsive selectors; live server verified the rebuilt stylesheet
- Organizer usability pass — typecheck pass, lint pass with existing warnings, 31 tests pass, production build pass; changed surfaces: Teams, Team detail, Audit, Settings, shared Topbar, and dashboard primitives
- Final console redesign — typecheck pass, test pass (31 tests), production build pass
- Production HTTP smoke — `/login` 200, `/api/meta` 200, unauthenticated `/overview` redirects, authenticated `/api/auth/me`, `/api/overview`, `/api/teams`, `/api/audit`, and `/api/settings` all returned 200
- Browser visual/console pass — live `/login` snapshot at desktop viewport; zero browser console errors observed
- Security hardening — state-changing requests without `Origin` now fail closed; GET/HEAD/OPTIONS remain compatible
- `npm run seed` — pass with `ALLOW_DEFAULT_PASSWORDS=true`
- Authenticated `/api/teams` smoke — HTTP 200, 24 seeded teams
- Lifecycle reset/poll/audit smoke — HTTP 202, final `running`, completion audit observed
- Operator delete authorization smoke — HTTP 403
- Docker adapter unit tests — pass; real smoke test blocked pending club compose template/runtime
- `/api/teams/import` — validated with dry-run, duplicate, partial-success, ordered-ID, permission, and credential non-leakage tests
- `/api/environments/bulk` — typed request/response handling, ordered per-team processing, confirmation threshold, and partial result reporting verified
- Two isolated authenticated sessions (admin/operator) against `next start` — pass; both saw 24 teams, overview/directory totals matched, operator delete returned 403, admin reset completed to `running`, and the requested/completion audit pair shared one correlation ID
- Bounded two-session lifecycle/polling soak — pass; 3 reset cycles, 81 cross-session polls, 0 errors, 3 complete audit pairs, and 0 MB observed Node working-set growth
- Docker CLI is installed, but the Docker daemon is unavailable and `teams-template/docker-compose.yml` is not present; Compose smoke remains blocked
- Demo-route routability + fail-closure (R8) — `/api/demo/*` renamed and HTTP-verified in release config (401/403/404/403 cross-origin); AC-08 failure beat verified end-to-end over HTTP in mock dev mode (fail-next → 202 → polled `failed` → `action_failed` alert → `env.reset/failure` audit row)
- Authenticated headless-Chrome QA (R8) — login → overview → teams rendered with 24 teams; zero console warnings/errors and zero uncaught exceptions; screenshots captured

## Honest release state

The default release path is the SQLite-backed `MockAdapter` and is reported as `SIMULATED`. The Docker Compose path is opt-in via `ADAPTER=docker-compose`, is reported as `PARTIAL`, and is not a live orchestrator integration. No `LIVE` claim is made.

## Known issues

- Tailwind v4 directives (`@apply`, `@theme`, `@custom-variant`) produce Turbopack parser warnings.
- ESLint reports 56 legacy explicit-`any` warnings (58 warnings total, 0 errors; measured 19 Oct 2026 in the R7 final gate); the command exits successfully, but these should be reduced before a strict lint policy is reinstated.
- The import endpoint returns plaintext credentials only for successfully created rows, matching the one-time credential contract; the teams page clears that response after the reveal dialog closes.
- Docker one-team smoke testing requires the club-provided `teams-template/docker-compose.yml` and a Docker runtime.
- Full authenticated browser visual/keyboard verification remains a manual demo-machine task; this terminal run verified the live login/public-route visual and console state plus authenticated production HTTP/API flows. No claim is made for authenticated browser screenshots or screen-reader output.
- The prior authenticated dashboard collapse was caused by missing Tailwind utility emission, not by dashboard component markup. The PostCSS integration fix is now applied; authenticated route visual verification after login still requires the configured demo credentials in the browser session.
- Remaining contract gaps are now explicitly tracked: full Playwright acceptance coverage, complete focus-trapped credentials/import overlays, richer audit date/actor/team filters, filtered bulk-action idempotency, and club-dependent Docker smoke testing.
- Login and shared visual language were redesigned with a responsive control-plane layout, stronger contrast, explicit grid alignment, accessible focus states, reduced-motion handling, and Motion entrance/feedback animations. Decorative scan/drift motion was removed to match the UI spec.
- Shared theme tokens were corrected so semantic accent/muted colors are no longer overwritten by dark surface colors; primary buttons, focus rings, labels, and dashboard status UI now retain their intended contrast.
- Login received an anti-slop polish pass: removed decorative radar/grid/orb treatment and fake telemetry statuses, simplified copy to organizer-relevant language, and retained a restrained single-accent motion treatment.
- Security hardening removed the JWT secret fallback, requires a configured 32-character minimum `SESSION_SECRET`, and restricts post-login redirects to same-origin paths.
- The login editorial pass is complete: the left column now uses a restrained product hierarchy, useful organizer principles, aligned responsive spacing, standard text sizing, and accessible contrast rather than decorative telemetry.
- The deployed login verification at 20:50 IST returned HTTP 200, included the new “Keep every team” heading and “See what needs attention” principle, and contained no `min-h-screen` blank fallback.

## Next release actions

1. Obtain named owners, the authoritative registration source, the orchestrator/checker/terminal handoff and the target deployment details.
2. Run the R1–R8 emergency prompts only in order where their prerequisites are satisfied; keep Track A moving if Track B is blocked.
3. Perform the target-machine clean-start, backup/restore, two-browser, permission, failure/recovery and 60-minute polling checks.
4. Attempt Docker/real one-team smoke only with an authorized disposable team and the supplied template/runtime.
5. Record the final release mode and freeze. Do not reduce legacy warnings or redesign unrelated UI during the emergency window unless they block release.
