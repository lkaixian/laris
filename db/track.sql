-- On-track tracker: when did a document, an ask-suppliers reply or a catalog item enter its current status?
-- Applied by the owner on every start (idempotent), after listings.sql. The column is added and back-filled only once (while it is
-- missing); a small BEFORE UPDATE trigger moves it whenever status changes, so the guard in transitions.sql is untouched.
CREATE OR REPLACE FUNCTION touch_status_changed() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.status::text IS DISTINCT FROM OLD.status::text THEN NEW.status_changed_at := now(); END IF;
  RETURN NEW;
END $$;

DO $$
DECLARE t text;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'documents' AND column_name = 'status_changed_at') THEN
    ALTER TABLE documents ADD COLUMN status_changed_at timestamptz;
    ALTER TABLE documents DISABLE TRIGGER documents_audit;   -- a back-fill is not an edit: keep it out of the audit trail
    UPDATE documents d SET status_changed_at = coalesce(
      (SELECT max(a.at) FROM audit_log a WHERE a.tenant_id = d.tenant_id AND a.entity = 'documents' AND a.entity_id = d.id AND a.event LIKE 'status %'),
      d.created_at);
    ALTER TABLE documents ENABLE TRIGGER documents_audit;
    ALTER TABLE documents ALTER COLUMN status_changed_at SET DEFAULT now(), ALTER COLUMN status_changed_at SET NOT NULL;
  END IF;
  FOREACH t IN ARRAY ARRAY['rfq_replies', 'listing_items'] LOOP
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = t AND column_name = 'status_changed_at') THEN
      EXECUTE format('ALTER TABLE %I ADD COLUMN status_changed_at timestamptz', t);
      EXECUTE format('UPDATE %I SET status_changed_at = created_at', t);
      EXECUTE format('ALTER TABLE %I ALTER COLUMN status_changed_at SET DEFAULT now(), ALTER COLUMN status_changed_at SET NOT NULL', t);
    END IF;
  END LOOP;
  FOREACH t IN ARRAY ARRAY['documents', 'rfq_replies', 'listing_items'] LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS %I ON %I', t || '_status_changed', t);
    EXECUTE format('CREATE TRIGGER %I BEFORE UPDATE OF status ON %I FOR EACH ROW EXECUTE FUNCTION touch_status_changed()', t || '_status_changed', t);
  END LOOP;
END $$;

CREATE INDEX IF NOT EXISTS documents_track ON documents (tenant_id, status, status_changed_at);
CREATE INDEX IF NOT EXISTS rfq_replies_track ON rfq_replies (tenant_id, status, status_changed_at);
CREATE INDEX IF NOT EXISTS listing_items_track ON listing_items (tenant_id, status, status_changed_at);
CREATE INDEX IF NOT EXISTS audit_log_entity_at ON audit_log (entity, entity_id, at);
