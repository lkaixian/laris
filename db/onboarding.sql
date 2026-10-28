-- Guided tour progress per person, so it follows them to another phone. Applied by the owner on every start (idempotent), after jobs.sql
-- (needs laris_tenant_ok from rls.sql). laris_app gets its grants from roles.sql (ALL TABLES).
CREATE TABLE IF NOT EXISTS user_onboarding (
  user_id uuid PRIMARY KEY REFERENCES users ON DELETE CASCADE,
  tenant_id uuid NOT NULL REFERENCES tenants,
  tour text CHECK (tour IN ('owner','staff')),
  state text NOT NULL DEFAULT 'new' CHECK (state IN ('new','in_progress','done','skipped','later')),
  step int NOT NULL DEFAULT 0 CHECK (step BETWEEN 0 AND 50),
  later_count int NOT NULL DEFAULT 0,
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE user_onboarding ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_onboarding FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_scope ON user_onboarding;
CREATE POLICY tenant_scope ON user_onboarding USING (laris_tenant_ok(tenant_id)) WITH CHECK (laris_tenant_ok(tenant_id));
