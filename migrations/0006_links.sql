-- Tracked links: go.<domain>/l/<code> counts clicks, adds UTM tags, and credits sign-ups to the post that sent them.

CREATE TABLE IF NOT EXISTS links (
  id            TEXT PRIMARY KEY,
  code          TEXT NOT NULL UNIQUE,
  url           TEXT NOT NULL,                   -- final destination, UTM tags included
  source_type   TEXT NOT NULL DEFAULT 'manual',  -- social | email | manual
  source_id     TEXT,
  platform      TEXT,
  profile_id    TEXT,
  original      TEXT NOT NULL DEFAULT '',        -- the link as written
  clicks        INTEGER NOT NULL DEFAULT 0,
  last_click_at INTEGER,
  created_at    INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_links_source ON links(source_type, source_id);

CREATE TABLE IF NOT EXISTS link_days (
  link_id TEXT NOT NULL,
  day     TEXT NOT NULL,                         -- YYYY-MM-DD (UTC)
  clicks  INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (link_id, day)
);

ALTER TABLE contacts ADD COLUMN ref_link TEXT;
CREATE INDEX IF NOT EXISTS idx_contacts_ref ON contacts(ref_link);
