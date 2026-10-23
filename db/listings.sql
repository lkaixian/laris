-- Catalog photos: ONE photo with many labelled products, read by a vision model, each product reviewed beside its own crop.
-- Applied by the owner on every start (idempotent), after rfq.sql (needs laris_tenant_ok). laris_app gets its grants from roles.sql (ALL TABLES).
CREATE TABLE IF NOT EXISTS listings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants,
  created_by uuid REFERENCES users,             -- null when a supplier sent it on chat
  party_id uuid REFERENCES parties,             -- the supplier it came from, if known
  note text,
  source_channel text NOT NULL DEFAULT 'upload',
  image bytea NOT NULL,                         -- ponytail: in the row (8 MB cap), as rfq_items
  image_mime text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS listing_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  listing_id uuid NOT NULL REFERENCES listings ON DELETE CASCADE,
  tenant_id uuid NOT NULL REFERENCES tenants,
  position int NOT NULL,
  description text NOT NULL DEFAULT '',
  labels jsonb NOT NULL DEFAULT '[]',           -- text seen on or next to the product, verbatim
  sku text,
  sizes jsonb NOT NULL DEFAULT '[]',
  price numeric(14,4) CHECK (price > 0),        -- only ever a price OCR also saw, or one the owner keyed in
  currency text,
  bbox jsonb NOT NULL,                          -- [x0,y0,x1,y1] fractions of the photo
  crop bytea NOT NULL,
  crop_mime text NOT NULL DEFAULT 'image/jpeg',
  status text NOT NULL DEFAULT 'needs_review' CHECK (status IN ('needs_review','confirmed','discarded')),
  reasons jsonb NOT NULL DEFAULT '[]',
  item_key text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS listings_tenant ON listings (tenant_id, created_at DESC);
CREATE INDEX IF NOT EXISTS listing_items_listing ON listing_items (listing_id, position);

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['listings','listing_items'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS tenant_scope ON %I', t);
    EXECUTE format('CREATE POLICY tenant_scope ON %I USING (laris_tenant_ok(tenant_id)) WITH CHECK (laris_tenant_ok(tenant_id))', t);
  END LOOP;
END $$;
