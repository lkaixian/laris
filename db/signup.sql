-- Self-service registration and password reset by emailed code. Applied by the owner on every start (idempotent), after rbac.sql.
-- An email is unique per tenant, compared case-insensitively (db/multi.sql); one person may own accounts in several businesses.
-- A signup is inactive until email_verified_at is set; the login query only accepts active users.
ALTER TABLE users ADD COLUMN IF NOT EXISTS email text CHECK (length(email) <= 254);
ALTER TABLE users ADD COLUMN IF NOT EXISTS email_verified_at timestamptz;
ALTER TABLE users ADD COLUMN IF NOT EXISTS created_at timestamptz NOT NULL DEFAULT now();  -- the scheduler drops signups never verified after 7 days

-- One-time codes, stored only as an HMAC (src/api/signup.py). attempts counts wrong guesses; 5 kill the code.
CREATE TABLE IF NOT EXISTS email_codes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  purpose text NOT NULL CHECK (purpose IN ('verify', 'reset')),
  user_id uuid NOT NULL REFERENCES users ON DELETE CASCADE,
  tenant_id uuid NOT NULL REFERENCES tenants,
  code_hash text NOT NULL,
  expires_at timestamptz NOT NULL,
  attempts int NOT NULL DEFAULT 0,
  used_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS email_codes_user_idx ON email_codes (user_id, purpose, created_at);

ALTER TABLE email_codes ENABLE ROW LEVEL SECURITY;
ALTER TABLE email_codes FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_scope ON email_codes;
CREATE POLICY tenant_scope ON email_codes USING (laris_tenant_ok(tenant_id)) WITH CHECK (laris_tenant_ok(tenant_id));
