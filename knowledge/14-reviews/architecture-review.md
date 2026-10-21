---
type: review
date: 2026-10-22
status: final, read-only review of commit f716fcf (nothing was run; findings are from reading code)
---
# Architecture review of the built LARIS system

Verdict: the data model is sound and the decisions that matter (DB-enforced transitions, audit triggers, cost provenance, AI price firewall, staff scrubbing) are implemented as designed. The demo risk is not the architecture, it is the seams: the UI cannot talk to the API, the API does not serve the UI, and the seed does not match the template.

## 1. Contract and decision conformance

Holds: bidirectional documents (db/schema.sql:63-100); cost_items only via promote_document, idempotent via UNIQUE source_line_id (schema.sql:162, functions.sql:12-26); stale cost via v_stale_alerts (views.sql:41-55); transition legality, role and approver in the DB guard (transitions.sql:27-45); audit trigger plus append-only log (transitions.sql:47-60, schema.sql:238-243); AI never sets prices (src/pricing.py:28-33 rejects price keys; LLM schema has no price, src/pipeline.py:183-188; out-line price edit is 403, src/api/routes.py:162-165; price_src enum has no 'ai'); staff scrub is one choke point (src/api/deps.py:43-66) plus explicit omissions (routes.py:44,48,68-71).

Divergences:
- D1. Frontend sends a hardcoded X-User `0000...0001` (web/src/api.ts:64,84). `_open` looks it up and returns 401 unknown_user (deps.py:88-93). Seed users get random uuids (schema.sql:32). Every non-mock call fails.
- D2. Backend serves no static files (src/app.py:25-30) but deploy builds `web/` and runs one uvicorn (.replit, run.sh). The UI is not reachable on the deployed VM.
- D3. Frontend has no upload-supplier-doc or simulate-enquiry control (web/src/App.tsx never calls /documents/ingest or /enquiries/simulate). Steps 1 and 2 of the journey can only be triggered by curl or chat.
- D4. `ai_actions` is never written (only schema.sql mentions it). The "AI output = suggestion with applied_by" decision is not implemented; item_key_suggestion is written straight into document_lines.item_key (pipeline.py:172). Safe in practice because promote blocks needs_review lines (functions.sql:15-18) and the owner accepts, but there is no record of "AI proposed X, human confirmed Y".
- D5. No quote PDF is produced (reportlab is in requirements.txt, never imported). send_quote sends plain text (pipeline.py:249-253). Scope step 5 says "quote PDF sent in chat".
- D6. Contract /api/me logo_url: tenants has no column; env var fallback (routes.py:81-83). Contract met, model not. Known.
- D7. `followups` rows are queued (scheduler.py:17-23) but nothing drafts or sends them; state never leaves 'pending'.
- D8. Staff leak: `messages.body` for 'in' docs is the raw pasted supplier text (pipeline.py:178) and `/documents/{id}` returns it to staff (routes.py:104-106) in any status, including after in_cost_book. Supplier prices reach staff via messages even though lines and total are hidden. Fix: skip messages of direction-in documents for staff (one WHERE at routes.py:104).
- D9. Staff cannot move a doc `parsed -> reviewed` when OCR/LLM missed issued_on: `in_has_issue_date` (schema.sql:99) rejects it, no endpoint edits header fields, and the 409 carries a raw constraint name. Likely on poor OCR.
- D10. Doc numbering is `count(*)+1` (pipeline.py:214-216) but UNIQUE includes party_id (schema.sql:100), so two customers can receive the same QT number and the DB will not catch it.
- D11. handle_enquiry's cost lookup keys on item_key only, ignoring uom (pipeline.py:198-201), and excludes expired cost items (pipeline.py:200) while v_stale_alerts/v_quote_provenance "current" ignores valid_until (views.sql:20,49). An expired supplier quote gives MissingCost when pricing but still shows as current elsewhere; a supplier "roll" vs template "m" prices silently wrong.
- D12. "Current cost" = newest effective_date across all suppliers (functions.sql:28-34), not per supplier or cheapest. A newer quote from a different supplier supersedes the preferred one. Acceptable for demo; state it.

## 2. Builder-reported issues, ranked by demo risk (smallest fix)

1. Seed keys vs template (HIGH). Template: pla_1kg_black, plywood_12mm_sheet, screw_m4, packaging_box; recipes print_part_small, plywood_shelf, design_service (config/templates/made_to_order.yaml:6-30). Seed uses acrylic_3mm_sheet, vinyl_roll, pla_1kg, signboard_60x30 (db/seed_made_to_order.sql:21-29,42). A seeded DB can price only design_service (others raise MissingCost, pipeline.py:206), and the headline acrylic stale-cost story is a seed-only quote no recipe can reproduce. Fix: add acrylic_3mm_sheet (sheet) and vinyl_roll (m) to item_catalog and a `signboard_60x30` recipe (bom 0.25 acrylic + 0.5 vinyl, markup_pct ~107 to land near RM60) in the YAML; rename `pla_1kg` to `pla_1kg_black` in the seed. YAML plus one seed line, no code.
2. Webhook routing: unknown senders and no staff path (HIGH for step 1 via chat). An unknown sender is auto-created as a customer (webhooks.py:36-38) and an image/doc from them hits 415 (webhooks.py:55). A supplier is recognised only if `parties.contact` digits equal the sender (webhooks.py:31-33), no API creates or edits parties, and the seed contacts are fake `+60-000-...`. So "staff sends supplier photo in chat" does not work without SQL. Any number can also trigger ILMU calls and create draft quotes (spam/cost). Fix: in `_handle`, first match `users.channel_handle` (staff) and route their media/text to ingest_supplier_document; for unknown senders accept text only. Demo workaround: curl or a web upload button against /api/documents/ingest.
3. Margin mismatch (MED-HIGH, visible on screen). Pricing margin and guard include labour/machine hours (pricing.py:59-65,79); line_cost_basis cannot hold them (cost_item_id NOT NULL; pipeline.py:232-234 skips them), so v_quote_margin and the UI line_margin are materials-only (views.sql:3-4). The owner sees a higher margin than the guard used. Fix: add `document_lines.other_cost_per_unit numeric(14,4) not null default 0` via `alter table ... add column if not exists` in views.sql (re-runs on every start), fill it in handle_enquiry from the cid-is-None basis rows, and subtract `ql.qty*ql.other_cost_per_unit` in v_quote_margin.
4. v_quote_bom over-count (MED, only if shown). schema.sql:249-266 yields one row per basis row repeating the line total, and mixes conventions (line_cost treats qty_consumed as a total, line_margin multiplies by qty). No Python uses it, but the scope review says to lead the demo with it. Fix: drop it from schema.sql and show v_quote_provenance/v_quote_margin instead.
5. qty_consumed per unit vs totals (LOW). Code is internally consistent (pipeline.py:234 stores per unit; routes.py:301 and views multiply by qty). Only the schema.sql:158 comment and v_quote_bom disagree. Fix: change the comment to "per unit of the sold line".
6. tenants lacks logo_url (LOW). Env fallback works. When needed: `alter table tenants add column if not exists logo_url text` in views.sql and select it in /me.
7. Webhook multi-tenant routing uses first tenant (LOW for hackathon, blocker for a 2-tenant pilot). Fix: map WhatsApp metadata.phone_number_id / Telegram bot to tenant with one column on tenants.
8. promote_document under owner role (NOT a defect). The function has no role check of its own, but its final UPDATE trips the guard (functions.sql:32 -> transitions.sql:36-38), which aborts the whole call; guarded() maps it to 403 (deps.py:112-115). The honest statement: the role is a per-transaction GUC set by the app (db.py:20), so the DB trusts the app; do not claim RLS.

## 3. Coupling and failure modes

- Network calls inside DB transactions: yes. `db.tx` is held open for the whole request (deps.py:86-96). ILMU (up to 2 x 60 s, ilmu.py:18,63), OCR, media download and the customer send all run with a connection open. In /transition the status is already updated and the row locked FOR UPDATE (routes.py:122,136) while send_quote makes a WhatsApp call (routes.py:142, 20 s timeout). Effects: a connection held for tens of seconds under slow ILMU, and a lock on the quote during send. Cheap fix: run the send after the commit (BackgroundTask opening its own tx for the message row).
- Send failure is silent. `sent` is committed even if the channel rejects the message (routes.py:143-144 only logs), and send_quote returns False silently for channel web/upload (pipeline.py:245). The owner sees "sent", the customer got nothing. Fix: return a `delivered` flag in the transition response and show it; store a failed message row.
- WhatsApp 24 h window: only send_text is used; send_template (whatsapp.py:89) is dead code. If the owner approves more than 24 h after the customer's last message, Meta rejects the free-form text and the failure is silent (above). Fix: on a 4xx, retry once with an approved template; until then surface the failure.
- ILMU down: handled well. Errors map to 502 and create no half-built docs (pipeline.py:38-42); webhook replies SORRY. Ceiling: no retry or queue, the inbound message is dropped (webhook returns 200). Acceptable for the demo; for a pilot store the raw inbound first and process async.
- OCR poor: handled by design (needs_review, OCR_MIN, arithmetic and subtotal checks, validate.py:73-97). Gaps: D9; Tesseract is eng only (ocr.py:36) so BM/Manglish photos degrade; the Paddle path falls back silently on any exception (ocr.py:49-52).
- Webhook idempotency: partial. Dedupe is a SELECT on messages(channel, external_id) (webhooks.py:24) with no unique index (schema.sql:182-190), so two concurrent deliveries both pass and create two quotes. Rejected messages leave no row, so a retry re-runs ILMU and re-sends SORRY. Fix: `create unique index on messages(channel, external_id) where external_id is not null` and treat the violation as duplicate.
- Ordering: the read/delivered status can arrive before the quote tx commits (the wamid message row is inserted inside the still-open /transition tx, routes.py:142), so the status UPDATE matches 0 rows and `read` is lost (webhooks.py:65-68). Fixed by send-after-commit.
- Scheduler single process: APScheduler in-process with one uvicorn worker (run.sh last line); work is idempotent (status-filtered UPDATE, NOT EXISTS on followups, scheduler.py:12-23), so a duplicate run is harmless and downtime only delays expiry. A Reserved VM restart loses nothing because state is in Postgres. Single VM is a single point of failure, accepted for the hackathon. Note `pip install` runs on every start (run.sh), slowing restarts.
- Auth is simulated (X-Role / X-User, deps.py:74-96): any caller can claim owner. Declared in the contract; do not present it as security. Webhooks do fail closed (webhooks.py:99-100,112-113).

## 4. Scalability (pilot vs hackathon, brief)
- New psycopg connection per request, no pool (db.py:19). Fine for tens of users; add a pool before a pilot.
- Tracker loads all documents with correlated subqueries per row including max(audit_log.at) (routes.py:28-38), no pagination, no audit_log(entity_id) index. Fine for hundreds of docs.
- Sync ILMU/OCR in request threads: the threadpool saturates with a few slow ILMU calls. A pilot needs a job queue.
- Tenant_id is modelled and routes scope by it, but webhooks and numbering are not tenant-safe. A single-tenant pilot is fine.
- Source files are never stored (source_object_key unset): no evidence photo and no re-OCR.

## 5. Cut or simplify (least code that still demos the five-step journey)
Keep: schema, transitions, audit, promote, pricing, validate, scrub, tracker, stale alert, staff vs owner views.
Cut or leave unfinished without regret: one live channel only (WhatsApp if the Meta test number works, else Telegram; the other stays an adapter slide); send_template, transcribe_runpod, the F&B template demo, field-proposal UI, po.csv, followups queue (nothing consumes it), v_quote_bom, STL grams. Do not add PDF generation, ai_actions logging or pooling before the demo.

## Prioritised fix list

P0 (blocks the demo)
1. Frontend X-User: call `/api/me` without X-User first (reads default to the first user of the role, deps.py:89-91), then send the returned `id`; or read uuids from VITE env. (web/src/api.ts:64,84)
2. Serve the UI: in src/app.py after the routers, `app.mount("/", StaticFiles(directory="web/dist", html=True))` guarded by `Path("web/dist").exists()`.
3. Seed vs template: add acrylic/vinyl items and the signboard recipe to made_to_order.yaml; rename seed `pla_1kg` to `pla_1kg_black`.
4. A way to start steps 1 and 2: upload-supplier-quote and simulate-enquiry buttons calling the existing endpoints (or curl lines in docs/demo-script.md), and route staff channel_handle senders to supplier ingest.

P1 (should fix)
5. Header edit for issued_on/valid_until/doc_no (or default issued_on to today and flag it) so poor OCR cannot dead-end at reviewed.
6. Hide direction-in messages from staff (routes.py:104).
7. Send the quote after commit; return a delivered flag; record failed sends.
8. Unique index on messages(channel, external_id) where external_id is not null.
9. Margin consistency: other_cost_per_unit plus v_quote_margin change; drop v_quote_bom.
10. Quote numbering from a sequence instead of count(*)+1.
11. Cost lookup on (item_key, uom) and one valid_until rule shared by pipeline.py:200 and the views.

P2 (later)
12. tenants.logo_url; tenant routing by phone_number_id; connection pool; tracker pagination and audit index.
13. ai_actions logging with applied_by; quote PDF; WhatsApp template fallback; async inbound queue; object storage for source files; real auth.
