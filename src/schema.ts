// Generated from migrations/*.sql. Runs once per worker instance; every statement is idempotent.
export const SCHEMA: string[] = [
 "CREATE TABLE IF NOT EXISTS settings ( key TEXT PRIMARY KEY, value TEXT NOT NULL )",
 "CREATE TABLE IF NOT EXISTS sites ( id TEXT PRIMARY KEY, name TEXT NOT NULL, subdomain TEXT NOT NULL UNIQUE, accent TEXT NOT NULL DEFAULT 'brass', theme TEXT NOT NULL DEFAULT 'auto', status TEXT NOT NULL DEFAULT 'building', tagline TEXT NOT NULL DEFAULT '', created_at INTEGER NOT NULL )",
 "CREATE TABLE IF NOT EXISTS pages ( id TEXT PRIMARY KEY, site_id TEXT NOT NULL REFERENCES sites(id) ON DELETE CASCADE, slug TEXT NOT NULL, title TEXT NOT NULL, template TEXT NOT NULL, content TEXT NOT NULL DEFAULT '{}', published INTEGER NOT NULL DEFAULT 0, views INTEGER NOT NULL DEFAULT 0, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL, UNIQUE (site_id, slug) )",
 "CREATE TABLE IF NOT EXISTS lists ( id TEXT PRIMARY KEY, name TEXT NOT NULL, site_id TEXT REFERENCES sites(id) ON DELETE SET NULL, welcome_enabled INTEGER NOT NULL DEFAULT 0, welcome_subject TEXT NOT NULL DEFAULT '', welcome_body TEXT NOT NULL DEFAULT '', created_at INTEGER NOT NULL )",
 "CREATE TABLE IF NOT EXISTS contacts ( id TEXT PRIMARY KEY, email TEXT NOT NULL UNIQUE COLLATE NOCASE, name TEXT NOT NULL DEFAULT '', status TEXT NOT NULL DEFAULT 'subscribed', source TEXT NOT NULL DEFAULT '', consent_at INTEGER, consent_text TEXT NOT NULL DEFAULT '', token TEXT NOT NULL UNIQUE, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL )",
 "CREATE TABLE IF NOT EXISTS list_members ( list_id TEXT NOT NULL REFERENCES lists(id) ON DELETE CASCADE, contact_id TEXT NOT NULL REFERENCES contacts(id) ON DELETE CASCADE, added_at INTEGER NOT NULL, PRIMARY KEY (list_id, contact_id) )",
 "CREATE TABLE IF NOT EXISTS campaigns ( id TEXT PRIMARY KEY, name TEXT NOT NULL, subject TEXT NOT NULL DEFAULT '', preheader TEXT NOT NULL DEFAULT '', body TEXT NOT NULL DEFAULT '', list_id TEXT REFERENCES lists(id) ON DELETE SET NULL, site_id TEXT REFERENCES sites(id) ON DELETE SET NULL, status TEXT NOT NULL DEFAULT 'draft', scheduled_at INTEGER, sent_at INTEGER, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL )",
 "CREATE TABLE IF NOT EXISTS sends ( id TEXT PRIMARY KEY, campaign_id TEXT REFERENCES campaigns(id) ON DELETE CASCADE, list_id TEXT, kind TEXT NOT NULL, contact_id TEXT REFERENCES contacts(id) ON DELETE CASCADE, email TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'queued', error TEXT, provider_id TEXT, opened_at INTEGER, clicked_at INTEGER, created_at INTEGER NOT NULL, sent_at INTEGER )",
 "CREATE INDEX IF NOT EXISTS idx_pages_site ON pages(site_id)",
 "CREATE INDEX IF NOT EXISTS idx_members_c ON list_members(contact_id)",
 "CREATE INDEX IF NOT EXISTS idx_sends_queue ON sends(status, created_at)",
 "CREATE INDEX IF NOT EXISTS idx_sends_campaign ON sends(campaign_id)",
 "CREATE INDEX IF NOT EXISTS idx_contacts_time ON contacts(created_at)",
 "CREATE TABLE IF NOT EXISTS login_tokens ( hash TEXT PRIMARY KEY, email TEXT NOT NULL, expires_at INTEGER NOT NULL, used_at INTEGER, created_at INTEGER NOT NULL )",
 "CREATE TABLE IF NOT EXISTS sessions ( hash TEXT PRIMARY KEY, email TEXT NOT NULL, expires_at INTEGER NOT NULL, created_at INTEGER NOT NULL, user_agent TEXT NOT NULL DEFAULT '' )",
 "CREATE INDEX IF NOT EXISTS idx_login_email ON login_tokens(email, created_at)"
];
