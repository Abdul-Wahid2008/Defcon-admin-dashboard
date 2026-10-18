# 01 — MASTER BLUEPRINT: DEFCON Control Center

| Field | Value |
|---|---|
| Project | DEFCON Control Center (Admin Dashboard + Team Environment Control Panel) |
| Event | DEFCON 2.0, Technozion, NIT Warangal (hosted by the ham arc club) |
| Owner / sole developer | Abdul Wahid |
| Blueprint version | 1.1 — updated 17 Oct 2026 after reviewing BUILD_STATUS, the registration site and the club group-chat messages (see `09_CHANGELOG`) |
| Source spec | DEFCON 2.0 System Requirements, Diagram-First Edition, v1.2 (13 Oct 2026) |
| Deadline | Within 5 days of 17 Oct 2026. Planning assumption: **Day 1 = Sat 17 Oct, feature freeze = end of Day 4 (Tue 20 Oct), rehearsal and fixes = Day 5 (Wed 21 Oct), Thu 22 Oct = emergency buffer.** Replace with the real date as soon as it is confirmed. |
| Status of club backend | Not built yet. This project therefore ships its own mock backend (see §7). |

Read order for any AI session: `00 PROJECT_INSTRUCTIONS` → `BUILD_STATUS.md` (repo `docs/`) → this file → `02_SPEC_DIGEST` → the file relevant to the task (`03` API, `04` data and rules, `05` UI, `06` plan, `07` playbook, `08` tests/demo, `09` changelog for what changed since v1.0).

---

## 1. Mission

Build the **organizer-facing control surface** of DEFCON 2.0: one web application through which DEFCON organizers manage all 20–30 competing teams and their isolated environments — create and edit teams, issue and rotate participant credentials, start/stop/reset/delete environments, see service health, and review an append-only audit log — with safe, permission-aware, confirmed actions.

It must run end-to-end **today** against a built-in, honestly-labelled simulated backend, and be structured so the club's real orchestrator can be plugged in later by replacing exactly one module (the adapter).

## 2. Context and constraints

- **Event.** DEFCON 2.0 is a hacking competition. Teams get one container each (attack tools such as Nmap and Netdiscover plus vulnerable web/network services) and attack each other's intended targets. Scoring is attack-only with dynamic flags. Participants reach their container through a browser terminal using organizer-issued credentials.
- **Expected scale (spec):** 20–30 teams, 80–100 simultaneous participants, one container per team.
- **Event format (club registration site, informal):** "a 4 hour attack-defense cyberwarfare competition" (tagline RECON | BREACH | EXPLOIT). Implication: this console is likely to be **operated live for about four hours**, not only demoed. A simulation alone cannot run that (see D15, A19, §7.5).
- **Club working decisions (WhatsApp group, 11–13 Oct, informal — see `02 §11`):** 5–6 vulnerable services per team in three difficulty tiers; a centralised `checker.py` per service plants and checks flags; each team gets an `attackbox` container exposing a browser terminal through `ttyd` on port 7681, reached via a Cloudflare quick tunnel (docker-compose). Several of these conflict with spec v1.2 and need club confirmation (A15–A19).
- **This project's slice (spec page 1 and page 2):** "Admin dashboard — Teams • credentials • status • lifecycle" and the Admin + orchestrator responsibility "Create/update/delete teams, manage credentials, provision environments and execute lifecycle actions".
- **Not this project:** the orchestrator, the browser-terminal gateway, the game server / health-check engine, flag validation and scoring, patch capture and rollback. Other people own those. We *display and trigger* things related to them; we do not implement them.
- **Team size:** one developer.
- **Time:** 5 days. Every decision below optimises for "working, honest, demonstrable" over "complete".
- **Tooling:** Claude Code primary; free fallbacks and local Ollama (RTX 4060 8 GB VRAM, 24 GB RAM) — see `07`.
- **Machine unknowns:** the club's server capacity is unverified (spec page 2). The dashboard must therefore run comfortably on a laptop and on a modest server.

## 3. Source-of-truth hierarchy

When documents disagree, the higher one wins:

1. **The DEFCON 2.0 spec v1.2** (PDF and `02_SPEC_DIGEST`). Only the spec decides what DEFCON requires.
2. **Written decisions from the club's technical lead** (record them in `01 §6` the moment you get them).
3. **Club group-chat messages** — informal; treat as strong hints and label them *unconfirmed* until the lead confirms (logged in `02 §11`).
4. **This blueprint** and the files it references.
5. **Claude's suggestions.**

Never invent a spec requirement. If something is not in the spec, it is an **assumption** (§6) and must be labelled as such everywhere it appears (code comments, UI copy, docs).

## 4. Scope

### 4.1 Priorities

| Pri | Meaning | Items |
|---|---|---|
| **P0** | Must exist for the demo to be valid | F1 Auth + roles · F2 Team directory (list/search/filter) · F3 Create/edit team · F4 Team detail page · F5 Lifecycle actions (start/stop/reset/delete) with confirmations · F6 Audit log (append-only, filterable) · F7 Overview dashboard · F8 Simulated adapter with state machine · F9 SIMULATED/LIVE badge |
| **P1** | Should exist; cut only if behind | F10 Participant credential issue/rotate/revoke with one-time reveal + CSV · F11 Account status (active/suspended) · F12 Health detail per service (reachability + functional) · F13 Alerts feed · F14 Resource usage bars · F15 Idempotency + 409 in-progress handling · F16 Demo controls (fault injection) · F18 Audit CSV export (promoted: post-event review of a 4-hour run) · F24 Terminal endpoint display |
| **P2** | Only if everything else is done | F17 Bulk start/stop with typed confirmation (first in stretch order: start-all/stop-all is how a real 4-hour event is opened and closed) · F23 CSV import of registered teams · F19 Competition status label · F20 Playwright E2E · F21 `DockerComposeAdapter` (experimental, **gated** — see §7.5 and D15) · F22 Keyboard shortcut palette |

### 4.2 Explicitly out of scope

Docker orchestration from scratch (except the optional F21), the terminal gateway, flag/scoring engine, patch capture/rollback logic, real telemetry pipelines, a participant-facing UI, vulnerable-service UIs (e.g. the DocuVault UI requested in the group chat), a leaderboard, email/SMS notifications, multi-tenant support, mobile layouts, i18n, dark/light toggle (dark only), user self-registration, password reset flows.

### 4.3 Acceptance criteria (the contract with yourself)

The project is **done** when all P0 criteria pass on the machine that will run the demo:

- **AC-01** An organizer can log in; a wrong password is rejected; unauthenticated API calls return 401.
- **AC-02** The directory shows all seeded teams, with working search (name or id) and filters (lifecycle state, health, account status).
- **AC-03** Creating a team assigns a sequential team ID (`team-NN`), provisions a simulated environment, and shows participant credentials **exactly once**.
- **AC-04** Editing a team's name/notes/account status persists and writes an audit entry.
- **AC-05** The team detail page shows lifecycle state, health, services with both check types, resource usage, accepted patch version, participants, and this team's recent audit entries.
- **AC-06** Start, stop, reset and delete each require their own confirmation dialog; delete requires typing the team name.
- **AC-07** After confirming, the UI shows an in-progress state, then the real final state from the API — never a success toast before the backend says so.
- **AC-08** A forced failure (demo control) produces a visible failure toast, a `failed` lifecycle state, an alert, and a failure audit row.
- **AC-09** An `organizer_operator` cannot delete teams or use admin-only features, in the UI (hidden/disabled with reason) **and** at the API (403 + a `denied` audit row).
- **AC-10** Audit log rows cannot be edited or deleted through any API or by SQL (trigger blocks it).
- **AC-11** Overview numbers equal the directory numbers at all times (single source of truth).
- **AC-12** A permanent header badge shows `SIMULATED` (amber) when the mock adapter is active and `LIVE` (green) only when the real adapter is active.
- **AC-13** Vitest suite for state machine, permissions, idempotency and audit immutability passes.
- **AC-14** The scripted 3-minute demo (`08`) runs twice in a row without intervention after `npm run seed`.
- **AC-15** No plaintext password is ever stored, logged, or returned after creation/rotation.
- **AC-16** Every non-deleted environment shows its **five manifest services** (D14) with both check types in a compact table, with no layout break at 1280 px; placeholder services carry a visible "placeholder" chip.
- **AC-17** The team detail page shows the **terminal endpoint** (a fake `.invalid` URL in mock mode, marked simulated) with a copy button, only when the environment is running; the URL never appears in lists, tiles, audit details or logs.

P1/P2 criteria are tracked in `06`.

## 5. Key decisions

| ID | Decision | Why | What would reverse it |
|---|---|---|---|
| D1 | Single Next.js (App Router, TypeScript) app: UI **and** API route handlers | One repo, one process, one deploy; fastest for one person + AI | Club insists on separate backend → keep route handlers as a thin proxy to their API |
| D2 | **Adapter pattern.** UI → `/api/*` → service layer → `EnvironmentAdapter` (`MockAdapter` now, `RealAdapter` later) | Real integration later = replace one module | None; this is the core design |
| D3 | The mock is a **real state machine with persistence (SQLite)**, not static JSON | Buttons really change state; audit really accumulates; survives restart | n/a |
| D4 | Async transitions resolve **lazily** by timestamps (`pending_ends_at`) on every read, not by background timers | Timers die with serverless/dev reloads; lazy resolution is deterministic and testable | A long-running Node server with a job queue is available |
| D5 | Dark navy "security operations console" look; shadcn/ui + Tailwind | Fast, consistent, impressive | n/a |
| D6 | TanStack Query polling every 5 s (2 s while any transition is pending) | Looks live, trivially robust | WebSocket/SSE if backend offers events |
| D7 | Server-side permission checks on every route; UI hiding is only a convenience | Spec requires restricted privileges; frontend alone cannot enforce them | n/a |
| D8 | Audit log is **append-only**; two rows per async action (`requested`, then `success`/`failure`) linked by `correlation_id` | Append-only forbids updating a row from pending to done | Real backend provides its own audit stream |
| D9 | Delete = archive team record + remove environment resources; audit and score-like records are retained | Spec keeps audit and history persistent; "delete" removes assigned resources | Club says delete must purge everything (see A6) |
| D10 | Reset keeps the environment's persistent categories untouched and returns it to the **latest accepted patch** | Spec page 4 and 5 | n/a |
| D11 | `team` role exists in the permission model and tests (own-environment reset), but there is **no participant UI** | Spec distinguishes team vs organizer permissions; participants use the terminal gateway, not this app | Club wants a team self-service page |
| D12 | SQLite via `better-sqlite3`; passwords with `bcryptjs`; sessions with signed JWT cookie via `jose` | Zero infrastructure; pure-JS fallbacks exist | Install problems → see `07` fallback |
| D13 | No Supabase, no external services, no network calls at runtime | Event Wi-Fi is unreliable; fewer moving parts | n/a |
| D14 | Services are **data-driven** from a manifest (`src/lib/server/adapters/mock/services.manifest.ts`): key, name, port, `placeholder`. Five entries by default | Group chat says 5–6 services per team; names and ports are not final | n/a |
| D15 | `DockerComposeAdapter` (F21) is **conditional**: decision gate G1 at the end of Day 3; built on Day 4 only if P0 is green and the club has no orchestrator committed. While it is active the badge reads `PARTIAL` | A 4-hour live event cannot be run from a simulation | The club delivers an orchestrator → use `RealAdapter` instead |

## 6. Assumptions (must be confirmed with the club — label them wherever used)

| ID | Assumption | Impact if wrong |
|---|---|---|
| A1 | "Start" exists as the inverse of "Stop" (spec only names stop/reset/delete; stop "retains environment") | Remove start button |
| A2 | After a reset the environment ends in `running` | Adjust transition table |
| A3 | Reset is allowed from `running` and `failed`, not from `stopped` | Allow from `stopped` too |
| A4 | Each team has several participants, each with an individual credential for the browser terminal (spec: "Organizer-issued credentials"; granularity not specified) | Fallback with zero schema change: model the team login as **one participant** named `Team login` (see A16) |
| A5 | Default team size for seed/create form = 4 participants (80–100 users ÷ 20–30 teams ≈ 3–5) | Change default |
| A6 | Deleting a team keeps its audit history and score/submission records (archived, not purged) | Hard-delete everything but audit |
| A7 | Soft cap of 30 teams: creating the 31st shows a warning, not a block (spec says "20–30 expected") | Hard cap |
| A8 | Health = derived from two check types per service: *reachability* (stopped/unreachable) and *functional* (workflow test), per spec page 3; the verdicts come from the per-service checker (A17) | n/a |
| A9 | **Five** services per environment in the mock (group chat: "5–6 services"). Seed manifest: `docuvault` (exists in the club repo), `funsplash` (in progress), plus three clearly-labelled placeholders; all ports are placeholders. The real list comes from the challenge catalogue (unresolved in spec) | Data-driven: edit `services.manifest.ts` only |
| A10 | Mock resource limits (CPU 1.0, memory 1024 MB, processes 256, storage 2048 MB) are placeholders; spec only says limits exist | Replace with real limits |
| A11 | Mock durations: provision 6 s, start 3 s, stop 2 s, reset 5 s, delete 3 s | Cosmetic |
| A12 | Organizer roles: `organizer_admin` (everything) and `organizer_operator` (no delete, no settings, no demo controls) | Collapse to one role |
| A13 | Reset dialog states that anything not captured in an accepted patch is discarded `[CONFIRM WITH CLUB]` | Edit dialog copy |
| A14 | When the real backend exists, the dashboard still keeps its own audit of *organizer actions*; the orchestrator's deployment/rollback history is shown read-only when available | Single audit source |
| A15 | Terminal access (group chat 13 Oct): each team's `attackbox` runs `ttyd` on port 7681 behind a Cloudflare quick tunnel; the dashboard displays the terminal URL per environment (quick-tunnel URLs are random and change on every restart). Spec v1.2 instead describes an authenticating browser-terminal gateway | Hide or replace the terminal field |
| A16 | `ttyd` basic auth (`-c user:pass`) is per instance, so terminal credentials are likely **one per team**, not per participant. The compose snippet in the chat shows `ttyd -W` with **no** credentials, which would give anyone holding the URL a writable shell and contradicts the spec's authenticated, team-scoped sessions | If a real gateway exists, per-participant credentials stand |
| A17 | Health checks are produced by the centralised per-service `checker.py`. Assumed enowars-style verdicts: OK → pass; OFFLINE → reachability fail; MUMBLE → functional fail; INTERNAL_ERROR → unknown (checker fault, not a team fault). Their custom checker may differ — verify | Adjust the mapping in `04 §4.1` |
| A18 | Topology is unclear: spec says one container per team; the pasted compose shows `attackbox` + a `cloudflared` container, and the vulnerable services' placement is not stated. The dashboard treats an "environment" as one logical unit with N services | Lifecycle semantics may need per-container detail |
| A19 | The console will be used **live** during the 4-hour event, not only demoed, so once P0 is green real control matters more than polish | n/a |

## 7. Architecture

### 7.1 Layers

```
┌──────────────────────────────────────────────────────────┐
│ Browser: React UI (App Router pages, shadcn, TanStack Q) │
└───────────────┬──────────────────────────────────────────┘
                │ fetch /api/*  (JSON, cookie session)
┌───────────────▼──────────────────────────────────────────┐
│ Route handlers (thin): parse + zod validate + call service│
├──────────────────────────────────────────────────────────┤
│ Service layer: authN, authZ (can()), validation rules,    │
│ idempotency, audit writes, error mapping, adapter sync    │
├──────────────────────────────────────────────────────────┤
│ EnvironmentAdapter (interface)                            │
│   ├─ MockAdapter  → SQLite state machine  (DEFAULT)       │
│   └─ RealAdapter  → club orchestrator API (LATER)         │
├──────────────────────────────────────────────────────────┤
│ SQLite (app tables: users, audit_log, idempotency,        │
│ settings; mock tables: teams, participants, environments, │
│ services, checks, alerts)                                 │
└──────────────────────────────────────────────────────────┘
```

Hard rules: UI never imports from `lib/server/*`. Only the service layer touches the adapter. Only `MockAdapter` touches mock tables. Only `lib/server/db` opens SQLite.

### 7.2 Adapter interface (TypeScript, canonical)

```ts
export type LifecycleAction = 'start' | 'stop' | 'reset' | 'delete';

export interface EnvironmentAdapter {
  readonly mode: 'mock' | 'real' | 'docker-compose';

  // teams
  listTeams(q: TeamQuery): Promise<Page<TeamSummary>>;
  getTeam(teamId: string): Promise<TeamDetail | null>;
  createTeam(input: CreateTeamInput): Promise<{ team: TeamDetail; credentials: IssuedCredential[]; completionDueAt: string }>;
  updateTeam(teamId: string, patch: UpdateTeamInput): Promise<TeamDetail>;

  // participants + credentials (plaintext only ever returned here, once)
  addParticipant(teamId: string, name: string): Promise<{ participant: Participant; credential: IssuedCredential }>;
  removeParticipant(teamId: string, participantId: string): Promise<void>;
  rotateCredentials(teamId: string, participantId?: string): Promise<IssuedCredential[]>;

  // lifecycle (async by nature)
  requestAction(teamId: string, action: LifecycleAction, ctx: { correlationId: string }):
    Promise<
      | { kind: 'accepted'; from: LifecycleState; to: LifecycleState; startedAt: string; estimatedEndsAt: string }
      | { kind: 'noop'; reason: string }
    >;

  // health
  runHealthChecks(teamId: string): Promise<HealthSnapshot>;

  // aggregates
  getOverviewData(): Promise<OverviewData>;
  listAlerts(q: { status?: 'open' | 'resolved'; limit?: number }): Promise<Alert[]>;

  // lazy resolution: finish any transitions whose time has come and report them
  resolveDue(): Promise<CompletedTransition[]>;
}
```

`requestAction` throws typed errors: `NOT_FOUND`, `INVALID_TRANSITION`, `ACTION_IN_PROGRESS`. The service layer maps them to HTTP (see `03`).

### 7.3 Request flow — "Reset team-07" (reference sequence)

1. UI opens the reset dialog, user confirms → `POST /api/teams/team-07/environment/reset` with `Idempotency-Key`.
2. Route handler: session → `can(user,'env.reset')` (403 + `denied` audit row if not) → idempotency lookup (replay stored response if key seen).
3. Service calls `adapter.requestAction`. Mock: checks transition table, sets `pending_action='reset'`, `lifecycle_state='resetting'`, `pending_ends_at = now + 5 s`.
4. Service appends audit row `env.reset / outcome=requested / correlation_id=C`, stores idempotent response, returns **202** with transition info.
5. UI shows the team as `resetting` (progress state) and polls every 2 s.
6. Any later read calls `service.sync()` → `adapter.resolveDue()`; due transitions finish: `lifecycle_state='running'`, accepted patch unchanged, checks refreshed, `pending_*` cleared. The service appends audit row `env.reset / success|failure / correlation_id=C / ts=pending_ends_at`.
7. UI sees `pending=null`, shows the success (or failure) toast based on the **final state it read**, invalidates overview, audit and alerts queries.

### 7.4 Real adapter (what the club must expose later)

For `RealAdapter` to work the orchestrator needs endpoints equivalent to: list/create/update/delete teams; provision/start/stop/reset/delete environment with a job id or polling status; per-service check results (reachability + functional) with timestamps; resource usage; participants and credential issue/rotate; accepted patch version and deploy history (read-only). `03` lists the shapes we consume. Give that page to the club's backend developers on Day 1 — it is also what makes them agree on a contract.

### 7.5 Optional `DockerComposeAdapter` (F21, experimental, gated by G1)

**Why it exists.** The event is a 4-hour live competition. A simulation cannot start, stop or recover real team environments. If the club has no orchestrator by the end of Day 3 and P0 is green, this adapter gives organizers *real* start/stop/delete and reachability probes for the group's own packaging (one compose project per team, per the 13 Oct group message). If the club delivers an orchestrator, use `RealAdapter` instead and drop this.

| Capability | Implementation | Honest limitation |
|---|---|---|
| Provision | Render `teams/<teamId>/docker-compose.yml` from a club-supplied template, then `docker compose -p <teamId> up -d --build` | Templates and images come from the club; we do not write services |
| Start / Stop | `docker compose -p <teamId> start` / `stop` | — |
| Reset | `docker compose -p <teamId> down` (never `-v`), then `up -d` | **Does not restore the latest accepted patch** (no patch store in our scope). UI label: "Restart (patch restore not available)"; badge stays `PARTIAL` |
| Delete | `docker compose -p <teamId> down -v` after typed confirmation | Volumes are removed; our audit stays |
| Reachability | TCP connect to each service port and to ttyd 7681, 2 s timeout → failure = reachability fail | Functional check stays `unknown` until the club's `checker.py` verdicts can be read |
| Terminal URL | Parse the tunnel container's logs for the quick-tunnel URL | Changes on every (re)start; may be missing for several seconds after start; Cloudflare documents quick tunnels as a testing feature, so verify its limits before relying on 20–30 of them for four hours |
| Resource usage | `docker stats --no-stream` (optional) | Nice-to-have |

**Security rules (non-negotiable).** `execFile('docker', [...args])` with argument arrays only — never a shell string. Validate team IDs against `^team-\d{2}$` before any command. The dashboard process needs Docker access, which is root-equivalent on the host: run it only on the organizer machine, never on a participant-reachable network. This is consistent with the spec: participants and team containers never get Docker access (spec p2); only the control plane does.

**Gate G1 (end of Day 3).** Build it only if (a) P0 acceptance criteria are green or nearly so, (b) the club has no orchestrator committed for the event date, and (c) the club lead agrees compose-per-team is what will actually run. Time-box 3 hours on Day 4; if it does not work end-to-end by the freeze, drop it and ship simulated.

## 8. Technology

| Concern | Choice | Notes |
|---|---|---|
| Runtime | Node.js LTS (20+) | Check `node -v` |
| Framework | Next.js (latest stable), App Router, TypeScript strict | Scaffold with `create-next-app`; do not hand-pin versions in docs |
| Styling | Tailwind CSS + shadcn/ui | Components copied into repo |
| Data fetching | TanStack Query | Polling, cache invalidation |
| Validation | zod | One schema per request/response; types inferred |
| DB | SQLite via `better-sqlite3` | Fallback in `07` |
| Auth | `jose` (JWT in httpOnly cookie) + `bcryptjs` | No OAuth |
| Charts | Recharts | Donut for states, small sparkline optional |
| Icons | lucide-react | |
| Toasts | shadcn `sonner` | |
| Tests | Vitest (P0); Playwright (P2) | |
| Lint/format | ESLint (from scaffold), Prettier optional | |

Do **not** use: Supabase, Firebase, Prisma (extra generate step), Redux, any UI kit besides shadcn, WebSockets (D6), localStorage for state that matters, CDN fonts at runtime (use `next/font`, which self-hosts at build).

## 9. Repository structure

```
defcon-control-center/
├─ CLAUDE.md                     # repo rules for Claude Code
├─ AGENTS.md                     # same content, for other tools
├─ docs/                         # copy of files 01–08 + the spec PDF
├─ .env.example
├─ package.json
├─ src/
│  ├─ app/
│  │  ├─ (auth)/login/page.tsx
│  │  ├─ (console)/layout.tsx            # sidebar + topbar + providers
│  │  ├─ (console)/overview/page.tsx
│  │  ├─ (console)/teams/page.tsx
│  │  ├─ (console)/teams/[teamId]/page.tsx
│  │  ├─ (console)/audit/page.tsx
│  │  ├─ (console)/settings/page.tsx     # P2
│  │  └─ api/…                           # route handlers, mirror 03_API_CONTRACT
│  ├─ components/
│  │  ├─ ui/                             # shadcn generated
│  │  ├─ layout/ (Sidebar, Topbar, AdapterBadge)
│  │  ├─ status/ (StateBadge, HealthBadge, CheckRow, ResourceBar)
│  │  ├─ teams/ (TeamsTable, TeamFilters, CreateTeamDialog, EditTeamSheet, ParticipantsPanel, CredentialsRevealDialog)
│  │  ├─ actions/ (ActionBar, ConfirmActionDialog, DeleteTeamDialog)
│  │  ├─ overview/ (StatCards, StateDonut, HealthGrid, AlertsFeed, RecentActivity)
│  │  └─ audit/ (AuditTable, AuditFilters)
│  ├─ lib/
│  │  ├─ schemas/                        # zod: types shared by client and server
│  │  ├─ api-client.ts                   # typed fetch wrappers + error class
│  │  ├─ queries.ts                      # TanStack hooks
│  │  ├─ format.ts                       # dates, bytes, relative time
│  │  ├─ config.ts                       # durations, caps, polling intervals
│  │  └─ server/                         # server-only (import 'server-only')
│  │     ├─ db.ts  migrate.ts  seed.ts
│  │     ├─ auth.ts  permissions.ts
│  │     ├─ audit.ts  idempotency.ts  errors.ts
│  │     ├─ services/ (teams.ts, lifecycle.ts, credentials.ts, overview.ts, audit.ts)
│  │     └─ adapters/ (types.ts, index.ts, mock/ incl. services.manifest.ts, real/…, docker-compose/ [F21, gated])
│  └─ middleware.ts                      # session gate for /api/* and pages
├─ scripts/ (seed.ts, reset-demo.ts)
└─ tests/ (state-machine.test.ts, permissions.test.ts, idempotency.test.ts, audit.test.ts, api.test.ts)
```

## 10. Configuration (`.env.example`)

```
# Adapter
ADAPTER=mock                       # mock | real
REAL_ORCHESTRATOR_URL=             # only when ADAPTER=real
REAL_ORCHESTRATOR_TOKEN=

# Auth
SESSION_SECRET=change-me-32+chars
ORGANIZER_ADMIN_USERNAME=admin
ORGANIZER_ADMIN_PASSWORD=change-me
ORGANIZER_OPERATOR_USERNAME=operator
ORGANIZER_OPERATOR_PASSWORD=change-me

# Mock behaviour
SEED_TEAMS=24
DEMO_CONTROLS=true                 # enables /api/_demo/* and the demo panel (admin only, mock only)
MOCK_DURATION_SCALE=1              # multiply all simulated durations (use 0.5 to speed up)
DB_PATH=./data/defcon.sqlite
```

Production/demo hardening: the seed script refuses to run with default passwords unless `ALLOW_DEFAULT_PASSWORDS=true`; secrets are never committed (`.env*` in `.gitignore`).

## 11. Roles and permissions (summary — full matrix in `04`)

`organizer_admin`: everything. `organizer_operator`: read, create/edit teams, start/stop/reset, credentials, audit read; **no** team delete, no settings, no demo controls. `team`: read and reset **own** environment only (modelled and unit-tested; no UI). Every denied attempt is audited with `outcome=denied`.

## 12. Lifecycle summary (full table in `04`)

`provisioning → running ⇄ (stopping → stopped → starting)`; `running|failed → resetting → running`; `running|stopped|failed → deleting → deleted`; any failed transition → `failed`. Stop **retains** the environment; reset **restores latest accepted patch** and preserves the five persistent categories; delete **removes assigned resources**. The three are distinct controls with distinct dialogs (spec page 5).

## 13. Security requirements

- Passwords (organizer and participant): bcrypt hash, cost ≥ 10. Participant passwords generated server-side with `crypto.randomInt` over an unambiguous alphabet (no `0O1lI`), 12 chars; shown once.
- Session cookie: `httpOnly`, `SameSite=Lax`, `Secure` when served over HTTPS, 8 h lifetime.
- All mutating routes require `Content-Type: application/json` and a same-origin `Origin` header (basic CSRF defence).
- Login rate limit: 5 failures per 5 min per IP+username → 429 for 60 s. Failed logins are audited (`auth.login_failed`).
- Every route: authenticate → authorize → validate (zod) → act → audit. No exceptions.
- Audit table is append-only via SQLite triggers; no API exposes update/delete.
- Never log request bodies containing passwords; scrub `password`, `plaintext`, `token` keys in any logger.
- No secrets in client bundles; server-only modules use `import 'server-only'`.
- Bind the demo server to the LAN only; do not expose it to the public internet (spec: the control plane must not be reachable by participants — run it on a network participants cannot reach, or at minimum behind the login).
- Never deploy the dashboard to a public free host (Render, Cloudflare Workers, etc.) or behind a public quick tunnel: the registration site and the control plane are different trust levels.
- Terminal URLs are secrets (anyone holding one may get a shell if the club runs `ttyd` without credentials): show them only on the team detail page, never in lists, tiles, audit `details`, logs or CSV exports.
- If F21 is built: no shell strings, team ID regex check, dashboard host = organizer machine only (see §7.5).
- Demo-only endpoints return 404 unless `DEMO_CONTROLS=true` **and** `ADAPTER=mock` **and** the user is `organizer_admin`.

## 14. Honesty rules (non-negotiable)

1. The header badge is driven by `GET /api/meta` (`adapter`), never hard-coded. Values: `SIMULATED` (mock), `PARTIAL` (a composite of real and mock calls; tooltip lists what is real), `LIVE` (every environment-affecting call is real and tested).
2. In `mock` mode every environment-affecting screen carries the badge; the demo script says "simulated" out loud.
3. Never claim control of real containers until `RealAdapter` has been run against a real orchestrator and tested (AC-12 + a recorded test).
4. Success toasts appear only after the final state is read from the API. Failures are shown, logged, alerted, and audited.
5. Mock-only numbers (limits, durations, resource usage) are labelled in code with `// MOCK` and in UI tooltips when shown.
6. Terminal URLs in mock mode are fake placeholders on the reserved `.invalid` TLD and are visibly marked simulated.

## 15. UX states required on every data view

Loading (skeleton), empty (explain + primary action), error (message, retry, request id), forbidden (explain which role is needed), stale (small "updated Ns ago" timestamp). Details in `05`.

## 16. Non-functional requirements

- Supports 30 teams and ≥ 5 concurrent organizer browsers; every list endpoint paginates (default 25, max 100); overview endpoint answers in < 200 ms on a laptop for 30 teams.
- Desktop-first (≥ 1280 px wide), usable at 1024 px. Latest Chrome/Edge/Firefox. Mobile not required.
- Accessibility baseline: status never conveyed by colour alone (icon + label), focus-visible rings, dialog focus trapping (shadcn/Radix default), contrast ≥ 4.5:1 for text.
- Time displayed in the browser's local zone with an ISO tooltip; the server stores UTC ISO-8601.
- Must run **at least 4 hours continuously without restart** (live event). Soak-test: two browsers on `/overview` for 60 minutes; flat memory, no console errors (see `08 §2.2`). SQLite in WAL mode; no unbounded in-memory caches.

## 17. Risks

| Risk | L | I | Mitigation |
|---|---|---|---|
| 5-day deadline slips | H | H | Cut order in `06`; daily exit checks; feature freeze end of Day 4 |
| AI usage limit hit mid-build | M | H | Repo-held docs + `AGENTS.md`; fallback tool chain in `07`; small vertical slices; commit often |
| `better-sqlite3` fails to install (Windows/Node mismatch) | M | M | `07` fallback: `node:sqlite` or `sql.js`; the db module is the only importer |
| Club backend appears late and mismatches | M | M | Contract doc to them Day 1; adapter isolates the change |
| Demo-day hardware/network issue | M | H | Local build, seeded data, recorded video backup, screenshots |
| Over-claiming "live control" | L | H | Honesty rules §14 |
| Scope creep (leaderboard, terminal) | H | M | §4.2 is law |
| Permission bug leaks admin action to operator | M | H | Server-side `can()` + tests AC-09/AC-13 |
| Simulated-only dashboard cannot run the live 4-hour event | H | H | Gate G1 / D15: ask who builds the orchestrator now; real adapter or `DockerComposeAdapter` on Day 4 |
| Club's terminal design (`ttyd -W` via public quick tunnels, no credentials) breaks spec's authenticated, team-scoped terminal and exposes shells to anyone with a URL | M | H | Raise with the lead now; recommend at least `ttyd -c` credentials and treating tunnel URLs as secrets; dashboard never publishes them |
| Pulled into side tasks from the group chat (DocuVault UI, service building, registration site) | H | M | §4.2 is law; the deadline is for the console |
| Topology and checker interface differ from A17/A18 | M | M | Adapter + manifest isolate the change; ask the lead early |

## 18. Open questions for the club (send on Day 1)

1. Exact demo/deadline date and time, and who is the audience?
2. Is any orchestrator API planned? If yes, by when, and may we propose the contract in `03`?
3. Confirm A1–A19 (especially A4 credentials granularity, A6 delete semantics, A13 reset wording).
4. Is the dashboard reachable only from the organizer network?
5. Which services/challenges will each team environment expose (to replace A9)?
6. Real values for resource limits, health-check interval, idle-session timeout (spec: TBD).
7. Is there a spec newer than v1.2 (the group chat contains decisions dated after 13 Oct)?
8. Topology: one container per team (spec) or `attackbox` + tunnel + separate service containers (compose snippet)? Where do the vulnerable services run?
9. Terminal access: raw `ttyd` behind quick tunnels, or an authenticating gateway? Credentials per team or per participant (A16)?
10. Who is building the orchestrator/launcher, by when, and may we ship the experimental `DockerComposeAdapter` (§7.5) if nothing exists by Day 4?
11. Can the registration system export registered teams (columns/format) so F23 can import them?
12. Is `checker.py` enowars-style (OK / MUMBLE / OFFLINE / INTERNAL_ERROR), and can the dashboard read its latest verdict per team and service?

## 19. Glossary

**Environment** — a team's single container with tools and vulnerable services. **Accepted patch** — latest validated application version of a team's code; reset restores it. **Adapter** — module that talks to the thing that really owns environments. **Correlation ID** — links the `requested` and completion audit rows of one action. **Lifecycle state** — where the environment is in the state machine. **Health** — derived from service checks, separate from lifecycle. **Persistent categories** — flags and challenge state, scores and submissions, accepted patches, audit and deployment history, application data. **Attackbox** — the club's name for the team container that holds attack tools and the browser terminal (`ttyd`). **Checker** — the per-service `checker.py` that plants flags, retrieves them and runs functional checks; its verdicts feed our health model. **Service manifest** — the data file listing the services every environment has (D14).

## 20. Definition of done for each Claude/AI task

Code compiles with `tsc --noEmit`; lint clean; related Vitest tests pass; no new dependency without a reason in the commit message; no TODO left in P0 paths; the changed screen checked in the browser at 1280 px; a git commit with a message in the form `feat(teams): …`.
