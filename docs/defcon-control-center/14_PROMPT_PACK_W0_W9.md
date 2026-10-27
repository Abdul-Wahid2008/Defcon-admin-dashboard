# 14 — PROMPT PACK W0–W9 (v1.2). One slice per Claude Code session, after pasting doc 13.

Order for tonight's dry-run: **W0 → W1 → W2 → dry-run (doc 12 §11)**. W3–W9 follow. Each prompt is self-contained; "Acceptance" lines are what you check before accepting the slice.

---
## W0 — Hygiene and truth sync (≈30 min)
```
SLICE W0. Goal: a clean, trustworthy baseline on branch release/v1.2.
1. `git status`. The working tree has uncommitted rewrites of src/app/(console)/teams/page.tsx and teams/[teamId]/page.tsx plus modified docs. Review the diff of both pages for regressions against docs/05 (dialog copy, states) and docs/03; run typecheck, lint, tests, build; run headless-Chrome QA on /teams and /teams/team-01 using a temp DB (explicit env, port 3100). If it passes, commit it as `feat(teams): <what actually changed>`; if it fails, `git stash`, report what broke.
2. `git switch -c release/v1.2`.
3. Replace hard-coded versions: src/app/api/meta/route.ts returns '1.1.0' and Sidebar falls back to '1.1.0'. Read the version from package.json (set it to 1.2.0-rc.1) in one place.
4. Add scripts/check-env.ts + `npm run check-env`: fails (exit 1, readable message, never prints secrets) if any of: SESSION_SECRET <32 chars; DEMO_CONTROLS or ALLOW_DEFAULT_PASSWORDS true; DB_PATH unset or ':memory:'; organizer passwords equal to 'change-me' or the .env.example values; ADAPTER invalid. Add `npm run start:release` = check-env then `next start`. Add tests for check-env logic (pure function).
5. Sync status docs: make docs/BUILD_STATUS.md exist (copy the corrected docs/defcon-control-center/BUILD_STATUS.md), update the STATUS block of CLAUDE.md and AGENTS.md identically (head hash, 63+ tests, v1.2 in progress, deadline = unconfirmed; remove the stale "emergency release window 19–20 Oct").
6. Do NOT change behaviour beyond the above.
Acceptance: typecheck 0, lint 0 errors, all tests pass (63 + new), build 0, `git status` clean, two docs identical (diff CLAUDE.md AGENTS.md empty).
Commit: `chore: v1.2 baseline, check-env, version single-source, status sync`.
```

---
## W1 — Services manifest from config, flagstores, ports, migration 002, seed (≈1.5 h)
```
SLICE W1 (plan first: touches schema, seed, adapter, types). Read docs/defcon-control-center/12 §1 C3–C7, §2, §6.
Goal: replace the hard-coded 5-service manifest (docuvault, funsplash, svc-3..5 — 'funsplash' is NOT a DEFCON service) with a config-driven manifest, add the flagstore dimension and port formulas, and add migration 002.
Do:
1. Create src/lib/event-config.ts (zod, fail-closed) loading config/services.json (create it) with entries {key, name, portOffset, flagstores:3, placeholder, nameConfirmed:boolean}. Defaults (ALL names UNCONFIRMED, flagged): docuvault(+0), pulsechat(+2, placeholder:true, name "PulseChat / CampusPortal (unconfirmed)"), swiftshop(+3), service-4(+4, placeholder:true). Port = 10000 + seq*10 + portOffset; ttyd port = 7600 + seq (formula constants in config, // UNCONFIRMED A23). Warn (not fail) when seq>20.
2. One manifest source: delete the duplicate manifest in scripts/seed.ts and src/lib/server/adapters/mock/services.manifest.ts; both import event-config.
3. Migration 002 (follow the existing runner in db.ts; existing DBs must upgrade in place): teams.external_team_id TEXT UNIQUE NULL; users.session_epoch INTEGER NOT NULL DEFAULT 0, must_change_password INTEGER NOT NULL DEFAULT 0, last_login_at TEXT; table flagstore_results (team_id, service_key, flagstore CHECK IN ('flag0','flag1','flag2'), verdict CHECK IN ('OK','MUMBLE','OFFLINE','INTERNAL_ERROR','UNKNOWN'), message, round INTEGER, checked_at, PK(team_id,service_key,flagstore), FK to services); table health_source_state (source PK, last_round, last_fetch_at, last_ok_at, last_error, last_etag); settings defaults for stale_after_sec(270), round_sec(90), mutations_frozen('0'). Audit triggers must remain untouched — add a test proving UPDATE/DELETE on audit_log still abort after migration.
4. Types/schemas (additive): Service.flagstores?: {key, verdict, message, round, checkedAt}[]; Terminal gets mode:'per_team'|'shared'; keep Terminal.kind 'ttyd'. MockAdapter: terminal port from config, memory limitMb 1024 stays; mock resources unchanged and still marked MOCK.
5. Seed: 4 services/team, 3 flagstore rows each (mock verdicts consistent with seeded checks), keep the 24-team scenario (degraded/down/failed/stopped teams) but replace every 'funsplash' reference with the manifest's first non-placeholder service. external_team_id = String(seq) in the seed only (clearly mock).
6. Tests: manifest zod (reject duplicates/bad offsets), port formula, upgrade test (create DB with 001 only → run runner → 002 columns exist, data preserved), seed counts (24 teams × 4 services × 3 flagstores), audit append-only after migration.
Acceptance: all prior 63 tests still pass (update only those that assert the old manifest and say which), new tests listed, `npm run seed` on a temp DB works, overview still renders 24 teams (browser check), no mention of FUnsplash anywhere (`git grep -i funsplash` empty).
Commit: `feat(services): config-driven manifest, flagstores, migration 002`. CONTRACT CHANGE: list it and update docs 03/04.
```

---
## W2 — HealthSource: scoreboard poll + ingest + staleness (≈2.5 h) — critical for tonight
```
SLICE W2 (plan first; touches config, sync, services, adapter guard, 2 routes, UI badge). Read doc 12 §3 D17–D18, §7, §9 S2–S3 and docs/defcon-control-center/15_CLUB_INTEGRATION_INTAKE.md.
Goal: replace seeded-only health with a real, safe health pipeline while keeping lifecycle simulated.
Facts you may rely on: the club's nginx serves EnoEngine's scoreboard at /data/scoreboard.json (UNCONFIRMED, format unverified); rounds are ~90 s (UNCONFIRMED). Do NOT assume field names. 
Do:
1. Config (src/lib/config.ts, fail-closed, tested): HEALTH_SOURCE=mock|scoreboard|ingest (default mock); HEALTH_SCOREBOARD_URL (required for scoreboard; must be http/https; host allow-list from HEALTH_ALLOWED_HOSTS, default = the URL's own host); HEALTH_POLL_SEC=15; STALE_AFTER_SEC (setting, default 270); INGEST_TOKEN (required ≥32 chars for ingest; if unset the ingest route returns 404). Release mode must reject HEALTH_SOURCE=mock only if explicitly configured by env CHECK_RELEASE=1 (do not break existing tests).
2. src/lib/server/health/: verdicts.ts (verdict → reachability/functional per doc 12 §7; unknown strings → UNKNOWN → status 'unknown'; NEVER pass), apply.ts (applyHealthBatch(rows, source) in ONE SQLite transaction: upsert flagstore_results, recompute checks per service as worst-of flagstores, update environments.last_health_check_at, open/resolve alerts using the existing dedupe_key scheme 'team-NN:service:reachability|functional', info alert 'checker_error' for INTERNAL_ERROR; monotonic: ignore rows older than stored checked_at/round; unknown team/service → returned in a rejected[] list, never throws), scoreboard-source.ts (server-side fetch: 5 s AbortSignal timeout, redirect:'error', 2 MB cap, no cookies; parseScoreboard() is ISOLATED behind an interface; map engine team id → teams.external_team_id).
3. Scoreboard format: if docs/club-inputs/scoreboard.sample.json exists, write the parser against it with zod and add it as a test fixture. If it does not exist, implement parser behind the interface with a clearly-labelled PROVISIONAL fixture, make any unrecognised shape throw SOURCE_SHAPE_UNKNOWN (recorded in health_source_state.last_error, surfaced in UI), and print in your final reply exactly which fields you need confirmed. Never guess silently.
4. Lazy polling (no timers, consistent with the lazy state machine): extend services/sync.ts — when HEALTH_SOURCE=scoreboard and now − health_source_state.last_fetch_at > HEALTH_POLL_SEC, do ONE single-flight pull (in-process lock) before serving; failures update last_error and keep old data, which then ages into 'stale'.
5. Staleness: any check older than STALE_AFTER_SEC becomes status 'unknown' with detail 'stale' at read time. Also detect a frozen source: currentRound unchanged for > 2 × round_sec while the source is reachable → source_state 'frozen'.
6. Mock guard: when HEALTH_SOURCE≠mock, MockAdapter.runHealthChecks and the seeded/forced checks must NOT overwrite real data. 'Run check now' triggers a forced single-flight pull (rate-limited 1/5 s) and is audited as health.run.
7. POST /api/ingest/check-results: Bearer token (constant-time compare with crypto.timingSafeEqual on equal-length hashes), body ≤256 KB, ≤200 rows, zod .strict(), rate-limited; response {accepted, rejected:[{index,reason}]}. Audit ONLY: alert open/resolve (actor 'system') and rejected/invalid ingest attempts. Not same-origin (machine caller) — but still no cookies accepted. Add 'ingest.write' as a machine principal, not a role.
8. /api/meta adds sources:{health,lifecycle,roster}, capabilities (placeholder values now: resetKind from adapter mode), frozen:false; badge rule per doc 12 D17 (PARTIAL when health source is real). Update AdapterBadge/SimBanner so the banner says plainly which parts are simulated, e.g. "Health: live (scoreboard, round 41, 12 s ago) · Lifecycle: simulated".
9. UI: team detail and overview show per-service verdict, flagstore dots (3), last checked, and a visible stale/frozen/source-error state; overview shows source freshness. No green when stale.
10. Tests (list them in your reply): verdict mapping table; unknown verdict never passes; monotonic ignore; unknown team/service rejected not thrown; transaction rollback on bad row; staleness; frozen detection; timeout/oversize/redirect refusal (mock fetch); ingest auth (missing/wrong/short token, oversize, >200 rows, GET → 405, token unset → 404); alert dedupe open/resolve; mock-guard; /api/meta badge matrix.
Acceptance: all green + browser check with a local fake scoreboard server (write scripts/fake-scoreboard.ts that serves a rotating fixture) showing: healthy → one service MUMBLE → dashboard functional fail + alert → kill fake server → stale/unknown, not green.
Commit: `feat(health): scoreboard/ingest health source with staleness`. CONTRACT CHANGE.
```

---
## W3 — Security, roles v1.2, freeze, organizer accounts (≈3 h)
```
SLICE W3 (plan first: permissions/audit/auth). Read doc 12 §5, §6, §9.
Do:
1. permissions.ts: add service.restart, service.reset, alert.ack, user.manage; operator gets service.restart/service.reset/alert.ack; admin all. Remove env.reset from 'team' unless config TEAM_SELF_RESET=true (default false). Update tests/permissions.test.ts in the SAME commit and keep the full matrix assertions.
2. Authz matrix test (tests/authz-matrix.test.ts): enumerate every route file under src/app/api by globbing, call each handler with (a) no cookie (b) operator (c) admin (d) team user, same-origin and cross-origin, and assert expected 401/403/404/2xx per a declarative table you create (routes.authz.ts). The test must FAIL when a new route is added without a table entry.
3. Mutation freeze: settings.mutations_frozen; POST /api/settings/freeze (admin, audited, requires typed confirmation 'FREEZE'); every mutating service call checks it (single helper assertNotFrozen) and returns MUTATIONS_FROZEN (423, added to errors.ts + docs/03). Reads, audit and logout still work. Banner in UI when frozen.
4. Organizer accounts: GET/POST /api/users, POST /api/users/[id]/reset-password|revoke-sessions|disable (admin, audited, zod). Passwords generated server-side, shown once, must_change_password honoured at login. Session JWT carries epoch; auth.ts rejects tokens whose epoch < users.session_epoch. Admin cannot disable/demote themselves or the last active admin.
5. Login limiter: keep ip:username, add per-IP ceiling (e.g. 30/10 min) and per-username lockout; read X-Forwarded-For only if TRUST_PROXY=true. Tests for each.
6. next.config.ts security headers: CSP (no unsafe-eval in prod; allow only self + what the app needs; verify the build and dev both work), frame-ancestors 'none', X-Content-Type-Options, Referrer-Policy no-referrer, Permissions-Policy; Cache-Control no-store on /api/*. Cookie flags: HttpOnly, SameSite=Lax, Secure when X-Forwarded-Proto=https or COOKIE_SECURE=true.
7. CSV hardening: formula-injection guard (prefix ', = + - @ tab, CR) on audit export and any CSV output; import caps (size, rows) tested.
8. Run `npm audit --omit=dev`; report highs/criticals; do not auto-upgrade majors.
Acceptance: authz matrix green and fails when a route is added unlisted (prove it); freeze verified over HTTP (423 on a mutation, 200 on reads); revoked session rejected; headers present on /login and /api/meta (show curl -I); no existing test weakened.
Commit: `feat(security): roles v1.2, freeze, organizer accounts, headers`. CONTRACT CHANGE.
```

---
## W4 — Lifecycle semantics, service actions, agent client (≈3 h)
```
SLICE W4 (plan first: adapter + services + UI dialogs). Read doc 12 §1 C1, C2, C5, §3 D21–D22 and 15 §3.
Do:
1. EnvironmentAdapter gains `readonly capabilities: {resetKind:'restore_patch'|'recreate_pristine'|'restart'; serviceLevelReset:boolean; terminalMode:'per_team'|'shared'; flagstores:number}`. Mock → restore_patch (existing behaviour, still SIMULATED); DockerCompose → restart (existing resetLabel); future agent → recreate_pristine. Expose via /api/meta.
2. Service actions: POST /api/teams/[teamId]/services/[key]/restart|reset (permissions service.restart/service.reset; reset requires {reason (≥10 chars), confirmTeamId} → CONFIRMATION_MISMATCH 422 otherwise; idempotency key; two audit rows with correlation id; honour frozen). Mock implements them on the state machine without breaking invariants (accepted_patch_version untouched). Add to the adapter interface as optional methods guarded by capabilities.serviceLevelReset.
3. Reset dialog copy switches on capabilities.resetKind: restore_patch → existing docs/05 §4 text; recreate_pristine → "Resets this team's environment from the pristine image. Player patches and the service database may be erased and the team may lose SLA points. Flags and scores are held by the game server and are not affected by this action." (do not claim anything about EnoEngine beyond that sentence being UNCONFIRMED — keep a TODO tag); restart → existing label. Reason + typed team id required for resetKind≠restore_patch.
4. src/lib/server/adapters/agent/ (ADAPTER=real): typed HTTP client implementing the contract in doc 15 §3: bearer token from env, 10 s timeout, retry only idempotent GETs, response zod, errors → ADAPTER_ERROR with no secret/URL leakage; job polling mapped onto the existing pending/lazy completion model. Until the club delivers an agent, test it ONLY against scripts/fake-agent.ts (in-process HTTP server) — and keep `createAdapter` rejecting ADAPTER=real unless ORCHESTRATOR_* are set. Badge stays PARTIAL/SIMULATED until the evidence gate (W8).
5. DockerComposeAdapter: DO NOT extend. Mark deprecated in code comments (it parses Cloudflare tunnel logs, obsolete). Terminal URL for per_team = configurable template TERMINAL_URL_TEMPLATE (e.g. https://host/{port}/), never logged or audited, shown only to authorised organizers.
6. Tests: capability-driven copy (component test), reset without reason/typed id → 422, operator allowed/team denied, frozen → 423, fake-agent success/timeout/5xx/invalid body, no URL/token in error messages, idempotent replay, invariants (accepted_patch_version, audit pairs).
Acceptance: all green; browser check of all three reset dialog variants (switch via a test-only env on mock, not shipped); screenshots.
Commit: `feat(lifecycle): capability-driven reset, service actions, agent client`. CONTRACT CHANGE.
```

---
## W5 — UI humanisation and matrix view (≈3 h)
```
SLICE W5. Use the frontend-design skill if available; read doc 12 §8 and docs/05. Look at the CURRENT screens first (headless Chrome screenshots at 1280×800, 1440×900, 1920×1080, 1024×768) and write a short defect list BEFORE changing anything.
Do:
1. Copy pass over every screen/dialog/toast/empty state: remove marketing voice (examples to fix: overview subtitle "A calm read on team environments…", "No open alerts. Operations are quiet.", "Review failures"-style vague CTAs). Buttons are verbs+object; empty states say what to do; errors say what happened and what to try; no emoji; sentence case; no adjectives where a number exists. Grep for banned words: seamless, powerful, elevate, effortless, robust, leverage, journey, calm, quiet.
2. Overview: top strip = event clock (phase/round from config+source; "Event clock not set" if unset) + source freshness; then a failing-first teams × services MATRIX (rows teams, columns services, each cell shows reach/func status and 3 flagstore dots with text labels in tooltip), compact rows, sticky header, tabular-nums, click → team detail. Keep alerts and recent activity below. Remove decorative backgrounds on data views (keep the login restrained).
3. Teams table: sortable columns, persistent filters in URL, row actions menu, bulk bar, keyboard focus rows, `/` focuses search, selection count; no layout shift on poll (stable row heights, skeletons only on first load).
4. Team detail: header with state/health/pending; tabs Overview/Services/Participants/Activity/Settings; Services tab = per-service table with flagstore verdicts, last checked, stale marks, restart/reset actions (permission-aware with explanatory tooltips); Terminal row shows availability only (no secrets in DOM unless authorised and user clicks).
5. Consistency: one spacing scale, one radius, one accent, status = colour+icon+text, 4.5:1 contrast everywhere (check with computed styles), focus rings, Esc closes dialogs + focus restore, reduced-motion respected, no animation on data refresh.
6. Performance basics: no unnecessary client components, memoise table rows, avoid re-render storms on 5 s polls (select/structural sharing), paused polling when hidden.
Acceptance: before/after screenshots listed with paths; zero console errors; a11y spot-check (tab order, labels, dialog focus); `git grep -iE "seamless|powerful|elevate|effortless|leverage|journey"` empty; lighthouse not required but report route JS sizes from `next build`.
Commit: `feat(ui): copy pass, services matrix, team detail refinements`.
```

---
## W6 — Operator workflows (≈2 h)
```
SLICE W6. Goal: make a 4-hour live shift fast. Add only what is below.
1. Incident view /overview?view=incidents (or tab): only failing/stale/failed teams, worst first, with one-click "Open team", "Run check", "Restart service" (permission-aware).
2. Command palette (cmdk already installed): jump to team by name/number, go to page, run "Run check" on a team; keyboard shortcuts documented in a help dialog (?).
3. Alerts: ack/resolve with note (audited), mute duplicates, counts in the sidebar badge.
4. Team notes inline with autosave-on-blur and conflict-safe PATCH; recently-touched teams list.
5. Bulk: extend existing bulk start/stop with progress per team and failure list (no success toast until polled final states match).
6. Print-friendly/CSV audit export with current filters (already exists: verify and keep injection guard).
Acceptance: every flow reachable by keyboard; audit rows for every mutation; browser checks; tests for new routes; authz matrix updated.
Commit: `feat(ops): incident view, command palette, alert ack, bulk progress`.
```

---
## W7 — Performance, reliability, soak (≈2 h)
```
SLICE W7. Measure first, then fix only what the numbers justify.
1. Add scripts/loadtest.ts (Node fetch, 3 simulated organizers, login via env credentials, poll overview/teams every 5 s, occasional lifecycle action on mock) and scripts/soak.ts (60-minute option) writing p50/p95/p99 and error counts. Targets on this laptop with 30 teams: /api/overview p95 < 150 ms, /api/teams p95 < 150 ms, payload overview < 60 KB, zero 5xx, memory stable (RSS growth < 15% over 60 min).
2. Profile adapters/mock.ts and services/teams.ts for N+1 queries (listTeams/getOverviewData/getTeam); batch them; add indexes where EXPLAIN QUERY PLAN shows scans. SQLite pragmas at open: WAL, synchronous=NORMAL, busy_timeout=5000, foreign_keys=ON (verify not already set).
3. scripts/backup.ts using better-sqlite3's online backup API to data/backups/<ts>.db, keep last 12; `npm run backup`; document a Windows Task Scheduler line to run it every 5 minutes during the event. Restore drill documented in README (already rehearsed; re-run once).
4. Client: confirm paused polling when hidden, no duplicate in-flight queries, route JS sizes from `next build` listed.
Acceptance: numbers pasted (before/after); soak result (if you cannot run 60 min, run 10 and say so).
Commit: `perf: query batching, indexes, backup script, load/soak tools`.
```

---
## W8 — Evidence gate with the club (club-dependent)
```
SLICE W8. Inputs required from the club are listed in 15 §1–§3. Do nothing destructive without the named authorisation recorded in docs/club-evidence/.
1. Map the real inputs: club-inputs/template.compose.yml → confirm service names/ports/offsets, memory limits, ttyd mode; update config/services.json and set nameConfirmed=true only for confirmed entries.
2. Point HEALTH_SOURCE at the real source; compare 3 teams against the club's own view for 10 minutes; record in docs/club-evidence/<date>-health.md.
3. Only if an agent (or the club-approved compose host) exists: ONE test team, one action at a time (start → stop → restart service → reset), each with request id, correlation id, expected vs observed final state, audit result, recovery. Fill the release decision table in docs/10_INTEGRATION_COORDINATION_PLAN.md §6. Badge becomes LIVE only if every row is evidenced; otherwise PARTIAL.
Acceptance: evidence files exist; the badge matches the evidence table; unsupported actions are disabled with a reason.
Commit: `docs(evidence): <date> club integration evidence`.
```

---
## W9 — Final hardening and freeze (≈2 h)
```
SLICE W9. No new features.
1. Full gate: typecheck, lint, tests, build, authz matrix, `npm audit --omit=dev`, check-env on the release .env.example copy, loadtest 10 min.
2. Fresh-clone rehearsal: new folder, `npm ci`, release env, seed, build, start:release on 3100, login as admin and operator, 3-minute demo script (docs/08 §3) twice, backup/restore once.
3. Update README (v1.2: sources, capabilities, freeze, ingest, backup, Windows start) and docs 01–09 per doc 12 §12; CHANGELOG entry; tag `v1.2.0-rc.1` (do not push without being told).
4. Event-day runbook docs/EVENT_RUNBOOK.md: start order, who holds which token, freeze procedure, what to say when health is stale, backup cadence, rollback to the last tag, escalation contacts (placeholders only).
5. Independent reviewer subagent over the full v1.2 diff (security + honesty + UI copy); fix valid findings.
Acceptance: all outputs pasted; fresh-clone run works; runbook exists.
Commit: `chore(release): v1.2.0-rc.1 hardening and runbook`.
```

---
## R — Independent review prompt (use after any slice, in a fresh Claude Code session or as a subagent)
```
You are an adversarial reviewer with NO stake in the code. Input: `git diff <base>..HEAD` and doc 12 §9. Find defects, not style. Output a table: severity (blocker/major/minor), file:line, what breaks, minimal fix. Check specifically: route order (requireUser→assertSameOrigin→sync→zod→service→errorResponse); can() on every mutation; audit pairs with one correlation_id; idempotency; frozen check; plaintext passwords never logged/returned outside reveal; unknown health values never become 'pass'; stale data never green; honesty (badge/copy claims only what is real); SSRF/redirect/size limits on health fetch; token compare constant-time; CSV formula injection; any test weakened or deleted; any contract rename. Run the tests yourself and paste counts.
```
