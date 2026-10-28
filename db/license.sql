-- Signed software licence (src/license.py). Applied by the owner on every start (idempotent), after rbac.sql (needs laris_tenant_ok from rls.sql).
-- One licence = one tenant: license_id is unique across tenants. The token is stored as issued; it is re-verified on every status read.
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS license_token text;
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS license_id uuid;
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS license_email text;
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS license_plan text;
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS license_seats int;
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS license_expires_at timestamptz;
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS license_activated_at timestamptz;
CREATE UNIQUE INDEX IF NOT EXISTS tenants_license_id_uq ON tenants (license_id);

-- Trusted time (src/clock.py): ONE global row, the highest trusted time ever seen. The watermark only moves forward and the row cannot be
-- deleted by the app role (it owns neither the table nor the trigger).
CREATE TABLE IF NOT EXISTS license_clock (
  id boolean PRIMARY KEY DEFAULT true CHECK (id),
  watermark timestamptz NOT NULL,
  last_ntp_ok timestamptz,
  first_seen timestamptz NOT NULL DEFAULT now(),
  rollback_flag boolean NOT NULL DEFAULT false
);
CREATE OR REPLACE FUNCTION license_clock_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'license_clock cannot be deleted'; END IF;
  NEW.watermark := greatest(OLD.watermark, NEW.watermark);
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS license_clock_guard ON license_clock;
CREATE TRIGGER license_clock_guard BEFORE UPDATE OR DELETE ON license_clock FOR EACH ROW EXECUTE FUNCTION license_clock_guard();

-- "Request a licence": what the owner asks for; the issuer's script lists them and marks one issued (src/api/license_routes.py).
CREATE TABLE IF NOT EXISTS license_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants,
  requested_by uuid REFERENCES users,
  email text NOT NULL,
  plan text NOT NULL,
  seats int NOT NULL CHECK (seats > 0),
  note text,
  status text NOT NULL DEFAULT 'new' CHECK (status IN ('new','issued','rejected')),
  created_at timestamptz NOT NULL DEFAULT now(),
  issued_license_id uuid
);
CREATE INDEX IF NOT EXISTS license_requests_tenant ON license_requests (tenant_id, created_at DESC);

ALTER TABLE license_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE license_requests FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_scope ON license_requests;
CREATE POLICY tenant_scope ON license_requests USING (laris_tenant_ok(tenant_id)) WITH CHECK (laris_tenant_ok(tenant_id));

-- Issued from the web page (src/api/license_routes.py): the licence the platform operator signed in the browser, waiting for the customer to accept it.
ALTER TABLE license_requests ADD COLUMN IF NOT EXISTS issued_token text;
ALTER TABLE license_requests ADD COLUMN IF NOT EXISTS issued_at timestamptz;

-- The public key set from the platform admin page (used when env LICENSE_PUBLIC_KEY / src/license_public.key is not set). ONE global row,
-- never deleted by the app. A public key only: no signing key is ever stored.
CREATE TABLE IF NOT EXISTS license_config (
  id boolean PRIMARY KEY DEFAULT true CHECK (id),
  public_key text,
  set_by uuid,
  set_at timestamptz NOT NULL DEFAULT now()
);
CREATE OR REPLACE FUNCTION license_config_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'license_config cannot be deleted';
END $$;
DROP TRIGGER IF EXISTS license_config_guard ON license_config;
CREATE TRIGGER license_config_guard BEFORE DELETE ON license_config FOR EACH ROW EXECUTE FUNCTION license_config_guard();
