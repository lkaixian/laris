-- Apply after schema.sql. Transition seed + guard trigger + audit trigger.
INSERT INTO doc_transitions(direction,from_status,to_status,needs_role) VALUES
 ('in','received','parsed','staff'),
 ('in','parsed','reviewed','staff'),
 ('in','reviewed','accepted','owner'),
 ('in','accepted','in_cost_book','owner'),
 ('in','reviewed','in_cost_book','owner'),            -- receipts shortcut
 ('in','received','rejected','owner'),('in','parsed','rejected','owner'),('in','reviewed','rejected','owner'),
 ('in','reviewed','expired','owner'),('in','accepted','expired','owner'),
 ('in','accepted','superseded','owner'),
 ('in','received','cancelled','owner'),('in','parsed','cancelled','owner'),
 ('in','reviewed','cancelled','owner'),('in','accepted','cancelled','owner'),
 ('out','draft','approved','owner'),
 ('out','approved','sent','owner'),
 ('out','sent','read','staff'),                       -- read is optional: sent -> accepted below
 ('out','sent','accepted','owner'),('out','read','accepted','owner'),
 ('out','sent','rejected','owner'),('out','read','rejected','owner'),
 ('out','sent','expired','owner'),('out','read','expired','owner'),
 ('out','sent','superseded','owner'),('out','read','superseded','owner'),
 ('out','accepted','job_created','owner'),
 ('out','draft','cancelled','owner'),('out','approved','cancelled','owner');

CREATE FUNCTION documents_transition_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE need user_role; r text := nullif(current_setting('laris.role', true), '');
BEGIN
  IF NEW.status = OLD.status THEN RETURN NEW; END IF;
  SELECT needs_role INTO need FROM doc_transitions
   WHERE direction=OLD.direction AND from_status=OLD.status AND to_status=NEW.status;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'illegal transition % % -> %', OLD.direction, OLD.status, NEW.status;
  END IF;
  IF r IS NULL OR (need = 'owner' AND r <> 'owner') THEN
    RAISE EXCEPTION 'role % may not do % -> % (needs %)', coalesce(r,'none'), OLD.status, NEW.status, need;
  END IF;
  IF NEW.direction='out' AND NEW.status='approved' AND NOT EXISTS
     (SELECT 1 FROM users WHERE id=NEW.approved_by AND role='owner' AND tenant_id=NEW.tenant_id) THEN
    RAISE EXCEPTION 'approval needs approved_by = an owner of this tenant';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER documents_transition_guard BEFORE UPDATE OF status ON documents
  FOR EACH ROW EXECUTE FUNCTION documents_transition_guard();

CREATE FUNCTION write_audit() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO audit_log(tenant_id,actor,entity,entity_id,event,before,after)
  VALUES (NEW.tenant_id,
          coalesce(nullif(current_setting('laris.actor', true), ''), 'system'),
          TG_TABLE_NAME, NEW.id,
          CASE WHEN TG_OP='INSERT' THEN 'insert'
               WHEN to_jsonb(OLD)->>'status' IS DISTINCT FROM to_jsonb(NEW)->>'status' AND TG_TABLE_NAME='documents'
                    THEN 'status '||(to_jsonb(OLD)->>'status')||'->'||(to_jsonb(NEW)->>'status')
               ELSE 'update' END,
          CASE WHEN TG_OP='UPDATE' THEN to_jsonb(OLD) END,
          to_jsonb(NEW) - 'extraction');  -- ponytail: raw extraction blob kept out of audit; before still holds it
  RETURN NULL;
END $$;
CREATE TRIGGER documents_audit  AFTER INSERT OR UPDATE ON documents  FOR EACH ROW EXECUTE FUNCTION write_audit();
CREATE TRIGGER cost_items_audit AFTER INSERT OR UPDATE ON cost_items FOR EACH ROW EXECUTE FUNCTION write_audit();
CREATE TRIGGER jobs_audit       AFTER INSERT OR UPDATE ON jobs       FOR EACH ROW EXECUTE FUNCTION write_audit();
