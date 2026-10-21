---
type: analysis
retrieved: 2026-10-22
confidence: design opinion (no external statistics used); field/SQL claims checked against [[../07-data-model/bidirectional-schema]]
status: proposed
---
# Value hidden in a quotation

Opinion throughout: this is an inventory of what the data can answer, not evidence that SMEs will pay for it. Validate with [[../08-validation]] interviews. Schema: [[../07-data-model/bidirectional-schema]]; lifecycle: [[../07-data-model/state-machines]]; dynamic fields: [[dynamic-fields-design]].

A quotation is a dated price promise with quantity, validity and a counterparty. Stored as rows, it is a time series per `(tenant, item_key, supplier)` (receiver view, `direction=in`) and a funnel record per customer (issuer view, `direction=out`).

Effort: S = one SQL view/query on existing columns, M = view plus small new column/table or job, L = needs new data capture, new UI or modelling.

## A. Receiver side (supplier quotes, `direction=in`): "what am I paying?"

| # | Insight | Fields needed | Exists? | SQL shape | Effort |
|---|---|---|---|---|---|
| A1 | Price history per item per supplier | `cost_items(item_key,uom,unit_cost,supplier_id,effective_date)` | yes | `SELECT effective_date, unit_cost FROM cost_items WHERE tenant_id=$1 AND item_key=$2 ORDER BY effective_date` | S |
| A2 | Cost drift alert: latest vs previous | same | yes | `lag(unit_cost) OVER (PARTITION BY tenant_id,item_key,uom,supplier_id ORDER BY effective_date)`; flag `abs(unit_cost/prev-1) > threshold` | S (per-tenant threshold = M) |
| A3 | Drift that hurts open quotes | `v_quote_bom.cost_is_stale` | yes (designed) | already the headline view | S |
| A4 | Supplier comparison, same item | current `cost_items` | yes | `DISTINCT ON (supplier_id) ... ORDER BY supplier_id, effective_date DESC`, then rank by `unit_cost` | S |
| A5 | Cheapest valid supplier now | `cost_items.valid_until` | yes | A4 filtered `valid_until IS NULL OR valid_until >= current_date` | S |
| A6 | Prices expiring in 7 days | `documents.valid_until`, status | yes | `WHERE status IN ('accepted','in_cost_book') AND valid_until BETWEEN now() AND now()+interval '7 days'` | S |
| A7 | Missing validity date (chase supplier) | `valid_until IS NULL` | yes | feeds `followups` | S |
| A8 | Supplier price volatility | cost_items | yes | `stddev(unit_cost)/avg(unit_cost)` per supplier+item; needs 3+ points, show the count | M |
| A9 | MOQ and price breaks | moq, break_qty | NO (one `qty`/`unit_price` per line) | store as line `attrs` `{moq, break_qty}` ([[dynamic-fields-design]]); pick tier where `qty >= break_qty` | M |
| A10 | Lead time per supplier/item | `lead_time_days` | NO | line or document attr; `avg(lead_time_days)` per supplier. Quoted vs actual needs delivery-date capture | M (quoted), L (actual) |
| A11 | Material spend outlook | accepted out-quote BOM x current cost | partly: `line_cost_basis` exists, no demand history | open `accepted` out docs: `sum(qty*qty_consumed*current unit_cost)` per item_key = committed spend, not a statistical forecast. Opinion: do not claim forecasting | M |
| A12 | Price vs public benchmark | PriceCatcher | grocery/F&B only ([[../06-tech-stack/adr-pricecatcher]]) | join item_key to mapped item | L |
| A13 | Quoted spend per supplier | accepted `in` lines | yes | `sum(qty*unit_price) GROUP BY party_id`. Label "quoted"; only receipts mean "paid" | S |

## B. Issuer side (customer quotes, `direction=out`): "how well do I sell?"

| # | Insight | Fields needed | Exists? | SQL shape | Effort |
|---|---|---|---|---|---|
| B1 | Win/loss rate | `documents.status` | yes | won = `accepted`,`job_created`; lost = `rejected`,`expired`; `count(*) FILTER (...)` ratio over decided sent docs. `accepted` is non-terminal in [[../07-data-model/state-machines]], count it as won | S |
| B2 | Win rate by customer / value band | `party_id`, line totals | yes | B1 grouped; `width_bucket` on total | S |
| B3 | Time-to-quote | `enquiries.created_at`, `documents.sent_at` | yes | `min(d.sent_at) - e.created_at` via `documents.enquiry_id`; median with `percentile_cont(0.5)` | S |
| B4 | Time-to-decision | `sent_at`, `decided_at` | yes | difference | S |
| B5 | Read but no reply | `read_at`, `decided_at IS NULL` | yes, if read webhook works (WhatsApp read status depends on recipient privacy settings; unverified) | feeds follow-up | S |
| B6 | Margin per quote | `line_cost_basis`, `unit_price` | yes | `v_quote_margin` GROUP BY (planned) | S |
| B7 | Margin by customer | B6 + `party_id` | yes | group B6 | S |
| B7b | Margin by category/trade | category on line | NO (`tenants.trade_template` is one per tenant) | `attrs->>'category'` or column | M |
| B8 | Win rate vs margin | B1 + B6 | yes | bucket margin_pct vs won flag. Opinion: meaningless under ~30 quotes; show counts | M |
| B9 | Discount leakage | `price_source='owner_override'` | yes | count/sum; reason column missing | S (reason M) |
| B10 | Repeat customer value | out docs per party | yes | `sum(total) FILTER (WHERE status='job_created') GROUP BY party_id` | S |
| B11 | Revision churn | `parent_id` | yes | recursive CTE | M |
| B12 | Lost reason | reason on reject | NO | add `documents.decision_reason text` | S |
| B13 | Pipeline value / ageing | status, `valid_until` | yes | sum lines where status in (`sent`,`read`) | S |

## C. Cross-direction (opinion: the differentiator)
Cost-to-sell lag: days from a supplier price rise (`cost_items.effective_date`) to the first out quote repriced on it. Fields exist. M.

## Needs new fields (shortest list)
1. `document_lines.attrs jsonb` (MOQ, break_qty, lead_time_days, finishing, per pax).
2. `documents.decision_reason`, `price_override_reason`.
3. Per-tenant `drift_alert_pct`.
4. Delivery actuals for real lead time (defer).

## Order (opinion)
Hackathon: A1, A2, A3, A4, B1, B3, B6, B13. Defer A8, A11, A12, B8, B11. See [[summary]].
