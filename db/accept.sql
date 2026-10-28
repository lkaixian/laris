-- Customer accept links (SIMULATED e-signature, docs/api-contract.md). Applied by the owner on every start (idempotent).
-- Only the SHA-256 of the link token is stored. A customer has no account, so the two SECURITY DEFINER functions below are the ONLY way
-- a link holder touches a quote: they validate the link (known, not revoked, not expired, quote still sent/read, not yet decided), then do
-- the same guarded status change and the same jobs insert the owner path does. The guard in transitions.sql is NOT changed: the functions
-- run as the schema owner and set laris.role = 'owner' only for their own statements (restored on return), so no other caller gains anything.
CREATE TABLE IF NOT EXISTS quote_accept_links (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants,
  quote_id uuid NOT NULL REFERENCES documents,
  token_hash text NOT NULL UNIQUE,                       -- sha256 hex of the token; the raw token is never stored
  created_by uuid REFERENCES users,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  first_viewed_at timestamptz,
  decided_at timestamptz,
  decision text CHECK (decision IN ('accepted','declined')),
  signer_name text CHECK (length(signer_name) BETWEEN 2 AND 80),
  signer_ip_hash text,
  revoked_at timestamptz,
  CONSTRAINT decision_pair CHECK ((decision IS NULL) = (decided_at IS NULL))
);
CREATE INDEX IF NOT EXISTS quote_accept_links_quote_idx ON quote_accept_links (quote_id);

ALTER TABLE quote_accept_links ENABLE ROW LEVEL SECURITY;
ALTER TABLE quote_accept_links FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_scope ON quote_accept_links;
CREATE POLICY tenant_scope ON quote_accept_links USING (laris_tenant_ok(tenant_id)) WITH CHECK (laris_tenant_ok(tenant_id));

-- Both functions set laris.role / actor / tenant for their own statements and put the caller's values back before returning (set_config,
-- transaction-local). A function-level SET clause would do the same but a plain table owner may not set a custom parameter that way.

-- Look at a link: NULL for anything unknown, revoked, or (undecided and) expired / no longer open: one generic answer, nothing to enumerate.
-- Marks first_viewed_at and moves sent -> read (the staff-class step the delivery receipts also do).
CREATE OR REPLACE FUNCTION accept_link_open(p_hash text, p_now timestamptz) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE l quote_accept_links; s text; res jsonb;
        o_role text := coalesce(current_setting('laris.role', true), ''); o_actor text := coalesce(current_setting('laris.actor', true), '');
        o_tenant text := coalesce(current_setting('laris.tenant', true), '');
BEGIN
  PERFORM set_config('laris.role', 'owner', true), set_config('laris.actor', 'customer:link', true), set_config('laris.tenant', '*', true);
  <<work>> BEGIN
    SELECT * INTO l FROM quote_accept_links WHERE token_hash = p_hash AND revoked_at IS NULL FOR UPDATE;
    IF NOT FOUND THEN EXIT work; END IF;
    SELECT status::text INTO s FROM documents WHERE id = l.quote_id AND tenant_id = l.tenant_id AND direction = 'out';
    IF l.decision IS NULL THEN
      IF s IS NULL OR s NOT IN ('sent','read') OR l.expires_at <= p_now THEN EXIT work; END IF;
      UPDATE quote_accept_links SET first_viewed_at = coalesce(first_viewed_at, p_now) WHERE id = l.id;
      IF s = 'sent' THEN
        UPDATE documents SET status = 'read', read_at = coalesce(read_at, now()) WHERE id = l.quote_id;
        s := 'read';
      END IF;
    END IF;
    res := jsonb_build_object('tenant_id', l.tenant_id, 'quote_id', l.quote_id, 'status', s, 'decision', l.decision,
                              'decided_at', l.decided_at, 'signer_name', l.signer_name);
  END work;
  PERFORM set_config('laris.role', o_role, true), set_config('laris.actor', o_actor, true), set_config('laris.tenant', o_tenant, true);
  RETURN res;
END $$;

-- Decide: p_decision 'accepted' (creates the job, once) or 'declined'. Returns {"result": "ok" | "already_decided" | "not_found", ...}.
-- A repeat of the same decision is answered from the stored row: never a second job, never a second status change.
CREATE OR REPLACE FUNCTION accept_link_decide(p_hash text, p_decision text, p_name text, p_ip_hash text, p_reason text, p_now timestamptz) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE l quote_accept_links; s text; res jsonb := jsonb_build_object('result', 'not_found');
        o_role text := coalesce(current_setting('laris.role', true), ''); o_actor text := coalesce(current_setting('laris.actor', true), '');
        o_tenant text := coalesce(current_setting('laris.tenant', true), '');
BEGIN
  IF p_decision NOT IN ('accepted','declined') THEN RAISE EXCEPTION 'bad decision'; END IF;
  PERFORM set_config('laris.role', 'owner', true), set_config('laris.actor', 'customer:link', true), set_config('laris.tenant', '*', true);
  <<work>> BEGIN
    SELECT * INTO l FROM quote_accept_links WHERE token_hash = p_hash AND revoked_at IS NULL FOR UPDATE;
    IF NOT FOUND THEN EXIT work; END IF;
    IF l.decision IS NOT NULL THEN
      res := jsonb_build_object('result', 'already_decided', 'decision', l.decision, 'decided_at', l.decided_at, 'signer_name', l.signer_name);
      EXIT work;
    END IF;
    SELECT status::text INTO s FROM documents WHERE id = l.quote_id AND tenant_id = l.tenant_id AND direction = 'out' FOR UPDATE;
    IF s IS NULL OR s NOT IN ('sent','read') OR l.expires_at <= p_now THEN EXIT work; END IF;
    IF p_decision = 'accepted' THEN
      UPDATE documents SET status = 'accepted', decided_at = now(), decision_reason = 'simulated e-signature' WHERE id = l.quote_id;
      INSERT INTO jobs(tenant_id, quote_id) VALUES (l.tenant_id, l.quote_id) ON CONFLICT (quote_id) DO NOTHING;
    ELSE
      UPDATE documents SET status = 'rejected', decided_at = now(), decision_reason = left(nullif(btrim(p_reason), ''), 300) WHERE id = l.quote_id;
    END IF;
    UPDATE quote_accept_links SET decision = p_decision, decided_at = now(), signer_ip_hash = p_ip_hash,
           signer_name = CASE WHEN p_decision = 'accepted' THEN p_name END, first_viewed_at = coalesce(first_viewed_at, p_now) WHERE id = l.id;
    INSERT INTO audit_log(tenant_id, actor, entity, entity_id, event, after)
    VALUES (l.tenant_id, 'customer:link', 'documents', l.quote_id,
            CASE WHEN p_decision = 'accepted' THEN 'accepted by link (simulated e-signature)' ELSE 'declined by link (simulated)' END,
            jsonb_build_object('link_id', l.id, 'simulated', true));
    res := jsonb_build_object('result', 'ok', 'decision', p_decision, 'quote_id', l.quote_id);
  END work;
  PERFORM set_config('laris.role', o_role, true), set_config('laris.actor', o_actor, true), set_config('laris.tenant', o_tenant, true);
  RETURN res;
END $$;

REVOKE ALL ON FUNCTION accept_link_open(text, timestamptz) FROM PUBLIC;
REVOKE ALL ON FUNCTION accept_link_decide(text, text, text, text, text, timestamptz) FROM PUBLIC;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'laris_app') THEN
    GRANT EXECUTE ON FUNCTION accept_link_open(text, timestamptz) TO laris_app;
    GRANT EXECUTE ON FUNCTION accept_link_decide(text, text, text, text, text, timestamptz) TO laris_app;
  END IF;
END $$;
