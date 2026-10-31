-- Order chain step 3 (docs/order-chain-plan.md): delivery orders and the customer's tap-to-sign link. Applied by the owner on every start
-- (idempotent), after chain.sql. Same token design as quote_accept_links (db/accept.sql): only the SHA-256 is stored, and a link holder has
-- no account, so the two SECURITY DEFINER functions below are the ONLY way in. They validate the link, then sign the delivery order and, when
-- every ordered item is on a signed delivery order, move the job to done, as the owner's job edit does (done_at, audited as customer:link).
CREATE TABLE IF NOT EXISTS delivery_links (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants,
  deal_doc_id uuid NOT NULL,
  token_hash text NOT NULL UNIQUE,                       -- sha256 hex of the token; the raw token is never stored
  created_by uuid REFERENCES users,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  first_viewed_at timestamptz,
  revoked_at timestamptz,
  FOREIGN KEY (tenant_id, deal_doc_id) REFERENCES deal_docs (tenant_id, id)
);
CREATE INDEX IF NOT EXISTS delivery_links_doc_idx ON delivery_links (deal_doc_id);
ALTER TABLE delivery_links ENABLE ROW LEVEL SECURITY;
ALTER TABLE delivery_links FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_scope ON delivery_links;
CREATE POLICY tenant_scope ON delivery_links USING (laris_tenant_ok(tenant_id)) WITH CHECK (laris_tenant_ok(tenant_id));

-- The audit row of a signature leaves out the drawn mark (an image) and the typed name; both stay in delivery_signatures itself.
CREATE OR REPLACE FUNCTION delivery_signatures_audit() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO audit_log(tenant_id, actor, entity, entity_id, event, after)
  VALUES (NEW.tenant_id, coalesce(nullif(current_setting('laris.actor', true), ''), 'system'), 'delivery_signatures', NEW.id, 'insert',
          to_jsonb(NEW) - 'mark' - 'signer_name' || jsonb_build_object('has_mark', NEW.mark IS NOT NULL));
  RETURN NULL;
END $$;
DROP TRIGGER IF EXISTS delivery_signatures_audit ON delivery_signatures;
CREATE TRIGGER delivery_signatures_audit AFTER INSERT ON delivery_signatures FOR EACH ROW EXECUTE FUNCTION delivery_signatures_audit();

-- Per order line (by line_no): ordered, on live (not void) delivery orders, and on signed ones. A hand-made job is one line of 1.
CREATE OR REPLACE FUNCTION delivery_lines(p_job uuid) RETURNS TABLE(line_no int, ordered numeric, issued numeric, signed numeric)
LANGUAGE sql STABLE AS $$
  WITH o AS (SELECT l.line_no, l.qty FROM jobs j JOIN document_lines l ON l.document_id = j.quote_id
              WHERE j.id = p_job AND NOT l.is_header AND l.qty IS NOT NULL
             UNION ALL SELECT 1, 1::numeric FROM jobs WHERE id = p_job AND quote_id IS NULL),
       d AS (SELECT (x->>'no')::int AS no, (x->>'qty')::numeric AS qty, s.status
               FROM deal_docs s, jsonb_array_elements(s.lines) x
              WHERE s.job_id = p_job AND s.kind = 'delivery_order' AND s.status <> 'void' AND NOT coalesce((x->>'is_header')::boolean, false))
  SELECT o.line_no, o.qty::numeric(14,3), coalesce(sum(d.qty), 0)::numeric(14,3), coalesce(sum(d.qty) FILTER (WHERE d.status = 'signed'), 0)::numeric(14,3)
    FROM o LEFT JOIN d ON d.no = o.line_no GROUP BY o.line_no, o.qty ORDER BY o.line_no
$$;

-- Never deliver more than was ordered across the live delivery orders. The row lock on the job serialises every issue for one order.
CREATE OR REPLACE FUNCTION delivery_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE x jsonb; r record; n int := 0;
BEGIN
  PERFORM 1 FROM jobs WHERE id = NEW.job_id AND tenant_id = NEW.tenant_id FOR UPDATE;
  IF (SELECT count(*) <> count(DISTINCT e->>'no') FROM jsonb_array_elements(NEW.lines) e WHERE NOT coalesce((e->>'is_header')::boolean, false)) THEN
    RAISE EXCEPTION 'delivery: a line is listed twice';
  END IF;
  FOR x IN SELECT * FROM jsonb_array_elements(NEW.lines) LOOP
    CONTINUE WHEN coalesce((x->>'is_header')::boolean, false);
    SELECT * INTO r FROM delivery_lines(NEW.job_id) WHERE line_no = (x->>'no')::int;
    IF NOT FOUND THEN RAISE EXCEPTION 'delivery: line % is not on this order', x->>'no'; END IF;
    IF (x->>'qty')::numeric <= 0 THEN RAISE EXCEPTION 'delivery: line % needs a quantity above zero', x->>'no'; END IF;
    IF r.issued + (x->>'qty')::numeric > r.ordered THEN
      RAISE EXCEPTION 'delivery: line % would deliver % but only % of % ordered is left', x->>'no', (x->>'qty')::numeric, r.ordered - r.issued, r.ordered;
    END IF;
    n := n + 1;
  END LOOP;
  IF n = 0 THEN RAISE EXCEPTION 'delivery: nothing to deliver'; END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS deal_docs_delivery_guard ON deal_docs;
CREATE TRIGGER deal_docs_delivery_guard BEFORE INSERT ON deal_docs FOR EACH ROW WHEN (NEW.kind = 'delivery_order') EXECUTE FUNCTION delivery_guard();

-- Both functions set laris.role / actor / tenant for their own statements and put the caller's values back before returning.

-- Look at a link: NULL for anything unknown, revoked, void, or (unsigned and) expired: one generic answer, nothing to enumerate.
-- A signed delivery order stays readable on its link, whatever the expiry.
CREATE OR REPLACE FUNCTION delivery_link_open(p_hash text, p_now timestamptz) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE l delivery_links; d deal_docs; s delivery_signatures; res jsonb;
        o_role text := coalesce(current_setting('laris.role', true), ''); o_actor text := coalesce(current_setting('laris.actor', true), '');
        o_tenant text := coalesce(current_setting('laris.tenant', true), '');
BEGIN
  PERFORM set_config('laris.role', 'owner', true), set_config('laris.actor', 'customer:link', true), set_config('laris.tenant', '*', true);
  <<work>> BEGIN
    SELECT * INTO l FROM delivery_links WHERE token_hash = p_hash AND revoked_at IS NULL FOR UPDATE;
    IF NOT FOUND THEN EXIT work; END IF;
    SELECT * INTO d FROM deal_docs WHERE id = l.deal_doc_id AND tenant_id = l.tenant_id AND kind = 'delivery_order';
    IF NOT FOUND OR d.status = 'void' OR (d.status = 'issued' AND l.expires_at <= p_now) THEN EXIT work; END IF;
    UPDATE delivery_links SET first_viewed_at = coalesce(first_viewed_at, p_now) WHERE id = l.id;
    SELECT * INTO s FROM delivery_signatures WHERE deal_doc_id = d.id;
    res := jsonb_build_object('tenant_id', l.tenant_id, 'deal_doc_id', d.id, 'status', d.status,
                              'signed_name', s.signer_name, 'signed_at', s.signed_at, 'problems', s.problems_note);
  END work;
  PERFORM set_config('laris.role', o_role, true), set_config('laris.actor', o_actor, true), set_config('laris.tenant', o_tenant, true);
  RETURN res;
END $$;

-- Sign: returns {"result": "ok" | "ok_again" | "already_signed" | "not_found", ...}. The same name and problems note again is answered from the
-- stored row (never a second signature); anything else on a signed order is "already_signed". doc_sha256 = sha256 of the frozen document
-- (number, lines, totals, extra, layout) as signed.
CREATE OR REPLACE FUNCTION delivery_link_sign(p_hash text, p_name text, p_ip_hash text, p_problems text, p_mark text, p_now timestamptz) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE l delivery_links; d deal_docs; s delivery_signatures; j jobs; done boolean := false; res jsonb := jsonb_build_object('result', 'not_found');
        o_role text := coalesce(current_setting('laris.role', true), ''); o_actor text := coalesce(current_setting('laris.actor', true), '');
        o_tenant text := coalesce(current_setting('laris.tenant', true), '');
BEGIN
  PERFORM set_config('laris.role', 'owner', true), set_config('laris.actor', 'customer:link', true), set_config('laris.tenant', '*', true);
  <<work>> BEGIN
    SELECT * INTO l FROM delivery_links WHERE token_hash = p_hash AND revoked_at IS NULL FOR UPDATE;
    IF NOT FOUND THEN EXIT work; END IF;
    SELECT * INTO d FROM deal_docs WHERE id = l.deal_doc_id AND tenant_id = l.tenant_id AND kind = 'delivery_order' FOR UPDATE;
    IF NOT FOUND OR d.status = 'void' THEN EXIT work; END IF;
    IF d.status = 'signed' THEN
      SELECT * INTO s FROM delivery_signatures WHERE deal_doc_id = d.id;
      res := jsonb_build_object('result', CASE WHEN lower(s.signer_name) = lower(p_name) AND coalesce(s.problems_note, '') = coalesce(p_problems, '')
                                               THEN 'ok_again' ELSE 'already_signed' END,
                                'signed_at', s.signed_at, 'signer_name', s.signer_name, 'problems', s.problems_note IS NOT NULL);
      EXIT work;
    END IF;
    IF l.expires_at <= p_now THEN EXIT work; END IF;
    SELECT * INTO j FROM jobs WHERE id = d.job_id AND tenant_id = d.tenant_id FOR UPDATE;
    INSERT INTO delivery_signatures(tenant_id, deal_doc_id, signer_name, agreed, mark, signer_ip_hash, problems_note, doc_sha256)
    VALUES (d.tenant_id, d.id, p_name, true, p_mark, p_ip_hash, p_problems,
            encode(sha256(convert_to(jsonb_build_object('doc_no', d.doc_no, 'job_id', d.job_id, 'lines', d.lines, 'subtotal', d.subtotal, 'tax_total', d.tax_total,
                                                        'total', d.total, 'extra', d.extra, 'layout', d.layout_snapshot)::text, 'UTF8')), 'hex'))
    RETURNING * INTO s;
    UPDATE deal_docs SET status = 'signed' WHERE id = d.id;
    INSERT INTO audit_log(tenant_id, actor, entity, entity_id, event, after)
    VALUES (d.tenant_id, 'customer:link', 'jobs', d.job_id, 'delivery order ' || d.doc_no || ' signed by link',
            jsonb_build_object('deal_doc_id', d.id, 'link_id', l.id, 'problems', p_problems IS NOT NULL));
    IF p_problems IS NOT NULL THEN
      -- ponytail: the report goes first in the notes so it is seen; the oldest notes lose their tail past 2000 characters (the jobs audit row keeps the old text)
      UPDATE jobs SET notes = left('Delivery problem reported on ' || d.doc_no || ': ' || p_problems || coalesce(E'\n' || notes, ''), 2000) WHERE id = j.id;
      INSERT INTO audit_log(tenant_id, actor, entity, entity_id, event, after)
      VALUES (d.tenant_id, 'customer:link', 'jobs', d.job_id, 'delivery problem reported on ' || d.doc_no, jsonb_build_object('deal_doc_id', d.id));
    END IF;
    IF EXISTS (SELECT 1 FROM delivery_lines(d.job_id)) AND NOT EXISTS (SELECT 1 FROM delivery_lines(d.job_id) WHERE signed < ordered) THEN
      done := true;
      IF j.status <> 'done' THEN
        UPDATE jobs SET status = 'done', done_at = now() WHERE id = j.id;
        INSERT INTO audit_log(tenant_id, actor, entity, entity_id, event, after)
        VALUES (d.tenant_id, 'customer:link', 'jobs', d.job_id, 'job done: every ordered item is on a signed delivery order', jsonb_build_object('deal_doc_id', d.id));
      END IF;
    END IF;
    res := jsonb_build_object('result', 'ok', 'signed_at', s.signed_at, 'signer_name', s.signer_name, 'problems', p_problems IS NOT NULL, 'complete', done);
  END work;
  PERFORM set_config('laris.role', o_role, true), set_config('laris.actor', o_actor, true), set_config('laris.tenant', o_tenant, true);
  RETURN res;
END $$;

REVOKE ALL ON FUNCTION delivery_link_open(text, timestamptz) FROM PUBLIC;
REVOKE ALL ON FUNCTION delivery_link_sign(text, text, text, text, text, timestamptz) FROM PUBLIC;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'laris_app') THEN
    GRANT EXECUTE ON FUNCTION delivery_link_open(text, timestamptz) TO laris_app;
    GRANT EXECUTE ON FUNCTION delivery_link_sign(text, text, text, text, text, timestamptz) TO laris_app;
  END IF;
END $$;
