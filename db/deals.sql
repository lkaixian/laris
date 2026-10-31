-- Quote-to-cash document chain (v2 slice): customer PO, sales order, proforma, delivery order, invoice, receipt, supplier PO.
-- Quotations stay in `documents`; a chain doc may point at the accepted quote it came from (quote_id).
-- Applied by the owner on every start (idempotent), after consent.sql. Money is numeric(14,2); lines are jsonb [{description, qty, uom, unit_price}].
CREATE TABLE IF NOT EXISTS chain_docs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants,
  kind text NOT NULL CHECK (kind IN ('cpo','so','pf','do','inv','rcp','spo')),
  doc_no text NOT NULL,
  status text NOT NULL,
  deal_id uuid NOT NULL,                                  -- every document of one deal shares this id (the Document Trail)
  parent_id uuid REFERENCES chain_docs,
  quote_id uuid REFERENCES documents,
  party_id uuid REFERENCES parties,
  ref text CHECK (length(ref) <= 80),                     -- the customer's own PO number
  lines jsonb NOT NULL DEFAULT '[]',
  discount_pct numeric(5,2) NOT NULL DEFAULT 0 CHECK (discount_pct >= 0 AND discount_pct <= 100),
  sst_rate numeric(5,2) NOT NULL DEFAULT 0 CHECK (sst_rate >= 0 AND sst_rate <= 100),
  round5 boolean NOT NULL DEFAULT false,                  -- Malaysian 5-sen rounding
  subtotal numeric(14,2) NOT NULL DEFAULT 0,
  discount numeric(14,2) NOT NULL DEFAULT 0,
  sst numeric(14,2) NOT NULL DEFAULT 0,
  rounding numeric(14,2) NOT NULL DEFAULT 0,
  total numeric(14,2) NOT NULL DEFAULT 0,
  deposit_pct numeric(5,2) CHECK (deposit_pct >= 0 AND deposit_pct <= 100),
  paid numeric(14,2) NOT NULL DEFAULT 0,                  -- on an invoice or proforma: the sum of its receipts
  due_on date,
  note text CHECK (length(note) <= 2000),
  void_reason text,
  created_by uuid REFERENCES users,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, doc_no)
);
CREATE INDEX IF NOT EXISTS chain_docs_deal_idx ON chain_docs (tenant_id, deal_id, created_at);
CREATE INDEX IF NOT EXISTS chain_docs_kind_idx ON chain_docs (tenant_id, kind, created_at DESC);

-- Gap-free numbering: one counter row per tenant, kind and year, bumped in the same transaction as the insert.
CREATE TABLE IF NOT EXISTS chain_counters (
  tenant_id uuid NOT NULL REFERENCES tenants,
  kind text NOT NULL,
  yr int NOT NULL,
  last int NOT NULL DEFAULT 0,
  PRIMARY KEY (tenant_id, kind, yr)
);

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['chain_docs','chain_counters'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS tenant_scope ON %I', t);
    EXECUTE format('CREATE POLICY tenant_scope ON %I USING (laris_tenant_ok(tenant_id)) WITH CHECK (laris_tenant_ok(tenant_id))', t);
  END LOOP;
END $$;
