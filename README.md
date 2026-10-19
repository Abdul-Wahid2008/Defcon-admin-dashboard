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
npm install --legacy-peer-deps
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

The seed script creates 24 teams with five services each. Use `npm run reset-demo` to restore the deterministic demo state.

## Configuration and operator handoff

- `ADAPTER=mock` is the default development path and is always reported as **SIMULATED**. It uses the persistent SQLite state machine.
- `ADAPTER=docker-compose` is opt-in and reports **PARTIAL**. It requires the club-provided `teams-template/docker-compose.yml` and a Docker runtime.
- `ADAPTER=real` is rejected unless `ORCHESTRATOR_BASE_URL`, `ORCHESTRATOR_TOKEN`, and `ORCHESTRATOR_TIMEOUT_MS` are present; this repository does not implement a verified real orchestrator client, so it never silently falls back to mock.
- `DEMO_CONTROLS=true`, `ALLOW_DEFAULT_PASSWORDS=true`, and non-default `MOCK_DURATION_SCALE` are rehearsal-only controls. Demo controls and default passwords are rejected outside mock development mode.
- `SESSION_SECRET` signs organizer sessions. It is never logged, returned by `/api/meta`, or sent to the browser. Rotate it through the deployment secret store and restart the process.
- Back up the SQLite database before rehearsal and event operations. A restart preserves mock state and lazily completes due transitions on the next read; it does not replace a database backup.

### SQLite backup and restore (rehearsed 19 Oct 2026)

1. Stop the application process (`next start`) so no writer holds the database.
2. Copy all three SQLite files together: `<DB_PATH>`, `<DB_PATH>-wal`, and `<DB_PATH>-shm`. Copying only the main file can lose committed-but-uncheckpointed rows.
3. Store the three-file set as one backup unit.
4. To restore: stop the process again, replace all three live files with the backup set (discard the live `-wal`/`-shm`), and restart.
5. Verify after restart: team count, audit row count, lifecycle states, and that `/api/meta` still reports the expected adapter (`mock` / `SIMULATED`).

This procedure was rehearsed on a temporary, explicitly named test database (`data/r7-rehearsal.db`) during the R7 release-candidate pass; the post-backup state change was reverted by the restore and the temporary files were removed afterwards.
- Do not change adapter mode during an event. If external integration is unavailable, keep the known-good `SIMULATED` release and state the limitation plainly.

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
