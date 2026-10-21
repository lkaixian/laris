# LARIS API contract (v0, owner = lead; agents must not change it without saying so)

Base `/api`. JSON. Auth is simulated: header `X-Role: owner|staff` and `X-User: <uuid>`. Staff responses NEVER contain cost, margin, supplier cost, or owner_only attrs.
Money is a string with 2-4 decimals (e.g. "123.4000"). Dates ISO-8601. Statuses and directions are the enums in db/schema.sql.

## Types
Doc summary: {id, direction:"in"|"out", kind, doc_no, party:{id,name}, status, issued_on, valid_until, total, currency, updated_at, flags:{cost_is_stale:bool, needs_review:bool}}
Line: {id, line_no, description, qty|null, uom, unit_price|null, discount_pct|null, tax_rate|null, section|null, is_header, needs_review, ocr_confidence|null, attrs:{}, attrs_unmapped:{}}
Provenance (owner only): {cost_item_id, supplier, source_doc_id, source_doc_no, source_line_id, cost_date, unit_cost, cost_snapshot, current_unit_cost, cost_is_stale, line_margin}

## Endpoints
- GET  /api/me -> {role, name}
- GET  /api/tracker -> {received:[DocSummary], sent:[DocSummary]}   (two lanes, shared states)
- GET  /api/documents/{id} -> {doc:DocSummary+terms, lines:[Line], provenance?:[Provenance] (owner), messages:[{direction,channel,body,at}]}
- POST /api/documents/{id}/transition {to:status, reason?} -> DocSummary   (owner for approve/accept/reject; 403 otherwise; 409 if transition not allowed)
- POST /api/documents/{id}/lines/{lineId} {item_key?, qty?, unit_price?, needs_review?} -> Line   (review step for 'in' docs; unit_price on 'out' lines is rules-engine only, 403)
- GET  /api/alerts/stale-costs (owner) -> [{quote_id, quote_no, customer, item_key, old_cost, current_cost, margin_delta, status}]
- GET  /api/cost-items (owner) -> [{id,item_key,uom,unit_cost,supplier,source_doc_no,effective_date}]
- GET  /api/fields -> [{key,label,type,unit,options,show_in_grid,sort_order}]  (staff: owner_only removed)
- GET  /api/field-proposals (owner) -> [{id,key,sample_values,status}] ; POST /api/field-proposals/{id}/decide {decision:"approve"|"ignore", type?, label?}
- GET  /api/audit?after=<id> -> [{id,at,actor,entity,entity_id,event}]   (poll cursor = last id; also used as the live-update feed)
- POST /api/enquiries/simulate {channel, text} -> creates a draft out quote via extraction+rules (demo helper)
- POST /webhooks/telegram , GET+POST /webhooks/whatsapp (Meta verify + inbound; delivery/read status updates documents.read_at)
- GET  /api/export/bom.xlsx?quote_id= , /api/export/po.csv?quote_id=

Errors: {error:{code,message}}; list endpoints return [] when empty.
