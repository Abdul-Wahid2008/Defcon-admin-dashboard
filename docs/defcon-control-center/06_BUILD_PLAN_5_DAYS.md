# 06 — FIVE-DAY BUILD PLAN

> **v1.2 (27 Oct 2026): superseded for planning by slices W0–W9** (`14_PROMPT_PACK_W0_W9.md`, roadmap in `12_V1_2_RECONCILIATION_AND_ROADMAP.md` §10). W0–W7 and W9 are done, W8 (club evidence gate) is blocked on club inputs. Status: `BUILD_STATUS.md`. The five-day plan below is kept as history.

**Assumed calendar** (replace with the real deadline the moment you know it): Day 1 Sat 17 Oct · Day 2 Sun 18 · Day 3 Mon 19 · Day 4 Tue 20 (**feature freeze at end of day**) · Day 5 Wed 21 (rehearsal + fixes only) · Thu 22 Oct emergency buffer.

**Capacity assumption:** about 6–8 productive hours per day with AI doing most typing. Each day has an **exit check** — if it fails at day's end, apply the cut list (§4) immediately rather than carrying debt forward.

**Working loop (every task):** read the relevant doc → ask the AI for a short plan → implement one vertical slice → run `tsc`, lint, tests → look at it in the browser → commit. Never stack two unfinished slices.

---

### Status reconciliation (17 Oct 2026, from BUILD_STATUS.md)

Done: **P1** schemas/config and **P3** permissions (9 tests reported green). Not done: **P2** database + migration, **P4** mock adapter, **P5** services (audit/idempotency/errors/auth), **P6** seed. Slice numbers follow `07 §4` only — the earlier BUILD_STATUS.md used a different list and pointed at `§5`; use the corrected `BUILD_STATUS.md`. P1 must also absorb the v1.1 schema delta (`09 §2`, prompt **P1b**) before P4. The Day-1 exit check needs P1–P6, so Day 1 is at risk: catch-up rule — slip task 2.2 (API integration tests) and the Day-4 polish sweep, never P4/P5.

## Day 1 — Foundation, contract, mock engine (backend-first)

| # | Task | Output | Time |
|---|---|---|---|
| 1.1 | Send the Day-1 message to the club lead (open questions `01 §18`, attach `03` as the proposed contract) | Message sent | 0:15 |
| 1.2 | Scaffold: `create-next-app`, shadcn init + components, install deps (`07 §2`) | App boots at `/` | 0:45 |
| 1.3 | Put `CLAUDE.md`, `AGENTS.md`, `docs/` (all 8 files + spec PDF) into the repo; first commit | Repo with docs | 0:15 |
| 1.4 | `lib/schemas` (zod from `03 §2`), `lib/config.ts`, `.env.example` | Types compile | 0:45 |
| 1.5 | `lib/server/db.ts` + migration `001_init.sql` + audit triggers | DB creates itself | 0:45 |
| 1.6 | `permissions.ts` (`can()`) + tests | Tests green | 0:30 |
| 1.7 | `MockAdapter`: transition table, `requestAction`, `resolveDue`, health derivation, credentials, team creation | Unit-testable engine | 2:00 |
| 1.8 | State-machine tests (all rows of `04 §1`, invariants 1–3, 10) | Tests green | 0:45 |
| 1.9 | `audit.ts`, `idempotency.ts`, `errors.ts`, `auth.ts` (login, session, rate limit) | Services ready | 1:00 |
| 1.10 | Seed + `reset-demo` scripts per `04 §7` | `npm run seed` works | 0:45 |

**Exit check D1:** with `curl`/REST client, log in, list teams, reset a team, wait 5 s, see it back to `running` and two audit rows with one correlation ID; `npm test` green.

## Day 2 — API surface + shell + team directory + create flow

| # | Task | Output | Time |
|---|---|---|---|
| 2.1 | All route handlers per `03` (teams, lifecycle, participants/credentials, audit, overview, alerts, meta, demo) using the handler template | API complete | 2:00 |
| 2.2 | API integration tests: 401/403/404/409/422, idempotent replay, denied audit row | Tests green | 1:00 |
| 2.3 | Layout shell: sidebar, topbar, AdapterBadge, simulation banner, providers, login page, auth gate | Navigable shell | 1:30 |
| 2.4 | `api-client.ts`, `queries.ts` (TanStack hooks), `format.ts` | Typed data layer | 0:45 |
| 2.5 | Teams directory: table, search, filters, sort, pagination, URL state, StateBadge/HealthBadge | `/teams` functional | 1:45 |
| 2.6 | Create-team dialog + CredentialsRevealDialog (+ CSV) | Create works end-to-end | 1:15 |

**Exit check D2:** log in via UI, create a team, see it provision to `running`, copy credentials once; filter/search works on 24 seeded teams.

## Day 3 — Team detail, lifecycle actions, audit

| # | Task | Output | Time |
|---|---|---|---|
| 3.1 | Team detail page skeleton + Overview tab (environment, services, resources cards) | Page renders real data | 1:45 |
| 3.2 | ActionBar + ConfirmActionDialog (stop/start/reset) + DeleteTeamDialog (typed name) + pending state + toast logic per `05 §5` | Lifecycle works in UI | 2:30 |
| 3.3 | Permission-aware disabling (tooltips with reasons); verify operator vs admin | AC-09 UI half | 0:45 |
| 3.4 | Audit page: table, filters, expand row, append-only banner; team Activity tab reuses it | `/audit` functional | 1:45 |
| 3.5 | Edit team (sheet), account status with confirm | AC-04 | 0:45 |

**Exit check D3:** run the **full demo scenario** (`08 §3`) manually, once, start to finish.

**Decision gate G1 (end of Day 3).** The event is a live 4-hour competition, so decide now what Day 4 afternoon buys: (a) the club has a working orchestrator or a firm delivery date → map `RealAdapter` to the 3–4 endpoints they have; (b) the club has none and P0 is green → build `DockerComposeAdapter` (`01 §7.5`) *instead of* the polish sweep 4.6; (c) otherwise ship simulated and say so. Record the decision in `BUILD_STATUS.md`.

## Day 4 — Overview, participants, health/alerts, demo controls, deploy, FREEZE

| # | Task | Output | Time |
|---|---|---|---|
| 4.1 | Overview: stat cards, donut, environment grid, alerts feed, recent activity, polling | `/overview` complete | 2:30 |
| 4.2 | Participants tab: add/remove/rotate, one-time reveal reuse | F10 | 1:15 |
| 4.3 | Health detail polish, "Run health checks", alerts open/resolve verification | F12/F13 | 0:45 |
| 4.3b | Audit CSV export (promoted to P1: post-event record of a 4-hour run) | F18 | 0:30 |
| 4.4 | Demo controls (inject failure, fail-next, reseed) + AC-08 verification | F16 | 1:15 |
| 4.4b | **Conditional on gate G1:** `DockerComposeAdapter` per `01 §7.5` (experimental, badge `PARTIAL`); time-box 3:00; abandon at freeze if not working end-to-end | F21 | 3:00 |
| 4.5 | Production build, run on the demo machine, `.env` secrets, LAN bind, smoke test | `next build && next start` OK | 1:00 |
| 4.6 | Empty/loading/error states sweep per `05 §7`; accessibility pass | UX bar | 1:00 |
| 4.7 | **FREEZE:** tag `v1.0-freeze`; no new features after this | Git tag | — |

**Exit check D4:** all P0 acceptance criteria AC-01…AC-17 ticked in `08 §1`.

## Day 5 — Rehearse, harden, record

| # | Task | Output | Time |
|---|---|---|---|
| 5.1 | Fix list from the AC run (bugs only) | Clean AC pass | 2:00 |
| 5.2 | Rehearse the demo script twice from `npm run reset-demo`; time it | Smooth 3-minute run | 1:00 |
| 5.3 | Record a screen capture of the whole demo (backup) + 6 screenshots | `demo-backup/` | 0:45 |
| 5.4 | Write `README.md` (run instructions, honesty statement, how to plug real adapter) and hand the club the contract + adapter docs | README | 0:45 |
| 5.5 | Optional stretch if all green: P2 items in §3 order | Extras | rest |

**Exit check D5:** a teammate (or you from a cold start) runs the demo from `git clone` + README steps without help.

---

## 3. P1/P2 stretch order (only after P0 is green)

1. Bulk start/stop with typed confirmation `START ALL` / `STOP ALL` (F17) — 1:30 (how a real event is opened and closed)
2. CSV import of registered teams (F23) — 1:15 (needs the registration export format; ask the club)
3. Competition status label (F19) — 30 min
4. Global `/` search (F22 light) — 30 min
5. Playwright happy-path test (F20) — 1:00
6. `DockerComposeAdapter` (F21) if it was not built under gate G1 — see `01 §7.5`; always experimental, never default, badge `PARTIAL`
(Audit CSV export is now P1, task 4.3b.)

## 4. Cut list (apply in this order when behind)

1. Resource usage bars (F14) → show "not available".
2. Demo controls UI (F16) → keep API only, trigger via curl during demo.
3. Credentials rotate/remove (keep issue-on-create only).
4. Account status suspend UI (F11).
5. Donut chart → plain numbers.
6. Alerts feed → rely on recent activity.
7. Edit-team sheet → inline name edit only.

**Never cut:** auth, audit append-only, confirmations, permission checks, SIMULATED badge, state machine tests, honest final-state toasts.

## 5. Daily checkpoint ritual (5 minutes, end of each day)

1. `npm run lint && npx tsc --noEmit && npm test` all green.
2. Commit + tag `dayN`.
3. Update the "Status" block at the top of `CLAUDE.md` (what's done, what's next, known bugs) — this is what lets another AI tool continue seamlessly.
4. Re-estimate: if tomorrow's exit check looks at risk, apply the cut list now.

## 6. If the club's backend appears early

Do **not** pause the plan. Day 4 afternoon only: implement `RealAdapter` for the 3–4 endpoints they actually have working (list teams, one lifecycle action, status), leave the rest on mock via a composite adapter flagged `mixed` — and then the badge must say **`PARTIAL`** (amber, tooltip lists what is real). Never show `LIVE` unless every environment-affecting call is real.
