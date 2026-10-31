-- What the owner aims for, and the cash on hand, for the Business report. Every field is optional: a KPI with no target shows "set a target" and
-- Cash Runway with no cash figure shows "no data" (nothing is guessed). revenue_month and profit_month are per month; a week uses 12/52 of them.
CREATE TABLE IF NOT EXISTS report_targets (
  tenant_id uuid PRIMARY KEY REFERENCES tenants,
  revenue_month numeric(14,2) CHECK (revenue_month >= 0),
  margin_pct numeric(5,2) CHECK (margin_pct BETWEEN 0 AND 100),
  profit_month numeric(14,2),
  cac numeric(14,2) CHECK (cac >= 0),
  runway_months numeric(5,1) CHECK (runway_months >= 0),
  cash_on_hand numeric(14,2) CHECK (cash_on_hand >= 0),
  cash_as_of date,
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE report_targets ENABLE ROW LEVEL SECURITY;
ALTER TABLE report_targets FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_scope ON report_targets;
CREATE POLICY tenant_scope ON report_targets USING (laris_tenant_ok(tenant_id)) WITH CHECK (laris_tenant_ok(tenant_id));
