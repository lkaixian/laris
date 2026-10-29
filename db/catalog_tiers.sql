-- Catalog items: per-size prices, quantity tiers and an optional stock count. Applied by the owner on every start (idempotent), after listings.sql.
-- price_tiers: [{"size": "1kg" | null, "min_qty": "10", "price": "40.00"}]. One entry = one tier, like a supplier tier line (row 73):
-- the rules engine (src/pricing.py pick_tier) takes the largest min_qty <= qty; below the lowest tier of a size that tier is used and flagged.
-- A tier is a price, so the API only shows or changes it for roles with view_costs (same as listing_items.price).
-- stock_qty: NULL = not counted, and a reply then never says "in stock". It is a count the owner keys in; sales do not lower it.
ALTER TABLE listing_items ADD COLUMN IF NOT EXISTS price_tiers jsonb NOT NULL DEFAULT '[]' CHECK (jsonb_typeof(price_tiers) = 'array');
ALTER TABLE listing_items ADD COLUMN IF NOT EXISTS stock_qty numeric(14,3) CHECK (stock_qty >= 0);
