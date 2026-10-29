-- Repair: a deployed database recorded 0001 and 0002 as applied but lacked these columns (catalog photo detail and categories failed with a server error). Idempotent, so a healthy database is untouched.
ALTER TABLE listing_items ADD COLUMN IF NOT EXISTS category text;
ALTER TABLE listing_items ADD COLUMN IF NOT EXISTS category_suggestion text;
ALTER TABLE listing_items ADD COLUMN IF NOT EXISTS cutout bytea;
