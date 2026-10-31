-- Telegram customers: the @username we see on their messages, the phone number they give when the bot asks,
-- and the first enquiry kept until they answer (the quote is made after the name and number are in).
ALTER TABLE parties ADD COLUMN IF NOT EXISTS tg_username text;
ALTER TABLE parties ADD COLUMN IF NOT EXISTS phone text;
ALTER TABLE parties ADD COLUMN IF NOT EXISTS pending_enquiry jsonb;
ALTER TABLE parties ADD COLUMN IF NOT EXISTS profile_tries int NOT NULL DEFAULT 0;
