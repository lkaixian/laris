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
| `POST /api/documents/ingest` | any | Supplier document (multipart `file`, 10 MB, or form `text`; optional `supplier`, `kind`). The type is sniffed from the bytes, not trusted from the client: PDF (text layer), JPEG/PNG/WebP photo, XLSX (all sheets, first 2000 rows and 40 columns), DOCX (paragraphs and tables) or CSV (comma, semicolon or tab; UTF-8, GB18030 or Windows-1252; recognised by a `.csv` name or a `text/csv` type). Sheets and Word files are read as exact text, so there is no OCR confidence. Old `.xls`/`.doc` -> 415; a corrupt file, a Word file with a DOCTYPE/ENTITY, or a zip over 50 MB unpacked -> 422. Same extraction, validation, duplicate check (sha256 of the bytes) and review as a PDF. The same types work when sent as a document on WhatsApp or Telegram |
| `GET /api/documents/{id}/pdf` | any | Customer quotation PDF (selling prices only) |
| `POST /api/parties/{id}/erase` | owner | Erase a customer's personal data on request |
| `POST /api/rfq` | any | Ask suppliers (multipart): `image` (JPEG or PNG, 8 MB), `description` (200), `note` (300, optional), `circle` (optional JSON `{x,y,r}`, fractions), `supplier_ids` (repeated; each a supplier of this tenant with a phone or a `tg:<chat id>` contact, else 422). A supplier whose `contact` is `tg:<chat id>` or `telegram:<chat id>` (digits, may be negative for a group) gets the photo and note from the Telegram bot (`sendPhoto`); anyone else gets it on WhatsApp, once-uploaded, from the tenant's WhatsApp number (outside the 24h window it uses `WHATSAPP_RFQ_TEMPLATE`, else that send fails). A Telegram supplier who never pressed Start on the bot fails with `supplier must open the bot and press Start first`. Their replies come in through `/webhooks/telegram` (reply to our photo, or the newest open ask) and are acknowledged on Telegram. `rfq_sends.wamid` holds the provider message id for either channel (Telegram: `chat_id:message_id`). A failed send does not stop the others. -> `201 {rfq_id, sends:[{supplier_id, status:"sent"\|"failed", error}]}` |
| `GET /api/rfq` | any | Newest 100 asks: `[{id, description, note, created_at, image_url, replies:[{reply_id, send_id, supplier_id, supplier_name, text, unit_price, min_qty, tiers:[{min_qty, unit_price}], status}]}]`, one reply row per supplier asked (`waiting` until they answer). Staff get `text ""`, prices null, `tiers []`, and `status` only `waiting` or `needs_review` (answered). Owner status: `waiting`, `needs_review`, `ready`, `accepted` |
| `GET /api/rfq/{id}/image` | any | The photo (own tenant only) |
| `POST /api/rfq/{id}/replies/{reply_id}/accept` | owner | `{item_key}` (`^[a-z][a-z0-9_]{0,60}$`, else 422). Makes an inbound quotation from the reply (one line per price break, uom `pcs`), runs it reviewed -> accepted -> in_cost_book so cost items exist, sets the reply `accepted`. 409 if the reply has no price or is already accepted. -> `{reply_id, status, doc_id}` |

Supplier replies reach `POST /webhooks/whatsapp`. A text from a supplier is linked to the ask it quotes (`context.id` = our message id), else to that supplier's newest ask still waiting (7 days). The price is read by ILMU from the redacted text; the server decides the status: `ready` only for a positive price (and sane breaks: dearer never at higher volume, ringgit), otherwise `needs_review`; the raw text is always kept. Voice notes and photos are stored `needs_review` (not read); a photo counts only when it quotes our message.

Identity, strongest first: a session or per-user token (`Authorization: Bearer`) decides user, role and tenant from the database and ignores `X-Role` and `X-User`; the shared `APP_TOKEN` or no token, both demo mode only. Demo mode (identity from `X-Role` / `X-User`) is allowed only while no account has a password, `REQUIRE_USER_TOKEN` is not `1`, and `DEMO_MODE=1` or (no `APP_TOKEN` and not a Replit deployment); otherwise 401 `bad_token`. With `APP_TOKEN`, `X-User` must be a user of the first tenant. `GET /api/auth/config` returns `login_required: true` exactly when demo mode is not allowed.
