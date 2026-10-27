-- v1.2 hardening: server-side logout. A session token carries a random jti; logging out records it here until the
-- token would have expired anyway (expires_at, unix seconds), so a copied cookie stops working immediately.
CREATE TABLE revoked_sessions (
  jti        TEXT PRIMARY KEY,
  expires_at INTEGER NOT NULL
);
CREATE INDEX ix_revoked_sessions_exp ON revoked_sessions(expires_at);
