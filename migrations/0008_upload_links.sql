-- One-time upload links, so Claude (or Aisling, in a browser) can put big files like videos into the library.
CREATE TABLE IF NOT EXISTS upload_links (
  hash       TEXT PRIMARY KEY,          -- SHA-256 of the secret in the link
  id         TEXT NOT NULL UNIQUE,      -- public id Claude uses to check on it
  folder     TEXT NOT NULL DEFAULT '',
  note       TEXT NOT NULL DEFAULT '',
  max_files  INTEGER NOT NULL DEFAULT 10,
  expires_at INTEGER NOT NULL,
  created_at INTEGER NOT NULL
);
ALTER TABLE files ADD COLUMN upload_link TEXT;
CREATE INDEX IF NOT EXISTS idx_files_link ON files(upload_link);
