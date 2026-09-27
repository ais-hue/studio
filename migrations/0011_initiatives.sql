-- Campaigns (called "initiatives" in the database, because the emails table is already "campaigns"):
-- one launch or push that groups emails, social posts, forms and pages, with a goal and one set of results.

CREATE TABLE IF NOT EXISTS initiatives (
  id         TEXT PRIMARY KEY,
  workspace  TEXT NOT NULL DEFAULT 'main',
  name       TEXT NOT NULL,
  tag        TEXT NOT NULL DEFAULT '',          -- utm_campaign for links in its emails and posts
  goal       TEXT NOT NULL DEFAULT '',          -- in plain words
  target     INTEGER,                           -- sign-ups to aim for
  starts_at  INTEGER,
  ends_at    INTEGER,
  notes      TEXT NOT NULL DEFAULT '',
  archived   INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

ALTER TABLE campaigns ADD COLUMN initiative_id TEXT;
ALTER TABLE social_posts ADD COLUMN initiative_id TEXT;
ALTER TABLE forms ADD COLUMN initiative_id TEXT;
ALTER TABLE pages ADD COLUMN initiative_id TEXT;
CREATE INDEX IF NOT EXISTS idx_campaigns_init ON campaigns(initiative_id);
CREATE INDEX IF NOT EXISTS idx_social_init ON social_posts(initiative_id);
