-- Orders and purchase orders (v2 slice): customer PO, sales order, supplier PO. Proforma, delivery order, invoice and receipt live in
-- chain.sql / delivery.sql (deal_docs, payments), against the order's jobs row; job_id here is that row, so money for an order lives in one place.
-- Quotations stay in `documents`; a chain doc may point at the accepted quote it came from (quote_id).
-- Applied by the owner on every start (idempotent), after consent.sql. Money is numeric(14,2); lines are jsonb [{description, qty, uom, unit_price}].
CREATE TABLE IF NOT EXISTS chain_docs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants,
  kind text NOT NULL CHECK (kind IN ('cpo','so','spo','grn')),
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
  note text CHECK (length(note) <= 2000),
  void_reason text,
  created_by uuid REFERENCES users,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, doc_no)
);
ALTER TABLE chain_docs ADD COLUMN IF NOT EXISTS job_id uuid;   -- the order (jobs row) this document belongs to; null for a supplier PO that serves no order
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chain_docs_job_fk') THEN
    ALTER TABLE chain_docs ADD CONSTRAINT chain_docs_job_fk FOREIGN KEY (tenant_id, job_id) REFERENCES jobs (tenant_id, id);   -- same tenant only
  END IF;
END $$;
DO $$ BEGIN   -- databases made before goods received: widen the kind check once
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chain_docs_kind_check' AND conrelid = 'chain_docs'::regclass AND pg_get_constraintdef(oid) NOT LIKE '%grn%') THEN
    ALTER TABLE chain_docs DROP CONSTRAINT chain_docs_kind_check;
    ALTER TABLE chain_docs ADD CONSTRAINT chain_docs_kind_check CHECK (kind IN ('cpo','so','spo','grn'));
  END IF;
END $$;
CREATE INDEX IF NOT EXISTS chain_docs_job_idx ON chain_docs (job_id);
CREATE INDEX IF NOT EXISTS chain_docs_deal_idx ON chain_docs (tenant_id, deal_id, created_at);
CREATE INDEX IF NOT EXISTS chain_docs_kind_idx ON chain_docs (tenant_id, kind, created_at DESC);

-- Gap-free numbering for cpo / so / spo only (proforma, delivery order, invoice, receipt are numbered in api/chain.py from the per-kind prefixes in tenants).
-- One counter row per tenant, kind and year, bumped in the same transaction as the insert.
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
