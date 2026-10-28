-- Which business owns an inbound WhatsApp number. Applied by the owner on every start (idempotent).
-- The column and its unique index first appeared in views.sql; they are restated here so this file stands on its own.
-- One number belongs to one business: the unique index is across tenants (RLS hides other tenants' rows, the index does not).
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS wa_phone_number_id text;
CREATE UNIQUE INDEX IF NOT EXISTS tenants_wa_phone_uq ON tenants (wa_phone_number_id) WHERE wa_phone_number_id IS NOT NULL;

-- Telegram: each business connects its OWN customer bot from the dashboard (one bot per business, one business per bot).
-- token_enc / secret_enc are Fernet ciphertext (src/tgbots.py); bot_key is the unguessable part of the webhook URL.
CREATE TABLE IF NOT EXISTS tenant_telegram_bots (
  tenant_id uuid PRIMARY KEY REFERENCES tenants,
  bot_id bigint NOT NULL UNIQUE,
  bot_key text NOT NULL UNIQUE,
  username text NOT NULL,
  name text,
  token_enc text NOT NULL,
  secret_enc text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  connected_by uuid REFERENCES users ON DELETE SET NULL
);
-- One-time codes that link a Telegram chat to a LARIS user (via the LARIS helper bot). Only the SHA-256 of the code is stored.
CREATE TABLE IF NOT EXISTS telegram_link_codes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants,
  user_id uuid NOT NULL REFERENCES users ON DELETE CASCADE,
  code_hash text NOT NULL UNIQUE,
  expires_at timestamptz NOT NULL,
  used_at timestamptz
);
CREATE INDEX IF NOT EXISTS telegram_link_codes_user_idx ON telegram_link_codes (user_id);
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['tenant_telegram_bots','telegram_link_codes'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS tenant_scope ON %I', t);
    EXECUTE format('CREATE POLICY tenant_scope ON %I USING (laris_tenant_ok(tenant_id)) WITH CHECK (laris_tenant_ok(tenant_id))', t);
  END LOOP;
END $$;
