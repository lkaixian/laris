-- Deposits paid online, and documents sent to the customer. Each business uses ITS OWN Stripe account: LARIS holds the keys (encrypted, src/tgbots.py)
-- and never the money. Row level security like every business table.
CREATE TABLE IF NOT EXISTS tenant_stripe (
  tenant_id uuid PRIMARY KEY REFERENCES tenants,
  secret_enc text NOT NULL,                      -- the business's Stripe secret or restricted key, Fernet-encrypted
  webhook_secret_enc text,                       -- its webhook signing secret (whsec_...), optional: without it "Check now" settles payments
  webhook_key text NOT NULL UNIQUE,              -- random part of the webhook address, so the right business is found before the signature is checked
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS deposit_links (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants,
  job_id uuid NOT NULL REFERENCES jobs,
  deal_doc_id uuid NOT NULL REFERENCES deal_docs,  -- the proforma this deposit is for
  session_id text NOT NULL UNIQUE,                 -- Stripe Checkout session id
  url text NOT NULL,
  amount numeric(14,2) NOT NULL CHECK (amount > 0),
  currency text NOT NULL DEFAULT 'MYR',
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'paid', 'expired', 'failed')),
  created_at timestamptz NOT NULL DEFAULT now(),
  paid_at timestamptz,
  payment_id uuid REFERENCES payments
);
CREATE INDEX IF NOT EXISTS deposit_links_job ON deposit_links (tenant_id, job_id, created_at DESC);

CREATE TABLE IF NOT EXISTS deal_doc_sends (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants,
  deal_doc_id uuid NOT NULL REFERENCES deal_docs,
  channel text NOT NULL DEFAULT 'telegram',
  status text NOT NULL CHECK (status IN ('sent', 'failed', 'skipped')),
  detail text,                                     -- why it failed or was skipped, in plain words (never a token or a URL)
  at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS deal_doc_sends_doc ON deal_doc_sends (tenant_id, deal_doc_id, at DESC);

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['tenant_stripe', 'deposit_links', 'deal_doc_sends'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS tenant_scope ON %I', t);
    EXECUTE format('CREATE POLICY tenant_scope ON %I USING (laris_tenant_ok(tenant_id)) WITH CHECK (laris_tenant_ok(tenant_id))', t);
  END LOOP;
END $$;
