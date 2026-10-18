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
npm run seed
npm run dev
```

Open `http://localhost:3000`. Demo seed passwords require explicit opt-in:

```powershell
$env:ALLOW_DEFAULT_PASSWORDS = "true"
npm run seed
```

The seed script creates 24 teams with five services each. Use `npm run reset-demo` to restore the deterministic demo state.

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
