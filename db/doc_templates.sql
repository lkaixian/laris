-- The owner's own Word template for a customer document (purchase order, sales order, proforma, delivery order, invoice, receipt), uploaded on the
-- Admin page. One per business and document type; uploading again replaces it, removing it falls back to LARIS's standard layout. The file is a plain
-- .docx checked by src/doc_template.py (no macros, no embedded objects); only the owner may change it. Applied by the owner on every start (idempotent),
-- after revenue.sql. Row level security FORCE like every other table; changes are audited by the API (the file itself is not copied into the audit log).
CREATE TABLE IF NOT EXISTS doc_templates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants,
  stage text NOT NULL CHECK (stage IN ('purchase_order','sales_order','proforma','delivery_order','invoice','receipt')),
  filename text NOT NULL CHECK (length(filename) BETWEEN 1 AND 120),
  content bytea NOT NULL CHECK (octet_length(content) BETWEEN 1 AND 2000000),
  sha256 text NOT NULL CHECK (sha256 ~ '^[0-9a-f]{64}$'),
  uploaded_by uuid REFERENCES users,
  uploaded_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, stage)
);
ALTER TABLE doc_templates ENABLE ROW LEVEL SECURITY;
ALTER TABLE doc_templates FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_scope ON doc_templates;
CREATE POLICY tenant_scope ON doc_templates USING (laris_tenant_ok(tenant_id)) WITH CHECK (laris_tenant_ok(tenant_id));
