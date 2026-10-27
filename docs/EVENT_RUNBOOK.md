# DEFCON Control Center — event-day runbook (v1.2.0-rc.2)

Audience: the 1–3 organizers running the console. Written 27 Oct 2026. Everything here is verified against the repository; items that depend on the club are marked **CLUB**.

## 0. What the badge means

| Badge | Meaning |
|---|---|
| SIMULATED | Lifecycle and health are both the built-in mock. Nothing touches real containers. |
| PARTIAL | At least one source is real (scoreboard pull, ingest, or a non-mock adapter), but not everything is proven. |
| LIVE | Not reachable in this release. It needs `EVIDENCE_GATE_PASSED=true` **and** an adapter that reports `fullyReal`; no adapter does. |

Say what the badge says. Do not describe SIMULATED data as real.

## 1. Start order (Windows, demo machine)

1. Pre-flight on the machine: nothing else on the dashboard port; `data/` on durable disk; power connected.
2. Fresh checkout only: `npm ci --ignore-scripts` (plain `npm ci` tries to compile better-sqlite3 and fails without Visual Studio C++ build tools).
3. Release `.env` (never committed): `SESSION_SECRET` (64+ random hex), `DB_PATH` set to a real file, `DEMO_CONTROLS=false`, `ALLOW_DEFAULT_PASSWORDS=false`, non-default `ORGANIZER_ADMIN_PASSWORD` / `ORGANIZER_OPERATOR_PASSWORD`, `ADAPTER` and `HEALTH_SOURCE` chosen. For ingest: `INGEST_TOKEN` of 32+ characters. For scoreboard: `HEALTH_SCOREBOARD_URL` (+ `HEALTH_ALLOWED_HOSTS` if the host differs). Organizer passwords must be at least 12 characters (`check-env` refuses shorter ones).
4. First time on this DB only: `npm run seed` (demo data; it reads the process environment, not `.env`, so export the `.env` values first) or import the real roster from the Teams page (`external_team_id` as third CSV column).
5. `npm run build` (once per code change), then `npm run start:release` (set `PORT` if 3000 is taken; it defaults to 3000). It runs `check-env` first and refuses to start on a weak or unsafe config; read its message, fix `.env`, retry.
6. Open the console, log in as admin, confirm the badge matches what you intend, open Settings and check health source freshness and the event clock.
7. Start the backup task (section 5) and take one manual backup: `npm run backup`.
8. Log in as operator in a second browser and confirm Delete is disabled for that role.

Do not change the adapter mode during the event. If an integration is unavailable, keep the known-good SIMULATED/PARTIAL release and say so.

## 2. Who holds which secret

| Secret | Holder | Notes |
|---|---|---|
| `SESSION_SECRET` | Dashboard owner only | Rotating it signs everyone out. |
| Admin password | Lead organizer | Change after rehearsal; admin can create/disable organizer accounts. |
| Operator password | Moderators | Cannot delete teams or change settings. |
| `INGEST_TOKEN` | Dashboard owner + the checker host's operator (**CLUB**) | Sent as `Authorization: Bearer <token>` to `POST /api/ingest/check-results`. Never paste it in chat or commit it. |
| `ORCHESTRATOR_TOKEN` | Whoever owns the agent (**CLUB**, owner not yet named) | Only needed with `ADAPTER=real`. |
| Participant credentials | Shown once on create/rotate/import | Plaintext is never stored; re-issue by rotating. |

## 3. Freeze procedure

Use when the event is at a critical moment (for example the last 30 minutes) and no organizer action may change state.

1. Settings, admin only: Freeze mutations, type `FREEZE`, confirm. Mutating routes then return 423 `MUTATIONS_FROZEN`; reads and the audit log keep working, and "Run check" stays available because it only refreshes data.
2. Everyone is told: no lifecycle, team or account changes until unfreeze.
3. To unfreeze: Settings, Unfreeze. Both actions are written to the audit log.
4. If an emergency action is needed while frozen: unfreeze, act, freeze again, and say why in the notes.

## 4. What to say when health is stale

Stale means the source has not delivered a result within `stale_after_sec` (default 270 s). Stale services show as **unknown**, never green.

- Say: "Health is stale: the checker data has not updated since <time>. We are not claiming those services are up."
- Check in order: (1) the health-source freshness indicator in the console (and `/api/meta`) for the last error (`SOURCE_SHAPE_UNKNOWN`, fetch error, rejected batch); (2) is the scoreboard URL reachable from this machine; (3) for ingest, is the checker still posting and is the token valid; (4) run "Run check" on one team (under SIMULATED health this is a simulated check and says so).
- A scoreboard frozen by the club in the final stretch will look stale. That is expected until an unfrozen status source exists (**CLUB**).
- Checker or scoreboard restarted and every row is now rejected as "older than stored" (overview shows `all_rows_rejected`)? An admin opens Settings, "Health source baseline", types `RESET` and confirms. It arms a one-shot switch: the next batch is accepted even though its round numbers are lower, then the switch turns itself off. Nothing stored is rewritten, so old results still go stale. The action is audited.
- Never edit the database to make health look fine.

## 5. Backup cadence

- Every 5 minutes during the event via Task Scheduler (command in README, "Online backup"), keeping the newest 12 files in `data/backups/` (one hour of history). Check `data\backup.log` shows `backup ok`.
- Before any risky operation: `npm run backup`.
- Restore: stop the server, copy the chosen `data/backups/<ts>.db` over `DB_PATH`, delete `DB_PATH-wal` and `DB_PATH-shm`, start the server, verify team count, audit row count and the badge. A power cut can lose the last few seconds of writes (WAL, `synchronous=NORMAL`) but not corrupt the database.

## 6. Rollback to the last tag

1. `npm run backup`, then stop the server.
2. `git status` must be clean. `git checkout v1.2.0-rc.2` (the last tag), `npm ci --ignore-scripts`, `npm run build`, `npm run start:release`.
3. Migrations only move forward. Rolling code back over a newer database is safe only if no newer migration ran since the tag; if one did, restore a backup taken before it.
4. Record what was rolled back and why in the event notes.

## 7. Incident quick reference

| Symptom | First action |
|---|---|
| Console returns 500 on every page | Almost always config: run `npm run check-env`; a local `.env` with `DEMO_CONTROLS=true` makes `next start` fail closed. |
| Action stays "pending" | Pending transitions resolve on the next request after their due time; reload. Under the agent adapter check the agent, not the dashboard. |
| An action failed | The failure is persistent on screen and in audit; do not retry blindly. Read the audit row (correlation id), then decide: reset is not the same as restart. |
| Login blocked | The limiter locks a username for 5 minutes after 10 failures from any address, an address+username pair for 1 minute after 5, and all logins at 120 attempts per minute. Anyone who can reach the login page can therefore lock an organizer out for 5 minutes (known trade-off; keep the dashboard on the organizer network only). Fastest recovery: restart the dashboard process (the limiter is in memory, nothing else is lost), or wait. Already signed-in sessions are not affected. An admin can revoke sessions or reset another organizer's password through the admin API (`/api/users/[id]/revoke-sessions`, `/reset-password`); there is no UI for these yet. |
| Wrong team data | Do not delete. Archive via admin Delete only if it really is a duplicate; deletion removes the team's environment resources. |

## 8. Escalation contacts (placeholders — fill before the event)

| Role | Name | Phone/handle |
|---|---|---|
| Dashboard owner | ______ | ______ |
| Club lead / release decision | ______ | ______ |
| Orchestrator / agent owner (**CLUB**) | ______ | ______ |
| Checker / scoreboard owner (**CLUB**) | ______ | ______ |
| Network / host admin | ______ | ______ |

## 9. Known limits to state honestly

- No real orchestrator is connected; LIVE is not available in this release.
- The scoreboard parser is provisional until a real sample exists; unknown shapes fail closed.
- Reset semantics, service names and ports are unconfirmed; the UI labels them so.
- Scripts run only with a per-request nonce (no `unsafe-inline` for scripts); styles still allow inline because the UI kit sets style attributes. The dashboard must still be reachable from the organizer network only: serve it over HTTPS (or set `COOKIE_SECURE=true`) and never on a public host or quick tunnel.
- Logging out revokes that session token at once; a copied cookie stops working. Sessions issued before the hardening pass (27 Oct) were not individually revocable and expire within 8 hours.
