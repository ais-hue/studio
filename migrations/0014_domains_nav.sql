-- Custom domains. A hostname serves a site, or redirects to another hostname (www.ciunas.app → ciunas.app).
-- The primary domain is the site's real address: once set, its *.aisling.online address sends visitors there.
CREATE TABLE IF NOT EXISTS domains (
  hostname     TEXT PRIMARY KEY,
  site_id      TEXT NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
  redirect_to  TEXT,
  is_primary   INTEGER NOT NULL DEFAULT 0,
  workspace_id TEXT NOT NULL DEFAULT 'main',
  created_at   INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS domains_site ON domains(site_id);

-- Old addresses that should send people somewhere else on the site (or off it).
CREATE TABLE IF NOT EXISTS redirects (
  site_id      TEXT NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
  from_path    TEXT NOT NULL,                 -- '/old-page', no trailing slash
  to_url       TEXT NOT NULL,                 -- '/new-page' or https://…
  workspace_id TEXT NOT NULL DEFAULT 'main',
  created_at   INTEGER NOT NULL,
  PRIMARY KEY (site_id, from_path)
);

-- Site-wide header links, logo and footer, as JSON (see src/sitekit.ts).
ALTER TABLE sites ADD COLUMN nav TEXT NOT NULL DEFAULT '{}';
