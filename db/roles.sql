-- Least-privilege application role (audit D1, D2). Run once as the database owner AFTER the schema exists:
--   psql "$DATABASE_URL" -v app_password="'...'" -f db/roles.sql     (login) or set the password afterwards
-- Then point the app's DATABASE_URL at laris_app and keep the owner URL for migrations only (apply_schema needs the owner).
-- laris_app owns nothing, so it cannot disable the audit or guard triggers, alter tables, or touch the append-only audit log.
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'laris_app') THEN CREATE ROLE laris_app LOGIN; END IF;
END $$;

GRANT USAGE ON SCHEMA public TO laris_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO laris_app;
REVOKE UPDATE, DELETE, TRUNCATE ON audit_log FROM laris_app;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON doc_transitions FROM laris_app;  -- shared rule data: the app only reads it
REVOKE TRUNCATE, TRIGGER, REFERENCES ON ALL TABLES IN SCHEMA public FROM laris_app;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO laris_app;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public TO laris_app;
