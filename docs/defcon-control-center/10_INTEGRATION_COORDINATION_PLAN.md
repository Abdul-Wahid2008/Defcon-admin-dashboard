# 10 — CLUB INTEGRATION COORDINATION AND HANDOFF PLAN

This document is the shared boundary between the dashboard owner and the teams building the DEFCON game server, vulnerable services, checker, terminal gateway, registration system and infrastructure.

## 1. Authority order

1. `DEFCON_2.0_Requirements_Specification_Diagram_First.pdf`
2. `01_BLUEPRINT.md`, `02_SPEC_DIGEST.md`, `03_API_CONTRACT.md`, `04_DATA_MODEL_AND_RULES.md`
3. Written decisions from the club technical lead
4. Sanitized implementation evidence from the club owners
5. Group-chat suggestions and repository examples

If sources conflict, stop and record the conflict. Do not silently select the convenient interpretation.

## 2. Responsibility boundary

| System | Owner | Dashboard responsibility | Explicitly not implemented here |
|---|---|---|---|
| Registration | registration owner | import/reconcile stable team records | registration workflow redesign |
| Orchestrator | environment owner | adapter mapping, status polling, error display | privileged host control without a reviewed contract |
| Vulnerable services | service owners | manifest/check results display | service implementation or exploit selection |
| Checker/scoring | game-server owner | consume verdict/health projection | flag planting, scoring, difficulty points |
| Terminal/network | gateway/network owner | display safe availability metadata | shell gateway, tunnel security, network isolation |
| Patch/deployment | game-server owner | read accepted patch/deployment history if supplied | patch capture, validation, rollback |
| Dashboard | dashboard owner | organizer auth, permissions, CRUD UX, audit, operator workflow | participant UI and leaderboard |

## 3. Required response from each owner

Ask each owner to reply with a sanitized, versioned handoff:

```text
Owner:
System:
Version/commit:
Environment:
Authoritative IDs:
Authentication method:
Endpoints or commands:
Request examples:
Response examples:
Async job/status behavior:
Timeout/retry behavior:
Failure codes:
Data retention/reset semantics:
Test team ID:
Known limitations:
Contact during event:
```

Never include passwords, bearer tokens, private keys, public terminal URLs, participant credentials or host Docker socket paths in this document.

## 4. Questions that block `LIVE`

1. Who owns the orchestrator and who can authorize destructive tests?
2. What is the authoritative team ID and registration source?
3. How is one team provisioned, started, stopped, reset and deleted?
4. Does every action return a job/status object, and what is the authoritative completion state?
5. What does reset preserve: flags/challenge state, scores/submissions, accepted patches, audit/deployment history and application data?
6. How is the exactly-one-container requirement satisfied?
7. What exact checker verdicts and timestamps are available?
8. What happens when a checker is unavailable or returns an unknown verdict?
9. Who issues participant credentials, how are they rotated/revoked, and are they team- or participant-scoped?
10. Is terminal access authenticated and team-scoped, and how is cross-team access denied?
11. What resource limits and capacity have been tested for 20–30 teams and 80–100 users?
12. Where is the deployment host, how is it restarted, and how is the database backed up/restored?
13. Which inbound network paths are allowed, and how are host/control-plane/Docker-daemon paths blocked?
14. What is the actual hard deadline and who makes the release decision?

Any unanswered item is a risk entry, not an implementation invitation.

## 5. Evidence packet for the dashboard owner

Before enabling a real adapter operation, collect:

- sanitized request/response fixture;
- owner name and date;
- test-team authorization;
- expected final state;
- observed final state;
- request ID and correlation ID;
- failure/retry observation;
- permission result;
- audit result;
- rollback/recovery result.

Store only sanitized evidence in the repository. Keep private addresses and credentials in the club's secure channel.

## 6. Release decision record

Complete this table before freeze:

| Capability | Mock | Real read | Real mutation | Evidence | Release mode impact |
|---|---:|---:|---:|---|---|
| Team identity/reconciliation |  |  |  |  |  |
| Create/provision |  |  |  |  |  |
| Start |  |  |  |  |  |
| Stop |  |  |  |  |  |
| Reset |  |  |  |  |  |
| Delete/archive |  |  |  |  |  |
| Health/checkers |  |  |  |  |  |
| Resources |  |  |  |  |  |
| Credentials |  |  |  |  |  |
| Terminal metadata |  |  |  |  |  |
| Audit/recovery |  |  |  |  |  |

Rules:

- Any blank evidence cell for a critical mutation prevents `LIVE`.
- Unsupported operations are disabled or return a clear unavailable error.
- A successful list call does not prove lifecycle control.
- A successful start call does not prove reset, delete, health, permissions or recovery.

## 7. Escalation and event-day behavior

- **Contract missing:** ship Track A in `SIMULATED`.
- **Read-only contract works:** consider `PARTIAL` only if the UI clearly marks mutations unavailable.
- **One-team lifecycle works but health/terminal security is unproven:** remain `PARTIAL`.
- **Adapter timeout or checker outage during the event:** show failure/staleness, preserve audit, do not show success, and notify the orchestrator owner with request/correlation IDs.
- **Host or database problem:** stop mutations, preserve the database, use the backup/runbook, and do not improvise destructive recovery.
