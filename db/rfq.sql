-- "Ask suppliers": a photographed item sent to suppliers on WhatsApp, and their price replies. Applied by the owner on every
-- start (idempotent), after rls.sql (needs laris_tenant_ok). laris_app gets its grants from roles.sql (ALL TABLES), as for the rest.
CREATE TABLE IF NOT EXISTS rfq_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants,
  created_by uuid REFERENCES users,
  description text NOT NULL,
  note text NOT NULL,
  circle jsonb,                                 -- {x,y,r} as fractions of the photo, already drawn on the image
  image bytea NOT NULL,                         -- ponytail: in the row (8 MB cap); object storage if volume grows
  image_mime text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS rfq_sends (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  rfq_item_id uuid NOT NULL REFERENCES rfq_items,
  tenant_id uuid NOT NULL REFERENCES tenants,
  supplier_id uuid NOT NULL REFERENCES parties,
  wamid text UNIQUE,                            -- a reply's context.id points here
  status text NOT NULL CHECK (status IN ('sent','failed')),
  error text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS rfq_replies (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  send_id uuid NOT NULL REFERENCES rfq_sends,
  tenant_id uuid NOT NULL REFERENCES tenants,
  message_text text,                            -- null while waiting
  external_id text UNIQUE,                      -- inbound message id: a provider retry stores nothing twice
  unit_price numeric(14,4) CHECK (unit_price > 0),
  min_qty numeric(14,3) CHECK (min_qty > 0),
  tiers jsonb NOT NULL DEFAULT '[]',            -- [{min_qty, unit_price}] as strings
  status text NOT NULL DEFAULT 'waiting' CHECK (status IN ('waiting','needs_review','ready','accepted')),
  doc_id uuid REFERENCES documents,             -- the inbound quotation made on accept
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS rfq_items_tenant ON rfq_items (tenant_id, created_at DESC);
CREATE INDEX IF NOT EXISTS rfq_sends_supplier ON rfq_sends (supplier_id, created_at DESC);
CREATE INDEX IF NOT EXISTS rfq_sends_item ON rfq_sends (rfq_item_id);
CREATE INDEX IF NOT EXISTS rfq_replies_send ON rfq_replies (send_id);

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['rfq_items','rfq_sends','rfq_replies'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS tenant_scope ON %I', t);
    EXECUTE format('CREATE POLICY tenant_scope ON %I USING (laris_tenant_ok(tenant_id)) WITH CHECK (laris_tenant_ok(tenant_id))', t);
  END LOOP;
END $$;
