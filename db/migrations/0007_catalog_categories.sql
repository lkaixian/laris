-- The business's own catalog categories (Filaments, Printer maintenance, ...). A product's category stays a plain text on listing_items;
-- this table holds the list the owner keeps, including categories that have no product yet. Names are unique per business, ignoring case.
CREATE TABLE IF NOT EXISTS catalog_categories (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants,
  name text NOT NULL CHECK (length(btrim(name)) BETWEEN 1 AND 60),
  sort_order int NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS catalog_categories_name ON catalog_categories (tenant_id, lower(name));
ALTER TABLE catalog_categories ENABLE ROW LEVEL SECURITY;
ALTER TABLE catalog_categories FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_scope ON catalog_categories;
CREATE POLICY tenant_scope ON catalog_categories USING (laris_tenant_ok(tenant_id)) WITH CHECK (laris_tenant_ok(tenant_id));
CREATE INDEX IF NOT EXISTS listing_items_category ON listing_items (tenant_id, category);
