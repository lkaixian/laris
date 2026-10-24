-- Job scheduling: due date, assignee, priority, notes and timestamps on jobs. Applied by the owner on every start (idempotent), after signup.sql.
-- A job row exists from the moment an outgoing quote is accepted (src/api/routes.py move); started_at / done_at are set by the API.
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'users_tenant_id_id_uq') THEN
    ALTER TABLE users ADD CONSTRAINT users_tenant_id_id_uq UNIQUE (tenant_id, id);   -- target of the same-tenant foreign keys below
  END IF;
END $$;

ALTER TABLE jobs ADD COLUMN IF NOT EXISTS due_on date;
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS assignee_id uuid;
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS priority text NOT NULL DEFAULT 'normal' CHECK (priority IN ('low','normal','high'));
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS notes text CHECK (length(notes) <= 2000);
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS created_by uuid REFERENCES users;
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS started_at timestamptz;
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS done_at timestamptz;
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS remind_sent_at timestamptz;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'jobs_assignee_fk') THEN
    ALTER TABLE jobs ADD CONSTRAINT jobs_assignee_fk FOREIGN KEY (tenant_id, assignee_id) REFERENCES users (tenant_id, id);  -- same tenant only
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS jobs_due_idx ON jobs (tenant_id, due_on) WHERE status <> 'done';

UPDATE jobs SET done_at = created_at WHERE status = 'done' AND done_at IS NULL;   -- backfill, once
