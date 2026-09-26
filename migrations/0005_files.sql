-- File library. The files themselves live in R2 and are served at files.<domain>/<key>.

CREATE TABLE IF NOT EXISTS files (
  id         TEXT PRIMARY KEY,
  key        TEXT NOT NULL UNIQUE,            -- path in R2, also the public URL path
  name       TEXT NOT NULL,
  folder     TEXT NOT NULL DEFAULT '',        -- e.g. a brand or site name; '' = unfiled
  type       TEXT NOT NULL,                   -- MIME type
  kind       TEXT NOT NULL,                   -- image | video | document | other
  size       INTEGER NOT NULL DEFAULT 0,
  width      INTEGER,
  height     INTEGER,
  alt        TEXT NOT NULL DEFAULT '',
  status     TEXT NOT NULL DEFAULT 'ready',   -- uploading (big files, in parts) | ready
  upload_id  TEXT,                            -- R2 multipart upload in progress
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_files_folder ON files(folder, created_at);
CREATE INDEX IF NOT EXISTS idx_files_time   ON files(created_at);
