-- Jobs made by hand (work that did not start as a quote): no quote, a title, an optional customer and amount. Applied by the owner on every
-- start (idempotent), after jobs.sql. A job from a quote keeps its quote_id (still UNIQUE); a hand-made job must have a title instead.
ALTER TABLE jobs ALTER COLUMN quote_id DROP NOT NULL;
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS title text CHECK (length(title) BETWEEN 1 AND 200);
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS party_id uuid REFERENCES parties;       -- the customer of a hand-made job (same tenant: checked by the API)
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS amount numeric(14,2) CHECK (amount >= 0);  -- what the owner agreed, typed in; never priced by the rules engine
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'jobs_quote_or_title') THEN
    ALTER TABLE jobs ADD CONSTRAINT jobs_quote_or_title CHECK (quote_id IS NOT NULL OR title IS NOT NULL);
  END IF;
END $$;
