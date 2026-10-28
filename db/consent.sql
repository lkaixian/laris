-- PDPA in the chat: the customer saw the privacy notice (customer_consent) and their erase / export requests (data_requests).
-- Applied on every start (idempotent), after privacy.sql (needs laris_tenant_ok from rls.sql). laris_app gets its grants from roles.sql.
CREATE TABLE IF NOT EXISTS customer_consent (
  tenant_id uuid NOT NULL REFERENCES tenants,
  party_id uuid PRIMARY KEY REFERENCES parties ON DELETE CASCADE,
  channel text,
  notice_version int NOT NULL DEFAULT 1,
  notice_shown_at timestamptz NOT NULL DEFAULT now(),
  basis text NOT NULL DEFAULT 'implied_by_continuing',
  withdrawn_at timestamptz
);

CREATE TABLE IF NOT EXISTS data_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants,
  party_id uuid NOT NULL REFERENCES parties ON DELETE CASCADE,
  kind text NOT NULL CHECK (kind IN ('erase','export')),
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','done','dismissed')),
  channel text,
  requested_at timestamptz NOT NULL DEFAULT now(),
  decided_at timestamptz,
  decided_by uuid REFERENCES users
);
CREATE INDEX IF NOT EXISTS data_requests_tenant ON data_requests (tenant_id, status, requested_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS data_requests_one_pending ON data_requests (party_id, kind) WHERE status = 'pending';

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['customer_consent','data_requests'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS tenant_scope ON %I', t);
    EXECUTE format('CREATE POLICY tenant_scope ON %I USING (laris_tenant_ok(tenant_id)) WITH CHECK (laris_tenant_ok(tenant_id))', t);
  END LOOP;
END $$;
