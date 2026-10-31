-- Running costs: rent, wages, bills and the like, recorded by the owner so the Revenue page can work out untung bersih (net profit).
-- Applied by the owner on every start (idempotent), after deals.sql. Money is numeric(14,2). Selling-side orders and payments live in chain.sql;
-- the cost of goods comes from the cost book (v_quote_margin), so nothing about goods is stored here.
-- Append-only in spirit, like payments: a mistake is fixed by voiding the row with a reason and recording a new one, never by editing or deleting.
-- Row level security FORCE and the audit trigger of transitions.sql, like every other table.
CREATE TABLE IF NOT EXISTS expenses (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants,
  spent_on date NOT NULL,
  category text NOT NULL CHECK (category IN ('rent','wages','utilities','transport','marketing','tax','other')),
  amount numeric(14,2) NOT NULL CHECK (amount > 0),
  note text CHECK (length(note) <= 200),
  created_by uuid REFERENCES users,
  created_at timestamptz NOT NULL DEFAULT now(),
  void_reason text CHECK (length(void_reason) <= 300),
  voided_at timestamptz,
  voided_by uuid REFERENCES users,
  UNIQUE (tenant_id, id),
  CONSTRAINT expenses_void_has_reason CHECK ((voided_at IS NULL) = (void_reason IS NULL))   -- a void has both its time and its reason, an active cost has neither
);
CREATE INDEX IF NOT EXISTS expenses_period_idx ON expenses (tenant_id, spent_on) WHERE voided_at IS NULL;

-- Only the void columns may change, once, and a row is never deleted.
CREATE OR REPLACE FUNCTION expenses_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE k text[] := ARRAY['void_reason','voided_at','voided_by'];
BEGIN
  IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'expenses rows cannot be deleted: void the cost'; END IF;
  IF OLD.voided_at IS NOT NULL THEN RAISE EXCEPTION 'expenses: this cost is already voided'; END IF;
  IF to_jsonb(NEW) - k <> to_jsonb(OLD) - k THEN RAISE EXCEPTION 'expenses: a recorded cost cannot be edited, void it and record a new one'; END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS expenses_guard ON expenses;
CREATE TRIGGER expenses_guard BEFORE UPDATE OR DELETE ON expenses FOR EACH ROW EXECUTE FUNCTION expenses_guard();
DROP TRIGGER IF EXISTS expenses_no_trunc ON expenses;
CREATE TRIGGER expenses_no_trunc BEFORE TRUNCATE ON expenses FOR EACH STATEMENT EXECUTE FUNCTION chain_immutable();
DROP TRIGGER IF EXISTS expenses_audit ON expenses;
CREATE TRIGGER expenses_audit AFTER INSERT OR UPDATE ON expenses FOR EACH ROW EXECUTE FUNCTION write_audit();
REVOKE DELETE, TRUNCATE ON expenses FROM PUBLIC;

ALTER TABLE expenses ENABLE ROW LEVEL SECURITY;
ALTER TABLE expenses FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_scope ON expenses;
CREATE POLICY tenant_scope ON expenses USING (laris_tenant_ok(tenant_id)) WITH CHECK (laris_tenant_ok(tenant_id));
