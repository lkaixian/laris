-- Branding and custom roles. Applied by the owner on every start (idempotent), after rls.sql (needs laris_tenant_ok) and before the seed.
-- users.role stays the CLASS (owner|staff) that the document guard in transitions.sql keys on; a role row decides the class and,
-- for staff-class roles, the permissions (src/perms.py). Custom roles are always class staff.
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS display_name text;      -- shown name; tenants.name stays the stable key (tenant ordering, imports)
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS brand_color text CHECK (brand_color ~ '^#[0-9a-f]{6}$');
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS logo_data_url text;     -- png/jpeg/webp data URL, sniffed and size-capped by the API

CREATE TABLE IF NOT EXISTS roles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants,
  key text NOT NULL CHECK (key ~ '^[a-z0-9][a-z0-9-]{0,39}$'),
  name text NOT NULL CHECK (length(name) BETWEEN 1 AND 60),
  class user_role NOT NULL,
  permissions text[],                           -- NULL = built-in defaults (system staff) or everything (owner)
  is_system boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, key),
  UNIQUE (tenant_id, id),
  CHECK (class = 'staff' OR (is_system AND key = 'owner'))   -- an owner-class custom role is not allowed
);
CREATE UNIQUE INDEX IF NOT EXISTS roles_name_uq ON roles (tenant_id, lower(name));

ALTER TABLE users ADD COLUMN IF NOT EXISTS role_id uuid;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'users_role_fk') THEN
    ALTER TABLE users ADD CONSTRAINT users_role_fk FOREIGN KEY (tenant_id, role_id) REFERENCES roles (tenant_id, id);  -- same tenant only
  END IF;
END $$;

-- Every tenant has the two system roles.
CREATE OR REPLACE FUNCTION tenant_system_roles() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO roles(tenant_id, key, name, class, is_system)
  VALUES (NEW.id, 'owner', 'Owner', 'owner', true), (NEW.id, 'staff', 'Staff', 'staff', true) ON CONFLICT DO NOTHING;
  RETURN NULL;
END $$;
DROP TRIGGER IF EXISTS tenants_system_roles ON tenants;
CREATE TRIGGER tenants_system_roles AFTER INSERT ON tenants FOR EACH ROW EXECUTE FUNCTION tenant_system_roles();

-- Keep users.role (class) and users.role_id in step: a new row or a direct change of `role` picks the system role;
-- otherwise the class follows the role row.
CREATE OR REPLACE FUNCTION users_role_sync() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.role_id IS NULL OR (TG_OP = 'UPDATE' AND NEW.role_id IS NOT DISTINCT FROM OLD.role_id AND NEW.role <> OLD.role) THEN
    SELECT id INTO NEW.role_id FROM roles WHERE tenant_id = NEW.tenant_id AND key = NEW.role::text AND is_system;
  ELSE
    SELECT class INTO NEW.role FROM roles WHERE id = NEW.role_id;
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS users_role_sync ON users;
CREATE TRIGGER users_role_sync BEFORE INSERT OR UPDATE ON users FOR EACH ROW EXECUTE FUNCTION users_role_sync();

ALTER TABLE roles ENABLE ROW LEVEL SECURITY;
ALTER TABLE roles FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_scope ON roles;
CREATE POLICY tenant_scope ON roles USING (laris_tenant_ok(tenant_id)) WITH CHECK (laris_tenant_ok(tenant_id));

-- Backfill: system roles for tenants that predate this file, then every user onto the system role of their old two-value role.
INSERT INTO roles(tenant_id, key, name, class, is_system)
SELECT t.id, k.key, k.name, k.class::user_role, true FROM tenants t
CROSS JOIN (VALUES ('owner', 'Owner', 'owner'), ('staff', 'Staff', 'staff')) AS k(key, name, class)
ON CONFLICT (tenant_id, key) DO NOTHING;
UPDATE users SET role_id = (SELECT r.id FROM roles r WHERE r.tenant_id = users.tenant_id AND r.key = users.role::text AND r.is_system)
WHERE role_id IS NULL;
