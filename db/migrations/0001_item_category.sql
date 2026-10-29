-- Catalog products get a category. category is what the business keeps; category_suggestion is what the photo reader proposed and nobody accepted yet.
ALTER TABLE listing_items ADD COLUMN IF NOT EXISTS category text;
ALTER TABLE listing_items ADD COLUMN IF NOT EXISTS category_suggestion text;
