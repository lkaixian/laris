-- Which business owns an inbound WhatsApp number. Applied by the owner on every start (idempotent).
-- The column and its unique index first appeared in views.sql; they are restated here so this file stands on its own.
-- One number belongs to one business: the unique index is across tenants (RLS hides other tenants' rows, the index does not).
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS wa_phone_number_id text;
CREATE UNIQUE INDEX IF NOT EXISTS tenants_wa_phone_uq ON tenants (wa_phone_number_id) WHERE wa_phone_number_id IS NOT NULL;
