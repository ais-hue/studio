-- Automations (email sequences), bounce/complaint handling and double opt-in.

-- An automation: who it starts for, and how its emails are styled.
CREATE TABLE IF NOT EXISTS sequences (
  id                  TEXT PRIMARY KEY,
  name                TEXT NOT NULL,
  status              TEXT NOT NULL DEFAULT 'draft',  -- draft | active | paused
  trigger             TEXT NOT NULL DEFAULT 'list',   -- list | click | manual
  trigger_list_id     TEXT,                           -- trigger = list: joins this list
  trigger_campaign_id TEXT,                           -- trigger = click: clicks a link in this email
  site_id             TEXT,                           -- styles the emails like this site
  created_at          INTEGER NOT NULL,
  updated_at          INTEGER NOT NULL
);

-- The emails in an automation, in order.
CREATE TABLE IF NOT EXISTS sequence_steps (
  id            TEXT PRIMARY KEY,
  sequence_id   TEXT NOT NULL,
  position      INTEGER NOT NULL,
  delay_minutes INTEGER NOT NULL DEFAULT 0,          -- wait after the previous step (or after starting)
  condition     TEXT NOT NULL DEFAULT 'always',      -- always | opened | not_opened | clicked | not_clicked (the previous email)
  subject       TEXT NOT NULL DEFAULT '',
  preheader     TEXT NOT NULL DEFAULT '',
  body          TEXT NOT NULL DEFAULT '',
  created_at    INTEGER NOT NULL,
  updated_at    INTEGER NOT NULL
);

-- One person going through one automation.
CREATE TABLE IF NOT EXISTS enrollments (
  id           TEXT PRIMARY KEY,
  sequence_id  TEXT NOT NULL,
  contact_id   TEXT NOT NULL,
  step_index   INTEGER NOT NULL DEFAULT 0,           -- next step to run
  status       TEXT NOT NULL DEFAULT 'active',       -- active | completed | exited
  exit_reason  TEXT,
  next_at      INTEGER,
  last_send_id TEXT,
  created_at   INTEGER NOT NULL,
  updated_at   INTEGER NOT NULL,
  UNIQUE (sequence_id, contact_id)
);

-- Delivery events from Resend (bounces, complaints, deliveries).
CREATE TABLE IF NOT EXISTS email_events (
  id          TEXT PRIMARY KEY,                      -- the webhook message id, so repeats are ignored
  type        TEXT NOT NULL,
  provider_id TEXT,
  email       TEXT,
  detail      TEXT NOT NULL DEFAULT '',
  created_at  INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_steps_seq     ON sequence_steps(sequence_id, position);
CREATE INDEX IF NOT EXISTS idx_enroll_due    ON enrollments(status, next_at);
CREATE INDEX IF NOT EXISTS idx_enroll_seq    ON enrollments(sequence_id, status);
CREATE INDEX IF NOT EXISTS idx_enroll_c      ON enrollments(contact_id);
CREATE INDEX IF NOT EXISTS idx_sends_provider ON sends(provider_id);
CREATE INDEX IF NOT EXISTS idx_events_time   ON email_events(created_at);

-- New columns on sends. (Applied one at a time; "already exists" is ignored.)
ALTER TABLE sends ADD COLUMN step_id TEXT;
ALTER TABLE sends ADD COLUMN enrollment_id TEXT;
ALTER TABLE sends ADD COLUMN delivered_at INTEGER;
ALTER TABLE sends ADD COLUMN bounced_at INTEGER;
ALTER TABLE sends ADD COLUMN complained_at INTEGER;
CREATE INDEX IF NOT EXISTS idx_sends_step ON sends(step_id);
