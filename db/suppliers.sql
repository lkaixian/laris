-- Suppliers section: products, offers, price history, purchases, contracts. Applied by the owner on every start (idempotent),
-- after rls.sql (needs laris_tenant_ok). Suppliers themselves stay in `parties` (role 'supplier'); this adds what we know about them.
-- Money is numeric. Prices per pack; a pack holds pack_size base units of the product.
CREATE TABLE IF NOT EXISTS products (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants,
  name text NOT NULL,
  base_uom text NOT NULL CHECK (base_uom IN ('kg','l','pc','m')),
  category text,
  item_key text,                                  -- the cost-book key this product writes to when a price is chosen
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, name)
);
CREATE TABLE IF NOT EXISTS product_aliases (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants,
  product_id uuid NOT NULL REFERENCES products ON DELETE CASCADE,
  lang text NOT NULL CHECK (lang IN ('en','ms','zh','ta')),
  alias text NOT NULL,
  confidence numeric(4,3) NOT NULL DEFAULT 1 CHECK (confidence BETWEEN 0 AND 1),
  confirmed boolean NOT NULL DEFAULT true,        -- false = a suggested match waiting for a human
  UNIQUE (tenant_id, lang, alias)
);
CREATE TABLE IF NOT EXISTS supplier_profiles (
  supplier_id uuid PRIMARY KEY REFERENCES parties ON DELETE CASCADE,
  tenant_id uuid NOT NULL REFERENCES tenants,
  state text,
  categories text[] NOT NULL DEFAULT '{}',
  certs text[] NOT NULL DEFAULT '{}',             -- halal, sst, einvoice, ...
  payment_days int NOT NULL DEFAULT 0 CHECK (payment_days >= 0),
  standing text NOT NULL DEFAULT 'normal' CHECK (standing IN ('normal','preferred','blocked')),
  on_time_pct numeric(5,2) CHECK (on_time_pct BETWEEN 0 AND 100),
  price_stability_pct numeric(5,2) CHECK (price_stability_pct BETWEEN 0 AND 100),
  response_hours numeric(6,1),
  distance_km numeric(7,1),
  last_order_on date
);
CREATE TABLE IF NOT EXISTS supplier_offers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants,
  supplier_id uuid NOT NULL REFERENCES parties ON DELETE CASCADE,
  product_id uuid NOT NULL REFERENCES products ON DELETE CASCADE,
  pack_label text NOT NULL DEFAULT 'pack',
  pack_size numeric(14,4) NOT NULL DEFAULT 1 CHECK (pack_size > 0),     -- base units per pack
  tiers jsonb NOT NULL CHECK (jsonb_typeof(tiers) = 'array' AND jsonb_array_length(tiers) > 0),  -- [{min_packs, price}] as strings
  moq numeric(14,3) CHECK (moq > 0),                                  -- base units
  lead_days int NOT NULL DEFAULT 1 CHECK (lead_days >= 0),
  delivery_fee numeric(14,2) CHECK (delivery_fee >= 0),               -- NULL = not known, asked of the human
  free_delivery_over numeric(14,2),
  sst_rate numeric(5,4) NOT NULL DEFAULT 0 CHECK (sst_rate BETWEEN 0 AND 1),
  discount_pct numeric(5,2) NOT NULL DEFAULT 0 CHECK (discount_pct BETWEEN 0 AND 100),
  valid_until date,
  stock numeric(14,3),
  payment_days int,
  source text NOT NULL DEFAULT 'manual' CHECK (source IN ('manual','rfq','pasted')),
  rfq_reply_id uuid REFERENCES rfq_replies,
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, supplier_id, product_id)
);
CREATE TABLE IF NOT EXISTS offer_history (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants,
  offer_id uuid NOT NULL REFERENCES supplier_offers ON DELETE CASCADE,
  month date NOT NULL,
  price_per_base numeric(14,4) NOT NULL CHECK (price_per_base >= 0),
  UNIQUE (offer_id, month)
);
CREATE TABLE IF NOT EXISTS purchases (             -- what we actually bought: last paid price, off-contract spend, repeat-buy nudge
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants,
  product_id uuid NOT NULL REFERENCES products ON DELETE CASCADE,
  supplier_id uuid NOT NULL REFERENCES parties ON DELETE CASCADE,
  bought_on date NOT NULL,
  qty numeric(14,3) NOT NULL CHECK (qty > 0),      -- base units
  amount numeric(14,2) NOT NULL CHECK (amount >= 0),
  contract_id uuid,                                -- set when it was bought under a contract
  off_contract_reason text,
  approved_by uuid REFERENCES users
);
ALTER TABLE purchases ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'approved' CHECK (status IN ('pending','approved','rejected'));
ALTER TABLE purchases ADD COLUMN IF NOT EXISTS requested_by uuid REFERENCES users;
CREATE TABLE IF NOT EXISTS contracts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants,
  supplier_id uuid NOT NULL REFERENCES parties,
  name text NOT NULL,
  state text NOT NULL DEFAULT 'draft' CHECK (state IN ('draft','pending_approval','active','expiring','renewal','renewed','expired','terminated')),
  start_on date NOT NULL,
  end_on date NOT NULL,
  notice_days int NOT NULL DEFAULT 30 CHECK (notice_days >= 0),
  renewal text NOT NULL DEFAULT 'manual' CHECK (renewal IN ('manual','auto')),
  price_model text NOT NULL DEFAULT 'fixed' CHECK (price_model IN ('fixed','tiered','indexed')),
  price_reviews date[] NOT NULL DEFAULT '{}',
  min_qty numeric(14,3), max_qty numeric(14,3),    -- committed volume, base units
  value numeric(14,2) NOT NULL DEFAULT 0 CHECK (value >= 0),
  payment_days int, sla_lead_days int,
  terms_note text,
  created_by uuid REFERENCES users,
  approved_by uuid REFERENCES users,
  acknowledged_at timestamptz,                     -- simulated "supplier acknowledged"; not an e-signature
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (end_on > start_on)
);
CREATE TABLE IF NOT EXISTS contract_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants,
  contract_id uuid NOT NULL REFERENCES contracts ON DELETE CASCADE,
  product_id uuid NOT NULL REFERENCES products,
  pack_size numeric(14,4) NOT NULL DEFAULT 1 CHECK (pack_size > 0),
  price_per_pack numeric(14,4) NOT NULL CHECK (price_per_pack >= 0),
  UNIQUE (contract_id, product_id)
);
CREATE TABLE IF NOT EXISTS contract_events (        -- every state change, with its reason; append-only for the app role (roles.sql)
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants,
  contract_id uuid NOT NULL REFERENCES contracts ON DELETE CASCADE,
  from_state text, to_state text NOT NULL,
  reason text,
  actor uuid REFERENCES users,
  at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE contract_events ADD COLUMN IF NOT EXISTS seq bigint GENERATED ALWAYS AS IDENTITY;  -- now() is the same inside one transaction: seq keeps the order
CREATE TABLE IF NOT EXISTS contract_usage (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants,
  contract_id uuid NOT NULL REFERENCES contracts ON DELETE CASCADE,
  product_id uuid NOT NULL REFERENCES products,
  qty numeric(14,3) NOT NULL CHECK (qty > 0),
  amount numeric(14,2) NOT NULL DEFAULT 0,
  used_on date NOT NULL
);
CREATE TABLE IF NOT EXISTS recommendations (        -- a stored snapshot: inputs, rules and result, so a past advice can be explained
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants,
  product_id uuid NOT NULL REFERENCES products,
  qty numeric(14,3) NOT NULL,
  needed_by date,
  inputs jsonb NOT NULL,
  result jsonb NOT NULL,
  created_by uuid REFERENCES users,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS shortlist (
  tenant_id uuid NOT NULL REFERENCES tenants,
  product_id uuid NOT NULL REFERENCES products ON DELETE CASCADE,
  offer_id uuid NOT NULL REFERENCES supplier_offers ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES users,
  PRIMARY KEY (product_id, offer_id, user_id)
);
CREATE TABLE IF NOT EXISTS supplier_settings (
  tenant_id uuid PRIMARY KEY REFERENCES tenants,
  manager_limit numeric(14,2) NOT NULL DEFAULT 5000,   -- contracts above this value need the owner
  weights jsonb NOT NULL DEFAULT '{"price":50,"reliability":25,"lead":15,"terms":10}',
  five_sen boolean NOT NULL DEFAULT false,
  market_gap_pct numeric(5,2) NOT NULL DEFAULT 5
);
CREATE INDEX IF NOT EXISTS offers_product ON supplier_offers (tenant_id, product_id);
CREATE INDEX IF NOT EXISTS contracts_tenant ON contracts (tenant_id, state, end_on);
CREATE INDEX IF NOT EXISTS purchases_product ON purchases (tenant_id, product_id, bought_on DESC);
-- A contract's state changes only along the allowed edges (src/suppliers_engine.py TRANSITIONS), also when SQL is run directly.
CREATE OR REPLACE FUNCTION contract_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.state IS DISTINCT FROM OLD.state AND NOT (
       (OLD.state='draft' AND NEW.state='pending_approval') OR (OLD.state='pending_approval' AND NEW.state IN ('active','draft'))
    OR (OLD.state='active' AND NEW.state IN ('expiring','terminated','expired'))
    OR (OLD.state='expiring' AND NEW.state IN ('renewal','expired','terminated'))
    OR (OLD.state='renewal' AND NEW.state IN ('renewed','expired','terminated'))) THEN
    RAISE EXCEPTION 'illegal transition % -> % on contract', OLD.state, NEW.state;
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS contract_guard_t ON contracts;
CREATE TRIGGER contract_guard_t BEFORE UPDATE OF state ON contracts FOR EACH ROW EXECUTE FUNCTION contract_guard();

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['products','product_aliases','supplier_profiles','supplier_offers','offer_history','purchases','contracts',
                           'contract_items','contract_events','contract_usage','recommendations','shortlist','supplier_settings'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS tenant_scope ON %I', t);
    EXECUTE format('CREATE POLICY tenant_scope ON %I USING (laris_tenant_ok(tenant_id)) WITH CHECK (laris_tenant_ok(tenant_id))', t);
  END LOOP;
END $$;
