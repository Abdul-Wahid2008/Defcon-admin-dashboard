PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;

CREATE TABLE users (
  id            TEXT PRIMARY KEY,
  username      TEXT NOT NULL UNIQUE COLLATE NOCASE,
  password_hash TEXT NOT NULL,
  display_name  TEXT NOT NULL,
  role          TEXT NOT NULL CHECK (role IN ('organizer_admin','organizer_operator')),
  active        INTEGER NOT NULL DEFAULT 1,
  created_at    TEXT NOT NULL
);

CREATE TABLE teams (
  id             TEXT PRIMARY KEY,                 -- 'team-01'
  seq            INTEGER NOT NULL UNIQUE,
  name           TEXT NOT NULL COLLATE NOCASE,
  notes          TEXT NOT NULL DEFAULT '',
  account_status TEXT NOT NULL DEFAULT 'active' CHECK (account_status IN ('active','suspended')),
  archived_at    TEXT,                             -- set on delete
  created_at     TEXT NOT NULL,
  updated_at     TEXT NOT NULL
);
-- names unique among non-archived teams
CREATE UNIQUE INDEX uq_teams_name_active ON teams(name) WHERE archived_at IS NULL;

CREATE TABLE participants (
  id                   TEXT PRIMARY KEY,
  team_id              TEXT NOT NULL REFERENCES teams(id),
  name                 TEXT NOT NULL,
  username             TEXT NOT NULL UNIQUE COLLATE NOCASE,   -- e.g. 'team-07-p1'
  password_hash        TEXT NOT NULL,
  credential_version   INTEGER NOT NULL DEFAULT 1,
  credential_issued_at TEXT NOT NULL,
  active               INTEGER NOT NULL DEFAULT 1
);
CREATE INDEX ix_participants_team ON participants(team_id);

CREATE TABLE environments (
  team_id                TEXT PRIMARY KEY REFERENCES teams(id),
  lifecycle_state        TEXT NOT NULL CHECK (lifecycle_state IN
    ('provisioning','running','stopping','stopped','starting','resetting','deleting','deleted','failed')),
  pending_action         TEXT,                     -- provision|start|stop|reset|delete
  pending_correlation_id TEXT,
  pending_from_state     TEXT,
  pending_to_state       TEXT,
  pending_started_at     TEXT,
  pending_ends_at        TEXT,
  accepted_patch_version INTEGER NOT NULL DEFAULT 1,   -- never modified by lifecycle actions
  last_deploy_result     TEXT,                         -- accepted|rejected|rolled_back
  last_deploy_at         TEXT,
  active_sessions        INTEGER NOT NULL DEFAULT 0,
  failure_reason         TEXT,
  last_action_at         TEXT,
  last_health_check_at   TEXT,
  terminal_url           TEXT,                         -- MOCK: fake *.invalid URL while running; sensitive (A15)
  fail_next_action       TEXT                          -- MOCK ONLY
);

CREATE TABLE services (
  team_id TEXT NOT NULL REFERENCES teams(id),
  key     TEXT NOT NULL,                              -- manifest key, from config/services.json, e.g. 'docuvault'
  name    TEXT NOT NULL,
  port    INTEGER NOT NULL,
  placeholder INTEGER NOT NULL DEFAULT 0,             -- 1 = not a real challenge service yet (A9)
  PRIMARY KEY (team_id, key)
);

CREATE TABLE checks (
  team_id         TEXT NOT NULL,
  service_key     TEXT NOT NULL,
  check_type      TEXT NOT NULL CHECK (check_type IN ('reachability','functional')),
  status          TEXT NOT NULL CHECK (status IN ('pass','fail','unknown')),
  detail          TEXT,
  last_checked_at TEXT,
  forced_fail     INTEGER NOT NULL DEFAULT 0,         -- MOCK ONLY (demo inject)
  forced_detail   TEXT,
  PRIMARY KEY (team_id, service_key, check_type),
  FOREIGN KEY (team_id, service_key) REFERENCES services(team_id, key)
);

CREATE TABLE alerts (
  id          TEXT PRIMARY KEY,
  team_id     TEXT,
  severity    TEXT NOT NULL CHECK (severity IN ('info','warning','critical')),
  kind        TEXT NOT NULL,
  dedupe_key  TEXT,                                   -- e.g. 'team-07:web:reachability'
  message     TEXT NOT NULL,
  created_at  TEXT NOT NULL,
  resolved_at TEXT
);
CREATE UNIQUE INDEX uq_alerts_open ON alerts(dedupe_key) WHERE resolved_at IS NULL AND dedupe_key IS NOT NULL;

CREATE TABLE audit_log (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  ts             TEXT NOT NULL,
  actor_id       TEXT,
  actor_name     TEXT NOT NULL,
  actor_role     TEXT NOT NULL,                       -- organizer_admin|organizer_operator|team|system|anonymous
  action         TEXT NOT NULL,
  target_type    TEXT NOT NULL,
  target_id      TEXT,
  outcome        TEXT NOT NULL CHECK (outcome IN ('requested','success','failure','denied','noop')),
  message        TEXT NOT NULL,
  request_id     TEXT,
  correlation_id TEXT,
  details_json   TEXT
);
CREATE INDEX ix_audit_ts ON audit_log(ts DESC);
CREATE INDEX ix_audit_target ON audit_log(target_id, ts DESC);
CREATE TRIGGER audit_no_update BEFORE UPDATE ON audit_log
BEGIN SELECT RAISE(ABORT, 'audit_log is append-only'); END;
CREATE TRIGGER audit_no_delete BEFORE DELETE ON audit_log
BEGIN SELECT RAISE(ABORT, 'audit_log is append-only'); END;

CREATE TABLE idempotency_keys (
  key           TEXT NOT NULL,
  actor_id      TEXT NOT NULL,
  route         TEXT NOT NULL,
  status        INTEGER NOT NULL,
  response_json TEXT NOT NULL,
  created_at    TEXT NOT NULL,
  PRIMARY KEY (key, actor_id, route)
);

CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
