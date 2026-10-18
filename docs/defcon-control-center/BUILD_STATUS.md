# BUILD STATUS

This status uses the canonical P1–P17 slices from `07_CLAUDE_CODE_PLAYBOOK.md §4`.

## Executive summary — 18 Oct 2026

The repository now contains a working organizer-facing DEFCON Control Center built around the documented Next.js, TypeScript, SQLite, Zod, TanStack Query, and adapter architecture. The default runtime is deliberately the persistent SQLite `MockAdapter`; it is not a live orchestrator and the UI/API report `SIMULATED`. The opt-in Docker Compose path is implemented as an experimental `PARTIAL` adapter and is never selected implicitly.

The P1–P16 implementation is verified by typecheck, lint, unit tests, production build, seeded authenticated API smoke tests, lifecycle completion/audit checks, and authorization checks. The next production slice has also started: the documented `/api/teams/import` server endpoint now validates rows, supports dry-run mode, preserves input order, skips duplicates with row-level reasons, and reuses the single-team creation service so permissions, audit, credential handling, and provisioning semantics are not duplicated.

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
- [ ] P17: bulk actions and CSV import — bulk endpoint and server-side import endpoint exist; import UI, CSV parsing/download flow, and focused P17 tests remain

## Validation evidence

- `npm run typecheck` — pass
- `npm run lint` — pass; legacy explicit-`any` warnings remain
- `npm test` — pass; 25 tests
- `npm run build` — pass; Turbopack emits three non-failing Tailwind v4 CSS parser warnings
- `npm run seed` — pass with `ALLOW_DEFAULT_PASSWORDS=true`
- Authenticated `/api/teams` smoke — HTTP 200, 24 seeded teams
- Lifecycle reset/poll/audit smoke — HTTP 202, final `running`, completion audit observed
- Operator delete authorization smoke — HTTP 403
- Docker adapter unit tests — pass; real smoke test blocked pending club compose template/runtime
- `/api/teams/import` — implemented with Zod validation, dry-run, ordered processing, duplicate skipping, and single-team service reuse; focused endpoint tests remain

## Honest release state

The default release path is the SQLite-backed `MockAdapter` and is reported as `SIMULATED`. The Docker Compose path is opt-in via `ADAPTER=docker-compose`, is reported as `PARTIAL`, and is not a live orchestrator integration. No `LIVE` claim is made.

## Known issues

- Tailwind v4 directives (`@apply`, `@theme`, `@custom-variant`) produce Turbopack parser warnings.
- ESLint reports 72 legacy explicit-`any` warnings; the command exits successfully, but these should be reduced before a strict lint policy is reinstated.
- P17 CSV import and complete bulk-action UI/test coverage are not release-complete.
- The import endpoint currently returns plaintext credentials only for successfully created rows, matching the one-time credential contract; the pending UI must clear that response after the reveal dialog closes.
- Docker one-team smoke testing requires the club-provided `teams-template/docker-compose.yml` and a Docker runtime.

## Next production slice

1. Add focused API/service tests for import dry-run, duplicate rows, partial success, ordered IDs, permission denial, and credential non-leakage.
2. Add the teams-directory bulk selection bar and CSV import dialog, including client-side parsing, confirmation thresholds, one-time credential reveal, and clearing sensitive response state on close.
3. Replace remaining unsafe legacy `any` boundaries in touched routes/services and investigate the Tailwind v4/Turbopack parser warnings.
4. Run the documented two-browser acceptance and bounded polling/lifecycle soak checks before calling P17 complete.
