# BUILD STATUS

> Slice names and numbers are those in `docs/07_CLAUDE_CODE_PLAYBOOK.md §4` — do not invent a different roadmap. Update this file at the end of every session.

## Current slice
**P1b — Schema delta v1.1** (prompt in `docs/07 §4`; details in `docs/09_CHANGELOG.md §2`). Then **P2 — Database and migration**.

## Progress
- [x] P1: Schemas and config
- [ ] P1b: Schema delta v1.1 (terminal, service placeholder, checker_error, docker-compose adapter value, import/bulk schemas)
- [ ] P2: Database and migration (incl. `terminal_url`, `services.placeholder`)
- [x] P3: Permissions — reported 9/9 tests green. **To verify:** the matrix is 3 roles × 11 permissions plus team-scope cases; confirm every combination is asserted (`npx vitest run --reporter=verbose tests/permissions.test.ts`)
- [ ] P4: Mock adapter core (+ `services.manifest.ts`, 5 services)
- [ ] P5: Services — audit, idempotency, errors, auth
- [ ] P5b: API error handling + lazy config (found 24 Oct: login returned a bare 500 on a short SESSION_SECRET; prompt in `docs/07 §4`)
- [ ] P6: Seed (24 teams, 5 services each, fake `.invalid` terminal URLs)
- [ ] P7: Route handlers
- [ ] P8: Shell and data layer
- [ ] P9: Teams directory + create
- [ ] P10: Team detail + lifecycle UX
- [ ] P11: Audit page and Activity tab
- [ ] P12: Overview
- [ ] P13: Participants, health, demo controls
- [ ] P14: Hardening sweep
- [ ] P15: README + handover
- [ ] P16: DockerComposeAdapter — **conditional on gate G1 (end of Day 3)**
- [ ] P17: Bulk actions + CSV import — stretch

## Known issues / decisions
- Earlier version of this file used a different slice list and referenced `docs/07 §5` (the review checklist). Prompts are in `§4`.
- Contract v1.1 changes are additive (see `docs/09_CHANGELOG.md`).
- Gate G1 decision (real adapter vs DockerCompose vs simulated): not yet taken.

## Next step
Apply prompt **P1b**, then **P2** (`docs/07_CLAUDE_CODE_PLAYBOOK.md §4`).
