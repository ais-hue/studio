-- Studio sign-in: one-time email links and long-lived sessions (stored as SHA-256 hashes, never the raw values).

CREATE TABLE IF NOT EXISTS login_tokens (
  hash       TEXT PRIMARY KEY,
  email      TEXT NOT NULL,
  expires_at INTEGER NOT NULL,
  used_at    INTEGER,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS sessions (
  hash       TEXT PRIMARY KEY,
  email      TEXT NOT NULL,
  expires_at INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  user_agent TEXT NOT NULL DEFAULT ''
);

CREATE INDEX IF NOT EXISTS idx_login_email ON login_tokens(email, created_at);
