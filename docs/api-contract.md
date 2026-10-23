# LARIS API contract (v0, owner = lead; agents must not change it without saying so)

Base `/api`. JSON. Auth is simulated: header `X-Role: owner|staff` and `X-User: <uuid>`. Staff responses NEVER contain cost, margin, supplier cost, or owner_only attrs.
Money is a string with 2-4 decimals (e.g. "123.4000"). Dates ISO-8601. Statuses and directions are the enums in db/schema.sql.

## Types
Doc summary: {id, direction:"in"|"out", kind, doc_no, party:{id,name}, status, issued_on, valid_until, total, currency, updated_at, flags:{cost_is_stale:bool, needs_review:bool}}
Line: {id, line_no, item_key|null, description, qty|null, uom, unit_price|null, discount_pct|null, tax_rate|null, section|null, is_header, needs_review, ocr_confidence|null, attrs:{}, attrs_unmapped:{}, min_qty|null, supplier_sku|null, review_reason|null}   (the last three are owner only: null for staff; min_qty is the supplier price-tier break, >1 = a minimum order quantity)
Provenance (owner only): {line_id, cost_item_id, supplier, source_doc_id, source_doc_no, source_line_id, cost_date, unit_cost, cost_snapshot, current_unit_cost, cost_is_stale, line_margin}

## Endpoints
- GET  /api/me -> {role, name, org:{name, logo_url|null}}   (org = tenant branding shown beside the LARIS logo; logo_url null = initials placeholder)
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

## Additions after v0 (all in the repo, all tested in `tests/test_api.py`)

Staff responses are scrubbed on every endpoint below as before. "Owner" means owner only.

| Endpoint | Who | What |
|---|---|---|
| `GET /api/auth/config`, `POST /api/login`, `POST /api/logout` | public / any | Accounts. Login returns a session token (stored server side only as SHA-256, expires after `SESSION_HOURS`, default 12). Wrong user and wrong password give the same error. 5 failed tries per username and address per 15 minutes, then 429 |
| `POST /api/me/password` | any | Change own password (10+ characters); other devices are signed out |
| `GET/POST /api/users`, `POST /api/users/{id}` | owner | Add people, set password, change role, deactivate. The last active owner cannot be removed |
| `GET/POST /api/contacts`, `GET/POST /api/contacts/{id}` | any | Contact book (customer, supplier, contractor). `GET` takes `q` and `role`. Owner also gets `value` and, for a supplier, `current_costs` |
| `GET /api/search?q=` | any | Contacts, documents (number, party, line text); owner also cost items |
| `POST /api/assistant`, `GET /api/assistant/suggestions` | any | Look-up chat. The model picks an intent from a closed list; the answer is built from the database; it never changes data. Without the model it falls back to keywords (`source: "keywords"`) |
| `GET /api/dashboard` | any | Home numbers |
| `GET /api/jobs`, `POST /api/jobs/{id}` | any | Job board |
| `GET /api/followups`, `POST /api/followups/{id}` | list any, act owner | Suggested chase messages; `{"action": "send" \| "skip"}` |
| `GET /api/reports/margin?days=N` | owner | Margin report |
| `GET/POST /api/settings` | owner | Margin floor and issuer details for the quote PDF |
| `POST /api/documents/manual` | any | Key in a supplier document by hand |
| `GET /api/documents/{id}/pdf` | any | Customer quotation PDF (selling prices only) |
| `POST /api/parties/{id}/erase` | owner | Erase a customer's personal data on request |

Identity, strongest first: a session or per-user token (`Authorization: Bearer`) decides user, role and tenant from the database and ignores `X-Role` and `X-User`; the shared `APP_TOKEN`; no token (demo). `REQUIRE_USER_TOKEN=1` switches the demo mode off.
