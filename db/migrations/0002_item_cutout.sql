-- A product picture with the background made transparent (PNG with alpha), drawn by hand in the browser starting from the photo reader's box.
ALTER TABLE listing_items ADD COLUMN IF NOT EXISTS cutout bytea;
