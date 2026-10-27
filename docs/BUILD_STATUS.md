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

## Files changed in W1 (commit `5604b3b`, 21 files, +459/-177)
| File | Change |
|---|---|
| `config/services.json` | new; manifest, port constants, `terminalMode` |
| `src/lib/event-config.ts` | new; zod schema, `getEventConfig`, `parseEventConfig`, `servicePort`, `ttydPort`, `teamCapWarning` (no `server-only`, so the tsx seed script can import it) |
| `src/lib/migrate.ts` | new; shared migration runner |
| `migrations/002_v1_2.sql` | new |
| `migrations/001_init.sql` | comment only (removed the old example key); schema unchanged |
| `src/lib/server/db.ts` | uses `migrate(db)`; the swallow-and-warn migration block is gone |
| `src/lib/server/adapters/mock.ts` | manifest and ports from config, flagstore rows on create, flagstores in `loadServicesForTeam`, terminal port and mode |
| `src/lib/server/adapters/mock/services.manifest.ts` | deleted |
| `src/lib/server/adapters/types.ts`, `src/lib/schemas/index.ts` | `FlagstoreResult`, `Service.flagstores?`, `Terminal.mode` |
| `scripts/seed.ts` | config manifest, flagstore rows, `external_team_id`, narrower settings wipe, shared runner |
| `src/app/api/demo/reseed/route.ts` | settings delete narrowed to `competition_status` |
| `tests/w1-manifest.test.ts` | new, 7 tests |
| docs 01, 03, 04, 08, `CLAUDE.md`, `AGENTS.md`, `BUILD_STATUS.md` (+ `docs/BUILD_STATUS.md` copy) | status and contract sync |

## Decisions made in W1 (and why)
- **ON DELETE CASCADE on `flagstore_results`:** the slice said only "FK to services". Cascade means the existing `DELETE FROM services` calls (reseed route, `tests/p17`, `tests/state-machine`) needed no change, so no prior test was edited.
- **Partial unique index instead of a `UNIQUE` column:** SQLite cannot `ALTER TABLE ADD COLUMN ... UNIQUE`. NULLs stay repeatable, which un-imported teams need.
- **`event-config.ts` has no `server-only`:** the seed script runs under tsx, where the alias to the mock does not exist. It uses `fs`, so client code must not import it (none does).
- **Scenario service = first non-placeholder (`docuvault`):** follows the slice text literally. Consequence: degraded teams 05/17 and down team 13 all hit the same service, so the demo shows one failing column. Using `swiftshop` for the down team is a one-line seed change if a more varied demo is wanted.
- **Mock flagstore rows are seeded data, not derived from checks:** deriving them at read time would hide the W2 gap instead of marking it. Left as a documented limitation.
- **Exactly 3 flagstores per service** in the zod schema (A24). If the club says otherwise it is a config change plus a new migration for the `CHECK`.
- **Port formula constants live in the config JSON, not env,** so a wrong guess is a file edit and the check-env gate is unaffected.

## Review findings in full (fresh general-purpose subagent, code diff only)
1. MEDIUM, demo reseed `DELETE FROM settings` wipes the migration-002 defaults for good (migrations never re-run). **Fixed:** narrowed to `competition_status`. The reviewer also noted `flagstore_results` is cleared only through the services cascade, which needs `foreign_keys=ON` (it is, in `db.ts`).
2. MEDIUM, the runner read `user_version` outside the transaction and used plain `BEGIN`; two processes (next build workers, or a script plus the server) could both try `ALTER TABLE` and the loser would crash; a crash between `COMMIT` and the pragma left schema 002 with version 1. **Fixed:** `BEGIN IMMEDIATE`, re-read inside, version set before `COMMIT`.
3. LOW, 001 runs unwrapped, so a failed 001 leaves a half-built DB at version 0 and later boots throw "table already exists". **Not applied:** failing closed is intended; recovery is a fresh DB. 001 holds `journal_mode` and `foreign_keys` PRAGMAs, both already set by `db.ts` and the seed, so wrapping it is possible later.
4. LOW, pre-W1 DBs keep old 5-service rows (8001–8005) and have no flagstore rows, so the UI would show a mixed manifest. **Not applied:** documented; run `npm run seed`.
- Areas the reviewer checked and found clean: 002 SQL, seed ordering and FKs, no remaining old-manifest references, `buildTeamDetail` always has `seq`, zod/TS agreement, port collisions (none for seq up to 99), MOCK labelling.
- The review was by reading only; the reviewer ran nothing. My own runs (tests, build, browser) are the execution evidence.

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
The full list is in `15_CLUB_INTEGRATION_INTAKE.md` and `docs/club-inputs/`. These are the ones W1 and the next slices depend on. "Default used" is what the code does until answered.

**Affects W1 data**
1. Service names: is the second service PulseChat or CampusPortal (the PDFs and the event-flow draft disagree)? What is "Service 4"? *Default used:* `pulsechat` and `service-4`, both flagged placeholder with `nameConfirmed:false`. *Impact:* label text and the checker mapping in W2.
2. Port offsets: are they +0, +2, +3, +4 (no +1) as the draft shows? *Default used:* those four. *Impact:* shown port numbers.
3. Port formulas: service = `10000 + teamId*10 + offset`, ttyd = `7600 + teamId`. What happens above team 20? *Default used:* both formulas, labelled UNCONFIRMED A23, with a warning above 20.
4. Three flagstores per service (Flag 0/1/2, easy/medium/hard), the same for all four services? *Default used:* exactly 3 each (A24).
5. Engine team id vs dashboard `team-NN`: is the engine id just the number, or a name or UUID? *Default used:* `external_team_id = String(seq)` in the seed only; real imports must carry it (A31).

**Blocks W2 (health)**
6. Where does health come from: is `scoreboard.json` (or `attack.json`) served by nginx from EnoEngine, at what URL, and reachable from the dashboard host? Can we get a real sample file? *Default used:* none; the parser must fail closed on unknown shapes.
7. Checker verdict names: confirm `OK / MUMBLE / OFFLINE / INTERNAL_ERROR` (enochecker3). Any others? *Default used:* anything unrecognised becomes `UNKNOWN` plus an info alert, never healthy.
8. Round length 90 s? Is `scoreboard.json` frozen in the last 30 minutes (the draft says so)? If yes we need an unfrozen status file or a push. *Default used:* `round_sec=90`, `stale_after_sec=270`.
9. If pull is impossible, can the club push results to a token-protected `POST /api/ingest/check-results`?

**Blocks W3 and W4 (roles, lifecycle)**
10. Reset: may players reset their own environment, or admin only? What does reset do on the real stack (restore patch, recreate pristine, restart), and does it wipe service data? *Default used:* team self-reset off; reset text will follow the adapter capability. The spec says players may reset and the chat says no, so the lead must decide.
11. Who runs start/stop/reset on the real host: a small allow-listed agent (proposal in doc 15 §3), or a Docker socket or compose on the host? Can `template.compose.yml` be shared, and is it one compose project per team (`team-NN`)?
12. Per-team ttyd or one shared ttyd? *Default used:* `per_team`.
13. Topology (A18): one container per team, or services plus separate DB containers? Is the memory cap 1024 MB per team project?
14. Is "moderator" our `organizer_operator` role? What should moderators be unable to do (delete, reset)?

**Event-level**
15. Event date and DEFCON slot (Technozion reported 30–31 Oct, unconfirmed). *Default used:* no freeze date assumed.
16. Team count: 20 (ports 7601–7620 in the draft) or up to 30?
17. How will the roster arrive (CSV/JSON from registration)? Which columns, and does it include the engine team id?
18. Is the dashboard reachable only from the organizer network (LAN/VPN/security group), never from participants?

## Hazards
- Local `.env` with `DEMO_CONTROLS=true` makes `next start` fail closed. Production start also refuses `ALLOW_DEFAULT_PASSWORDS=true`; seed with real passwords for QA.
- Port 3000 and `data/defcon.db` belong to a pre-existing server: untouched. QA used 3100 and a temp DB; that server was stopped afterwards.

## Next step
Slice W2 (doc 14), in a fresh session after pasting doc 13, then the dry-run (doc 12 §11).
- W2 can start without answers: it builds against a labelled provisional fixture and fails closed.
- Needed before the dry-run is meaningful: answers 6–8 (real `scoreboard.json` URL and a sample) and 5 (team id mapping).
- Carry-overs for W2: refresh `flagstore_results` from the real source and keep checks consistent with it (worst-of rule, doc 12 §7); decide whether pre-W1 dev DBs get a backfill; show flagstores in the UI only once real data exists (W5 matrix).
- To resume: `git status`; `npm run typecheck && npm test` (expect 81/81); read doc 14 W2; QA on ports 3100/3101 only.
