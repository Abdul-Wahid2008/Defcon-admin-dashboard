# DEFCON Control Center

Organizer-facing admin console for DEFCON 2.0. The application manages teams, participant credentials, environment lifecycle, service health, alerts, resources, overview data, and an append-only audit log.

## Runtime model

The default adapter is a persistent SQLite-backed mock state machine. It is intentionally reported as **SIMULATED**; it does not control the club's absent orchestrator. An experimental Docker Compose adapter can be selected with `ADAPTER=docker-compose`, but it is reported as **PARTIAL** and requires a club-supplied `teams-template/docker-compose.yml`. The application never claims `LIVE` unless every environment-affecting operation is real and tested.

## Requirements

- Node.js compatible with the repository's Next.js 16 toolchain
- npm
- Docker only for the opt-in Docker Compose adapter

## Development

```powershell
npm ci --ignore-scripts   # verified in a fresh clone; plain `npm ci` tries to compile better-sqlite3 (needs Visual Studio C++ build tools) although the package ships a Windows prebuilt binary
$env:SESSION_SECRET = "replace-with-a-random-secret-at-least-32-characters"
$env:DB_PATH = "data/defcon.db"
$env:ADAPTER = "mock"
npm run seed
npm run dev
```

Open `http://localhost:3000`. Copy `.env.example` to `.env` and replace every credential placeholder before running a shared or production-like instance. The application fails closed when `SESSION_SECRET` is missing or shorter than 32 characters. Production also requires `DB_PATH` to be explicitly set to durable SQLite storage.

Demo seed passwords require explicit opt-in and must remain disabled for release:

```powershell
$env:ALLOW_DEFAULT_PASSWORDS = "true"
npm run seed
```

The seed script creates 24 teams by default (`SEED_TEAMS`, up to 30) with five services each. Use `npm run reset-demo` to restore the deterministic demo state.

## Configuration and operator handoff

- `ADAPTER=mock` is the default development path and is always reported as **SIMULATED**. It uses the persistent SQLite state machine.
- `ADAPTER=docker-compose` is opt-in and reports **PARTIAL**. It requires the club-provided `teams-template/docker-compose.yml` and a Docker runtime.
- `ADAPTER=real` is rejected unless `ORCHESTRATOR_BASE_URL`, `ORCHESTRATOR_TOKEN`, and `ORCHESTRATOR_TIMEOUT_MS` are present; this repository does not implement a verified real orchestrator client, so it never silently falls back to mock.
- `DEMO_CONTROLS=true`, `ALLOW_DEFAULT_PASSWORDS=true`, and non-default `MOCK_DURATION_SCALE` are rehearsal-only controls. Demo controls and default passwords are rejected outside mock development mode.
- `SESSION_SECRET` signs organizer sessions. It is never logged, returned by `/api/meta`, or sent to the browser. Rotate it through the deployment secret store and restart the process.
- Back up the SQLite database before rehearsal and event operations. A restart preserves mock state and lazily completes due transitions on the next read; it does not replace a database backup.

### Online backup (no stop needed) — v1.2 W7

`npm run backup` uses SQLite's online backup API: it is consistent while the server runs, writes one self-contained file `data/backups/<UTC timestamp>.db`, runs `integrity_check` on it, and keeps the newest 12 (`BACKUP_KEEP`, `BACKUP_DIR`). `DB_PATH` must be set, as for the server.

Every 5 minutes during the event (Windows Task Scheduler; the task runs only while that user is logged on, add `/RU SYSTEM` if it must run logged out; adjust the paths and DB path):

```
schtasks /Create /SC MINUTE /MO 5 /TN "defcon-backup" /TR "cmd /c cd /d C:\path\to\defcon-control-center && set \"DB_PATH=data\defcon.db\"&& npm run backup >> data\backup.log 2>&1"
```

Durability note: the server uses `synchronous=NORMAL` with WAL, so a power cut can lose the last few committed transactions (audit rows included) but cannot corrupt the database; the 5-minute backups bound the exposure.

Restore from a backup file: stop the server, copy the chosen `<ts>.db` over `DB_PATH`, delete `<DB_PATH>-wal` and `<DB_PATH>-shm`, start the server. Drill re-run 27 Oct 2026 on a temp DB: row counts of teams, participants, environments, services, checks, audit_log, users and alerts matched, `integrity_check` ok, `user_version` 4.

### Load and soak tools

`npm run loadtest` (3 simulated organizers polling overview and teams every 5 s, one stop/start per minute on mock) and `npm run soak` (same, 60 minutes by default) print p50/p95/p99, payload size, 5xx counts and, with `LT_PID` set to the server's node PID, RSS growth. Env: `BASE_URL`, `LT_USER`, `LT_PASS`, `MINUTES`, `ORGANIZERS`. Run against a temp-DB server only; never against a live event DB.

### SQLite backup and restore, offline method (rehearsed 19 Oct 2026)

1. Stop the application process (`next start`) so no writer holds the database.
2. Copy all three SQLite files together: `<DB_PATH>`, `<DB_PATH>-wal`, and `<DB_PATH>-shm`. Copying only the main file can lose committed-but-uncheckpointed rows.
3. Store the three-file set as one backup unit.
4. To restore: stop the process again, replace all three live files with the backup set (discard the live `-wal`/`-shm`), and restart.
5. Verify after restart: team count, audit row count, lifecycle states, and that `/api/meta` still reports the expected adapter (`mock` / `SIMULATED`).

This procedure was rehearsed on a temporary, explicitly named test database (`data/r7-rehearsal.db`) during the R7 release-candidate pass; the post-backup state change was reverted by the restore and the temporary files were removed afterwards.
- Do not change adapter mode during an event. If external integration is unavailable, keep the known-good `SIMULATED` release and state the limitation plainly.

## v1.2: health sources, capabilities, freeze, ingest

- **Badge** (`/api/meta`): `SIMULATED` while lifecycle and health are both mock; `PARTIAL` if any source is real; `LIVE` only with `EVIDENCE_GATE_PASSED=true` **and** an adapter reporting `capabilities.fullyReal` (none does today).
- **Health source** (`HEALTH_SOURCE`): `mock` (default), `scoreboard` (the server pulls `HEALTH_SCOREBOARD_URL` every `HEALTH_POLL_SEC`; SSRF-limited by `HEALTH_ALLOWED_HOSTS`, size-capped), or `ingest` (the checker pushes to `POST /api/ingest/check-results` with `Authorization: Bearer $INGEST_TOKEN`, token of 32+ characters, constant-time compare). The scoreboard parser is **provisional**: an unknown shape is `SOURCE_SHAPE_UNKNOWN` and is never shown healthy. Results older than `stale_after_sec` (default 270) show as unknown.
- **Capabilities**: reset wording and service-level actions follow `/api/meta.capabilities` (`resetKind`, `serviceLevelReset`, `fullyReal`); unsupported actions are disabled with a reason.
- **Roles**: `organizer_admin` and `organizer_operator` (moderator); operators cannot delete teams or change settings. Admin can manage organizer accounts and sessions through the API.
- **Freeze**: Settings, admin only, type `FREEZE`. Mutating routes then return `423 MUTATIONS_FROZEN`; reads, the audit log and "Run check" keep working.
- **Hardening (27 Oct pass)**: per-request nonce CSP (no inline scripts), server-side logout (token revoked at once), 64 KB cap on every JSON body, clamped pagination, 1–128 character `Idempotency-Key`, global login ceiling, organizer passwords of at least 12 characters, no `X-Powered-By`, `Cross-Origin-Opener-Policy`/`Cross-Origin-Resource-Policy: same-origin`. Admin action to reset the health baseline after a checker restart (Settings). Details: `docs/defcon-control-center/BUILD_STATUS.md`.
- **Release gate**: `npm run check-env` (also run by `npm run start:release`) refuses weak or placeholder secrets, demo flags, default passwords, an unset or in-memory `DB_PATH`, and invalid adapter or health settings. A local `.env` with `DEMO_CONTROLS=true` makes `next start` fail closed.
- **Windows start**: `npm ci --ignore-scripts`, set the release environment, `npm run build`, `npm run start:release`. Event-day procedures: [`docs/EVENT_RUNBOOK.md`](docs/EVENT_RUNBOOK.md).

## Verification and production start

```powershell
npm run typecheck
npm run lint
npm test
npm run build
npm start
```

The production process reads `.env` and uses the configured SQLite database path. Keep `.env*` and `data/` out of version control.

## Security and behavior notes

- UI code communicates through `/api/*`; authorization is enforced server-side.
- Passwords are bcrypt hashes in storage and plaintext is returned only in one-time credential responses.
- Terminal URLs are redacted outside the running team-detail view.
- Lifecycle transitions resolve lazily by timestamp; there are no background timers.
- Audit rows are append-only and protected by SQLite triggers.
- The mock adapter's simulated resource values and service checks are labelled as mock data.

The canonical contracts and acceptance checklist are in `docs/defcon-control-center/`. Remaining club-dependent work includes orchestrator ownership/API, terminal gateway details, checker verdicts, health interval, idle timeout, backup policy, and challenge catalogue.
