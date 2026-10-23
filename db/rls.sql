-- Row-level security: the database, not only the API, keeps one tenant's rows from another's (audit D3).
-- Applied by the owner on every start (idempotent). FORCE makes a non-superuser table owner obey the policies too;
-- a superuser or BYPASSRLS role still skips RLS (the app warns at startup, src/db.py rls_status).
-- A request sets laris.tenant to its tenant after the user is known. System work that crosses tenants on purpose
-- (login lookup, webhooks, the scheduler, startup) sets '*'. Unset or any other value sees nothing (fails closed).
-- ponytail: '*' is a convention the app role could also set itself; this guards against missing WHERE clauses and
-- cross-tenant bugs in request code, not against someone who can run arbitrary SQL as laris_app.
CREATE OR REPLACE FUNCTION laris_tenant_ok(t uuid) RETURNS boolean LANGUAGE sql STABLE AS $$
  SELECT current_setting('laris.tenant', true) = '*' OR t::text = current_setting('laris.tenant', true)
$$;

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['users','parties','enquiries','documents','tenant_fields','field_proposals',
                           'cost_items','ai_actions','jobs','audit_log'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS tenant_scope ON %I', t);
    EXECUTE format('CREATE POLICY tenant_scope ON %I USING (laris_tenant_ok(tenant_id)) WITH CHECK (laris_tenant_ok(tenant_id))', t);
  END LOOP;
END $$;

ALTER TABLE tenants ENABLE ROW LEVEL SECURITY;
ALTER TABLE tenants FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_scope ON tenants;
CREATE POLICY tenant_scope ON tenants USING (laris_tenant_ok(id)) WITH CHECK (laris_tenant_ok(id));

-- Tables without a tenant_id follow the row they hang off (doc_transitions is shared rules, not tenant data). The subselect is itself filtered by that table's policy.
DO $$
DECLARE r record;
BEGIN
  FOR r IN SELECT * FROM (VALUES
      ('document_lines',  'documents d WHERE d.id = document_lines.document_id'),
      ('followups',       'documents d WHERE d.id = followups.document_id'),
      ('line_cost_basis', 'document_lines l WHERE l.id = line_cost_basis.out_line_id'),
      ('messages',        'documents d WHERE d.id = messages.document_id) OR EXISTS (SELECT 1 FROM enquiries e WHERE e.id = messages.enquiry_id'),
      ('sessions',        'users u WHERE u.id = sessions.user_id')) AS v(tbl, sub) LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', r.tbl);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', r.tbl);
    EXECUTE format('DROP POLICY IF EXISTS tenant_scope ON %I', r.tbl);
    EXECUTE format('CREATE POLICY tenant_scope ON %I USING (EXISTS (SELECT 1 FROM %s)) WITH CHECK (EXISTS (SELECT 1 FROM %s))',
                   r.tbl, r.sub, r.sub);
  END LOOP;
END $$;

-- A view runs with its owner's rights, which would skip the policies above; make it use the caller's.
ALTER VIEW v_quote_bom SET (security_invoker = true);
ALTER VIEW v_line_attrs SET (security_invoker = true);
ALTER VIEW v_quote_margin SET (security_invoker = true);
ALTER VIEW v_quote_provenance SET (security_invoker = true);
ALTER VIEW v_stale_alerts SET (security_invoker = true);
