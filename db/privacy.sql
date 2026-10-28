-- PDPA: the named data protection officer contact and the breach register. Applied by the owner on every start (idempotent), after jobs.sql
-- (needs laris_tenant_ok from rls.sql). laris_app gets its grants from roles.sql (ALL TABLES).
CREATE TABLE IF NOT EXISTS tenant_privacy (
  tenant_id uuid PRIMARY KEY REFERENCES tenants,
  dpo_name text CHECK (length(dpo_name) <= 120),
  dpo_email text CHECK (length(dpo_email) <= 254),
  dpo_phone text CHECK (length(dpo_phone) <= 40),
  notice_version int NOT NULL DEFAULT 1 CHECK (notice_version >= 1),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS breach_incidents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants,
  detected_at timestamptz NOT NULL,
  summary text NOT NULL CHECK (length(summary) <= 1000),
  data_types text[] NOT NULL DEFAULT '{}',
  people_affected int CHECK (people_affected >= 0),
  significant_harm boolean NOT NULL DEFAULT false,
  commissioner_notified_at timestamptz,
  subjects_notified_at timestamptz,
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open','closed')),
  notes text CHECK (length(notes) <= 2000),
  created_by uuid REFERENCES users,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS breach_incidents_tenant ON breach_incidents (tenant_id, detected_at DESC);

-- The register must be kept for at least 2 years: no role deletes a row, the owner role included.
CREATE OR REPLACE FUNCTION breach_incidents_keep() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'breach_incidents is a register and cannot be deleted';
END $$;
DROP TRIGGER IF EXISTS breach_incidents_no_delete ON breach_incidents;
CREATE TRIGGER breach_incidents_no_delete BEFORE DELETE ON breach_incidents FOR EACH ROW EXECUTE FUNCTION breach_incidents_keep();

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['tenant_privacy','breach_incidents'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS tenant_scope ON %I', t);
    EXECUTE format('CREATE POLICY tenant_scope ON %I USING (laris_tenant_ok(tenant_id)) WITH CHECK (laris_tenant_ok(tenant_id))', t);
  END LOOP;
END $$;
