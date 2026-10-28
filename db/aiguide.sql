-- Optional AI guide: per-business AI settings (default off) and an append-only consent log. Applied on every start (idempotent),
-- after rls.sql (needs laris_tenant_ok). laris_app gets its grants from roles.sql. custom_key_enc is Fernet text, never returned by the API.
CREATE TABLE IF NOT EXISTS tenant_ai (
  tenant_id uuid PRIMARY KEY REFERENCES tenants,
  mode text NOT NULL DEFAULT 'off' CHECK (mode IN ('off','guide','guide_data')),
  provider text NOT NULL DEFAULT 'ilmu' CHECK (provider IN ('ilmu','custom')),
  custom_base_url text,
  custom_model text,
  custom_key_enc text,
  consent_version int,
  consent_at timestamptz,
  consent_by uuid,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS ai_consent_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants,
  at timestamptz NOT NULL DEFAULT now(),
  user_id uuid,
  action text NOT NULL CHECK (action IN ('enable','change','disable')),
  mode text NOT NULL,
  provider text NOT NULL,
  host text,                      -- host name of a custom server only, never the path or key
  disclosure_version int
);
CREATE INDEX IF NOT EXISTS ai_consent_log_tenant ON ai_consent_log (tenant_id, at);

CREATE OR REPLACE FUNCTION ai_consent_immutable() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'ai_consent_log is append-only'; END $$;
DROP TRIGGER IF EXISTS ai_consent_no_mut ON ai_consent_log;
CREATE TRIGGER ai_consent_no_mut BEFORE UPDATE OR DELETE ON ai_consent_log FOR EACH ROW EXECUTE FUNCTION ai_consent_immutable();

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['tenant_ai','ai_consent_log'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS tenant_scope ON %I', t);
    EXECUTE format('CREATE POLICY tenant_scope ON %I USING (laris_tenant_ok(tenant_id)) WITH CHECK (laris_tenant_ok(tenant_id))', t);
  END LOOP;
END $$;
