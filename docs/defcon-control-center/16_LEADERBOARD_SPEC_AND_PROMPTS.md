# 16 — LEADERBOARD SERVICE: SPEC, MASTERPROMPT AND SLICES L0–L6 (28 Oct 2026)

**Scope change D24 (28 Oct, from Abdul; not yet confirmed by the club lead):** the leaderboard is built by us. Until now it was out of scope in CLAUDE.md. It is a **separate application**, not a page in the admin console, because it faces participants and the admin console must never be reachable by them.

## 1. Facts, assumptions, decisions

Facts (from the club's event-flow draft and PDFs): EnoEngine (central, .NET) generates flags, runs enochecker3 checkers and computes scores; it writes `scoreboard.json` each tick; nginx on the EC2 host exposes `/data/scoreboard.json` (CORS `*`) and an attack-info endpoint; rounds are 90 s, ~110 rounds; phases 45 min peace / 165 min battle / 30 min freeze (**draft**).

UNCONFIRMED assumptions: **A32** EnoEngine computes all points; we display, we never compute scoring. **A33** `scoreboard.json` shape unknown — parser is fixture-driven and fails closed. **A34** "Freeze" hides scores from the public view only; organizers can still see live. **A35** Per-service status per team is public only if the club says so (`SHOW_SERVICE_STATUS=false` by default). **A36** Hosted on the EC2 host behind nginx; viewers are on the event network (hosting/visibility question open). **A37** ≤30 teams, ≤150 concurrent viewers, many on phones.

Decisions:
- **D25 Separate repo/app** `defcon-leaderboard` (sibling folder). Next.js 16 App Router + TS + Tailwind, same stack as the dashboard (no new UI kit). No auth to view; no cookies; read-only.
- **D26 Browsers never talk to Supabase or to EnoEngine.** Browser → leaderboard server only. The server polls EnoEngine, writes history, and serves a cached, clipped view. This keeps keys private and upstream load constant.
- **D27 Supabase = history store only**, accessed with the server-side secret key. All tables have RLS enabled and **no policies for anon/authenticated** (deny-all). If Supabase is down the board keeps working from memory + a local append-only JSONL file and backfills later.
- **D28 Freeze is enforced on the server.** After `freeze_at` the public API/HTML/history never contain anything captured after it, until an admin **reveals**. Hiding columns in the UI is not a freeze.
- **D29 Never fake liveness.** Source down or stale → show last good data with its timestamp and a stale banner; never "live".

## 2. Architecture

```
EnoEngine host:  EnoEngine ─► scoreboard.json ─► nginx /data/scoreboard.json
                                   │ (server-side poll, allow-listed host, 5 s timeout, 2 MB cap)
 Leaderboard server (Next.js, 1 process) ─ collector (instrumentation hook + lazy fallback, single-flight)
        │  normalise → rank → store                    ├─► memory ring buffer (last N rounds)
        │                                               ├─► data/snapshots.jsonl (append-only local fallback)
        │                                               └─► Supabase (lb_* tables, secret key, RLS deny-all)
        └─► GET /api/board, /api/history  (3 s in-memory cache, ETag, per-IP rate limit, clipped at freeze)
 Participants' browsers: poll /api/board every 10 s (paused when hidden), render only what the API returns.
```

## 3. Public contract (all additive-only once published)

- `GET /api/board` → `{ meta:{ state:'pre_event'|'live'|'frozen'|'revealed'|'stale'|'unavailable', round, capturedAt, frozenAtRound?, serverTime, showServiceStatus }, teams:[{ teamId, name, rank, tied:boolean, total, attack?, defense?, sla?, rankDelta?, services?:[{key,status:'ok'|'mumble'|'offline'|'unknown'}] }] }` — numeric fields only as provided by the source; missing optional fields are omitted, a missing `total` is a source error.
- `GET /api/history?top=10` (1–30) → `{ rounds:[...], series:[{teamId,name,points:[...]}] }`, clipped to the freeze unless revealed.
- `GET /api/healthz` → `{ ok:true }` (no data). `POST /api/admin/reveal|unreveal|refresh` → Bearer `LEADERBOARD_ADMIN_TOKEN` (≥32 chars, constant-time compare, rate-limited, audited in `lb_audit`). Unset token → 404.
- Ranking: sort by `total` desc; equal totals share a rank (1,2,2,4) and are flagged `tied`; secondary order = source order, then name. `rankDelta` = previous rank − current rank from the last stored round.

## 4. Supabase rules for Claude Code (read before any MCP call)

1. First call `list_projects`. **Never modify `pitch-under-pressure`** (unrelated, paused).
2. Create a NEW project `defcon-leaderboard` only after `get_cost`; **show the cost to Abdul and wait for his explicit yes**, then `confirm_cost`. Ask which region (default ap-south-1; nearest to the EC2 host is better).
3. DDL only through `apply_migration` with snake_case names; no DDL through `execute_sql`. After every migration run `get_advisors` (security + performance) and fix every finding; paste the result.
4. Schema (migration `lb_init`): `lb_events(id uuid pk default gen_random_uuid(), slug text unique, name text, starts_at timestamptz, freeze_at timestamptz, ends_at timestamptz, revealed boolean not null default false, created_at timestamptz default now())`; `lb_rounds(event_id uuid references lb_events, round int, captured_at timestamptz not null, primary key(event_id, round))`; `lb_scores(event_id uuid, round int, team_id text, team_name text not null, total numeric(14,3) not null, attack numeric(14,3), defense numeric(14,3), sla numeric(14,3), rank int not null, primary key(event_id, round, team_id), foreign key(event_id, round) references lb_rounds)`; `lb_audit(id bigint generated always as identity pk, ts timestamptz default now(), action text, actor text, details jsonb)` with a trigger that raises on UPDATE/DELETE. Indexes: `lb_scores(event_id, team_id, round)`. **No raw payload storage** (size). Enable RLS on every table, `revoke all` from `anon, authenticated`, no policies.
5. Keys: the server uses the secret/service key from `.env.local` as `SUPABASE_SECRET_KEY` (**verify the current key naming in the Supabase dashboard**). Abdul puts it in the file himself; Claude Code must never ask for it in chat, print it, commit it, or prefix it `NEXT_PUBLIC_`. A test scans `.next/static` for it.
6. Generate TS types with `generate_typescript_types`. Writes are idempotent upserts on `(event_id, round[, team_id])`.
7. Free-tier projects can pause when idle: before the event, check the project is ACTIVE and note it in the runbook.

## 5. MASTERPROMPT (paste first in every leaderboard Claude Code session; then ONE slice)

```
You are the lead engineer on the DEFCON Leaderboard (new app, sibling folder ../defcon-leaderboard; reference docs live in ../defcon-control-center/docs/defcon-control-center/, especially 16_LEADERBOARD_SPEC_AND_PROMPTS.md and 12 §8–§9). It is shown to ~100 participants during a 4-hour attack-defense CTF at Technozion, NIT Warangal. A wrong rank, a leaked frozen score or a dead page is publicly visible, so correctness and honesty beat features.

HARD RULES
- We DISPLAY scores computed by EnoEngine; we never compute points (A32). Never invent the scoreboard.json shape, field names, status strings or club endpoints. Parse behind an interface from a real sample in ../defcon-control-center/docs/club-inputs/scoreboard.sample.json; if it is missing use a clearly-labelled PROVISIONAL fixture, fail closed on any unknown shape, and list exactly what must be confirmed. Unknown never becomes "ok".
- Browsers never reach Supabase or EnoEngine. Server-only secrets; nothing secret in client bundles.
- Freeze is enforced server-side (D28). Test it by moving the clock past freeze and asserting that API bodies AND rendered HTML contain no later round.
- Honest states: pre_event / live / frozen / revealed / stale / unavailable. Never show "live" when stale.
- Security: zod on every input, strict headers/CSP with per-request nonce, no cookies, no CORS wildcard, per-IP rate limit, response size caps, constant-time admin token compare, no PII (team names only), team names rendered as text and length-capped.
- Stack: Next.js (App Router), TypeScript strict, Tailwind, Vitest, zod, @supabase/supabase-js (server only). No other UI kit/state library; any new dependency needs a one-line reason. Do not touch ../defcon-control-center source (docs/club-inputs may be read only). Do not touch Supabase project pitch-under-pressure.
- Windows machine. Use ports 3200 (start) / 3201 (dev). Never print .env*/.env.local; never commit them. Do not create a GitHub remote or push unless told.
- UI: restrained, high-contrast, tabular numerals, plain copy (no marketing words, no emoji, no gradients/glow on data), works at 1920×1080 (30 teams without scrolling in ?tv=1), 1280, 1024 and phone width (collapse to rank/team/total). Look like a human designed it.

WORKFLOW per slice: restate goal and files → plan first if >3 files or Supabase/freeze/collector → implement in small commits → VERIFY WITH EVIDENCE and paste output tails (typecheck, lint 0 errors, tests with counts, build, browser QA via headless Chrome at the widths above with zero console errors) → spawn a fresh reviewer subagent with the diff and the slice's acceptance list, apply valid findings → update CLAUDE.md STATUS + BUILD_STATUS.md → commit. Final reply: what changed (≤8 lines) · evidence · CONTRACT CHANGES · questions for Abdul/club · next slice. If you did not run it, say so.
```

## 6. SLICES

### L0 — Scaffold and gates (≈45 min)
```
SLICE L0. Create ../defcon-leaderboard: `git init` (default branch main), Next.js 16 + TS strict + Tailwind v4, Vitest, ESLint. Scripts: dev, build, start, typecheck, lint, test, check-env, qa:layout. Add CLAUDE.md/AGENTS.md (identical) with the HARD RULES above, BUILD_STATUS.md, .env.example (SCOREBOARD_URL, SCOREBOARD_ALLOWED_HOSTS, POLL_SEC=15, STALE_AFTER_SEC=270, ROUND_SEC=90, EVENT_SLUG, FREEZE_AT_ISO, SHOW_SERVICE_STATUS=false, BASE_PATH, LEADERBOARD_ADMIN_TOKEN, SUPABASE_URL, SUPABASE_SECRET_KEY, RATE_LIMIT_PER_MIN=120, TRUST_PROXY=false) and .gitignore (.env*, data/). src/lib/config.ts: zod, fail-closed, lazy (never at import time), with a check-env script that refuses weak/missing values and prints nothing secret. Security headers + nonce CSP via proxy.ts following the dashboard's pattern (read ../defcon-control-center/src/proxy.ts and next.config.ts for the approach; do not copy blindly). /api/healthz. One landing page placeholder. Tests for config.
Acceptance: all gates green, `git status` clean after commit, check-env fails on a bad env (show it).
```

### L1 — Source, parser, normalisation, ranking (≈2 h)
```
SLICE L1 (plan first). Implement src/lib/source/: fetcher (allow-listed host from SCOREBOARD_ALLOWED_HOSTS, 5 s AbortSignal, redirect:'error', 2 MB cap, no credentials, content-type check), parser behind `interface ScoreboardParser { parse(json: unknown): RawBoard }`, normaliser → `Snapshot {round, capturedAt, teams[]}`, ranker (competition ranking with `tied`, deterministic secondary order), rankDelta. Use docs/club-inputs/scoreboard.sample.json if present (zod schema derived from it, `.passthrough()` off for known critical fields); otherwise PROVISIONAL fixture + SOURCE_SHAPE_UNKNOWN on mismatch, and report precisely which fields you need. Never compute totals; a missing/NaN/negative-infinity total is a source error. Sanitise team names (strip control chars, collapse whitespace, cap 40 chars) and keep the original id as teamId.
Tests: golden sample; every missing-field/wrong-type case fails closed; ties (1,2,2,4); rankDelta; huge/oversize/redirect/timeout; unicode/RTL/HTML in names stays inert; round going backwards is ignored; duplicate team ids rejected.
Acceptance: 100% of parser branches covered by tests (show coverage for src/lib/source), no test uses a made-up shape without the PROVISIONAL label.
```

### L2 — Supabase and stores (≈2 h; contains a STOP for cost approval)
```
SLICE L2 (plan first). Follow §4 of 16_LEADERBOARD_SPEC_AND_PROMPTS.md exactly. Steps: list_projects → get_cost → STOP and ask Abdul to approve cost/region → create_project/confirm_cost → apply_migration `lb_init` (schema in §4.4, RLS on, revoke from anon/authenticated) → get_advisors (security+performance) and fix findings → generate_typescript_types → tell Abdul to place SUPABASE_URL and SUPABASE_SECRET_KEY in .env.local himself (do not ask him to paste it). Then code: `interface SnapshotStore { saveRound(snapshot): Promise<void>; latest(): Promise<Snapshot|null>; rounds(upToRound?): Promise<Snapshot[]>; event(): Promise<EventRow>; setRevealed(b): Promise<void> }` with SupabaseStore (server-only, idempotent upserts in one transaction/RPC-free batch, timeouts, bounded retries with backoff), MemoryStore (ring buffer), JsonlStore (append-only data/snapshots.jsonl, fsync per round) and a FallbackStore that always writes memory+JSONL first, then Supabase, and backfills Supabase from JSONL when it recovers (idempotent). Startup rebuild: Supabase → else JSONL → else empty.
Tests: contract tests run against Memory/Jsonl/Fake-Supabase; an opt-in integration test (env LB_INTEGRATION=1) against the real project using a throwaway event slug and cleaning up; Supabase outage simulation keeps serving and later backfills with no duplicates; JSONL truncated last line tolerated; audit trigger blocks UPDATE/DELETE (prove via SQL through execute_sql SELECT-only checks or a migration test); service key absent from .next/static (build then grep).
Acceptance: advisors output pasted and clean; no secret in repo or logs; outage test green.
```

### L3 — Collector, freeze/reveal, public API (≈2.5 h)
```
SLICE L3 (plan first). Collector: started from instrumentation.ts register() (Node runtime only; verify in the Next.js docs for this version) with setInterval(POLL_SEC) + jitter, single-flight, plus a lazy refresh when a request finds data older than 2×POLL_SEC; every failure recorded in an in-memory source-state (lastOkAt, lastError, consecutiveFailures) exposed (without URLs) in meta.state. Only store a round when round number is new and totals parse. State machine for meta.state: pre_event (before starts_at or no data) / live / stale (no good fetch for STALE_AFTER_SEC) / frozen (now ≥ freeze_at and not revealed) / revealed / unavailable (no data at all). Freeze clipping: board and history serve the newest round with captured_at ≤ freeze_at; the frozen body must not contain later round numbers, later timestamps or later totals. Reveal/unreveal/refresh admin routes (Bearer, constant-time, rate-limited, audited to lb_audit and local log). API: /api/board (+ETag/304, Cache-Control public max-age=2), /api/history (zod `top`), /api/healthz; 3 s in-memory response cache; per-IP rate limit (TRUST_PROXY gates X-Forwarded-For); max response size; JSON only.
Tests (list counts): state machine table with an injectable clock; freeze leak test across API+history+HTML; reveal flow; stale never reported as live; ETag; rate limit; admin auth (missing/wrong/short/unset→404); collector single-flight; restart mid-event rebuilds from store.
Acceptance: scripts/fake-scoreboard.ts rotating fixture demo: live → frozen (clock moved) → reveal; kill fake source → stale banner state in API.
```

### L4 — UI (≈3 h)
```
SLICE L4. Use the frontend-design skill if available. First screenshot nothing — start from this spec, then iterate with headless-Chrome screenshots at 1920×1080 (?tv=1 and normal), 1440×900, 1280×800, 1024×768, 390×844.
Header: event name, state pill (text+icon+colour), round N, server time, "last updated Ns ago". Board: Rank, Team, Total, Attack, Defense, SLA (only columns present), Δ (▲▼ with number, neutral dash), optional service dots with text in tooltip when showServiceStatus. Rows keyed by teamId, stable heights, right-aligned tabular numerals, top-3 subtly marked (no medals/emoji), tie shown as "=2". Team drawer (click/Enter): per-team score breakdown and a rank/score-over-time sparkline from /api/history (inline SVG, no chart library unless justified). Stale/frozen/pre-event/unavailable banners with plain wording ("Scores frozen at round 110. Final results will be announced."). ?tv=1: larger type, 30 teams fit 1080p without scrolling, no cursor UI. Polling every 10 s with jitter, paused when hidden, abort in-flight on unmount, exponential backoff on errors, keep last data on error. No layout shift on updates; row change highlight ≤600 ms and respects prefers-reduced-motion. Accessibility: semantic table, caption, scope attributes, focus rings, 4.5:1 contrast, keyboard drawer with Esc + focus restore.
Acceptance: screenshots listed; zero console errors; `npm run qa:layout` (headless Chrome via CDP, as in the dashboard repo's recipe) asserts no horizontal overflow at all widths; copy grep for marketing words is empty.
```

### L5 — Hardening and load (≈2 h)
```
SLICE L5. Attack the production build yourself (like the dashboard's hardening pass): oversized/malformed query strings, `top=NaN|-1|1e9`, HEAD/OPTIONS/TRACE, path traversal, double-encoded paths, huge headers, slowloris-style stalls, many connections, forged X-Forwarded-For with TRUST_PROXY false, admin token brute force, cache poisoning via Host/headers, HTML/script in team names, JSON with duplicate keys/proto pollution, freeze bypass via `?round=`, `?t=` or history params, Range requests. Fix everything real; paste the matrix of attempts and results. Then scripts/loadtest.ts: 150 clients polling every 10 s for 10 min against the build with a rotating fake source: target p95 < 100 ms, zero 5xx, RSS growth < 15%, upstream fetches ≤ 1 per POLL_SEC, Supabase writes ≤ 1 per new round. Run `npm audit --omit=dev`.
Acceptance: results pasted; all tests green; reviewer subagent findings applied.
```

### L6 — Live wiring, dry-run, runbook (club-dependent)
```
SLICE L6. Preconditions: docs/club-inputs/scoreboard.sample.json (and ideally one from the freeze window), the real SCOREBOARD_URL reachable from the leaderboard host, event slug and starts_at/freeze_at/ends_at, answer on SHOW_SERVICE_STATUS, hosting decision. If any is missing, STOP and list what is missing — do not guess. Then: update parser to the real sample; seed lb_events; run against the live source for 15 min; compare 5 teams' total/rank with the club's own view at the same round and record in docs/club-evidence/<date>-leaderboard.md (in the dashboard repo's docs); rehearse freeze (temporarily set freeze_at 3 min ahead on a temp event), reveal, source outage, Supabase outage, process restart; nginx snippet for the EC2 host (proxy_pass, BASE_PATH, rate-limit zone, no CORS `*`, gzip, HSTS only if HTTPS) written as docs/NGINX.md — do not apply it. Write docs/EVENT_RUNBOOK.md for the leaderboard: start order, who holds the admin token, freeze/reveal procedure, what to tell participants when stale, backup (JSONL copy), rollback, checks that Supabase is ACTIVE.
Acceptance: evidence file; runbook; every state demonstrated once with screenshots.
```
