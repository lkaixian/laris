-- Quotation defaults and issuer contact, set by the owner under Settings. Applied by the owner on every start (idempotent).
-- Nullable text = not set (the quote then simply prints nothing); validity and prefix always have a value.
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS quote_validity_days int NOT NULL DEFAULT 30 CHECK (quote_validity_days BETWEEN 1 AND 365);
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS quote_payment_terms text CHECK (length(quote_payment_terms) <= 500);
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS quote_terms_text text CHECK (length(quote_terms_text) <= 2000);
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS quote_prefix text NOT NULL DEFAULT 'QT' CHECK (quote_prefix ~ '^[A-Z0-9-]{1,8}$');
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS issuer_email text CHECK (length(issuer_email) <= 254);
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS issuer_phone text CHECK (length(issuer_phone) <= 40);

-- A quote can be emailed to the customer: the sent message is recorded on the quote like a chat message.
ALTER TYPE channel_t ADD VALUE IF NOT EXISTS 'email';
