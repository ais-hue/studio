-- Social posts, published through Zernio. Brands are Zernio profiles; accounts live in Zernio.

CREATE TABLE IF NOT EXISTS social_posts (
  id           TEXT PRIMARY KEY,
  profile_id   TEXT NOT NULL,                      -- Zernio profile (brand)
  content      TEXT NOT NULL DEFAULT '',
  media        TEXT NOT NULL DEFAULT '[]',         -- JSON [{url, type, name}]
  targets      TEXT NOT NULL DEFAULT '[]',         -- JSON [{platform, accountId}]
  options      TEXT NOT NULL DEFAULT '{}',         -- JSON {pinterest:{boardId,title,link}, tiktok:{...}}
  status       TEXT NOT NULL DEFAULT 'draft',      -- draft | scheduled | publishing | published | partial | failed
  scheduled_at INTEGER,
  published_at INTEGER,
  zernio_id    TEXT,
  results      TEXT NOT NULL DEFAULT '[]',         -- JSON [{platform, status, url, error}]
  error        TEXT,
  created_at   INTEGER NOT NULL,
  updated_at   INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_social_profile ON social_posts(profile_id, status);
CREATE INDEX IF NOT EXISTS idx_social_due     ON social_posts(status, scheduled_at);
