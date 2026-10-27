# BUILD STATUS (27 Oct 2026, verified on the real repo)

## Snapshot
- Branch `release/v1.2` (cut from `main`), version `1.2.0-rc.1`. Not pushed.
- Slices P1–P17 (v1.1) and W0 (v1.2 baseline) complete. Next: W1.
- Runtime: `ADAPTER=mock` -> `SIMULATED`. No real adapter, no real health source. `LIVE` must not be claimed.
- Commits on this branch (oldest first):
  - `acd43f9` feat(teams): extract `CredentialsReveal`, reuse on team detail
  - `c4ad549` chore: v1.2 baseline, check-env, version single-source, status sync
  - `9ebb544` fix(check-env): reject non-boolean flags, declare node >=20.12
  - `d46e74f` docs: v1.2 reconciliation, roadmap, masterprompt, prompt pack, club intake
  - `81f4d5a` docs: club reference PDFs

## W0 detail
- **Teams pages:** the uncommitted rewrites of `teams/page.tsx` and `teams/[teamId]/page.tsx` were reviewed, QA'd and committed. The one-time credential reveal is now `src/components/teams/CredentialsReveal.tsx`. Three unused icon imports left in `teams/page.tsx` were removed.
- **Behaviour change to know about:** on the team detail page the reveal no longer closes on Esc and requires the "I have saved these credentials" checkbox before Close (previously a plain dialog).
- **Version:** single source is `package.json`; `/api/meta` returns `pkg.version`; the Sidebar shows `…` until meta loads (no hard-coded fallback).
- **Release gate:** `npm run check-env` (logic in `src/lib/check-env.ts`, script `scripts/check-env.ts`, reads `.env` without overriding real env) exits 1 and prints variable names only (never values) when:
  - SESSION_SECRET is under 32 chars or the `.env.example` placeholder
  - DEMO_CONTROLS or ALLOW_DEFAULT_PASSWORDS is `true`, or not `true`/`false`
  - DB_PATH is unset or `:memory:`
  - organizer passwords are unset or `change-me`
  - ADAPTER is not `mock | real | docker-compose`
  `npm run start:release` = `check-env` then `next start`. `package.json` declares `engines.node >=20.12` (needed by `process.loadEnvFile`).
- **Docs:** root `CLAUDE.md` and `AGENTS.md` STATUS synced and identical; deadline now "UNCONFIRMED" (stale 19–20 Oct window removed); this file copied to `docs/BUILD_STATUS.md`. Docs 10–15, `docs/club-inputs/` and five club PDFs are now tracked.

## Evidence
- `npm run typecheck`: 0 errors.
- `npm run lint`: 0 errors, 58 warnings (legacy `any`/unused; unchanged count).
- `npm test`: 75/75 across 9 files (63 existing + 12 in `tests/check-env.test.ts`). Last run before the docs-only commits.
- `npm run build`: exit 0 (run after the check-env commit, before the final fix commit `9ebb544`; not re-run since).
- Headless-Chrome QA on a temp DB, production build, port 3100: `/teams` (24 rows) and `/teams/team-01` at 1280×800 and 1024×768; zero console errors or exceptions; screenshots of `/teams` at 1280 and detail at 1024 inspected.
- `/api/meta` over HTTP returned `{"adapter":"mock","version":"1.2.0-rc.1","demoControls":false}`.
- `check-env` run against the local `.env` exited 1 with a readable list and no secret values.
- Fresh reviewer subagent on `c4ad549`: no defects; two minor points (non-boolean flags, `engines`) applied in `9ebb544`.

## Not verified
- Credential reveal dialog was not exercised in a browser (rotate/create flow); only page render and console were checked.
- Lint, build and the full test run were not repeated after `9ebb544` (tests were: 75/75; typecheck clean).
- Keyboard/screen-reader accessibility QA remains manual. Tailwind v4/Turbopack CSS parser warnings may still appear on cold builds.

## Known gaps (v1.2 work)
- Services manifest is stale (`funsplash`, svc-3..5); needs config-driven 4-service manifest + flagstores (W1).
- No real health source (W2). No real lifecycle adapter; DockerCompose adapter targets an obsolete Cloudflare-tunnel design (W4).
- Roles/permissions need v1.2 additions, freeze switch, organizer account management, security headers (W3).
- UI copy and operator workflows need a human pass (W5–W6). Performance/soak not measured (W7).
- Club inputs missing: `template.compose.yml`, scoreboard sample, verdict list, reset semantics (`docs/club-inputs/`, doc 15). Event deadline unconfirmed.

## Hazards
- A local `.env` with `DEMO_CONTROLS=true` makes `next start` fail closed (500s). Release uses `DEMO_CONTROLS=false`; `check-env` now catches this.
- Port 3000 and `data/defcon.db` belong to a pre-existing server: do not touch. QA uses 3100/3101 with a temp `DB_PATH`.

## Plan
See `12_V1_2_RECONCILIATION_AND_ROADMAP.md` §10 and `14_PROMPT_PACK_W0_W9.md`. Tonight: W1 -> W2 -> dry-run (doc 12 §11).

## Next step
Slice W1 (doc 14), in a fresh session after pasting doc 13.
