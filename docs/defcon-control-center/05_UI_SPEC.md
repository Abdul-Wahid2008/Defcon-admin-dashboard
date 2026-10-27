# 05 — UI SPECIFICATION

Goal: a professional cybersecurity **operations console** — calm, dense, dark, trustworthy. Functional workflows first; no time spent on mockups. Build with shadcn/ui + Tailwind. Reference sites from the earlier suggestion are inspiration only; copy no content.

## 1. Design tokens

Define as CSS variables in `globals.css` and map into Tailwind (shadcn dark theme as base).

| Token | Value | Use |
|---|---|---|
| `--bg` | `#0B1220` | app background |
| `--panel` | `#111A2E` | cards, tables |
| `--panel-2` | `#16213A` | hover rows, inputs |
| `--border` | `#1F2C48` | 1 px borders |
| `--text` | `#E6EDF7` | primary text |
| `--muted` | `#8FA3C4` | secondary text |
| `--accent` | `#38BDF8` | links, focus ring, selected nav |
| `--ok` | `#34D399` | healthy / running / success |
| `--warn` | `#F59E0B` | degraded / in-progress / SIMULATED badge |
| `--bad` | `#F87171` | down / failed / destructive |
| `--idle` | `#64748B` | stopped / unknown |

Typography: `next/font` — Inter (UI) and JetBrains Mono (IDs, usernames, timestamps, counters). Sizes: 12 (meta), 13 (table), 14 (body), 16 (section title), 20–24 (page title), 28–32 (stat numbers, mono). Radius 8 px cards, 6 px inputs. Spacing scale 4/8/12/16/24. Subtle shadow only on dialogs. Motion: 150 ms fades; a soft 1.2 s pulse on in-progress badges; **no** decorative animation elsewhere; honour `prefers-reduced-motion`.

**Status is never colour-only:** each badge = colour + icon + text.

| State | Icon (lucide) | Colour | Label |
|---|---|---|---|
| running | `CircleCheck` / `Play` | ok | Running |
| stopped | `Square` | idle | Stopped |
| provisioning/starting/stopping/resetting/deleting | `LoaderCircle` (spinning) | warn | Provisioning… / Starting… / Stopping… / Resetting… / Deleting… |
| failed | `OctagonAlert` | bad | Failed |
| deleted | `Trash2` | idle | Deleted |
| healthy | `ShieldCheck` | ok | Healthy |
| degraded | `TriangleAlert` | warn | Degraded |
| down | `ShieldX` | bad | Down |
| unknown | `CircleHelp` | idle | Unknown |

## 2. Application shell

- **Sidebar** (240 px, collapsible to icons): logo "DEFCON Control Center" with a small `2.0` mono tag; nav: Overview, Teams, Audit log, Settings (P2, admin only). Footer: version, adapter mode text.
- **Top bar** (56 px): page title/breadcrumb · global team search (focus with `/`; P1) · **Adapter badge** · server clock (mono, from `/api/meta` offset) · user menu (display name, role chip, Log out).
- **Adapter badge** (always visible): `SIMULATED` amber outlined with `FlaskConical` icon and tooltip "Data and actions are simulated by the built-in mock backend. No real containers are controlled." / `LIVE` green with `Radio` icon and tooltip "Connected to the DEFCON orchestrator" / `PARTIAL` amber solid with `CircleDashed` icon when the adapter is `docker-compose` or mixed (tooltip lists what is real — start/stop/delete and reachability — and what is not — patch restore, functional checks). Source: `/api/meta`.
- Content max width 1440 px, 24 px padding.
- A thin amber banner under the top bar when SIMULATED: "Simulation mode — actions change demo data only." Dismissible per session, but the badge stays.

## 3. Screens

### 3.1 Login (`/login`)

Centered panel on `--bg`: title "DEFCON Control Center", subtitle "Organizer access only", username, password (show/hide), submit. Errors inline ("Invalid username or password" — never say which). Lockout message with seconds remaining on 429. Footer shows the adapter badge. Autofocus username. Enter submits.

### 3.2 Overview (`/overview`) — "landing page; communicates competition status in 5 seconds"

Layout (desktop, 12-col grid):

1. **Stat cards row** (5): Total teams · Running · Stopped · Failed · Active sessions (sim). Each: label, big mono number, small delta-free caption (e.g. "of 24"). Clicking Running/Stopped/Failed navigates to Teams with that filter.
2. **Health summary** (left, 4 cols): donut (Recharts) of health (healthy/degraded/down/unknown) with legend counts, plus line: "Services failing: R reachability · F functional".
3. **Environment grid** (right, 8 cols): one tile per team (`team-01`… compact, 6–8 tiles per row): mono ID, name truncated, state icon, health colour edge. Tile click → team detail. Pending tiles pulse. Tooltip: name, state, health, last action.
4. **Alerts feed** (6 cols): up to 10, open first; severity icon, message, team link, relative time; empty state "No open alerts".
5. **Recent activity** (6 cols): up to 10 latest audit completions/denials; actor, action, target, outcome chip, relative time; "View audit log →".
6. Optional (P2) competition status chip near the title.

Header strip: page title, "Updated Ns ago", manual refresh button. Poll 5 s (2 s if any tile pending).

### 3.3 Teams directory (`/teams`)

- Toolbar: search input (name or id, 250 ms debounce), filter dropdowns (State multi-select, Health multi-select, Account status), "Show deleted" toggle, **Create team** button (disabled with tooltip if role lacks `team.create`) and, P2, an **Import CSV** button (dialog: paste or upload CSV with columns `team_name,participants` where participants are `;`-separated; dry-run preview table with per-row errors; confirm → credentials reveal for all created teams).
- Table (shadcn Table, sticky header, 25/page): checkbox (P2 bulk) · Team (mono ID + name) · State badge · Health badge · Participants (count) · Account (Active/Suspended chip) · Updated (relative) · row actions menu (`⋯`: Open, Start/Stop, Reset…, Delete…; items disabled with reason per state and permission).
- Sort by column header (ID, name, state, health, updated). URL holds filters/sort/page (shareable state).
- Row click → team detail. Pending rows show progress badge.
- Empty state: "No teams match these filters" + Clear filters; first-run empty: "No teams yet" + Create team.
- Result count: "Showing 1–25 of 24".
- Soft cap: creating the 31st active team shows a warning toast "Above the expected 20–30 teams" (A7).
- **Bulk bar (P2, F17):** when rows are selected, a sticky bar offers **Start selected** and **Stop selected** only (reset and delete are never bulk). The confirm dialog shows the count and, for 5 or more teams, requires typing `START ALL` / `STOP ALL`. The result toast summarises accepted / no-op / rejected counts and links to the audit log.

**Create team dialog:** fields — Team name (required, 2–60, uniqueness error inline), Notes (optional, ≤ 500), Participants (repeatable name inputs, default 4 pre-filled "Participant 1–4", max 8), checkbox "Provision environment now" (default on). Submit → on 201 open **Credentials reveal dialog** (below). Team appears in the table in `provisioning`.

### 3.4 Team detail (`/teams/[teamId]`)

Header: back link, `team-07` (mono) + team name, State badge, Health badge, Account chip, adapter badge inherited. **Action bar** (right): Start/Stop (context-sensitive), Reset, Delete (destructive outline), Edit. Buttons show disabled state with tooltip reason: wrong state ("Already running"), in progress ("Another action is in progress"), permission ("Requires organizer_admin").

Tabs (default **Overview**):

1. **Overview** — three columns:
   - *Environment card*: lifecycle state, pending action with progress bar when transitioning (use `estimatedEndsAt`), failure reason (red callout with "Reset to recover" shortcut), last action time, last health check, **Accepted patch: v3** (read-only, with tooltip "Reset restores this version"), last deploy result/time (read-only), **Terminal endpoint** (mono URL + copy button + external-link icon; tooltip "Simulated placeholder" in mock; "Not running" otherwise; treat as sensitive — never show it in tiles, lists, audit rows or exports).
   - *Services table* (5–6 services per environment, D14): compact table — Service (name, port in mono, "placeholder" chip when `placeholder`), Reachability, Functional (icon + label each), Detail (checker verdict text such as "OFFLINE: connection refused"), Last checked. Failing rows are highlighted and sorted first. Must stay readable at 1280 px with 6 rows. Button "Run health checks" (P1, only when running).
   - *Resources card*: four bars (CPU, Memory, Processes, Storage) with `used / limit` text; shows "No data — environment not running" when null; tooltip "Simulated values" when `isMock`.
2. **Participants** — table: name, username (mono, copy button), credential issued (relative), credential version, status; actions: Rotate credential (dialog), Remove; **Add participant**; **Rotate all credentials** (with confirm). Spec note card: "Credentials are issued by organizers (spec p1). Passwords are shown once." Suspended-team note per 04 §6.6.
3. **Activity** — audit table filtered to this team (same component as the Audit page), newest first.
4. **Details** — editable name, notes, account status switch (Active/Suspended with confirm), created/updated times, "Danger zone" card repeating Delete.

### 3.5 Audit log (`/audit`)

Filters: date range (presets: last hour, 24 h, all), actor, action (multi-select grouped: auth / team / env / credential / settings / demo), team, outcome chips (requested/success/failure/denied/noop), free-text search. Table columns: Time (mono, local with ISO tooltip) · Actor (name + role chip) · Action (mono code + friendly label) · Target (team link) · Outcome chip · Message. Row expand → raw `details` JSON (pretty, monospace) + request/correlation IDs with copy buttons. Newest first, 50/page, "Export CSV" (P1, promoted — the log is the post-event record of a 4-hour run). Banner at top: "Audit entries are append-only and cannot be edited or deleted." Optional toggle "Hide `requested` rows" (default off — show everything).

Outcome chip colours: success ok, failure bad, denied bad (outline) with `Ban` icon, requested warn with `Clock`, noop idle with `Minus`.

### 3.6 Settings (`/settings`, P2, admin)

Competition status select (display label), demo controls card (see 3.8), build/version info.

### 3.7 Credentials reveal dialog

Modal, cannot be dismissed by clicking outside or Esc until the user ticks "I have saved these credentials" (checkbox enables **Close**). Content: warning "These passwords are shown only once and cannot be retrieved later." Table: participant, username (mono), password (mono, masked by default; per-row reveal and copy; "Reveal all" toggle). Buttons: **Copy all**, **Download CSV** (client-generated: `team_id,team_name,participant,username,password`), **Print** (browser print stylesheet with only the table). After close, clear state from memory.

### 3.8 Demo controls panel (mock + admin + `DEMO_CONTROLS=true`)

Small card on Settings (and a floating wrench button on team detail for admins): inject/clear a service failure (select service + check type), "Make next <action> fail", "Reseed demo data" (typed confirm "RESEED"). Banner: "Demo tools — simulation only. Every use is audited." Never visible in LIVE mode.

## 4. Confirmation dialogs (exact behaviour and copy)

All use shadcn `AlertDialog`; primary button is the action name; focus starts on **Cancel** for reset/delete; dialogs list the target as `team-07 · Null Pointers`. After confirm, the button shows a spinner while the request is in flight; the dialog closes on 202; the UI then enters the pending state. Errors keep the dialog open with an inline message.

| Action | Title | Body | Confirm button |
|---|---|---|---|
| Stop | Stop environment? | "The environment will be stopped and its services will be unreachable. The environment is retained and can be started again. Active terminal sessions will end." | **Stop environment** (neutral/warn) |
| Start | Start environment? | "The retained environment will be started." | **Start environment** |
| Reset | Reset environment? | "The environment will be restored to the latest accepted patch (v{n}), not the original vulnerable baseline. **Preserved:** flags and challenge state · scores and submissions · accepted patches · audit and deployment history · application data. Anything not captured in an accepted patch is discarded. `[confirm with club]`" | **Reset environment** (warn) |
| Delete | Delete team and environment? | "This removes the team's assigned resources and archives the team. Audit history is kept. This cannot be undone. Type **{team name}** to confirm." (input; button enabled only on exact match) | **Delete team** (destructive red) |
| Rotate credentials | Rotate credentials? | "Existing passwords stop working immediately. New passwords will be shown once." | **Rotate** |
| Suspend account | Suspend team account? | "Suspended teams are marked inactive. (Enforced by the terminal gateway once integrated.)" | **Suspend** |

Reset, stop and delete have **different** colours, icons (`RotateCcw`, `Square`, `Trash2`) and wording, per the spec's "distinct" rule.

## 5. Notifications (sonner)

- Request accepted: info toast "Reset requested for team-07…" (neutral, not a success claim).
- Final state read successfully: success toast "team-07 reset complete — running (patch v3)" — **only after** polling reads `pending=null` and `lifecycleState` equals the expected end state.
- Failure end state: error toast (persistent until dismissed) "team-07 reset failed: <failureReason>" with a **View details** action to the team page.
- 403: "You don't have permission (requires organizer_admin)." 409 in progress: "Another action is already running for team-07." 5xx/network: "Request failed — nothing was changed. [Retry]" with the request id.
- Toasts stack max 3; success auto-dismiss 5 s.

## 6. Data-fetching behaviour

- TanStack Query keys: `['meta']`, `['overview']`, `['teams', filters]`, `['team', id]`, `['audit', filters]`, `['alerts']`.
- `refetchInterval`: overview 5 s; team detail 5 s (2 s while `pending`); directory 5 s; audit 10 s; pause when tab hidden.
- After any mutation: invalidate `team`, `teams`, `overview`, `audit`, `alerts`.
- Mutation lifecycle for actions: send with a fresh `Idempotency-Key` (generated when the dialog opens, so double-clicks dedupe) → on 202 invalidate and start 2 s polling → when `pending` clears, compare to the expected outcome and toast.
- Global handlers: 401 → redirect to `/login?next=…`; network error banner "Connection lost — retrying" (auto-clears).

## 7. States checklist (every view)

| View | Loading | Empty | Error | Forbidden |
|---|---|---|---|---|
| Overview | Skeleton cards + tile grid | n/a (alerts empty text) | Card-level retry | n/a |
| Teams | 8 skeleton rows | "No teams…" variants | Table-level retry + request id | n/a |
| Team detail | Skeleton header + cards | 404 page "Team not found" | Retry | Disabled actions with reasons |
| Audit | 10 skeleton rows | "No entries match" | Retry | "Audit access requires organizer role" |

## 8. Accessibility and quality bar

Keyboard reachability for all actions; dialogs trap focus and restore it; `aria-live="polite"` region for toasts and pending-state changes; table headers with `scope`; visible focus ring (`--accent`); minimum click target 32 px; contrast ≥ 4.5:1 verified for `--muted` on `--panel`; no layout shift on poll updates (reserve badge widths); numbers right-aligned and mono; relative times update every 30 s; long names truncate with tooltip.

**Live-event ergonomics (the console may be used for about four hours, possibly projected):** readable at 125 % browser zoom; always-visible "updated Ns ago"; a prominent "Connection lost — retrying" banner; session length 8 h so nobody is logged out mid-event; no modal that blocks the overview without a way out.

## 9. Component inventory (build order)

`AdapterBadge`, `StateBadge`, `HealthBadge`, `Sidebar`, `Topbar`, `StatCard`, `StateDonut`, `HealthGrid`, `AlertsFeed`, `ActivityList`, `TeamsTable`, `TeamFilters`, `CreateTeamDialog`, `CredentialsRevealDialog`, `ActionBar`, `ConfirmActionDialog`, `DeleteTeamDialog`, `ServiceChecks`, `ResourceBars`, `ParticipantsPanel`, `AuditTable`, `AuditFilters`, `EmptyState`, `ErrorState`, `RelativeTime`, `CopyButton`, `DemoControls`.

## v1.2 additions (built in W5–W6; see BUILD_STATUS.md)

- **Overview matrix** (`/overview`): teams × services with R/F checks and three flagstore dots, worst first; **Incidents** view (`/overview?view=incidents`) lists only teams with a failed environment or failing/stale services, each with the problem in words and the action that applies.
- **Event clock**, health-source freshness banner, and a SIMULATED/PARTIAL banner that names the health and lifecycle sources.
- **Command palette** (Ctrl/Cmd+K, `?` for shortcuts), recently opened teams, alert acknowledge with a note, conflict-safe team notes, bulk start/stop with per-team progress.
- **Copy rules**: plain and specific, no marketing adjectives, no emoji, no placeholder text; reset wording follows `/api/meta.capabilities.resetKind`; stale data reads "unknown", never green; admin-only controls are disabled with a reason (Delete for operators, W9).
