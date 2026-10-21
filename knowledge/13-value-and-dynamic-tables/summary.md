---
retrieved: 2026-10-22
confidence: design opinion
status: proposed (db/schema.sql NOT edited)
---
# Summary: value and dynamic tables

Notes: [[quote-value-insights]], [[dynamic-fields-design]], [[dashboard-live-update]].

## Build now (hackathon)
1. Insights needing no schema change: price history (A1), cost drift (A2), stale open quotes (A3), supplier compare (A4), win/loss (B1), time-to-quote (B3), margin per quote (B6), pipeline (B13). SQL views over existing columns.
2. `document_lines.attrs jsonb` + `tenant_fields` registry seeded from template YAML `fields:`; grid = fixed columns + registry columns; extraction JSON schema built from the same registry.
3. Unknown field goes to `field_proposals` + `attrs_unmapped`; owner approves in one tap. No runtime DDL; AI cannot write the registry.
4. Dashboard by polling (3-5 s) on the `audit_log.id` cursor.

## Defer
MOQ/price-break calculation (capture attrs now, compute later), lead-time actuals, volatility score, spend outlook, PriceCatcher benchmark, win-rate vs margin, generated-column promotion, LISTEN/NOTIFY + SSE. Rejected: EAV, per-trade tables.

## Proposed changes to db/schema.sql (list only)
1. `CREATE TYPE field_type AS ENUM ('text','number','integer','date','select','boolean');`
2. `document_lines`: add `attrs jsonb NOT NULL DEFAULT '{}'`, `attrs_unmapped jsonb NOT NULL DEFAULT '{}'`, CHECK both are JSON objects.
3. `CREATE INDEX ON document_lines USING GIN (attrs jsonb_path_ops);` (`jsonb_ops` if key-exists filters are needed).
4. New table `tenant_fields` (tenant_id, key with regex CHECK, label, type, unit, options, applies_to doc_direction[], show_in_grid, owner_only, sort_order, approved_by, UNIQUE(tenant_id,key)).
5. New table `field_proposals` (tenant_id, key, sample_values, source_line_id, status pending/approved/ignored, decided_by/at, UNIQUE(tenant_id,key)).
6. `documents`: add `decision_reason text`. `document_lines`: optional `price_override_reason text`.
7. `tenants`: add `drift_alert_pct numeric(5,2) NOT NULL DEFAULT 5.00`.
8. Views: `v_price_history`, `v_cost_drift` (lag), `v_quote_margin`, `v_funnel` (win/loss, time-to-quote), `v_line_attrs` (jsonb_each_text). Staff views must exclude `owner_only` attrs.
9. Grants: LLM role INSERT on `field_proposals` only; no write on `tenant_fields`.
10. Stretch: `notify_board()` AFTER INSERT trigger on `audit_log`.
