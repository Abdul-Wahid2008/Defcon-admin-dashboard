# 02 — SPEC DIGEST: DEFCON 2.0 System Requirements (v1.2, 13 Oct 2026)

This is a faithful digest of the club's six-page "Diagram-First Edition" spec, reorganised for the dashboard builder. **Upload the original PDF to the project as well; where this digest and the PDF differ, the PDF wins.** Nothing here is invented: items marked **TBD / UNRESOLVED** are unresolved in the spec and must not be filled with guessed values except as clearly-labelled assumptions (see `01 §6`).

## 1. Headline numbers (page 1)

| Item | Spec statement |
|---|---|
| Teams | 20–30 expected |
| Simultaneous users | 80–100 target |
| Containers | 1 container per team, containing tools + vulnerable services |
| Terminal | Browser terminal; organizer-issued credentials |
| Cross-team attacks | Only intended competition targets |
| Scoring | Attack-only; dynamic flags; points by difficulty |

## 2. System at a glance (page 1)

Three planes:

- **Control plane:** Organizers → **Admin dashboard (Teams • credentials • status • lifecycle)** → Backend + orchestrator (Authorization • Provision • reset • delete) → Team environments (20–30 containers; each: attack tools + vulnerable web/network services). *Our project is the Admin dashboard box.*
- **Participant access:** Participants (80–100 concurrent) → Browser-terminal gateway (authenticate • authorize • open assigned session) → Assigned team container (terminal session scoped to one team).
- **Game operations:** Team services (web + network challenge services) → Game server (health checks, functional tests) → Flag validation + scoring (dynamic flags, difficulty-based points) → Persistent state (flags, scores, patches, logs, app data). Participants submit flags to validation.

**Key implementation constraint (page 1, amber box):** "Exactly one container per team at all times, same-container replacement, automatic rollback, and near-zero downtime must be reconciled before deployment implementation is finalized."

## 3. Architecture and network boundaries (page 2)

Component responsibilities:

| Component | Responsibility |
|---|---|
| **Admin + orchestrator** | Create/update/delete teams, manage credentials, provision environments and execute lifecycle actions. |
| Browser-terminal gateway | Authenticate sessions and restrict each participant to their assigned team. |
| Team containers | Attack tools and vulnerable web/network services; Nmap and Netdiscover are initial tools. |
| Competition networking | Allow attacks to intended other-team targets; block host, Docker daemon, control plane and unrelated external access. |
| Restricted privileges | No host privileges or Docker socket access. Apply per-team CPU, memory, process and storage limits. |
| Existing server | Hosting choice confirmed, but capacity is unverified until inspected and load-tested. |

Diagram facts: participants are "browser only"; the control plane (Admin API + database) is "protected"; host/Docker daemon is "never accessible to participants" (blocked).

## 4. Game server, flags and scoring (page 3) — *context only, not our scope*

Scheduled checks → health + functional tests (service reachability, application workflows) → record service status → **organizer dashboard shows service state + failures** (this is what we display).

| Topic | Spec |
|---|---|
| Health checks | Detect stopped or unreachable services. |
| Functional tests | Verify application workflows, not just open ports. |
| Fixed rotation | Flags rotate on a fixed schedule. |
| Target-specific flags | Unique per target and rotation period. |
| Validation | Reject expired flags and flags for the wrong target. |
| Duplicate protection | A flag scores at most once per attacking team. |
| Scoring | Attack-only: no points for patching or availability. Point values vary by difficulty; **exact values unresolved**. |

## 5. Patch capture, validation and rollback (page 4) — *context only*

Flow: direct code edits (permitted application workspace only) → automatic capture of workspace changes → validate candidate (health + functional tests) → pass: activate in the same container then post-deployment health check → healthy: accept patch (record version + audit result); unhealthy: automatic rollback (restore latest accepted patch, preserve state). Fail validation: reject candidate, keep latest accepted patch, do not replace live code.

Confirmed deployment behaviour:

| Topic | Spec |
|---|---|
| Direct changes | Teams edit permitted application files inside their container. |
| Automatic capture | Capture all permitted application-workspace changes into a candidate. |
| Same-container rule | Exactly one container must exist at all times; same-container replacement is selected. |
| Failure handling | Automatically roll back failed deployments and verify recovery. |
| **Reset baseline** | **Restore the latest accepted patch, not the original vulnerable baseline.** |
| Near-zero downtime | Target only; not yet guaranteed by the selected deployment constraint. |

"One-container constraint": candidate validation must not destroy the last accepted version; the exact mechanism for safe same-container validation and near-zero downtime **remains unresolved**.

## 6. State, lifecycle and operations (page 5) — **our core page**

**Team lifecycle:** Request (stop • reset • delete) → Authorization (**Team: own environment; Organizer: any team**) → one of:

- **Stop** — *Retain environment.*
- **Reset** — *Restore latest accepted patch.*
- **Delete** — *Remove assigned resources.*

**Persistent state — preserved across reset and rollback (five categories):**

1. Flags + challenge state — rotation and challenge progress
2. Scores + submissions — authoritative records of submissions and points
3. Accepted patches — recoverable accepted application versions
4. Audit + deployment history — actions, timestamps, validation and rollback outcomes
5. Application data — data required by service workflows

Plus: persistent storage + scheduled backups (**frequency / retention TBD**).

**Operational rules (verbatim in meaning):**

- Teams reset their own environment; organizers may reset any team, with **separate permissions**.
- **Reset, stop and delete are distinct.**
- Reset/rollback must preserve all five data categories.
- Idle terminal sessions expire automatically (**timeout TBD**).
- Health checks run automatically at a less-frequent interval (**interval TBD**).
- Container root privileges are restricted; host and Docker-daemon access are prohibited.

## 7. Unresolved questions (page 6) — never guess these

| Open item | Question |
|---|---|
| Deployment mechanism | How to validate a candidate and retain the last accepted version with exactly one container at all times while targeting near-zero downtime? |
| Existing server capacity | CPU, RAM, storage, network capacity, current workload? |
| Flag timing | Rotation interval; handling submissions at the rotation boundary? |
| Difficulty points | Point values for easy/medium/hard? |
| Operations | Idle-session timeout and health-check interval? |
| Backup policy | Frequency, retention, restore-test schedule? |
| Privilege escalation | How will privilege-escalation challenges work under the restricted-privilege policy? |
| Challenge catalogue | Exact challenges, targets, flags and functional tests per difficulty tier? |

## 8. The spec's own development suggestions (page 6)

Modular monolith first (one backend API + shared database, modules not microservices) · one team lifecycle state machine reused across admin UI, orchestrator, reset and monitoring · one standard team image with team settings injected at provisioning · one challenge manifest · single authoritative scorer with transactional duplicate protection · keep state (scores, flags, accepted patches, logs, durable app data) **outside disposable container state** · shared health-check framework (one scheduler, one test interface, one alert path) · **idempotent automation** (provision, reset, deploy and rollback safe to retry) · prototype one team end-to-end before scaling to 20–30 teams · measure before sizing (inspect hardware, set resource limits, load-test with 100 concurrent users).

## 9. Traceability: spec requirement → dashboard feature

| Spec requirement | Where it lands in our build |
|---|---|
| Admin dashboard: teams, credentials, status, lifecycle (p1) | F2–F6, F10, F12 |
| Create/update/delete teams (p2) | F3, F4, F5 (delete) |
| Manage credentials (p2) | F10 participants + credentials |
| Provision environments (p2) | Create-team flow → `provisioning` |
| Execute lifecycle actions (p2) | F5 start/stop/reset/delete |
| Organizer dashboard shows service state + failures (p3) | F7 overview, F12 service checks, F13 alerts |
| Health checks detect stopped/unreachable; functional tests check workflows (p3) | Two check types per service (A8) |
| Reset/stop/delete distinct (p5) | Three separate controls and dialogs |
| Team: own env; organizer: any team; separate permissions (p5) | Role model: `team` own-scope, organizers any (D11, A12) |
| Reset restores latest accepted patch; preserves five categories (p4, p5) | Reset semantics (D10), dialog copy, patch version shown |
| Audit + deployment history persistent (p5) | F6 append-only audit; read-only last-deploy info |
| Resource limits per team (p2) | F14 usage bars with limits (mock values A10) |
| Idempotent automation (p6) | F15 idempotency keys; safe retries |
| One lifecycle state machine (p6) | `04` state machine, reused by UI, API, mock |
| Control plane protected from participants (p2) | Security §13: login, LAN-only, no participant UI |
| Idle session expiry, health interval TBD (p5) | Shown as configurable constants; **not** invented values |

## 10. What the spec does NOT say (so we must not claim it)

The spec does not define: a "competition status" concept, a "start" action, per-participant vs per-team credentials, a leaderboard on the dashboard, resource-usage telemetry, team self-service UI, backup restore UI, or how delete treats scores. Anything we build in those areas is an **assumption** and is labelled as such.


## 11. Informal club decisions and inputs (NOT in spec v1.2) — label as *unconfirmed*

Sources reviewed on 17 Oct 2026: the club's registration site (`defcon2.fahadsyed0507.workers.dev`, read via a rendered fetch), and WhatsApp group messages pasted by Abdul (11–13 Oct). **Not opened:** the GitHub repos (`eveniota/HAM-DEFCON`, `Gal1lioDev/REGISTRATION`) and `defcon-ham-arc.onrender.com` (automated access blocked), and the ephemeral trycloudflare demo link. Anything about them below is only what the chat said.

| # | Date / source | Statement | Why it matters to the dashboard | Status |
|---|---|---|---|---|
| I1 | Registration site | "A 4 hour attack-defense cyberwarfare competition"; tagline RECON \| BREACH \| EXPLOIT | The console will be used live for ~4 h; reliability and real control matter (A19, D15) | Informal, from the club's own site |
| I2 | Group, 11 Oct | Flags are not put in services by plain POSTs: a **centralised `checker.py` per vulnerable service** knows how to place the flag; flags are sent to those checkers | Health/flag-placement verdicts originate there; our checks map to checker verdicts (A17) | Unconfirmed |
| I3 | Group, 11 Oct | Aim for **5–6 services** (not 7–8), because players may use AI; candidate services come from the enowars and saarctf archives and are to be reframed; testers need only Docker | Seed five services per team (A9, D14) | Unconfirmed |
| I4 | Group, 13 Oct | A service named DocuVault (`HAM-DEFCON/service-docuvault`) exists with **3 flags**; a volunteer UI for it was requested; another member is building `enowars10-service-funsplash` | Used only as seed service names; the UI request is **out of scope** for this project | Unconfirmed |
| I5 | Group, 13 Oct | Vulnerabilities in **3 difficulty categories** (easy / medium / hard): more easy, fewer medium, only a few hard; different points per category; each app gets a guidebook saying what the app is, no hints | Consistent with spec p3 ("points vary by difficulty"); **values still unresolved**. No dashboard feature depends on it | Unconfirmed |
| I6 | Group, 13 Oct | Dockerfile should expose the service port; packaging alternative via `docker-compose.yml`: an `attackbox` service running `ttyd -p 7681 -W bash` plus a `cloudflared` quick-tunnel service pointing at `http://attackbox:7681` | Terminal endpoint display (A15), credential granularity (A16), topology (A18). As pasted the YAML is not valid compose (`tunnel:` is not nested under `services:`; `restart`/`command` are mis-indented) — probably a paste artefact; lint with `docker compose config` | Unconfirmed |

### Conflicts and gaps versus spec v1.2

| Topic | Spec v1.2 | Chat / site | Our handling |
|---|---|---|---|
| Containers per team | Exactly **one** at all times (p1, p4) | Compose shows `attackbox` + `cloudflared` (≥ 2) | Treat "environment" as one logical unit; ask (A18) |
| Terminal authentication | Gateway authenticates and restricts each participant to their team (p2) | `ttyd -W` with no credentials; public quick-tunnel URL | Show URL as sensitive; recommend `-c`; ask (A16) |
| Credential granularity | "Organizer-issued credentials", granularity unstated | `ttyd -c` is one credential per instance | Fallback "Team login" participant (A4) |
| Challenge catalogue | Unresolved (p6) | Candidate repos and 2 named services, no final list | Placeholder manifest (A9) |
| Difficulty points | Unresolved (p6) | Three tiers decided, point values not | Nothing built; still unresolved |
| Health checks | Game server runs health + functional tests (p3) | Per-service `checker.py` | Same idea; mapping in `04 §4.1` |
| Event length | Not stated | 4 hours | Informational |
