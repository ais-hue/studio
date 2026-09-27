-- Custom contact fields, forms (on pages, embedded anywhere, or posted to by apps), and smart lists.

CREATE TABLE IF NOT EXISTS contact_fields (
  id         TEXT PRIMARY KEY,
  key        TEXT NOT NULL UNIQUE,              -- used in forms, embeds and the API
  label      TEXT NOT NULL,
  type       TEXT NOT NULL DEFAULT 'text',      -- text | textarea | number | date | select | multiselect | checkbox | country
  options    TEXT NOT NULL DEFAULT '[]',        -- for select / multiselect
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS forms (
  id           TEXT PRIMARY KEY,
  name         TEXT NOT NULL,
  site_id      TEXT,                            -- styling, and whose pages can show it
  list_id      TEXT,                            -- who they're added to; made on first sign-up if empty
  fields       TEXT NOT NULL DEFAULT '[]',      -- [{key, required, label?}] in order; email is always included
  button       TEXT NOT NULL DEFAULT 'Sign up',
  success      TEXT NOT NULL DEFAULT 'Thanks, you’re on the list.',
  redirect_url TEXT NOT NULL DEFAULT '',
  status       TEXT NOT NULL DEFAULT 'active',  -- active | off
  created_at   INTEGER NOT NULL,
  updated_at   INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS form_submissions (
  id         TEXT PRIMARY KEY,
  form_id    TEXT NOT NULL,
  contact_id TEXT,
  data       TEXT NOT NULL DEFAULT '{}',
  page_url   TEXT NOT NULL DEFAULT '',
  ip_hash    TEXT NOT NULL DEFAULT '',          -- daily-salted hash, only for rate limiting
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_subs_form ON form_submissions(form_id, created_at);
CREATE INDEX IF NOT EXISTS idx_subs_contact ON form_submissions(contact_id);
CREATE INDEX IF NOT EXISTS idx_subs_ip ON form_submissions(ip_hash, created_at);

CREATE TABLE IF NOT EXISTS segments (
  id         TEXT PRIMARY KEY,
  name       TEXT NOT NULL,
  rules      TEXT NOT NULL DEFAULT '{"match":"all","rules":[]}',
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

ALTER TABLE contacts ADD COLUMN props TEXT;
ALTER TABLE campaigns ADD COLUMN segment_id TEXT;
