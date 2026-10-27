-- v1.2 W1: external team id, organizer session epoch, flagstore verdicts, health source state.
ALTER TABLE teams ADD COLUMN external_team_id TEXT;            -- A31; UNIQUE enforced by index (SQLite cannot ADD COLUMN ... UNIQUE)
CREATE UNIQUE INDEX uq_teams_external_team_id ON teams(external_team_id) WHERE external_team_id IS NOT NULL;

ALTER TABLE users ADD COLUMN session_epoch INTEGER NOT NULL DEFAULT 0;
ALTER TABLE users ADD COLUMN must_change_password INTEGER NOT NULL DEFAULT 0;
ALTER TABLE users ADD COLUMN last_login_at TEXT;

CREATE TABLE flagstore_results (
  team_id     TEXT NOT NULL,
  service_key TEXT NOT NULL,
  flagstore   TEXT NOT NULL CHECK (flagstore IN ('flag0','flag1','flag2')),
  verdict     TEXT NOT NULL CHECK (verdict IN ('OK','MUMBLE','OFFLINE','INTERNAL_ERROR','UNKNOWN')),
  message     TEXT,
  round       INTEGER,
  checked_at  TEXT,
  PRIMARY KEY (team_id, service_key, flagstore),
  FOREIGN KEY (team_id, service_key) REFERENCES services(team_id, key) ON DELETE CASCADE
);

CREATE TABLE health_source_state (
  source       TEXT PRIMARY KEY,
  last_round   INTEGER,
  last_fetch_at TEXT,
  last_ok_at   TEXT,
  last_error   TEXT,
  last_etag    TEXT
);

INSERT OR IGNORE INTO settings (key, value) VALUES ('stale_after_sec', '270');
INSERT OR IGNORE INTO settings (key, value) VALUES ('round_sec', '90');
INSERT OR IGNORE INTO settings (key, value) VALUES ('mutations_frozen', '0');
