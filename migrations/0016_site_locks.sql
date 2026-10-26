-- Password-protected sites. A site with a row here asks visitors for its password before showing anything.
-- Only a salted PBKDF2 hash is stored; the password itself is never kept or sent back to the browser.
CREATE TABLE IF NOT EXISTS site_locks (
  site_id    TEXT PRIMARY KEY REFERENCES sites(id) ON DELETE CASCADE,
  hash       TEXT NOT NULL,              -- base64url PBKDF2-SHA256
  salt       TEXT NOT NULL,              -- base64url, 16 bytes
  iter       INTEGER NOT NULL,
  hint       TEXT NOT NULL DEFAULT '',   -- a line shown on the password page, e.g. "Sent with my application"
  updated_at INTEGER NOT NULL
);

-- Wrong-password attempts, per site and visitor, so the password can't be guessed by brute force.
CREATE TABLE IF NOT EXISTS gate_tries (
  k     TEXT PRIMARY KEY,               -- site_id:ip
  n     INTEGER NOT NULL,
  since INTEGER NOT NULL
);
