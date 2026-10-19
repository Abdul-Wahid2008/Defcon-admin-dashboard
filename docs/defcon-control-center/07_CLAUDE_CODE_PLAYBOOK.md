# 07 — AI CODING PLAYBOOK (Claude Code first, free fallbacks, Ollama)

## 0. Slice numbering is authoritative

**P1–P17 in §4 are complete.** Do not reopen the P-slice roadmap unless a release blocker is found. The remaining work uses the **R1–R8 emergency release sessions in §11**. `BUILD_STATUS.md` must preserve the P-slice history and record R-session outcomes separately.

## 1. Principles

1. **The repo carries the memory, not the chat.** `CLAUDE.md`, `AGENTS.md` and `docs/` hold every decision, so any tool can resume after a usage limit.
2. **One vertical slice per session.** Start each session fresh (`/clear` or a new session), point at 1–3 doc files, state one slice, define "done".
3. **Plan, then implement.** Use plan mode (or "propose a plan first, wait for my OK") for every slice that touches more than 3 files.
4. **Tests lock the dangerous parts** (state machine, permissions, idempotency, audit). Never accept AI changes there without green tests.
5. **Commit after every green slice.** A bad AI edit must always be one `git restore`/`git revert` away.
6. **Do not paste huge files into chat.** Reference paths; let the tool read them.
7. **Spend the strongest model on the hard core** (adapter, transitions, permissions, audit, idempotency); use cheaper/faster models or local models for UI components and boilerplate.
8. **Read every diff** that touches `lib/server/**`. Skim UI diffs, but run them.

## 2. Setup commands (Day 1, task 1.2)

Check first: `node -v` (want an LTS ≥ 20), `git --version`. On Windows prefer PowerShell or WSL; if using PowerShell, run commands one line at a time.

```bash
npx create-next-app@latest defcon-control-center --typescript --tailwind --eslint --app --src-dir --import-alias "@/*"
cd defcon-control-center
npx shadcn@latest init
npx shadcn@latest add button card table dialog alert-dialog badge input select dropdown-menu sonner tabs skeleton tooltip separator sheet form label textarea checkbox progress switch scroll-area popover command
npm i zod @tanstack/react-query better-sqlite3 bcryptjs jose recharts lucide-react server-only
npm i -D vitest @types/better-sqlite3 @types/bcryptjs tsx
git init && git add -A && git commit -m "chore: scaffold"
```

If a flag or prompt differs in the installed CLI version, follow the CLI's prompts (choose: TypeScript, Tailwind, App Router, `src/`, alias `@/*`; shadcn base colour *slate/neutral*, CSS variables yes). Add scripts to `package.json`: `"test": "vitest run"`, `"seed": "tsx scripts/seed.ts"`, `"reset-demo": "tsx scripts/reset-demo.ts"`, `"typecheck": "tsc --noEmit"`.

**If `better-sqlite3` fails to install** (native build error): (a) make sure Node is LTS and retry `npm i better-sqlite3`; (b) otherwise switch **only** `lib/server/db.ts` to Node's built-in `node:sqlite` (available in recent Node versions) or `sql.js`; keep the same small query helper interface so nothing else changes. Do not spend more than 30 minutes on this.

## 3. Repo bootstrap checklist

1. Copy the 8 knowledge files into `docs/`; add the spec PDF as `docs/DEFCON_2_0_Requirements_Specification.pdf`.
2. Put `CLAUDE.md` and `AGENTS.md` in the repo root.
3. `.gitignore`: `.env*`, `data/`, `.next/`, `node_modules/`, `demo-backup/` (keep `.env.example`).
4. Create `.env` from `.env.example` with real secrets.

## 4. Prompt sequence (paste one at a time; each assumes a fresh session)

Common header to include in each: *"Read CLAUDE.md first. Follow docs/ as source of truth. Do not invent spec requirements. Show a short plan before editing."*

**P1 — Schemas and config**
> Read docs/03_API_CONTRACT.md §2 and docs/04_DATA_MODEL_AND_RULES.md §1, §3. Create `src/lib/schemas/*` with zod schemas and inferred types for every shared type and request/response in 03, and `src/lib/config.ts` with mock durations, polling intervals, soft cap, and the TBD constants (`HEALTH_INTERVAL_SEC`, `IDLE_SESSION_TIMEOUT_MIN` as `null`). No other files. Done = `npm run typecheck` passes.

**P1b — Schema delta v1.1 (right after P1; read docs/09_CHANGELOG.md first)**
> Read docs/09_CHANGELOG.md §2 and docs/03 §2–§3. Update `src/lib/schemas/*` to contract v1.1 with additive changes only: `Terminal` and `Environment.terminal`, `Service.placeholder`, `Alert.kind` including `'checker_error'`, `/api/meta` adapter value `'docker-compose'`, and request/response schemas for `POST /api/teams/import` and `POST /api/environments/bulk`. Do not rename anything. Done = `npm run typecheck` and `npm test` green with the P3 permission tests untouched.

**P2 — Database and migration**
> Read docs/04 §5 (v1.1 DDL includes `environments.terminal_url` and `services.placeholder`). Implement `src/lib/server/db.ts` (opens SQLite at `DB_PATH`, runs `migrations/001_init.sql` once, exposes a tiny typed helper: `get`, `all`, `run`, `transaction`) and the migration file exactly as in 04 §5 including audit triggers. Write `tests/audit.test.ts` proving UPDATE and DELETE on `audit_log` fail. Done = tests green.

**P3 — Permissions**
> Read docs/04 §3. Implement `src/lib/server/permissions.ts` with `can()` per the matrix, including team-scope rules. Write exhaustive table-driven tests in `tests/permissions.test.ts` covering every role × permission, plus team-role own/other-team cases and the missing-resource case. Done = tests green.

**P4 — Mock adapter core (use the strongest model; plan first)**
> Read docs/01 §7.2, docs/04 §1, §2, §4 (incl. §4.1), §6 (incl. §6.9 and §6.10). First create `adapters/mock/services.manifest.ts` (five services, D14). Implement the `EnvironmentAdapter` interface in `src/lib/server/adapters/types.ts` and `MockAdapter` in `adapters/mock/` using the db helper: team creation with sequential IDs, participants and credentials (bcrypt, `crypto.randomInt`, shown only in return values), `requestAction` using the transition table, lazy `resolveDue`, health derivation, alerts open/resolve with dedupe, failure injection fields. Everything transactional. Then write `tests/state-machine.test.ts` covering every row of the transition table, noop cases, in-progress 409 cases, failure path, invariants 1, 2, 3, 5, 9, 10. Use an injectable clock (`now()` parameter) so tests don't sleep. Done = tests green.

**P5 — Services: audit, idempotency, errors, auth**
> Read docs/03 §1, §4 and docs/01 §13. Implement `audit.ts` (append helpers; outcome semantics; two-row pattern with correlation IDs), `idempotency.ts`, `errors.ts` (typed errors → HTTP mapping), `auth.ts` (bcrypt verify, JWT cookie via jose, same-origin check, login rate limit in memory), and `services/*` orchestration (`sync()` that calls `resolveDue` and writes completion audit rows with ts = completion time). Tests: idempotent replay writes no extra audit rows; denied requests write `denied` rows. Done = tests green.

**P6 — Seed**
> Read docs/04 §7. Implement `scripts/seed.ts` and `scripts/reset-demo.ts`. Refuse default passwords unless `ALLOW_DEFAULT_PASSWORDS=true`. Seed the exact state mix, fake team names, participants, five services per team from the manifest, `.invalid` terminal URLs for running environments, alerts, and ~40 audit rows flagged `seeded`. Done = `npm run seed` prints a summary and `npm run reset-demo` can be run repeatedly.

**P7 — Route handlers**
> Read docs/03 fully. Implement every route handler using the template in 03 §4: authenticate, same-origin check, `sync()`, validate with zod, call the service, map errors. Include `/api/demo/*` gated per 03 §3.9 (renamed from `/api/_demo/*`, which Next.js private-folder rules kept unroutable). Write `tests/api.test.ts` (call handlers directly) for 401/403/404/409/422, create-team response contains credentials once, GET never contains passwords, idempotent replay header. Done = tests green and a short curl cheat sheet printed in `docs/CURL.md`.

**P8 — Shell and data layer**
> Read docs/05 §1, §2, §6. Implement tokens in `globals.css` (dark theme), next/font (Inter + JetBrains Mono), the `(console)` layout with Sidebar, Topbar, AdapterBadge (from `/api/meta`), simulation banner, QueryClientProvider, sonner Toaster, the login page and auth redirect (401 → `/login?next=`), `api-client.ts` with a typed `ApiError`, and `queries.ts` hooks. Done = I can log in and see an empty console shell with the correct badge.

**P9 — Teams directory + create**
> Read docs/05 §3.3 and §3.7. Build the teams page: toolbar, filters, URL-synced state, table with StateBadge/HealthBadge, row actions menu (disabled with reasons), pagination, empty/loading/error states, CreateTeamDialog and CredentialsRevealDialog (one-time, checkbox to close, CSV download, copy). Done = create a team, see it provision, copy credentials.

**P10 — Team detail + lifecycle UX (plan first)**
> Read docs/05 §3.4, §4, §5, §6. Build the team detail page (Overview tab first), ActionBar, ConfirmActionDialog (stop/start/reset with exact copy), DeleteTeamDialog (typed name), pending-state progress, idempotency key per dialog open, and the toast logic: info on 202, success only after the polled final state matches, persistent error on failure. Done = stop/start/reset/delete all work and the fail-next demo control produces a failure toast and `failed` state.

**P11 — Audit page and Activity tab**
> Read docs/05 §3.5. Build AuditTable + AuditFilters (URL-synced), expandable rows, outcome chips, append-only banner. Reuse for the team Activity tab. Done = filters work; denied and failure rows visible.

**P12 — Overview**
> Read docs/05 §3.2. Build StatCards, StateDonut (Recharts), HealthGrid tiles, AlertsFeed, ActivityList with adaptive polling. Totals must come from `/api/overview` only. Done = AC-11 holds (overview numbers match directory).

**P13 — Participants, health, demo controls**
> Read docs/05 §3.4 (Participants tab), §3.8, docs/03 §3.5–3.6, §3.9. Build ParticipantsPanel (add/remove/rotate with reveal), service checks UI with "Run health checks", ResourceBars, DemoControls (admin + mock + flag only). Done = AC-08 demonstrable.

**P14 — Hardening sweep**
> Review the whole repo against docs/01 §4.3 (AC-01…AC-17) and §13 (security). Produce a checklist of gaps with file/line references; fix only P0 gaps; do not add features. Also grep for: any import of `lib/server` from client code, any route missing `requireUser`, any log statement that could print passwords.

**P15 — README + handover**
> Write `README.md`: what this is, honesty statement (simulated vs live), how to run (`npm i`, `.env`, `npm run seed`, `npm run build && npm start`), default demo logins (to be changed), how the adapter works and how the club plugs in a real one (point to docs/03 §5).

**P16 — DockerComposeAdapter (conditional on gate G1; strongest model; plan first)**
> Read docs/01 §7.5 and §13, docs/03 §5, docs/04 §1 and §4.1. Implement `adapters/docker-compose/` implementing `EnvironmentAdapter` per §7.5: `execFile('docker', args[])` only (no shell strings), team IDs validated with `^team-\d{2}$`, compose project name = team ID, per-team compose file rendered from `./teams-template/`, TCP-connect reachability probes, terminal URL parsed from the tunnel container's logs, reset implemented as `down` (no volumes) + `up -d` and labelled "Restart (patch restore not available)". `/api/meta` must report `docker-compose` so the badge shows `PARTIAL`. Unit-test command construction with an injected fake exec (no Docker needed): assert exact arg arrays, that validation rejects bad IDs, and that `-v` appears only for delete. Done = tests green; then a manual smoke test with ONE team on the demo machine. Do not change the transition table.

**P17 — Bulk actions and CSV import (stretch)**
> Read docs/03 §3.3 (import) and §3.4 (bulk), docs/05 §3.3. Implement `POST /api/teams/import` (with `dryRun`) and `POST /api/environments/bulk` exactly as specified, reusing the single-team service functions (no duplicated rules), plus the Import CSV dialog and the bulk bar. Tests: per-row validation, partial success, confirm string for ≥ 5 teams, reset/delete not bulkable. Done = tests green.

## 5. Reviewing AI output (checklist before each commit)

- Does every mutating route call `requireUser` → `can()` → validate → act → audit?
- Is any permission enforced only in the UI?
- Does any response or log include a password/hash?
- Did the AI change an enum or state name away from `03`/`04`? (Reject.)
- Did it add a dependency? Is it justified?
- Did it silently "simplify" the state machine, audit append-only rule, or idempotency? (Reject.)
- Did UI show success before the final state was read? (Reject.)
- Does it still run: `npm run typecheck && npm run lint && npm test`?
- (F21 only) Is any command built by string concatenation, or any team ID used without the `^team-\d{2}$` check? Reject.
- Does a terminal URL appear anywhere except the team-detail response and page? Reject.

## 6. Managing usage limits across the emergency release

- Sessions short and focused; don't ask for whole-app rewrites.
- Do boilerplate (schemas, routes, table columns) with the cheaper model/tool; reserve the strongest model for P4, P5, P10.
- Keep a running "Status" block at the top of `CLAUDE.md` (updated at every release gate): done / next / known bugs / decisions made. Fresh sessions read it first.
- When a limit hits: commit, update Status, switch tool (below), and continue with the next slice using the same prompt text.

## 7. Fallback tool chain (check current free-tier limits yourself; they change)

1. **Claude Code** (primary).
2. **Other hosted free tiers** — e.g. Gemini CLI, GitHub Copilot free tier, free tiers of AI editors (Cursor, Windsurf, Trae, etc.), OpenRouter free models via Cline/Continue/OpenCode. Treat each as "good for one slice at a time"; confirm in the tool's current docs what the free allowance is. They all read `AGENTS.md` or let you paste it as a rule.
3. **Local via Ollama** (works offline, no limits) — see §8.
4. **The claude.ai chat itself** (this project): paste a file path's contents or error and ask for a patch when no coding tool is available.

Rule when switching: start the new tool with *"Read AGENTS.md and docs/. We are on slice P<n>. Last commit: <hash/message>."*

## 8. Local models on your machine (RTX 4060 laptop, 8 GB VRAM, 24 GB RAM)

- 8 GB VRAM comfortably runs ~7–8 B parameter models at 4-bit quantisation. Larger (~14 B) models will partially spill into system RAM and become slow; use only if you can wait.
- Suggested starting point: pull a current **coder-tuned 7–8 B model** from the Ollama library (e.g. a Qwen-Coder 7B-class model, or a newer equivalent — check `ollama.com/library` for what's current). Test one, keep one.
- Raise the context window (a Modelfile with `PARAMETER num_ctx 16384`, or the tool's equivalent setting) — default contexts are often too small for multi-file work. Larger context costs VRAM; if it slows down, drop to 8192.
- Use through an agent front-end (Aider, Continue, Cline, OpenCode) pointed at `http://localhost:11434`.
- **Good for local models:** one shadcn component, a table column set, zod schema from a given type list, a unit test for a given function, Tailwind tweaks, README text.
- **Not good for local models:** designing the adapter, transactional SQL logic, permissions, multi-file refactors, debugging subtle async/polling issues. Use Claude Code or a hosted model for those, or write them with extra care and review.
- Keep prompts tiny and explicit (give the exact file path, exact types, one change).

## 9. When the AI is stuck or going in circles

1. Stop. `git diff` — what did it actually change?
2. If it's wrong, `git restore .` and restart the slice with a shorter, more specific prompt and the exact failing output.
3. Split the slice (e.g., "only the API route", then "only the hook", then "only the component").
4. Give the failing test output verbatim, not a paraphrase.
5. If the problem is in an area not on the critical path, apply the cut list.

## 10. Useful commands

```bash
npm run dev             # http://localhost:3000
npm run typecheck && npm run lint && npm test
npm run seed            # initial data
npm run reset-demo      # restore demo data before each rehearsal
npm run build && npm start   # demo mode
# LAN access for a demo laptop: npm start -- -H 0.0.0.0 -p 3000   (use only on a trusted network)
```

## 11. Emergency release master prompts (R1–R8)

These prompts are intentionally separate from P1–P17. Use one fresh session per prompt. Every session must read `CLAUDE.md`, `AGENTS.md`, `docs/01_BLUEPRINT.md`, `docs/03_API_CONTRACT.md`, `docs/04_DATA_MODEL_AND_RULES.md`, `docs/06_BUILD_PLAN_5_DAYS.md`, `docs/08_TEST_AND_DEMO.md`, and `docs/10_INTEGRATION_COORDINATION_PLAN.md` before acting.

### Shared behavioral pattern for every R session

1. Start with a bounded plan and list the exact files you will inspect/change.
2. Separate confirmed PDF facts, repository facts, club-provided facts and assumptions.
3. Never invent an orchestrator endpoint, checker verdict, terminal credential, resource limit or deployment fact.
4. Preserve the adapter boundary; the UI calls `/api/*` only.
5. Keep the default adapter `mock` unless the user explicitly approves a tested real-adapter change.
6. Fail closed on missing credentials/configuration; never silently fall back from requested real mode to mock.
7. Never print secrets or include `.env`, tokens, passwords, hashes or terminal URLs in commits.
8. Add/modify focused tests for every behavior changed.
9. Run the smallest relevant checks, then `npm run typecheck`, `npm run lint`, `npm test`, `npm run build`, and `git diff --check` before handoff when code changed.
10. End with: files changed, tests run, evidence, unresolved blockers, release-mode impact, and the exact next R session.

### R1 — Integration contract and dependency lock

> Read the shared files and current `BUILD_STATUS.md`. Do not write application code first. Produce `docs/10_INTEGRATION_COORDINATION_PLAN.md` as the single sanitized handoff checklist for the orchestrator, game-server/checker, service, terminal/network, registration and infrastructure owners. Add only facts supported by the PDF/repository or clearly labelled questions. Define the minimum request/response evidence required for one-team integration, the release modes SIMULATED/PARTIAL/LIVE, the ownership matrix, escalation path and the exact go/no-go checklist. If club answers are present in local files, quote only non-secret contract facts. Do not add vulnerability exploit details or build service code. Update `09_CHANGELOG.md` and `BUILD_STATUS.md` with the contract status. Run `git diff --check`.

**Behavior:** coordination/documentation only; stop if asked to guess missing API behavior.
**Done:** a club engineer can implement or review the handoff without reading chat history.

### R2 — Environment configuration and adapter safety

> Read `01 §21.4`, `03 §1/§5`, and the existing config/adapter files. Audit the environment-variable surface and adapter selection. Add or update `.env.example`, startup validation and tests so SESSION_SECRET is mandatory and at least 32 characters, DB_PATH is explicit, demo controls/default passwords are disabled for release, and `ADAPTER=real` or `docker-compose` fails clearly when required configuration is absent. Do not add a hidden fallback to mock. Redact secrets in errors/logs. Preserve the current mock behavior. Update README/runbook only if required. Verify with focused config tests and the full release checks.

**Behavior:** security-first, fail-closed, no secret output.
**Done:** a clean target machine can intentionally select mock/partial/real and the wrong configuration cannot look successful.

### R3 — Registration import and reconciliation

> Read `03 §3.3`, `04` team invariants, current import code/tests, and `06 §6`. Implement only the confirmed registration-source mapping. If no authoritative export/API exists, improve the dry-run CSV path and documentation rather than inventing an integration. Ensure immutable external IDs are supported if supplied, duplicate IDs stop safely, missing teams are not silently deleted, renames are explicit, row-level errors are reported, and ordered IDs/credentials remain deterministic. Add tests for duplicate, missing, rename, partial and rerun cases. Never log participant passwords. Run the import-focused tests plus all release checks.

**Behavior:** reconciliation is conservative; no destructive sync without explicit policy.
**Done:** the operator can explain exactly which teams were imported, skipped or left untouched.

### R4 — One-team real lifecycle adapter

> Read the club's supplied contract and `03 §5`. Implement or adjust only the adapter mapping needed for one disposable team. Do not guess paths, verbs, job semantics or reset behavior. Map create/start/stop/reset/delete/status into the existing canonical lifecycle model, preserving lazy polling, one pending transition, idempotency, audit correlation and error codes. Use bounded timeouts and typed adapter errors. Add contract-fixture tests with sanitized responses; do not require live credentials in tests. Perform manual smoke only after the user supplies the target and authorization. Never test destructive actions on the full team set. Keep the badge PARTIAL unless every required operation is proven.

**Behavior:** smallest vertical slice; real side effects are opt-in and reversible.
**Done:** one team can be read and safely exercised, with evidence for both success and failure.

### R5 — Health, checker and resource mapping

> Read `04 §4`, `03 §5`, service manifest code and the club checker handoff. Map exact checker verdicts into reachability/functional checks, health precedence, alert kinds and timestamps. If verdict names differ, add an explicit mapping table and tests; do not silently treat unknown values as healthy. Map resource limits/usage only when the source provides them; otherwise return null/unknown with a visible label. Verify that placeholder services remain marked and that service IDs are stable. Add tests for OK, OFFLINE, MUMBLE, INTERNAL_ERROR, unknown and stale results.

**Behavior:** health is evidence-based and stale/unknown is not healthy.
**Done:** an operator can distinguish a service outage, functional failure, checker failure and unavailable telemetry.

### R6 — Credentials, terminal and security boundary

> Read the PDF security requirements, `03 §3.5/§5`, `04` credential rules and current UI. Verify that credential plaintext exists only in create/rotate/import response handling, is cleared when the reveal closes, and never appears in list/overview/audit/logs. Map terminal metadata only if the club supplies an authenticated, team-scoped gateway contract. Reject or visibly mark raw public quick tunnels without authentication. Add tests for cross-team terminal denial, stopped-terminal null behavior, redaction and credential rotation invalidation. Do not build the gateway or expose Docker sockets.

**Behavior:** treat terminal URLs and credentials as secrets; security gaps block LIVE.
**Done:** the dashboard cannot accidentally turn an unauthenticated shell URL into an event access mechanism.

### R7 — Deployment, permissions, audit and recovery gate

> Read `06 §4`, `08`, the deployment scripts and current test suite. Build a release-candidate verification script or documented command sequence (do not add a new dependency) covering clean start, session/auth, role permissions, same-origin protection, lifecycle final-state polling, duplicate/idempotent requests, adapter timeout, checker error, restart during pending mock action, backup/restore and audit correlation. Run on the actual target machine if available. Fix only release blockers. Record results and unresolved failures in `BUILD_STATUS.md`. Do not weaken a test to make the gate green.

**Behavior:** evidence over optimism; preserve failures until understood.
**Done:** another operator can reproduce the release decision from the runbook.

### R8 — Final rehearsal, freeze and handoff

> Read all docs and current status. Do not add features. Execute the exact two-track rehearsal: clean fallback release, optional one-team real smoke, two organizer sessions, permissions denial, health/checker display, lifecycle action, audit review, restart, backup/restore and 4-hour operational preparation. Capture sanitized evidence, choose SIMULATED/PARTIAL/LIVE using the documented gate, update `BUILD_STATUS.md`, `09_CHANGELOG.md`, README/runbook and release artifacts. Create a release tag only after typecheck, lint, tests, build and diff checks pass. Stop if the club has not authorized the target or if evidence would require exposing secrets.

**Behavior:** freeze means freeze; only release blockers may be fixed afterward.
**Done:** the club receives a truthful release package, a known-good fallback and a list of named external blockers.
