# BUILD STATUS (27 Oct 2026, verified on the real repo)

## Snapshot
- Branch `release/v1.2`, version `1.2.0-rc.1`. Not pushed.
- Done: P1–P17 (v1.1), W0 (baseline), **W1 (config-driven services manifest, flagstores, migration 002, seed)**. Next: **W2** (HealthSource: scoreboard poller, parser, staleness, alerts, ingest route, `/api/meta` capabilities).
- Runtime: `ADAPTER=mock` -> `SIMULATED`. No real adapter, no real health source. `LIVE` must not be claimed.
- Earlier commits (oldest first): `acd43f9` CredentialsReveal; `c4ad549` v1.2 baseline/check-env; `9ebb544` check-env fixes; `d46e74f` docs reconciliation; `81f4d5a` club PDFs; `67a2213` W0 BUILD_STATUS. W1 commit: `feat(services): config-driven manifest, flagstores, migration 002` (see `git log`).

## W1 detail

**Manifest**
- `config/services.json` is the only manifest. Loaded and validated by `src/lib/event-config.ts` (zod, fail-closed): unique `key`, unique `portOffset`, `portOffset < serviceStride`, `flagstores` must be 3, at least one service, key regex `^[a-z0-9][a-z0-9-]*$`.
- Defaults, every name UNCONFIRMED (`nameConfirmed:false`): `docuvault` (+0), `pulsechat` (+2, placeholder, "PulseChat / CampusPortal (unconfirmed)"), `swiftshop` (+3), `service-4` (+4, placeholder).
- Formulas (UNCONFIRMED A23, constants in config `ports`): service port = `10000 + seq*10 + portOffset`; ttyd port = `7600 + seq`; `softTeamCap` 20. `teamCapWarning(seq)` warns (console, never fails) above 20; used by seed and `MockAdapter.createTeam`. `terminalMode` (`per_team`) is config.
- Deleted `src/lib/server/adapters/mock/services.manifest.ts` and the copy inside `scripts/seed.ts`. `SERVICES_PER_TEAM` is gone; all manifest entries are used.

**Migration 002** (`migrations/002_v1_2.sql`) and runner (`src/lib/migrate.ts`, used by `db.ts`, `scripts/seed.ts`, tests)
- `teams.external_team_id TEXT` + partial unique index (SQLite cannot `ADD COLUMN ... UNIQUE`); `users.session_epoch`, `must_change_password`, `last_login_at`.
- `flagstore_results` (CHECKs on flagstore and verdict; composite FK to `services` with `ON DELETE CASCADE`, so the existing `DELETE FROM services` in reseed and tests keeps working); `health_source_state`.
- Settings defaults via INSERT OR IGNORE: `stale_after_sec=270`, `round_sec=90`, `mutations_frozen='0'`.
- Runner: `user_version`-based. 001 runs bare (it has PRAGMAs); 002+ run in `BEGIN IMMEDIATE`, re-read `user_version` inside the transaction, and set it before `COMMIT`. **Behaviour change:** migration errors now throw (fail closed); the old `db.ts` swallowed them with a warning and set the version anyway.
- Audit triggers untouched; a test proves UPDATE/DELETE on `audit_log` still abort after migration.

**Types / mock**
- Additive: `Service.flagstores?: FlagstoreResult[]`, `Terminal.mode`. Both in `adapters/types.ts` and the zod schemas in `src/lib/schemas/index.ts`. `Terminal.kind` stays `'ttyd'`.
- `MockAdapter`: terminal port from `ttydPort(team.seq)`; services and ports from config; creates 3 `UNKNOWN` flagstore rows per service on team create; `loadServicesForTeam` returns `flagstores`. Memory limit 1024 and mock resources unchanged and still `// MOCK`.

**Seed** (`npm run seed`)
- 24 teams x 4 services x 3 flagstores = 96 services, 192 checks, 288 flagstore rows. `external_team_id = String(seq)` (MOCK, seed only). Verdicts match checks per doc 12 §7: down team -> reach fail + all 3 flagstores OFFLINE; degraded -> functional fail + `flag1` MUMBLE; non-running -> UNKNOWN.
- Scenario service (degraded teams 05/17, down team 13) = first non-placeholder manifest entry = `docuvault`. `funsplash` removed from code, config and seed. The seed no longer wipes the whole `settings` table, only `competition_status`; the demo reseed route got the same fix (found in review).

**Docs updated:** 01 (A9), 03 (types + CONTRACT CHANGE note), 04 (schema comment, §6.10 manifest, §7 seed, new §9 migration 002), 08 (demo script row), CLAUDE.md and AGENTS.md STATUS (identical).

## CONTRACT CHANGES (all additive)
- `Service.flagstores?`, `Terminal.mode`. Service keys changed: `funsplash`, `svc-3..5` no longer exist; ports moved from 8001–8005 to the formula. DB schema: migration 002. Documented in docs 03/04.

## Evidence (final run, after review fixes)
- `npm run typecheck`: 0 errors.
- `npm run lint`: 0 errors, 58 warnings (same count as before W1).
- `npm test`: 81/81 across 10 files. All 74 prior tests pass unmodified. New `tests/w1-manifest.test.ts` (7 tests): manifest loads 4 services; zod rejects duplicate keys, duplicate offsets, offset >= stride, flagstores != 3, empty list; port formulas and cap warning; v1-only DB upgrades in place with data preserved and is idempotent; unique `external_team_id` (NULLs may repeat), flagstore/verdict CHECKs and cascade; audit UPDATE/DELETE still abort; seed run via tsx on a temp DB gives 24/96/192/288, no `funsplash` key, no NULL `external_team_id`, `team-03`/`swiftshop` port 10033.
- `npm run build`: exit 0 (re-run after the review fixes).
- `npm run seed` on a temp DB: works (warns for team seq 21–24 per the soft cap).
- Headless Chrome, production build on port 3100, temp DB, non-default passwords, 1280x800 and 1024x768: login, `/overview`, `/teams` (24 rows at both sizes), `/teams/team-13`; zero console errors, zero exceptions. Looked at the team-13 screenshot at 1280: four services (DocuVault :10130 reachability Fail, PulseChat / CampusPortal (unconfirmed) :10132, Service 4 :10134, SwiftShop :10133), placeholder labels, simulated terminal endpoint, SIMULATED badge, version 1.2.0-rc.1. The 1024 and overview/teams screenshots were not opened; only script assertions (row count, text, console) cover them.
- `git grep -i funsplash`: no hits in `src`, `scripts`, `config`, `migrations`. Remaining hits are intentional: docs that explain the removal (01, 02 source log I4, 03, 04, 12, 14, this file) and the test asserting its absence. The acceptance line "empty" is therefore met for code only.
- Fresh reviewer subagent on the code diff: 4 findings. Applied: (1) demo reseed deleted all settings including the migration-002 defaults; (2) migration race and version-after-COMMIT window, now `BEGIN IMMEDIATE` with in-transaction version. Not applied: (3) wrapping 001 in a transaction (a failed 001 needs a fresh DB; acceptable fail-closed); (4) backfill of old DBs (documented below).

## Not verified / limitations
- **Existing pre-W1 databases** upgrade to schema 002 in place but keep their old `funsplash`/`svc-3..5` service rows (ports 8001–8005) and have no `flagstore_results`. Run `npm run seed` on dev DBs. No backfill was written.
- The mock does not update `flagstore_results` when checks change (start/stop/reset, health run, demo inject), so after a lifecycle action a team's flagstore verdicts can disagree with its checks. W2 owns health. The UI does not show flagstores yet (data is in the team detail payload only).
- Concurrent migration (two processes) is fixed by construction; no test starts two processes.
- The UI was not changed. Old marketing copy ("A calm read on team environments…") is still on the overview (W5).
- Credential reveal dialog and keyboard/screen-reader QA remain unverified (as in W0). Nothing was listening on port 3000 during the build; `next build` writes `.next`, which a running `next start` on 3000 would share.
- Names `pulsechat`/CampusPortal, ports, 3 flagstores per service and the `external_team_id` meaning are all UNCONFIRMED club inputs.

## Open questions for the club
- Final service names and port offsets (CampusPortal vs PulseChat; what is service 4?). Confirm 3 flagstores per service, the port formulas, and whether engine team ids map to `team-NN` by number.

## Hazards
- Local `.env` with `DEMO_CONTROLS=true` makes `next start` fail closed. Production start also refuses `ALLOW_DEFAULT_PASSWORDS=true`; seed with real passwords for QA.
- Port 3000 and `data/defcon.db` belong to a pre-existing server: untouched. QA used 3100 and a temp DB; that server was stopped afterwards.

## Next step
Slice W2 (doc 14), in a fresh session after pasting doc 13.
