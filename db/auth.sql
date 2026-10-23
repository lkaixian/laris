-- Credential lifecycle (security step 3). Applied by the owner on every start (idempotent), after views.sql (which creates users/sessions).
-- API tokens expire; existing tokens get 90 days from this migration. NULL (set by hand) means no expiry.
ALTER TABLE users ADD COLUMN IF NOT EXISTS token_expires_at timestamptz;
UPDATE users SET token_expires_at = now() + interval '90 days' WHERE token_sha256 IS NOT NULL AND token_expires_at IS NULL;

-- Sessions get an id the UI can list and revoke without ever seeing the token hash, and a throttled last-seen.
-- (user_agent already exists on sessions.)
ALTER TABLE sessions ADD COLUMN IF NOT EXISTS id uuid NOT NULL DEFAULT gen_random_uuid();
CREATE UNIQUE INDEX IF NOT EXISTS sessions_id_uq ON sessions (id);
ALTER TABLE sessions ADD COLUMN IF NOT EXISTS last_seen_at timestamptz;
