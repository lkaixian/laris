-- Lite multi-business: one email may have an account in several tenants (one users row = one person in one business).
-- Applied by the owner on every start (idempotent), after signup.sql. Replaces the old global unique index on lower(email).
DROP INDEX IF EXISTS users_email_uq;
CREATE UNIQUE INDEX IF NOT EXISTS users_tenant_email_uq ON users (tenant_id, lower(email)) WHERE email IS NOT NULL;
