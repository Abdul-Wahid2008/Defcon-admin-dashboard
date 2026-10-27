# 09 — CHANGELOG

## v1.2.0-rc.2 (27 Oct 2026): hardening and performance pass

- **Security**: nonce-based CSP (scripts no longer allow `unsafe-inline`), server-side logout (`revoked_sessions`, migration 005), 64 KB JSON body cap, clamped pagination (an absurd `page` was a 500), `Idempotency-Key` validation, 400 for malformed percent-escapes, global login ceiling, 12-character minimum for organizer passwords in `check-env`, `X-Powered-By` removed, COOP/CORP headers, server config no longer bundled into the browser.
- **Product**: admin "Reset health baseline" action (`POST /api/settings/health-baseline`), ARIA tabs with arrow keys on the team page, no layout jump when the source banner loads.
- **Dependencies**: removed unused `recharts` and `tw-animate-css`.
- **Evidence**: 60-minute soak, black-box attack probes, browser checks at four viewport sizes. Details in `BUILD_STATUS.md`.

## v1.2.0-rc.1 (27 Oct 2026)

Reconciliation after the club decisions (D16–D23) and slices W0–W9, details in `BUILD_STATUS.md`.

- **Health**: scoreboard pull and token ingest with staleness; unknown shapes fail closed; flagstore verdicts per service (W2).
- **Security**: roles v1.2, mutation freeze (423), organizer accounts and session revocation, login/CSRF hardening, rate limits, CSV formula guard, security headers (W3).
- **Lifecycle**: capability-driven reset wording, service-level actions, agent client (tested only against the fake agent) (W4).
- **UI and ops**: overview matrix, event clock, incidents view, command palette, alert acknowledge, conflict-safe notes, bulk progress (W5, W6).
- **Reliability**: online backup (`npm run backup`), load and soak tools, WAL `synchronous=NORMAL`; measured p95 17 ms at 30 teams (W7).
- **Evidence gate (W8)**: not executed, no club input or authorisation; decision record filled with "no evidence"; release mode stays SIMULATED/PARTIAL.
- **Hardening (W9)**: `shadcn` moved to devDependencies (`npm audit --omit=dev`: 0 vulnerabilities), event runbook, README v1.2.
- Contract changes: additive only (docs 03 and 04).

---

# v1.0 → v1.1 (17 Oct 2026)

## 1. Inputs reviewed and what each changed

Reviewed: `BUILD_STATUS.md` (repo `docs/`), the club registration site (rendered), and the pasted WhatsApp messages (11–13 Oct). **Could not open:** `github.com/eveniota/HAM-DEFCON`, `github.com/Gal1lioDev/REGISTRATION`, `defcon-ham-arc.onrender.com` (all block automated access) and the ephemeral trycloudflare link — so nothing here claims to know their contents beyond what the chat said.

| # | Finding | Source | Change made | Files |
|---|---|---|---|---|
| 1 | Event is a **4-hour attack-defense** competition → the console is likely operated live | Registration site | New assumption A19 and decision D15 (gate G1: real control on Day 4); soak test; audit CSV export promoted to P1; bulk start/stop first in stretch order; live-event ergonomics | 01, 05, 06, 07, 08 |
| 2 | **5–6 services per team** | Group, 11 Oct | Mock has five services from a manifest (D14, A9); services card became a compact table; seed and overview numbers updated; AC-16 | 01, 03, 04, 05, 08 |
| 3 | **Centralised `checker.py` per service** plants flags and checks services | Group, 11 Oct | Health verdict mapping (OK/OFFLINE/MUMBLE/INTERNAL_ERROR → our two checks) in `04 §4.1`; `checker_error` alert kind; checker rows in the real-orchestrator mapping; question to the club (A17) | 01, 03, 04 |
| 4 | **Terminal = `ttyd` :7681 + Cloudflare quick tunnel**, per team (compose) | Group, 13 Oct | `Terminal` type and `Environment.terminal`; A15/A16/A18; AC-17; security rules (URL is a secret; never host the dashboard publicly); risk rows | 01, 03, 04, 05, 08 |
| 5 | **Three difficulty tiers**, different points | Group, 13 Oct | Logged in `02 §11` only. No dashboard feature (considered: a difficulty chip per service — rejected: tier assignment is per vulnerability and point values are still unresolved) | 02 |
| 6 | DocuVault UI requested from volunteers | Group, 13 Oct | Explicitly **out of scope** so it does not eat the 5 days | 00, 01, CLAUDE |
| 7 | Registration systems exist (workers site, Render site, REGISTRATION repo) | Chat + site | F23 CSV import of registered teams (P2); `POST /api/teams/import`; question about export format | 01, 03, 05, 07 |
| 8 | `BUILD_STATUS.md` used a **different slice list** (P2 "Mock Backend & Adapter", P4 "Team CRUD"…) and pointed at `docs/07 §5` | BUILD_STATUS | Slice numbering declared authoritative (`07 §0`); corrected `BUILD_STATUS.md` provided; rules added to 00 and CLAUDE.md | 00, 06, 07, CLAUDE, BUILD_STATUS |
| 9 | Free-host registration sites | Chat | Never deploy the dashboard on public free hosts or quick tunnels | 01 |

## 2. Contract/schema delta for Claude Code (additive; apply as prompt P1b)

1. `Terminal { kind: 'ttyd'; port: number; url: string | null; isMock: boolean }` and `Environment.terminal: Terminal | null`.
2. `Service.placeholder: boolean`.
3. `Alert.kind` gains `'checker_error'`.
4. `/api/meta.adapter`: `'mock' | 'real' | 'docker-compose'` (badge `PARTIAL` for `docker-compose` or mixed).
5. New request/response schemas: `POST /api/teams/import` and `POST /api/environments/bulk` (both P2; schemas may be added now or in P17).
6. DB (applies when writing P2): `environments.terminal_url TEXT`, `services.placeholder INTEGER NOT NULL DEFAULT 0`; mock seed gets a service manifest.
7. Nothing renamed; P3 permissions unchanged (`env.start`/`env.stop` already cover bulk).

## 3. Deliberately not changed

- Per-participant credentials stay (A4), with the "one participant named `Team login`" fallback if the club ends up with per-team `ttyd -c` credentials. No schema change needed either way.
- Reset/stop/delete semantics, append-only audit, idempotency, five-day structure, cut list.
- No vulnerability details from the chat (e.g. DocuVault's three flags) were copied into these files: the dashboard does not need them and project knowledge should not become a spoiler sheet.

## 4. Things to verify (progress report said "9/9 tests green")

- P3 was specified as a table-driven matrix: 3 roles × 11 permissions = 33 role/permission cases, plus team own-vs-other-team and missing-resource cases. Vitest counts each `it.each` row as a test, so **9 tests suggests the matrix is grouped or not exhaustive**. Run `npx vitest run --reporter=verbose tests/permissions.test.ts` and check that every role × permission is asserted; if not, have Claude Code expand it before building on `can()`.
- Confirm P1 `config.ts` keeps `HEALTH_INTERVAL_SEC` and `IDLE_SESSION_TIMEOUT_MIN` as `null` (spec: TBD).

## 5. New questions for the club (also `01 §18` items 7–12)

Spec newer than v1.2? · One container per team or attackbox + tunnel + services? · Terminal: raw `ttyd` behind quick tunnels or an authenticating gateway; credentials per team or per participant? · Who builds the orchestrator and by when; OK to ship the experimental `DockerComposeAdapter`? · Registration export format? · Is the checker enowars-style and can we read its latest verdicts?

## 6. Observation on the pasted compose snippet

As pasted it is not valid compose (`tunnel:` is not nested under `services:`; `restart` and `command` are mis-indented) — likely a paste artefact. Whoever packages it should run `docker compose config`. Also verify Cloudflare's current limits for quick tunnels before relying on 20–30 of them for four hours; they are documented as a testing feature.


## 7. v1.1.1 (24 Oct 2026)

- **Bug in the blueprint's own example:** `.env.example` showed `SESSION_SECRET=change-me-32+chars`, which is only 18 characters and fails the 32-character check, so copying it unchanged made `POST /api/auth/login` return a bare 500. Replaced with an empty value plus a generator command.
- **Root cause of the bare 500:** config validation ran at module import (`db.ts` → `loadConfig()`), outside every handler's try/catch. New rule (`01 §13`, `CLAUDE.md` rules 13–14) and new slice **P5b** (`07 §4`).
- If your repo's `docs/BUILD_STATUS.md` is ahead of the copy in the zip, **keep yours** and only add the P5b line.


## 8. v1.1.2 (24 Oct 2026) — session handoff

Added `10_SESSION_HANDOFF.md` and `11_FIRST_MESSAGE.md` for continuing in a fresh Claude account/chat; updated `00_PROJECT_INSTRUCTIONS.md` (no-memory rule, unconfirmed deadline, repo snapshot rule). **Proposed, not yet in the contract:** a token-protected `POST /api/ingest/check-results` endpoint so the club's checker can push per-service verdicts, with a stale-result rule (design in `10 §7`). It stays out of `03` until the club decides push vs poll.
