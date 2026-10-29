-- One row per model call, for the AI tab: counts only, never the question, the answer or any masked value. Applied on every start
-- (idempotent), after rls.sql. laris_app gets its grants from roles.sql. Purged after 90 days (src/scheduler.py purge_stale).
CREATE TABLE IF NOT EXISTS ai_calls (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants,
  user_id uuid,                                  -- null when a customer's chat message made the call
  at timestamptz NOT NULL DEFAULT now(),
  kind text NOT NULL,                            -- enquiry, supplier_doc, rfq_reply, availability, assistant, guide
  provider text NOT NULL CHECK (provider IN ('ilmu','custom')),
  ok boolean NOT NULL,
  ms int NOT NULL,
  masked jsonb NOT NULL DEFAULT '{}'             -- how many values were hidden from the model, by type: {"EMAIL":1,"NAME":2}
);
CREATE INDEX IF NOT EXISTS ai_calls_tenant ON ai_calls (tenant_id, at);

ALTER TABLE ai_calls ENABLE ROW LEVEL SECURITY;
ALTER TABLE ai_calls FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_scope ON ai_calls;
CREATE POLICY tenant_scope ON ai_calls USING (laris_tenant_ok(tenant_id)) WITH CHECK (laris_tenant_ok(tenant_id));
