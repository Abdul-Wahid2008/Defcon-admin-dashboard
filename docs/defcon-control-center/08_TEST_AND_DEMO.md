# 08 — TEST PLAN, ACCEPTANCE CHECKLIST AND DEMO SCRIPT

## 1. Acceptance checklist (tick on Day 4 and again on Day 5)

| ID | Criterion | How to verify | D4 | D5 |
|---|---|---|---|---|
| AC-01 | Login works; wrong password rejected; unauthenticated API → 401 | UI + `curl /api/teams` without cookie | ☐ | ☐ |
| AC-02 | Directory shows all teams; search + filters work | Search "team-1", filter state=stopped, health=down | ☐ | ☐ |
| AC-03 | Create team → ID assigned, provisions, credentials shown once | Create "Demo Team"; close dialog; confirm passwords cannot be re-shown | ☐ | ☐ |
| AC-04 | Edit team persists + audit | Rename, reload, check Activity tab | ☐ | ☐ |
| AC-05 | Team detail shows all required data | Visit a running team; check every card | ☐ | ☐ |
| AC-06 | Distinct dialogs for stop/start/reset/delete; delete needs typed name | Open each | ☐ | ☐ |
| AC-07 | Pending state then real final state; no premature success | Reset a team; watch badge and toast timing | ☐ | ☐ |
| AC-08 | Forced failure → failure toast, `failed` state, alert, failure audit | Demo control "fail next reset" then reset | ☐ | ☐ |
| AC-09 | Operator cannot delete/use admin features (UI and API) | Log in as operator; try; also `curl` DELETE with operator cookie → 403 + `denied` row | ☐ | ☐ |
| AC-10 | Audit is append-only | Try `UPDATE`/`DELETE` via test; no API route | ☐ | ☐ |
| AC-11 | Overview totals = directory totals | Compare counts after several actions | ☐ | ☐ |
| AC-12 | Badge reads from `/api/meta`; SIMULATED in mock | Toggle `ADAPTER` env; restart | ☐ | ☐ |
| AC-13 | Vitest suite green | `npm test` | ☐ | ☐ |
| AC-14 | Demo script runs twice cleanly after `reset-demo` | Section 3 | ☐ | ☐ |
| AC-15 | No plaintext password stored/logged/returned except create/rotate | grep logs; inspect DB; inspect network tab | ☐ | ☐ |
| AC-16 | Five manifest services per environment, both checks each, placeholders flagged, table readable at 1280 px | Open several teams incl. one with failures | ☐ | ☐ |
| AC-17 | Terminal endpoint shown (simulated) only while running and only on team detail | Check running vs stopped team; grep list/overview/audit payloads for `terminal.invalid` | ☐ | ☐ |

P1 extras: ☐ credential rotate/revoke · ☐ suspend/reactivate · ☐ per-service checks UI · ☐ alerts open/resolve · ☐ resource bars · ☐ idempotent double-click · ☐ demo controls.

## 2. Test matrix

### 2.1 Unit / integration (Vitest) — must exist for P0

| Area | Cases |
|---|---|
| State machine | Every row in `04 §1`: allowed transitions reach correct end state after clock advance; noop returns noop and writes `noop` audit; invalid → `INVALID_TRANSITION`; pending → `ACTION_IN_PROGRESS`; `fail-next` leads to `failed` + alert + failure row; reset from `failed` recovers |
| Preservation | `accepted_patch_version`, `last_deploy_*`, and seeded audit rows identical before/after stop, start, reset |
| Health | Derivation table in `04 §4`, including precedence (`down` > `degraded`) and `unknown` when not running |
| Permissions | Role × permission matrix; team-role own-team allow and other-team deny; missing resource deny |
| Audit | Append works; UPDATE/DELETE blocked; `requested` + completion share `correlation_id`; completion `ts` equals `pending_ends_at`; denied rows written |
| Idempotency | Same key replays response, adds no audit rows; different route/key acts normally |
| Teams | Sequential IDs; archived IDs never reused; duplicate name (case-insensitive) → 409; delete requires exact `confirmName` (422 otherwise) |
| Credentials | Create/rotate return plaintext once; DB holds only bcrypt hash; old password invalid after rotate (compare hashes); version increments |
| API | 401 without cookie; 403 with wrong role; 400 validation shape; GET responses never contain `password` keys |
| Overview | Totals equal directory counts under same conditions |
| Services | Every non-deleted environment has exactly the manifest services with two checks each; placeholder flags mirror the manifest (invariant 11) |
| Terminal | `terminal.url` null unless running; fake `.invalid` host in mock; changes on restart; absent from list/overview/audit payloads (invariant 12) |
| Checker mapping (A17) | Table-driven: OK / OFFLINE / MUMBLE / INTERNAL_ERROR → check statuses, derived health, alert kinds (`04 §4.1`) |
| Configuration | Missing/short `SESSION_SECRET` fails; valid secret is accepted; unsupported adapter fails; real/docker-compose selection cannot silently fall back; demo controls/default passwords are disabled outside mock development |
| Bulk / import (only if built) | Per-team rules reused; `START ALL`/`STOP ALL` required for ≥ 5; reset/delete rejected; CSV dry-run reports row errors; partial success |

Inject a fake clock (`now()` provider) in the adapter so tests advance time without sleeping.

### 2.2 Manual UI tests (do on the demo machine)

1. Cold start: `npm run reset-demo && npm run build && npm start`; open on a second device on the LAN.
2. Resize to 1280 and 1024 px wide; no horizontal scroll; no overlapping text.
3. Two browsers logged in (admin + operator): act in one, watch the other update within 5 s.
4. Kill the server mid-transition and restart: the transition completes on next read (lazy resolution) and audit rows are consistent.
5. Double-click a confirm button: only one action; second click is a replay or `ACTION_IN_PROGRESS`.
6. Disconnect Wi-Fi briefly: banner "Connection lost" appears and clears.
7. Keyboard only: open Teams, create a team, reset a team, delete via typed name.
8. Check browser console for errors on every screen.
9. **Soak test (live event is ~4 h):** leave `/overview` open in two browsers for 60 minutes with polling on while a script performs a reset every few minutes; Node process memory and tab memory stay flat, no console errors, SQLite file and audit growth sane.

### 2.3 Optional Playwright (P2)

Single happy path mirroring the demo script, run against a freshly seeded DB with `MOCK_DURATION_SCALE=0.2`.

## 3. Demo script (3 minutes, repeatable)

**Pre-flight (before the audience arrives):** `npm run reset-demo` → `npm run build && npm start` → open `/overview` logged in as **admin** (browser A) and keep an **operator** login ready (browser B, private window). Zoom 110 %. Close other tabs. Charge the laptop; plug in power.

| Time | Step | Say | Show |
|---|---|---|---|
| 0:00 | Overview | "This is the DEFCON organizer console. It's running on a built-in simulated backend, as the badge shows, so nothing here touches real containers yet." | Badge, stat cards, health donut, environment grid (one down, one failed, two degraded) |
| 0:30 | Find a team | "Organizers can find any of the 24 teams instantly." | Teams page → search `team-13` → open the team that's **down** |
| 0:50 | Team detail | "Health is the spec's two checks per service: reachability and functional tests. In the real event those verdicts come from each service's checker." | Services table (5 services): `funsplash` reachability failing; terminal endpoint shown (simulated); alert in feed; resource bars; accepted patch v3 |
| 1:10 | Create a team | "Creating a team provisions its environment and issues terminal credentials once." | Create "Demo Squad" → reveal dialog → tick saved → close → team shows Provisioning → Running |
| 1:50 | Reset with safety | "Reset is distinct from stop and delete, and the dialog says what's preserved: flags, scores, patches, audit, app data." | Open Reset dialog on `team-19` (failed) → confirm → Resetting… → back to Running; success toast arrives only at the end |
| 2:20 | Permissions | "Roles are enforced on the server." | Browser B (operator): Delete button disabled with tooltip; (optional) show 403 |
| 2:35 | Audit | "Everything lands in an append-only audit log." | Audit page: reset requested + completed rows with the same correlation ID, `denied` row for operator attempt |
| 2:50 | Close | "Next step is plugging in the real orchestrator through one adapter module." | Overview showing updated counts |

**Optional failure beat (+30 s):** Settings → demo controls → "Make next reset fail" on a running team → reset → show red failure toast, `failed` state, new alert, failure audit row → reset again to recover. This demonstrates "report failures instead of faking success".

> **Resolved (19 Oct 2026, R8):** the demo-control handlers previously lived under the Next.js private folder `_demo` and were excluded from routing in both `next dev` and `next start` (HTTP probe returned the HTML 404 page even with `DEMO_CONTROLS=true`). The folder is now `src/app/api/demo/`, so the endpoints are `/api/demo/inject`, `/api/demo/fail-next`, and `/api/demo/reseed`; `docs/03_API_CONTRACT.md` §3.9 was updated in the same commit. They remain fail-closed: 401 without a session, 403 for non-admins, and 404 unless `DEMO_CONTROLS=true` with the mock adapter. AC-08's failure beat is now runnable over HTTP and was verified end-to-end in R8: fail-next reset → reset 202 → polled `failed` → `action_failed` alert → `env.reset/failure` audit row.

## 4. Likely questions and honest answers

| Question | Answer |
|---|---|
| Is this controlling real containers? | "Not yet. It runs on a simulated backend; the badge says so. The adapter is the single place to connect the real orchestrator, and the contract for it is documented." |
| Where do the numbers (CPU etc.) come from? | "Simulated placeholders; real limits and telemetry are unresolved in the spec." |
| What does reset do exactly? | "Restores the latest accepted patch — not the original baseline — and preserves flags, scores, accepted patches, audit history and app data, as the spec requires. In the simulation those records are untouched by design and covered by tests." |
| Can an operator delete a team? | "No — admin only; enforced at the API and audited when denied." |
| How is the audit protected? | "Append-only at the database level; no edit or delete route exists." |
| What happens if two organizers click at once? | "One wins; the other gets 'action already in progress'. Actions are idempotent and safe to retry." |
| Why not real-time websockets? | "Polling keeps it robust on event Wi-Fi; swapping to events is easy later." |
| What about participants? | "They use the terminal gateway; this console is organizer-only by design (spec p2)." |
| Where does terminal access come from? | "The club's design is a `ttyd` terminal per team behind a tunnel. The console only displays that endpoint — fake here — and does not implement the gateway." |

## 5. Failure fallbacks on demo day

| Failure | Fallback |
|---|---|
| App won't start | Run from the last tagged commit: `git checkout v1.0-freeze`; `npm ci`; `npm run reset-demo`; `npm run build && npm start` |
| Port/LAN problems | Demo on `localhost` from the same laptop; project the laptop |
| DB corrupt/odd state | Stop server → delete `data/defcon.sqlite` → `npm run seed` → start |
| Projector/network dies | Play `demo-backup/demo.mp4`, narrate over it, and say it is a recording |
| A bug appears mid-demo | Say so plainly, use the audit log/refresh, continue; do not hand-wave |
| Late club backend | Don't connect it on demo day unless it passed a rehearsal; if partially connected the badge must read `PARTIAL` |

## 6. Pre-demo checklist (night before and 30 min before)

☐ Laptop charged, charger packed ☐ `.env` secrets changed from defaults ☐ `npm run reset-demo` done ☐ Both logins tested ☐ Browser zoom/window set ☐ Notifications muted ☐ Backup video + screenshots on a USB/phone ☐ Git tag `v1.0-freeze` pushed to a remote ☐ README open in a tab ☐ Contract doc ready to hand to the club ☐ Water.

## 7. Emergency two-track operational gate

### Track A — guaranteed dashboard release

Run from a clean checkout on the target machine:

1. Verify `SESSION_SECRET`, `DB_PATH`, `ADAPTER=mock`, disabled demo controls and durable storage.
2. Run typecheck, lint, tests, build and `git diff --check`.
3. Start production mode and verify login, `/api/meta`, overview, teams, audit and settings.
4. Run the demo twice with an admin and operator session.
5. Restart during a pending mock action and confirm lazy completion/audit consistency.
6. Back up and restore the SQLite database.
7. Leave two overview sessions polling for at least 60 minutes; record memory, browser console and audit growth.

Track A is releasable only when the fallback is repeatable and the operator can explain that it is simulated.

### Track B — real-control gate

Run only with the club owner's authorization and one disposable team:

| Gate | Required evidence |
|---|---|
| B1 identity | team ID/name maps to the authoritative registration source |
| B2 auth | adapter authenticates with bounded timeout and redacted logs |
| B3 read | detail includes lifecycle status and freshness |
| B4 lifecycle | one approved action reaches the authoritative final state |
| B5 failure | timeout/checker failure becomes visible `ADAPTER_ERROR`/failure, not success |
| B6 permissions | operator cannot perform admin-only action at API level |
| B7 audit | request/completion rows share correlation ID and correct outcome |
| B8 health | service checker verdicts map to checks and alerts without unknown-to-healthy conversion |
| B9 terminal | no unauthenticated or cross-team terminal access is exposed |
| B10 recovery | restart/retry/backup procedure is documented and tested |

Missing B4, B5, B6 or B9 means the release cannot be `LIVE`. Use `PARTIAL` only when the real subset is clearly documented; otherwise use `SIMULATED`.

### Event-day command card

```text
1. Verify host, time, disk, process supervisor and network scope.
2. Verify the release commit and adapter badge.
3. Verify database backup path and free space.
4. Log in as admin and operator; confirm role boundaries.
5. Check overview freshness and open alerts.
6. Test one harmless read/check operation.
7. Do not change adapter mode during the competition.
8. If the real adapter fails, stop claiming live control; follow the documented fallback/escalation path.
9. Record incident time, team ID, request ID and correlation ID without recording secrets.
10. After event, preserve audit/database artifacts and do not destroy team data before sign-off.
```
