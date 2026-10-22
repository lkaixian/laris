-- Apply after functions.sql (CREATE OR REPLACE, safe to re-run). Convention (matches the seed): line_cost_basis.qty_consumed
-- is PER UNIT of the sold line, so line cost = qty * sum(qty_consumed * cost_snapshot).
-- Labour/machine rate-card hours have no cost_item row: they are stored on the line as other_cost_per_unit and added to line cost.
ALTER TABLE document_lines ADD COLUMN IF NOT EXISTS other_cost_per_unit numeric(14,4) NOT NULL DEFAULT 0;  -- DBs created before this column

-- Provider retries / replays: one message per (channel, provider id).
CREATE UNIQUE INDEX IF NOT EXISTS messages_channel_external_uq ON messages (channel, external_id) WHERE external_id IS NOT NULL;

-- Quote numbers are unique per tenant (the app also serialises numbering with an advisory lock).
CREATE UNIQUE INDEX IF NOT EXISTS documents_out_no_uq ON documents (tenant_id, doc_no) WHERE direction = 'out';

-- One row per OUT line (fixes v_quote_bom, which repeats the line total once per cost-basis row).
CREATE OR REPLACE VIEW v_quote_margin AS
SELECT s.*, s.line_total - s.line_cost AS line_margin,
       CASE WHEN s.line_total > 0 THEN round((s.line_total - s.line_cost) / s.line_total * 100, 2) END AS margin_pct
FROM (
  SELECT q.tenant_id, q.id AS quote_id, q.doc_no AS quote_no, q.status, ql.id AS line_id, ql.line_no, ql.item_key, ql.qty,
         ql.unit_price AS sell_price,
         ql.qty * ql.unit_price * (1 - coalesce(ql.discount_pct, 0) / 100) AS line_total,
         ql.qty * (sum(b.qty_consumed * b.cost_snapshot) + ql.other_cost_per_unit) AS line_cost
  FROM documents q
  JOIN document_lines ql ON ql.document_id = q.id
  JOIN line_cost_basis b ON b.out_line_id = ql.id
  WHERE q.direction = 'out'
  GROUP BY q.tenant_id, q.id, q.doc_no, q.status, ql.id, ql.line_no, ql.item_key, ql.qty, ql.unit_price, ql.discount_pct, ql.other_cost_per_unit
) s;

-- Owner explainability per cost-basis row, with the out line id the frontend needs.
CREATE OR REPLACE VIEW v_quote_provenance AS
SELECT m.tenant_id, m.quote_id, b.out_line_id AS line_id, ci.id AS cost_item_id, sp.name AS supplier,
       sd.id AS source_doc_id, sd.doc_no AS source_doc_no, sl.id AS source_line_id, ci.effective_date AS cost_date,
       ci.unit_cost, b.cost_snapshot, cur.unit_cost AS current_unit_cost,
       (cur.unit_cost IS DISTINCT FROM b.cost_snapshot) AS cost_is_stale, m.line_margin
FROM v_quote_margin m
JOIN line_cost_basis b ON b.out_line_id = m.line_id
JOIN cost_items ci ON ci.id = b.cost_item_id
JOIN document_lines sl ON sl.id = ci.source_line_id
JOIN documents sd ON sd.id = sl.document_id
JOIN parties sp ON sp.id = ci.supplier_id
LEFT JOIN LATERAL (
  SELECT unit_cost FROM cost_items c2
  WHERE c2.tenant_id = ci.tenant_id AND c2.item_key = ci.item_key AND c2.uom = ci.uom AND c2.superseded_by IS NULL
  ORDER BY effective_date DESC, created_at DESC LIMIT 1) cur ON true;

-- Sent quotes whose cost basis ROSE by >= tenant drift_alert_pct (cost drops are not alerts). margin_delta < 0 = margin leaked (RM).
CREATE OR REPLACE VIEW v_stale_alerts AS
SELECT q.tenant_id, q.id AS quote_id, q.doc_no AS quote_no, p.name AS customer, ci.item_key,
       b.cost_snapshot AS old_cost, cur.unit_cost AS current_cost,
       -(ql.qty * b.qty_consumed * (cur.unit_cost - b.cost_snapshot)) AS margin_delta, q.status
FROM documents q
JOIN tenants t ON t.id = q.tenant_id
JOIN parties p ON p.id = q.party_id
JOIN document_lines ql ON ql.document_id = q.id
JOIN line_cost_basis b ON b.out_line_id = ql.id
JOIN cost_items ci ON ci.id = b.cost_item_id
JOIN LATERAL (
  SELECT unit_cost FROM cost_items c2
  WHERE c2.tenant_id = ci.tenant_id AND c2.item_key = ci.item_key AND c2.uom = ci.uom AND c2.superseded_by IS NULL
  ORDER BY effective_date DESC, created_at DESC LIMIT 1) cur ON true
WHERE q.direction = 'out' AND q.status IN ('approved','sent','read')
  AND cur.unit_cost - b.cost_snapshot >= b.cost_snapshot * t.drift_alert_pct / 100;
