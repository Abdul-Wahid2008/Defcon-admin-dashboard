# 12 — v1.2 RECONCILIATION, ARCHITECTURE AND ROADMAP (27 Oct 2026)

Supersedes the status/plan parts of 06, 10_SESSION_HANDOFF and BUILD_STATUS. Spec > lead's written decisions > blueprint > ideas. Items marked **UNCONFIRMED** came from pasted club messages or the *DEFCON-EVENT-FLOW-I-DRAFT*; they are not spec.

## 0. Verified reality (27 Oct 2026, ~15:50 IST, run on the actual repo)

| Claim in older docs | Reality |
|---|---|
| "P1 and P3 done; P1b…P17 unknown" | `CLAUDE.md` STATUS: **P1–P17 done**, head `5fae488`. Real files exist for all routes, bulk, CSV import, audit explorer, demo routes, DockerCompose adapter. |
| "9/9 permission tests, coverage unverified" | The 9 tests loop over `ALL_PERMISSIONS` per role plus team-scope cases → the full 3×11 matrix **is** asserted. Closed. |
| Tests | `npm run typecheck` clean, `npx vitest run` **63/63 in 8 files** (re-run today). |
| Working tree | **Uncommitted** rewrites of `teams/page.tsx` (+490/−508) and `teams/[teamId]/page.tsx`, plus modified docs. Commit only after QA (W0). |
| Mode | `ADAPTER=mock` → SIMULATED. `ADAPTER=real` throws (no client). `docker-compose` delegates reads to the mock and parses **Cloudflare tunnel logs** — obsolete under the new design. |
| Services | Manifest still `docuvault, funsplash, svc-3..5` (ports 8001–8005). **`funsplash` is not a DEFCON service.** |
| Health | 100 % seeded/mock. Nothing reads real checker/EnoEngine output. |
| BUILD_STATUS.md in docs folder | Stale (says P1b next). Replaced today; old copy kept as `BUILD_STATUS.prev-2026-10-27.md`. |
| Club repo `eveniota/HAMDEFCON` | Returns 404 to me (private or wrong name). **I have not seen `template.compose.yml`.** |
| Supabase | Only project is `pitch-under-pressure` (INACTIVE, unrelated). No live teams data there. |

## 1. Source conflicts and how v1.2 resolves them

| # | Conflict | Resolution (until the lead confirms) |
|---|---|---|
| C1 | **Reset.** Spec: teams may reset own env; reset = latest accepted patch, preserves 5 categories. Club message: no player-run restore (RCE could run it, wipes DB = SLA suicide); only Admin resets, after a container is ruined. | Capability-driven. `TEAM_SELF_RESET=false` default (team role loses `env.reset`). Reset copy/outcome comes from `adapter.capabilities.resetKind` (`restore_patch` \| `recreate_pristine` \| `restart`). Real adapter reports `recreate_pristine`/`restart` → dialog says it **may wipe service data and cost SLA**, requires reason + typed team id. **Needs lead sign-off (spec outranks chat).** |
| C2 | Guidebook: supervisord + DB + flag rotator + restore-service inside one container. Lead: services + ttyd only; DB per service in its own container; flags/scoring central (EnoEngine). | Dashboard stops modelling in-container daemons. Environment = compose project `team-NN`. Flag/score = display only. |
| C3 | Service names: PDFs DocuVault / PulseChat / SwiftShop; event-flow diagram DocuVault / CampusPortal / SwiftShop / Service 4. Port offsets +0,+2,+3,+4 (no +1). | Manifest becomes config; `CampusPortal`≈PulseChat is **unknown** → keep one entry flagged `placeholder` until confirmed. |
| C4 | Guidebook: 11 vulns/box, 4 boxes, red herrings. Lead: 3 flagstores/service (PDFs: Flag 0/1/2 easy/medium/hard), one box for all. | Health model gets a **flagstore dimension** (3 per service). No vuln catalogue in dashboard. |
| C5 | Spec/guidebook: single container per team. Lead: DB isolated in its own container; compose template. | A18 topology stays open. Resources shown **per team project**, cap 1024 MB (event-flow: 768 MB typical, 1 GB cap). |
| C6 | ttyd port 8080 (guidebook) / 7681 (A15) / 7600+TeamID (event flow). One shared ttyd vs per-container untested (Mukesh testing; Wahid tested per-container). | `terminal.mode: 'per_team' \| 'shared'`, URL from config formula. Default `per_team`. Dashboard never proxies terminals. |
| C7 | 20 teams (event-flow, ports 7601–7620) vs 20–30 (spec) vs 24 seeded. | Keep soft cap 30; port formula shown with a warning above 20. |
| C8 | Event timeline (45 / 165 / 30 min, 90 s rounds, 110 rounds) is from a **draft**. | Event clock is config-driven (`EVENT_START_ISO`, phase lengths in settings); no hard-coded times. |
| C9 | Handoff says P1/P3 only. | Superseded by §0. |

## 2. New assumptions (all UNCONFIRMED; add to 01 §6)

A20 One EC2 host (32 GB/16 vCPU) runs ≤20 team stacks + EnoEngine (event-flow draft). A21 nginx serves `/data/scoreboard.json` (and `attack.json`) from EnoEngine — **format unverified**. A22 Round = 90 s. A23 Port formulas: ttyd `7600+id`; service `10000+id*10+offset`. A24 Three flagstores per service. A25 Checker verdicts follow enochecker3 (`OK/MUMBLE/OFFLINE/INTERNAL_ERROR`) — **verify against the club checker**. A26 Reset is admin/operator-only. A27 Dashboard runs on a private network path only (LAN/VPN/SG-restricted), never public. A28 Team roster arrives by CSV/JSON export from registration. A29 Memory cap 1024 MB/team. A30 "Moderator" = `organizer_operator`. A31 Engine team id ↔ dashboard `team-NN` needs an explicit `external_team_id`.

## 3. Decisions

- **D16 Keep SQLite as the control-plane store.** Rejected: moving to Supabase. Reasons: (1) append-only audit via DB triggers, idempotency and lazy state machine are tested (63 tests) — a Postgres/RLS rewrite re-opens every one of them with ≤3 days left; (2) a 4-hour live event must not depend on internet reachability to a hosted DB; (3) it adds a second secret store and a new attack surface for zero feature gain. **Supabase is allowed only as an optional `TeamSource`** (pull roster into the existing P17 import/dry-run). Not in the critical path. If used, create a **new dedicated project** (the existing one is unrelated and paused) and confirm cost first.
- **D17 Two seams, not one.** `EnvironmentAdapter` (lifecycle) stays. New `HealthSource` (`mock | scoreboard | ingest`) feeds checks. Badge: SIMULATED = both mock; PARTIAL = any real source/mutation; LIVE only when lifecycle **and** health are real and evidenced.
- **D18 Health by pull first, push second.** Pull `scoreboard.json` server-side (no club work needed); optional token-protected `POST /api/ingest/check-results` if the club can push.
- **D19 Freeze switch.** Admin-only `mutations_frozen` setting → all mutations return `MUTATIONS_FROZEN` (423). Reads/audit continue.
- **D20 Organizer account management** (admin): create/disable/reset password/revoke sessions (`session_epoch`).
- **D21 Real lifecycle goes through a tiny allow-listed agent** (spec in 15 §3), not a Docker socket mounted into a web app. Fallback: DockerComposeAdapter on the EC2 host — explicitly documented as root-equivalent.
- **D22 UI honesty from capabilities.** Dialog text, button labels and badges derive from `/api/meta.capabilities`, never from adapter-agnostic constants.
- **D23 No Supabase/other external service in the request path.** (restates D16)

## 4. Target architecture

```
 Organizer browser ──(LAN/VPN only)──> Next.js app (this repo)  ── SQLite (WAL, audit triggers)
                                         │   │   │
              HealthSource ◄─────────────┘   │   └─► EnvironmentAdapter
   scoreboard poll (server-side, allow-listed)│        mock | docker-compose | agent(real)
   or POST /api/ingest/check-results (token)  │
                                              └─► TeamSource (CSV/JSON file | Supabase optional)
 EnoEngine (central): flags, checkers (enochecker3), scoring, nginx /data/scoreboard.json
 Team stacks team-NN: services (+DB containers) + ttyd   — owned by club infra
```

## 5. Admin vs moderator capability matrix (v1.2)

| Capability | admin | operator (moderator) | team |
|---|:-:|:-:|:-:|
| View overview/teams/health/alerts/audit | ✔ | ✔ | own team only |
| Create / edit team, notes, suspend | ✔ | ✔ | – |
| Delete (archive) team | ✔ | – | – |
| Participants add/remove/rotate creds (one-time reveal) | ✔ | ✔ | – |
| Start / stop env, bulk start/stop | ✔ | ✔ | – |
| Restart a service (`service.restart`) | ✔ | ✔ | – |
| Reset env/service (`env.reset`, `service.reset`) — reason + typed id | ✔ | ✔ (configurable off) | ✘ unless `TEAM_SELF_RESET` |
| Run health check now, ack/resolve alert (`alert.ack`) | ✔ | ✔ | – |
| CSV/JSON roster import (dry-run first) | ✔ | ✔ | – |
| Audit read + CSV export | ✔ | ✔ | – |
| Settings, event clock, stale threshold, **mutation freeze** | ✔ | – | – |
| Organizer accounts (`user.manage`), revoke sessions | ✔ | – | – |
| Demo controls | ✔ (dev only) | – | – |
| Ingest (`ingest.write`) | machine token only | – | – |

## 6. Contract / data changes (all additive except the team `env.reset` removal)

- **Migration 002:** `teams.external_team_id TEXT UNIQUE NULL`; `users.session_epoch INTEGER DEFAULT 0, must_change_password INTEGER DEFAULT 0, last_login_at TEXT`; `flagstore_results(team_id, service_key, flagstore CHECK IN ('flag0','flag1','flag2'), verdict CHECK IN ('OK','MUMBLE','OFFLINE','INTERNAL_ERROR','UNKNOWN'), message, round INTEGER, checked_at, PRIMARY KEY(team_id,service_key,flagstore))`; `health_source_state(source PK, last_round, last_fetch_at, last_ok_at, last_error, last_etag)`; settings keys `mutations_frozen`, `stale_after_sec`, `event_start_iso`, `phase_peace_min`, `phase_battle_min`, `phase_freeze_min`, `round_sec`. Audit triggers untouched.
- **`/api/meta` adds:** `sources:{health,lifecycle,roster}`, `capabilities:{resetKind,serviceLevelReset,terminalMode,flagstores}`, `frozen:boolean`, real `version`.
- **Service** gains optional `flagstores:[{key,verdict,message,round,checkedAt}]`. **OverviewData** gains `event:{phase,currentRound,roundSec,startedAt|null,source}` and `sources` freshness.
- **Errors:** add `MUTATIONS_FROZEN`(423), `SOURCE_UNAVAILABLE`(503 only on explicit source-test routes).
- **Routes:** `POST /api/ingest/check-results`; `POST /api/teams/[id]/services/[key]/{restart|reset}`; `POST /api/alerts/[id]/ack`; `GET/POST /api/users`, `POST /api/users/[id]/{reset-password|revoke-sessions|disable}`; `POST /api/settings/freeze`.
- **Permissions:** add `service.restart, service.reset, alert.ack, user.manage`; remove `env.reset` from `team` unless `TEAM_SELF_RESET`. **Update `tests/permissions.test.ts` in the same commit** (it currently asserts team has `env.reset`).

## 7. Health model

Verdict → checks (per service, worst-of over its flagstores): `OK`→reach pass/func pass; `OFFLINE`→reach **fail**, func unknown; `MUMBLE`→reach pass, func **fail**; `INTERNAL_ERROR`/anything unrecognised→unknown + info-level `checker_error` alert (never blamed on the team). Never default an unparseable value to pass. **Stale rule:** no refresh for `stale_after_sec` (default 270 = 3 rounds) → `unknown` with detail "stale". **Frozen-source risk:** if the club freezes `scoreboard.json` in the last 30 min, `currentRound` stops advancing → show "source frozen/stale", and ask the club for an unfrozen status file or push (15 §1).

## 8. UI quality bar ("not AI slop")

Remove marketing-voice copy. Replace e.g. "A calm read on team environments, service health, and the next intervention." → "Team environments"; "No open alerts. Operations are quiet." → "No open alerts."; "control plane · v1.1.0" hard-coded → real version. Rules: sentence-case labels, verbs for buttons ("Stop environment", not "Take action"), exact numbers over adjectives, `tabular-nums` for counts/ports/times, one accent colour, status = colour + icon + text, ≥4.5:1 contrast, no decorative gradients/animations on data views, no emoji, no "seamless/powerful/elevate" language, real relative times with absolute on hover, empty states say what to do next. Primary view for operators: a **teams × services matrix** with three flagstore dots per cell and a failing-first sort. Desktop-first 1280+, usable at 1024. Dialog copy per 05 §4 but reset text switches on `capabilities.resetKind`.

## 9. Security checklist (verify, don't assume)

S1 every route: `requireUser`→`assertSameOrigin`→`sync`→zod→service→`errorResponse`; **generated authz test: every route × role × (own/other team)**. S2 `ingest` token: constant-time compare, ≥32 chars, 256 KB cap, ≤200 rows, rate-limited, 404 when unset. S3 health pull URL from env only, host allow-list, 5 s timeout, 2 MB cap, `redirect:'error'`. S4 login limiter currently keyed `ip:username` in memory → add per-IP ceiling + per-username lockout, define `TRUST_PROXY` before reading `X-Forwarded-For`. S5 security headers in `next.config.ts` (CSP without `unsafe-eval` in prod, `frame-ancestors 'none'`, `Referrer-Policy`, `X-Content-Type-Options`, `Permissions-Policy`), `Cache-Control: no-store` on `/api/*`. S6 cookie `HttpOnly; SameSite=Lax; Secure` when behind HTTPS; session `epoch` revocation. S7 `.env` never committed (hazard: local `DEMO_CONTROLS=true`); `check-env` refuses release start with demo flags. S8 passwords bcrypt cost ≥10, plaintext only in create/rotate/import reveal, cleared on dialog close; default organizer passwords refused in production. S9 CSV import: formula-injection guard on export (`=`,`+`,`-`,`@` prefix), size cap, row cap. S10 audit CSV export same guard. S11 no secrets in logs; `requestId` only. S12 `npm audit --omit=dev` reviewed; no new deps without a reason. S13 SQLite file perms; backup script copies db+wal+shm. S14 terminal URLs treated as secrets (not in audit details, not in CSV). S15 dashboard unreachable from participant network.

## 10. Roadmap (today 27 Oct 15:50 IST → Technozion reported 30–31 Oct; DEFCON slot UNCONFIRMED)

| Slice | Content | Est. | When |
|---|---|---|---|
| **W0** | Hygiene: QA + commit pending pages, truth-sync docs, env hazard, branch `release/v1.2` | 0.5 h | **tonight, first** |
| **W1** | Manifest from config, flagstores, ports, migration 002, seed (20 teams × 4 services) | 1.5 h | tonight |
| **W2** | HealthSource: scoreboard poller + parser + staleness + alerts + ingest route + meta capabilities | 2.5 h | tonight (dry-run needs this) |
| Dry-run | Import real roster, point at real `scoreboard.json`, compare 20 teams by eye (§11) | 1 h | **tonight** |
| W3 | Security + roles v1.2 + freeze + organizer accounts | 3 h | 28 Oct AM |
| W4 | Lifecycle semantics (capabilities), service restart/reset, agent client + fake-agent tests | 3 h | 28 Oct PM |
| W5 | UI humanisation + matrix view + headless QA | 3 h | 28 Oct PM |
| W6 | Operator workflows (incident view, shortcuts, bulk polish) | 2 h | 29 Oct AM |
| W7 | Performance, soak, backup cron, load test | 2 h | 29 Oct AM |
| W8 | Evidence gate with club (one team real mutation) | club-dependent | 29 Oct |
| W9 | Final hardening, docs, tag, **freeze** | 2 h | 29 Oct night |

Cut order if time collapses: W6 → part of W5 → W4 service-level reset → W3 organizer accounts (keep freeze + authz). **Never cut:** auth, authz tests, audit, confirmations, SIMULATED/PARTIAL honesty, ingest security.

## 11. Tonight's dry-run runbook (acceptance = all boxes)

1. `git switch -c release/v1.2`; `npm run typecheck && npm test` green.
2. Start on **port 3100** with explicit env (never reuse `.env`): `DEMO_CONTROLS=false ALLOW_DEFAULT_PASSWORDS=false SESSION_SECRET=<64-hex> DB_PATH=data/dryrun.db HEALTH_SOURCE=scoreboard HEALTH_SCOREBOARD_URL=<club url> npx next start -p 3100`. (Port 3000 hosts a pre-existing server and `data/defcon.db` — leave both.)
3. Import the real roster via the existing CSV/JSON import (dry-run preview first); every row carries `external_team_id`.
4. Overview shows N teams = roster N; badge reads **PARTIAL** (live health, simulated lifecycle); event strip shows round/phase or "Event clock not set".
5. Pick 3 teams; compare dashboard service status with the club scoreboard/Eno UI at the same minute; record mismatches.
6. Stop the source (wrong URL) → dashboard shows "stale/source unavailable", **not** green.
7. Operator and admin: lifecycle buttons still say SIMULATED outcomes; audit rows have correlation ids.
8. Record evidence in `docs/club-evidence/2026-10-27-dryrun.md` (sanitised; no URLs with tokens).

## 12. Exact doc edits to apply

01 §6 append A20–A31 (§2). 02 §11 append the club decisions in §1 with status *unconfirmed*. 03 add routes/types/errors from §6. 04 add migration 002, flagstore verdict mapping (§7), permission table (§5). 05 add copy rules (§8) and matrix view. 06 replace with §10. 07 replace prompts section with `14_PROMPT_PACK_W0_W9.md`. 08 add authz-matrix, ingest, stale, freeze tests. 09 add entry "v1.2 (27 Oct): reconciliation after club decisions; D16–D23". CLAUDE.md/AGENTS.md STATUS: set by W0.

## 13. Risks

R1 Club source of health unknown/frozen (high). R2 Reset semantics unconfirmed (high). R3 No orchestrator/agent → lifecycle stays simulated (high; ship PARTIAL honestly). R4 Event slot unconfirmed. R5 Docker-socket exposure if DockerComposeAdapter is used on the same host as players' containers. R6 AI-edit regressions in `lib/server/**` → review diffs, run authz matrix. R7 Single-operator fatigue: you are also E-Club/BHW/mechX; protect the 28–29 Oct blocks.
