# BUILD STATUS

This status uses the canonical P1–P17 slices from `07_CLAUDE_CODE_PLAYBOOK.md §4`.

## Executive summary — 18 Oct 2026

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
- `npm test` — pass; 31 tests
- `npm run build` — pass; Turbopack emits three non-failing Tailwind v4 CSS parser warnings
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

## Honest release state

The default release path is the SQLite-backed `MockAdapter` and is reported as `SIMULATED`. The Docker Compose path is opt-in via `ADAPTER=docker-compose`, is reported as `PARTIAL`, and is not a live orchestrator integration. No `LIVE` claim is made.

## Known issues

- Tailwind v4 directives (`@apply`, `@theme`, `@custom-variant`) produce Turbopack parser warnings.
- ESLint reports 72 legacy explicit-`any` warnings; the command exits successfully, but these should be reduced before a strict lint policy is reinstated.
- The import endpoint returns plaintext credentials only for successfully created rows, matching the one-time credential contract; the teams page clears that response after the reveal dialog closes.
- Docker one-team smoke testing requires the club-provided `teams-template/docker-compose.yml` and a Docker runtime.
- Full browser visual/keyboard/console verification remains a manual demo-machine task; this terminal run verified the equivalent HTTP session and polling flows.
- Login and shared visual language were redesigned with a responsive control-plane layout, mission-control palette, accessible focus states, reduced-motion handling, and Motion entrance/feedback animations. The `motion` package is now a production dependency.

## Next production slice

1. Perform the remaining manual browser visual, keyboard, and console checks on a real browser/demo machine; this terminal environment has no browser driver.
2. Obtain the club's Compose template and start Docker Desktop before attempting the one-team `PARTIAL` adapter smoke test.
3. Reduce remaining legacy `any` warnings and resolve the Tailwind v4/Turbopack parser warnings without changing the contract.
