-- Studio's own posting engine. Accounts connected here post straight to the platform through Studio's own
-- developer apps; accounts still on Zernio keep going through Zernio. Tokens are stored encrypted.

-- Brands Studio owns itself (ids start br_). Zernio profiles keep working as brands alongside them.
CREATE TABLE IF NOT EXISTS social_brands (
  id         TEXT PRIMARY KEY,
  name       TEXT NOT NULL,
  created_at INTEGER NOT NULL
);

-- Studio's developer app on each platform (client id and encrypted secret). Never sent to the browser.
CREATE TABLE IF NOT EXISTS social_apps (
  platform   TEXT PRIMARY KEY,
  client_id  TEXT NOT NULL,
  secret     TEXT NOT NULL,                     -- encrypted
  options    TEXT NOT NULL DEFAULT '{}',        -- JSON, e.g. {sandbox:true} for Pinterest trial access
  updated_at INTEGER NOT NULL
);

-- Accounts connected directly (ids start sa_). One per platform per brand.
CREATE TABLE IF NOT EXISTS social_accounts (
  id               TEXT PRIMARY KEY,
  profile_id       TEXT NOT NULL,               -- brand: a Zernio profile id or a social_brands id
  platform         TEXT NOT NULL,
  external_id      TEXT NOT NULL,               -- the account's id on the platform
  username         TEXT NOT NULL DEFAULT '',
  display_name     TEXT NOT NULL DEFAULT '',
  picture          TEXT NOT NULL DEFAULT '',
  token            TEXT NOT NULL,               -- encrypted access token
  refresh_token    TEXT,                        -- encrypted (Bluesky: refresh JWT)
  secret           TEXT,                        -- encrypted (Bluesky: app password, to sign in again)
  expires_at       INTEGER,
  refresh_expires_at INTEGER,
  token_issued_at  INTEGER NOT NULL,
  meta             TEXT NOT NULL DEFAULT '{}',  -- JSON, e.g. Bluesky PDS address
  status           TEXT NOT NULL DEFAULT 'ok',  -- ok | reconnect
  status_note      TEXT,
  created_at       INTEGER NOT NULL,
  updated_at       INTEGER NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_social_accounts_brand ON social_accounts(profile_id, platform);

-- Sign-ins in progress (OAuth state and PKCE verifier), kept for 15 minutes.
CREATE TABLE IF NOT EXISTS social_oauth (
  state      TEXT PRIMARY KEY,
  platform   TEXT NOT NULL,
  profile_id TEXT NOT NULL,
  verifier   TEXT NOT NULL,
  created_at INTEGER NOT NULL
);

-- One row per post per directly connected account: the publishing job, worked through by the every-minute cron.
CREATE TABLE IF NOT EXISTS social_deliveries (
  id          TEXT PRIMARY KEY,
  post_id     TEXT NOT NULL,
  account_id  TEXT NOT NULL,
  platform    TEXT NOT NULL,
  status      TEXT NOT NULL DEFAULT 'queued',   -- queued | working | done | failed
  step        TEXT NOT NULL DEFAULT 'start',
  data        TEXT NOT NULL DEFAULT '{}',       -- JSON scratch between steps (container ids, upload progress…)
  attempts    INTEGER NOT NULL DEFAULT 0,
  next_at     INTEGER NOT NULL,
  locked_until INTEGER NOT NULL DEFAULT 0,
  external_id TEXT,
  url         TEXT,
  error       TEXT,
  created_at  INTEGER NOT NULL,
  updated_at  INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_deliveries_due  ON social_deliveries(status, next_at);
CREATE INDEX IF NOT EXISTS idx_deliveries_post ON social_deliveries(post_id);

-- The Zernio half of a post, kept apart so it can be combined with the direct half.
ALTER TABLE social_posts ADD COLUMN zernio_status TEXT;
ALTER TABLE social_posts ADD COLUMN zernio_results TEXT;
