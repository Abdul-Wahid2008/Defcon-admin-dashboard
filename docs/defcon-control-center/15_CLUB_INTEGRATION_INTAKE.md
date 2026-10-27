# 15 — CLUB INTEGRATION INTAKE (what the dashboard needs, what to ask, what to send)

Everything here is a request or a proposal. Nothing is confirmed until the lead writes it down. Do not paste secrets into this repo.

## 1. Health data (blocks live health; the dry-run tonight uses this)

**Option A — dashboard pulls (needs nothing new from the club):** the dashboard server fetches `/data/scoreboard.json` from the nginx on the EC2 host (event-flow draft: EnoEngine writes it every tick; nginx exposes it).
Need from the club: (1) the URL reachable from the dashboard host; (2) one real sample file; (3) confirmation of how per-service status is expressed (names of the status values); (4) whether the file is **frozen** during the last 30 minutes (draft says the scoreboard "stops" in the freeze phase); (5) the engine's team id for each team (so `external_team_id` can map).
**Option B — club pushes:** `POST /api/ingest/check-results`, `Authorization: Bearer <INGEST_TOKEN>`, body
`{"results":[{"teamId":"7","serviceKey":"docuvault","flagstore":"flag1","verdict":"OK|MUMBLE|OFFLINE|INTERNAL_ERROR","message":"optional","round":41,"checkedAt":"2026-10-30T10:15:30Z"}]}`
(≤200 rows, ≤256 KB). Preferred if Option A is frozen late-game.
**Questions:** which option; how many seconds between refreshes; which verdict strings exactly (we assume the enochecker3 set — **verify**).

## 2. Lifecycle and topology (blocks LIVE; otherwise we ship PARTIAL, honestly)

1. Who controls team stacks on the EC2 host and who authorises a destructive test? 2. Is a team one container or a compose project (service containers + DB containers + ttyd)? 3. Exact `docker compose` project naming (we assume `team-NN`). 4. Terminal: one shared ttyd or per team (Mukesh's test result)? URL scheme? Authenticated? 5. **Reset:** what does an admin reset restore (pristine image? previous patched files?) and does it wipe the service database? Is the spec's "teams may reset their own environment" revoked? 6. Which service names are final (DocuVault / PulseChat or CampusPortal / SwiftShop / Service 4) and are ports `10000+team*10+{0,2,3,4}` correct? 7. Team count (20 vs up to 30) and the ttyd port range. 8. Where will the dashboard run (same EC2 host, a private laptop on VPN)? It must not be reachable from participants.

## 3. Proposed lifecycle agent contract (PROPOSAL for whoever owns the EC2 host; replaces mounting a Docker socket into a web app)

A tiny HTTP service on the EC2 host, bound to a private interface, bearer-token auth, allow-list only.
- Team id must match `^team-\d{2}$`; service key must be in the manifest; no shell passthrough, no arbitrary compose args.
- `POST /v1/teams/{id}/start|stop|reset` → `202 {"jobId","status":"queued"}`; `POST /v1/teams/{id}/services/{key}/restart|reset` same. Headers: `Idempotency-Key`.
- `GET /v1/jobs/{jobId}` → `{"jobId","status":"queued|running|succeeded|failed","startedAt","finishedAt","error?"}`.
- `GET /v1/teams/{id}/status` → `{"state":"running|stopped|degraded|absent","containers":[{"name","state"}],"memoryMb","cpuPct"}`.
- `GET /v1/capabilities` → `{"resetKind":"recreate_pristine|restart|restore_patch","serviceLevelReset":true}`.
- All responses JSON; errors `{"error":{"code","message"}}`; 10 s default timeout; unknown team → 404.
If no agent exists by 29 Oct, the dashboard stays PARTIAL (live health, simulated lifecycle). That is an acceptable, honest release.

## 4. Messages you can send (edit freely)

**To the lead / Aaditya:** "For the admin dashboard I need two things by tonight: a sample of `/data/scoreboard.json` and its URL from the dashboard host, and a yes/no on whether it freezes in the last 30 min. I also need a written answer on reset: does admin reset wipe the service DB, and is team self-reset removed from the spec? Until then the dashboard shows health live and lifecycle as simulated."
**To Mukesh:** "Result of the single-ttyd test? I'll show terminal availability per team only; need the URL pattern (without credentials) and whether it's per-team or shared."
**To the registration owner:** "Please send a 3-row sample of the registration export (CSV/JSON) so the import maps team names and ids correctly."

## 5. Supabase, if the club insists on a shared roster table

Allowed only as a read-only roster source feeding the existing CSV/JSON import (dry-run first). Use a NEW dedicated project, service-role key only on the server, never in the browser; the dashboard does not write state there. Not needed for tonight.
