-- Proof: sites, pages, contacts, lists, email

CREATE TABLE settings (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE TABLE sites (
  id         TEXT PRIMARY KEY,
  name       TEXT NOT NULL,
  subdomain  TEXT NOT NULL UNIQUE,
  accent     TEXT NOT NULL DEFAULT 'brass',
  theme      TEXT NOT NULL DEFAULT 'auto',      -- auto | light | dark
  status     TEXT NOT NULL DEFAULT 'building',  -- building | live | paused
  tagline    TEXT NOT NULL DEFAULT '',
  created_at INTEGER NOT NULL
);

CREATE TABLE pages (
  id         TEXT PRIMARY KEY,
  site_id    TEXT NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
  slug       TEXT NOT NULL,                     -- '' is the home page
  title      TEXT NOT NULL,
  template   TEXT NOT NULL,                     -- waitlist | launch | links | post
  content    TEXT NOT NULL DEFAULT '{}',        -- JSON fields for the template
  published  INTEGER NOT NULL DEFAULT 0,
  views      INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  UNIQUE (site_id, slug)
);

CREATE TABLE lists (
  id              TEXT PRIMARY KEY,
  name            TEXT NOT NULL,
  site_id         TEXT REFERENCES sites(id) ON DELETE SET NULL,
  welcome_enabled INTEGER NOT NULL DEFAULT 0,
  welcome_subject TEXT NOT NULL DEFAULT '',
  welcome_body    TEXT NOT NULL DEFAULT '',
  created_at      INTEGER NOT NULL
);

CREATE TABLE contacts (
  id            TEXT PRIMARY KEY,
  email         TEXT NOT NULL UNIQUE COLLATE NOCASE,
  name          TEXT NOT NULL DEFAULT '',
  status        TEXT NOT NULL DEFAULT 'subscribed', -- subscribed | unsubscribed | bounced
  source        TEXT NOT NULL DEFAULT '',           -- e.g. "seek/early-access", "import", "manual"
  consent_at    INTEGER,
  consent_text  TEXT NOT NULL DEFAULT '',
  token         TEXT NOT NULL UNIQUE,               -- unsubscribe token
  created_at    INTEGER NOT NULL,
  updated_at    INTEGER NOT NULL
);

CREATE TABLE list_members (
  list_id    TEXT NOT NULL REFERENCES lists(id) ON DELETE CASCADE,
  contact_id TEXT NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
  added_at   INTEGER NOT NULL,
  PRIMARY KEY (list_id, contact_id)
);

CREATE TABLE campaigns (
  id           TEXT PRIMARY KEY,
  name         TEXT NOT NULL,
  subject      TEXT NOT NULL DEFAULT '',
  preheader    TEXT NOT NULL DEFAULT '',
  body         TEXT NOT NULL DEFAULT '',     -- markdown
  list_id      TEXT REFERENCES lists(id) ON DELETE SET NULL, -- null = everyone subscribed
  site_id      TEXT REFERENCES sites(id) ON DELETE SET NULL, -- sets the accent colour
  status       TEXT NOT NULL DEFAULT 'draft', -- draft | scheduled | sending | sent
  scheduled_at INTEGER,
  sent_at      INTEGER,
  created_at   INTEGER NOT NULL,
  updated_at   INTEGER NOT NULL
);

CREATE TABLE sends (
  id          TEXT PRIMARY KEY,
  campaign_id TEXT REFERENCES campaigns(id) ON DELETE CASCADE,
  list_id     TEXT,                            -- set for welcome emails
  kind        TEXT NOT NULL,                   -- campaign | welcome | test
  contact_id  TEXT REFERENCES contacts(id) ON DELETE CASCADE,
  email       TEXT NOT NULL,
  status      TEXT NOT NULL DEFAULT 'queued',  -- queued | sent | failed | skipped
  error       TEXT,
  provider_id TEXT,
  opened_at   INTEGER,
  clicked_at  INTEGER,
  created_at  INTEGER NOT NULL,
  sent_at     INTEGER
);

CREATE INDEX idx_pages_site     ON pages(site_id);
CREATE INDEX idx_members_c      ON list_members(contact_id);
CREATE INDEX idx_sends_queue    ON sends(status, created_at);
CREATE INDEX idx_sends_campaign ON sends(campaign_id);
CREATE INDEX idx_contacts_time  ON contacts(created_at);
