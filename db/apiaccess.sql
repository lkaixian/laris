-- API keys for the read-only price API (/api/v1) and a per-call usage counter. Applied on every start (idempotent), after rls.sql
-- (needs laris_tenant_ok). laris_app gets its grants from roles.sql (ALL TABLES). Only the SHA-256 of a key is stored.
CREATE TABLE IF NOT EXISTS api_keys (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants,
  name text NOT NULL CHECK (length(name) BETWEEN 1 AND 60),
  key_prefix text NOT NULL,
  key_hash text NOT NULL UNIQUE,
  created_by uuid REFERENCES users,
  created_at timestamptz NOT NULL DEFAULT now(),
  last_used_at timestamptz,
  revoked_at timestamptz
);

CREATE TABLE IF NOT EXISTS usage_events (
  tenant_id uuid NOT NULL REFERENCES tenants,
  kind text NOT NULL,
  at timestamptz NOT NULL DEFAULT now(),
  key_id uuid REFERENCES api_keys
);
CREATE INDEX IF NOT EXISTS usage_events_tenant ON usage_events (tenant_id, kind, at);

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['api_keys','usage_events'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS tenant_scope ON %I', t);
    EXECUTE format('CREATE POLICY tenant_scope ON %I USING (laris_tenant_ok(tenant_id)) WITH CHECK (laris_tenant_ok(tenant_id))', t);
  END LOOP;
END $$;
