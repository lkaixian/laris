-- Order chain (docs/order-chain-plan.md steps 1-2): proforma, payments, receipts, delivery signatures. Applied by the owner on every start
-- (idempotent), after accept.sql. The order is the jobs row (jobs.quote_id may be null for a hand-made job). Money is numeric(14,2).
-- Selling side only: nothing here holds cost. Row level security FORCE + the audit trigger of transitions.sql on every table.
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS doc_language text NOT NULL DEFAULT 'en' CHECK (doc_language IN ('en','ms','zh','ta'));
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS doc_layouts jsonb NOT NULL DEFAULT '{}' CHECK (jsonb_typeof(doc_layouts) = 'object');  -- per-kind overrides, validated by doc_layout.merge before they are saved
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS proforma_prefix text NOT NULL DEFAULT 'PF' CHECK (proforma_prefix ~ '^[A-Z0-9-]{1,8}$');
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS delivery_order_prefix text NOT NULL DEFAULT 'DO' CHECK (delivery_order_prefix ~ '^[A-Z0-9-]{1,8}$');
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS invoice_prefix text NOT NULL DEFAULT 'INV' CHECK (invoice_prefix ~ '^[A-Z0-9-]{1,8}$');
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS receipt_prefix text NOT NULL DEFAULT 'RC' CHECK (receipt_prefix ~ '^[A-Z0-9-]{1,8}$');

-- What the customer owes for this order, set once by the API (quote total incl. estimated SST, or jobs.amount) and the cap the overpayment guard uses.
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS order_total numeric(14,2) CHECK (order_total >= 0);
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'jobs_tenant_id_id_uq') THEN
    ALTER TABLE jobs ADD CONSTRAINT jobs_tenant_id_id_uq UNIQUE (tenant_id, id);   -- target of the same-tenant foreign keys below
  END IF;
END $$;

-- Append-only: a mistake is fixed by a new (reversing) row, never an edit.
CREATE OR REPLACE FUNCTION chain_immutable() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION '% is append-only', TG_TABLE_NAME; END $$;

CREATE TABLE IF NOT EXISTS payments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants,
  job_id uuid NOT NULL,
  amount numeric(14,2) NOT NULL CHECK (amount > 0),
  method text NOT NULL CHECK (method IN ('cash','transfer','duitnow','cheque','card','other')),
  reference text CHECK (length(reference) <= 100),
  paid_on date NOT NULL,
  purpose text NOT NULL CHECK (purpose IN ('deposit','balance')),
  recorded_by uuid REFERENCES users,
  idempotency_key text NOT NULL CHECK (length(idempotency_key) BETWEEN 8 AND 100),
  reverses_payment_id uuid,                      -- set on the reversing row; it undoes one whole earlier payment
  reversal_reason text CHECK (length(reversal_reason) <= 300),
  extraction jsonb,                              -- the AI slip proposal the owner confirmed from; never in ai_actions
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, id),
  UNIQUE (tenant_id, idempotency_key),
  FOREIGN KEY (tenant_id, job_id) REFERENCES jobs (tenant_id, id),
  FOREIGN KEY (tenant_id, reverses_payment_id) REFERENCES payments (tenant_id, id),
  CONSTRAINT reversal_has_reason CHECK (reverses_payment_id IS NULL OR reversal_reason IS NOT NULL)
);
CREATE UNIQUE INDEX IF NOT EXISTS payments_one_reversal ON payments (reverses_payment_id) WHERE reverses_payment_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS payments_job_idx ON payments (job_id);

-- The row lock on the job serialises every payment of one order, so two racing payments cannot both pass the check.
CREATE OR REPLACE FUNCTION payments_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE j jobs; o payments; paid numeric;
BEGIN
  SELECT * INTO j FROM jobs WHERE id = NEW.job_id AND tenant_id = NEW.tenant_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'payment: job not found'; END IF;
  IF NEW.reverses_payment_id IS NOT NULL THEN
    SELECT * INTO o FROM payments WHERE id = NEW.reverses_payment_id AND tenant_id = NEW.tenant_id;
    IF NOT FOUND OR o.reverses_payment_id IS NOT NULL OR o.job_id <> NEW.job_id OR o.amount <> NEW.amount THEN
      RAISE EXCEPTION 'payment: a reversal must undo one whole earlier payment of the same order';
    END IF;
    RETURN NEW;
  END IF;
  IF j.order_total IS NULL THEN RAISE EXCEPTION 'payment: the order has no total yet'; END IF;
  SELECT coalesce(sum(CASE WHEN reverses_payment_id IS NULL THEN amount ELSE -amount END), 0) INTO paid FROM payments WHERE job_id = NEW.job_id;
  IF paid + NEW.amount > j.order_total THEN
    RAISE EXCEPTION 'payment: overpayment, this order has % left to pay', j.order_total - paid;
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS payments_guard ON payments;
CREATE TRIGGER payments_guard BEFORE INSERT ON payments FOR EACH ROW EXECUTE FUNCTION payments_guard();
DROP TRIGGER IF EXISTS payments_no_mut ON payments;
CREATE TRIGGER payments_no_mut BEFORE UPDATE OR DELETE ON payments FOR EACH ROW EXECUTE FUNCTION chain_immutable();
DROP TRIGGER IF EXISTS payments_no_trunc ON payments;
CREATE TRIGGER payments_no_trunc BEFORE TRUNCATE ON payments FOR EACH STATEMENT EXECUTE FUNCTION chain_immutable();
DROP TRIGGER IF EXISTS payments_audit ON payments;
CREATE TRIGGER payments_audit AFTER INSERT ON payments FOR EACH ROW EXECUTE FUNCTION write_audit();   -- the audit row leaves out `extraction`
REVOKE UPDATE, DELETE, TRUNCATE ON payments FROM PUBLIC;

CREATE TABLE IF NOT EXISTS deal_docs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants,
  job_id uuid NOT NULL,
  kind text NOT NULL CHECK (kind IN ('proforma','delivery_order','invoice','receipt')),
  doc_no text NOT NULL CHECK (length(doc_no) <= 40),
  status text NOT NULL DEFAULT 'issued' CHECK (status IN ('issued','signed','void')),
  lines jsonb NOT NULL DEFAULT '[]' CHECK (jsonb_typeof(lines) = 'array'),          -- frozen quote_doc lines (decimals as strings)
  subtotal numeric(14,2) NOT NULL CHECK (subtotal >= 0),
  tax_total numeric(14,2),
  total numeric(14,2) NOT NULL CHECK (total >= 0),
  extra jsonb NOT NULL DEFAULT '{}' CHECK (jsonb_typeof(extra) = 'object'),         -- proforma: {deposit_pct, deposit_amount}; receipt: {balance}
  layout_snapshot jsonb NOT NULL CHECK (jsonb_typeof(layout_snapshot) = 'object'),  -- the whole validated spec used at issue
  issued_by uuid REFERENCES users,
  issued_at timestamptz NOT NULL DEFAULT now(),
  void_reason text CHECK (length(void_reason) <= 300),
  voided_at timestamptz,
  voided_by uuid REFERENCES users,
  payment_id uuid,                                                                  -- a receipt's payment
  UNIQUE (tenant_id, id),
  UNIQUE (tenant_id, kind, doc_no),
  FOREIGN KEY (tenant_id, job_id) REFERENCES jobs (tenant_id, id),
  FOREIGN KEY (tenant_id, payment_id) REFERENCES payments (tenant_id, id),
  CONSTRAINT receipt_has_payment CHECK ((kind = 'receipt') = (payment_id IS NOT NULL)),
  CONSTRAINT void_has_reason CHECK ((status = 'void') = (void_reason IS NOT NULL AND voided_at IS NOT NULL))
);
-- One live proforma and one live invoice per order; delivery orders are many (no unique); one receipt per payment.
CREATE UNIQUE INDEX IF NOT EXISTS deal_docs_one_proforma ON deal_docs (job_id) WHERE kind = 'proforma' AND status <> 'void';
CREATE UNIQUE INDEX IF NOT EXISTS deal_docs_one_invoice ON deal_docs (job_id) WHERE kind = 'invoice' AND status <> 'void';
CREATE UNIQUE INDEX IF NOT EXISTS deal_docs_one_receipt ON deal_docs (payment_id) WHERE kind = 'receipt';
CREATE INDEX IF NOT EXISTS deal_docs_job_idx ON deal_docs (job_id);

-- An issued document is frozen: only its status and the void columns change, and void is final.
CREATE OR REPLACE FUNCTION deal_docs_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE k text[] := ARRAY['status','void_reason','voided_at','voided_by'];
BEGIN
  IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'deal_docs rows cannot be deleted: void the document'; END IF;
  IF OLD.status = 'void' OR NEW.status = 'issued' AND OLD.status <> 'issued' THEN RAISE EXCEPTION 'deal_docs: % is %, its status cannot go back', OLD.doc_no, OLD.status; END IF;
  IF to_jsonb(NEW) - k <> to_jsonb(OLD) - k THEN RAISE EXCEPTION 'deal_docs: an issued document is frozen, void it and issue a new one'; END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS deal_docs_guard ON deal_docs;
CREATE TRIGGER deal_docs_guard BEFORE UPDATE OR DELETE ON deal_docs FOR EACH ROW EXECUTE FUNCTION deal_docs_guard();
DROP TRIGGER IF EXISTS deal_docs_audit ON deal_docs;
CREATE TRIGGER deal_docs_audit AFTER INSERT OR UPDATE ON deal_docs FOR EACH ROW EXECUTE FUNCTION write_audit();
REVOKE DELETE, TRUNCATE ON deal_docs FROM PUBLIC;

-- The customer's proof of delivery (no API yet, step 3). Append-only; doc_sha256 = hash of the document as signed.
CREATE TABLE IF NOT EXISTS delivery_signatures (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants,
  deal_doc_id uuid NOT NULL,
  signer_name text NOT NULL CHECK (length(signer_name) BETWEEN 2 AND 80),
  agreed boolean NOT NULL CHECK (agreed),
  mark text CHECK (length(mark) <= 200000),      -- optional drawn mark, a data URL
  signer_ip_hash text,
  problems_note text CHECK (length(problems_note) <= 1000),
  doc_sha256 text NOT NULL,
  signed_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (deal_doc_id),
  FOREIGN KEY (tenant_id, deal_doc_id) REFERENCES deal_docs (tenant_id, id)
);
DROP TRIGGER IF EXISTS delivery_signatures_no_mut ON delivery_signatures;
CREATE TRIGGER delivery_signatures_no_mut BEFORE UPDATE OR DELETE ON delivery_signatures FOR EACH ROW EXECUTE FUNCTION chain_immutable();
DROP TRIGGER IF EXISTS delivery_signatures_no_trunc ON delivery_signatures;
CREATE TRIGGER delivery_signatures_no_trunc BEFORE TRUNCATE ON delivery_signatures FOR EACH STATEMENT EXECUTE FUNCTION chain_immutable();
DROP TRIGGER IF EXISTS delivery_signatures_audit ON delivery_signatures;
CREATE TRIGGER delivery_signatures_audit AFTER INSERT ON delivery_signatures FOR EACH ROW EXECUTE FUNCTION write_audit();
REVOKE UPDATE, DELETE, TRUNCATE ON delivery_signatures FROM PUBLIC;

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['payments','deal_docs','delivery_signatures'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS tenant_scope ON %I', t);
    EXECUTE format('CREATE POLICY tenant_scope ON %I USING (laris_tenant_ok(tenant_id)) WITH CHECK (laris_tenant_ok(tenant_id))', t);
  END LOOP;
END $$;
