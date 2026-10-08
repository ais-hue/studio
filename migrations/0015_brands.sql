-- Brands: the root that sites, social accounts and (later) lists, forms and files belong to.
-- kit holds the brand's design tokens as flat JSON (src/brandkit.ts). A child brand (an app under Ciúnas)
-- stores only what it overrides; everything else comes from its parent.
CREATE TABLE IF NOT EXISTS brands (
  id           TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL DEFAULT 'main',
  parent_id    TEXT REFERENCES brands(id) ON DELETE SET NULL,
  name         TEXT NOT NULL,
  kit          TEXT NOT NULL DEFAULT '{}',
  created_at   INTEGER NOT NULL,
  updated_at   INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS brands_parent ON brands(parent_id);

ALTER TABLE sites ADD COLUMN brand_id TEXT;
ALTER TABLE social_brands ADD COLUMN brand_id TEXT;
