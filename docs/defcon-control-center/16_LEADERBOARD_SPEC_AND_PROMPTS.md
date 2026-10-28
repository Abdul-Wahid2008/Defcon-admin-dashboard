# 16 — LEADERBOARD SERVICE SPEC v2 (29 Oct 2026) — public, participant-facing

v1 is kept as `16_LEADERBOARD_SPEC_AND_PROMPTS.v1-superseded.md`. The overnight prompt to paste into Claude Code is `18_LEADERBOARD_OVERNIGHT_MASTERPROMPT.md`; this file is the reference it points to.

## 1. Decisions made by Abdul (29 Oct) and by me on his delegation
- **Confirmed by Abdul:** the leaderboard is built by us; it is **public and reachable by participants**; it **displays EnoEngine's scores** (A32 — we never compute points). Not yet confirmed by the club lead.
- **Registered-team roster arrives 30 Oct.** Until then the app runs on a provisional fixture and the real `scoreboard.json` sample is also still missing (A33).
- **Delegated to me:** every other decision below.

| # | Decision | Why |
|---|---|---|
| D25 | Separate app/repo `defcon-leaderboard` (sibling folder). Next.js 16 App Router, TS strict, Tailwind, Vitest, zod. | Different trust zone from the admin console. |
| D26 | Browser → leaderboard server only. Never to Supabase or EnoEngine. | Keys stay private; upstream load constant. |
| D27 | **No HTTP admin surface at all.** Reveal/unreveal/refresh are CLI commands on the host (`npm run reveal` etc.) that write `data/control.json` (local file, source of truth); the collector re-reads it every tick. | A public app must not expose an admin route even behind a token. Removes the biggest attack surface. |
| D28 | Freeze enforced server-side: after `freeze_at` nothing captured later is in any API body, history point or HTML until revealed. | Hiding columns is not a freeze. |
| D29 | Never fake liveness: stale/unavailable are explicit states. | Honesty. |
| D30 | Supabase = **optional history store**, server-side secret key only, RLS deny-all. Works fully without it (memory + local JSONL). | A 4-hour event must not hinge on a hosted DB. |
| D31 | **Zero third-party requests at runtime**: system font stacks (no Google Fonts), no analytics, no CDN scripts. | Privacy, resilience, strict CSP. |
| D32 | Public-traffic design: nginx micro-cache (2 s) + `limit_req`, app-level per-IP limiter as backstop, ETag/304, polling 10 s with jitter, `X-Robots-Tag: noindex`. | 100–300 viewers cost the app ≈1 request / 2 s. |
| D33 | Team display names come from the source; optional `data/roster.json` overrides display names only (no members, no emails, no PII). | Roster format unknown until tomorrow. |
| D34 | `FREEZE_AT_ISO` is mandatory in release mode (`CHECK_RELEASE=1` check-env fails without it). | An unset freeze would silently leak. |
| D35 | `SHOW_SERVICE_STATUS=false` by default (club can flip by env). | Public visibility of who is down helps attackers; club's call. |
| D36 | Parser uses a **field-mapping config** (`config/source-map.json`) + zod; adapting to the real file = edit mapping + fixture, not code. Unknown shape → fail closed. | Real format unseen. |

UNCONFIRMED assumptions: A32 (club lead), A33 (format), A36 (hosting: runs on the EC2 host behind nginx, internet-reachable; TLS/domain unknown), A37 (≤30 teams, ≤300 concurrent viewers, many on phones), A38 (roster is CSV/JSON with a team id and a display name), A39 (EnoEngine team id in the roster equals the id in `scoreboard.json`).

## 2. Architecture
```
EnoEngine host: EnoEngine ─► scoreboard.json ─► nginx /data/scoreboard.json (club-owned)
     ▲ server-side poll only (allow-listed host, 5 s timeout, 2 MB cap, redirect:error)
Leaderboard host (Node, ONE process, listens on 127.0.0.1:3200):
   collector (instrumentation hook + lazy fallback, single-flight) → normalise → rank → FallbackStore
        memory ring ─ data/snapshots.jsonl (append-only, fsync per round) ─ Supabase lb_* (optional)
   control file data/control.json  ◄── CLI: reveal | unreveal | refresh | status | peek | import-roster
   public API (read-only, clipped at freeze, 3 s in-process cache, ETag, per-IP limiter)
nginx (public): TLS if available · proxy_pass 127.0.0.1:3200 · proxy_cache 2 s · limit_req · no CORS * · gzip
Participants: poll /api/board every 10 s (paused when hidden)
```

## 3. Public contract (additive-only once published)
- `GET /api/board` → `{ meta:{ state:'pre_event'|'live'|'frozen'|'revealed'|'stale'|'unavailable', event:{name}, round, capturedAt, frozenAtRound?, serverTime, showServiceStatus }, teams:[{ teamId, name, rank, tied, total, attack?, defense?, sla?, rankDelta?, services?:[{key,status:'ok'|'mumble'|'offline'|'unknown'}] }] }`. Numeric fields exactly as provided; a missing/invalid `total` is a source error. `meta` never contains URLs, hostnames, errors or internal counters.
- `GET /api/history?top=10` (1–30) → `{ rounds:number[], series:[{teamId,name,points:number[]}] }`, clipped at freeze.
- `GET /api/healthz` → `{ ok:true }` only.
- Any other method/path → 404/405 with a minimal body. No cookies set, ever. No CORS headers (same-origin only).
- Ranking: `total` desc; equal totals share a rank (1,2,2,4) and are `tied`; secondary order = source order then name. `rankDelta` = previous stored rank − current rank.

## 4. Control CLI (host-side, no network)
`npm run status` (state, last round, last fetch age, store health, freeze/reveal flags, roster match count) · `npm run peek` (live top 10 even while frozen; prints, never serves) · `npm run reveal` / `unreveal` (writes control.json, requires typing the event slug to confirm, appends to `lb_audit`/local audit log) · `npm run refresh` (forces a single-flight pull) · `npm run import-roster -- <file.csv|json>` (validates, writes data/roster.json, prints a diff, never overwrites without `--yes`).
File permissions: control/roster/snapshot files are created user-only where the OS allows.

## 5. Supabase (history only)
Rules: (1) `list_projects` first; **never touch `pitch-under-pressure`**. (2) Create a NEW project `defcon-leaderboard` in region ap-south-1 only if `get_cost` shows no recurring charge and the org has capacity; otherwise record a blocker and continue with memory+JSONL. (3) DDL only via `apply_migration`; after each: `get_advisors` (security + performance), fix all findings; `generate_typescript_types`. (4) Schema `lb_init`: `lb_events(id uuid pk default gen_random_uuid(), slug text unique, name text, starts_at timestamptz, freeze_at timestamptz, ends_at timestamptz, created_at timestamptz default now())`; `lb_rounds(event_id uuid references lb_events, round int, captured_at timestamptz not null, primary key(event_id, round))`; `lb_scores(event_id uuid, round int, team_id text, team_name text not null, total numeric(14,3) not null, attack numeric(14,3), defense numeric(14,3), sla numeric(14,3), rank int not null, primary key(event_id, round, team_id), foreign key(event_id, round) references lb_rounds)`; `lb_audit(id bigint generated always as identity primary key, ts timestamptz default now(), action text not null, actor text not null, details jsonb)` with a trigger raising on UPDATE/DELETE; index `lb_scores(event_id, team_id, round)`; RLS enabled on all, `revoke all … from anon, authenticated`, no policies; no raw payload storage. (5) The secret key is placed by Abdul in `.env.local` as `SUPABASE_SECRET_KEY` (verify current key naming in the dashboard); Claude Code never asks for it in chat, prints it, commits it or uses a `NEXT_PUBLIC_` name; a test greps `.next/static` for it. (6) Writes are idempotent upserts keyed by `(event_id, round[, team_id])`.

## 6. Public-exposure security checklist
P1 no admin routes (D27). P2 zod on every query param; reject unknown params on `/api/history` (including `round`, `t`). P3 strict CSP with per-request nonce, `frame-ancestors 'none'`, nosniff, `Referrer-Policy: no-referrer`, `Permissions-Policy` empty, HSTS only when served over HTTPS (nginx). P4 response size cap and JSON-only. P5 per-IP limiter reads `X-Forwarded-For` only when `TRUST_PROXY=true` and only the right-most trusted hop. P6 team names: strip control/bidi-override chars, collapse whitespace, cap 40 chars, render as text. P7 no upstream URL/host/error text ever in a response or in client bundles. P8 `Cache-Control: public, max-age=2` only on board/history, `no-store` elsewhere. P9 freeze leak tests over API+history+HTML. P10 secrets absent from `.next/static`, logs and git. P11 bind the Node server to 127.0.0.1 in release (nginx is the public listener). P12 `npm audit --omit=dev` reviewed. P13 no cookies → no consent banner. P14 Slowloris/connection caps handled at nginx (`client_header_timeout`, `limit_conn`).

## 7. Deployment notes (documented, not applied by Claude Code)
EC2 host (Linux, `/home/ubuntu` per the event-flow draft — **verify OS and Node version**). Run `next start -H 127.0.0.1 -p 3200` under systemd (unit text in docs/DEPLOY.md), nginx in front. Alternative if the club has no public domain/TLS: serve on the event network over HTTP only and state it in the runbook. Final fallback: `npm run snapshot` writes a static `final.json`/`final.html` that nginx can serve if the Node process dies.
