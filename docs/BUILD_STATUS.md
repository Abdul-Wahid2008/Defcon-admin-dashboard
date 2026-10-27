# BUILD STATUS (corrected 27 Oct 2026, verified on the real repo)

## Verified
- Slices P1–P17 and W0 complete on branch `release/v1.2`; typecheck clean; vitest 74/74 across 9 files; runtime ADAPTER=mock → SIMULATED.
- W0: teams pages committed after QA (acd43f9); version single-sourced from package.json (1.2.0-rc.1); `npm run check-env` and `npm run start:release` added (11 tests).
- Permission matrix fully asserted (loops over all permissions per role + team-scope cases).

## Known gaps (v1.2 work)
- Services manifest is stale (`funsplash`, svc-3..5); needs config-driven 4-service manifest + flagstores (W1).
- No real health source (W2). No real lifecycle adapter; DockerCompose adapter targets an obsolete Cloudflare-tunnel design (W4).
- Roles/permissions need v1.2 additions, freeze switch, organizer account management, security headers (W3).
- UI copy and operator workflows need a human pass (W5–W6). Performance/soak not measured (W7).
- Club inputs missing: template.compose.yml, scoreboard sample, verdict list, reset semantics (docs/club-inputs/, doc 15).

## Plan
See `12_V1_2_RECONCILIATION_AND_ROADMAP.md` §10 and `14_PROMPT_PACK_W0_W9.md`. Tonight: W0 → W1 → W2 → dry-run (doc 12 §11).

## Next step
Slice W1 (doc 14), in a fresh session after pasting doc 13.
