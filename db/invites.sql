-- Invite a person to a business by emailed link. Applied by the owner on every start (idempotent), after multi.sql (needs roles, users, laris_tenant_ok).
-- Only the SHA-256 of the token is stored. Expiry is by expires_at (status stays 'pending'); one pending invite per (tenant, email).
CREATE TABLE IF NOT EXISTS invites (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants,
  email text NOT NULL CHECK (length(email) <= 254 AND email = lower(email)),
  role_id uuid NOT NULL,
  invited_by uuid REFERENCES users,
  token_sha256 text NOT NULL UNIQUE,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'accepted', 'revoked')),
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL DEFAULT now() + interval '7 days',
  accepted_at timestamptz,
  accepted_user_id uuid REFERENCES users,
  FOREIGN KEY (tenant_id, role_id) REFERENCES roles (tenant_id, id) ON DELETE CASCADE  -- same tenant only; deleting a role drops its invites
);
CREATE UNIQUE INDEX IF NOT EXISTS invites_pending_uq ON invites (tenant_id, lower(email)) WHERE status = 'pending';
CREATE INDEX IF NOT EXISTS invites_tenant_idx ON invites (tenant_id, created_at DESC);

ALTER TABLE invites ENABLE ROW LEVEL SECURITY;
ALTER TABLE invites FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_scope ON invites;
CREATE POLICY tenant_scope ON invites USING (laris_tenant_ok(tenant_id)) WITH CHECK (laris_tenant_ok(tenant_id));
