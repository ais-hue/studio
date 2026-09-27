-- The producer: a brief per social brand, and batches of drafts Claude prepares for review.

CREATE TABLE IF NOT EXISTS brand_briefs (
  profile_id  TEXT PRIMARY KEY,                  -- Zernio profile (brand)
  workspace   TEXT NOT NULL DEFAULT 'main',
  voice       TEXT NOT NULL DEFAULT '',
  audience    TEXT NOT NULL DEFAULT '',
  pillars     TEXT NOT NULL DEFAULT '[]',        -- JSON list of themes
  dos         TEXT NOT NULL DEFAULT '',
  donts       TEXT NOT NULL DEFAULT '',
  hashtags    TEXT NOT NULL DEFAULT '',
  links       TEXT NOT NULL DEFAULT '[]',        -- JSON [{label, url}]
  examples    TEXT NOT NULL DEFAULT '',
  cadence     TEXT NOT NULL DEFAULT '{}',        -- JSON {platform: posts per week}
  pinterest_board TEXT NOT NULL DEFAULT '',
  producer_on INTEGER NOT NULL DEFAULT 0,
  updated_at  INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS draft_batches (
  id          TEXT PRIMARY KEY,
  workspace   TEXT NOT NULL DEFAULT 'main',
  profile_id  TEXT NOT NULL,
  title       TEXT NOT NULL,
  summary     TEXT NOT NULL DEFAULT '',
  status      TEXT NOT NULL DEFAULT 'open',      -- open (Claude still adding) | ready (waiting for review) | done
  created_at  INTEGER NOT NULL,
  ready_at    INTEGER
);
CREATE INDEX IF NOT EXISTS idx_batches_status ON draft_batches(status, created_at);

ALTER TABLE social_posts ADD COLUMN batch_id TEXT;
ALTER TABLE social_posts ADD COLUMN planned_at INTEGER;
ALTER TABLE social_posts ADD COLUMN origin TEXT;
ALTER TABLE social_posts ADD COLUMN note TEXT;
CREATE INDEX IF NOT EXISTS idx_social_batch ON social_posts(batch_id);
