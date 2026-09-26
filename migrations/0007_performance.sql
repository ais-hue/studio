-- Post performance pulled from Zernio (likes, comments, shares, reach… per platform).
ALTER TABLE social_posts ADD COLUMN metrics TEXT;
ALTER TABLE social_posts ADD COLUMN metrics_at INTEGER;
