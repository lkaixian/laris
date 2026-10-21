---
date: 2026-10-22
title: Correctness code review (src, db, tests, web)
---

Baseline: `pytest -q` = 71 passed. Repro script: scratchpad `test_repro.py` (ran against PGlite via the test fixtures).
V = reproduced by running. S = suspected from code reading, not run.

## High
- H1 (V) db/views.sql v_quote_margin / v_quote_provenance: margin is materials-only but sell price includes labour/machine hours. Seed-template `print_part_small` x10 at RM32: view says line_cost 40, line_margin 280, margin 87.50%; pricing.py says unit cost 20, true margin 37.5% (RM120). Owner sees inflated margin in provenance.line_margin. Fix: store hour rows in line_cost_basis (needs cost_item rows) or add a stored `line_cost` / labour column on document_lines at pricing time and use it in the view.
- H2 (V) api/deps.py:_open: no authentication. `X-Role: owner` with no X-User returns the first owner and 200 on `/api/cost-items` (all supplier costs). Contract says "simulated", but .replit deploys it publicly. Fix: shared secret / signed token before any deploy.
- H3 (V) web/src/api.ts:USER is hard-coded `0000...0001`; seed users get random uuids. In real (non-mock) mode every request returns 401 unknown_user (`/api/me` verified).
- H4 (V) validate.match_item: fuzzy cutoff 0.8 with no review flag. "M5 screw" -> `screw_m4` score 0.875, uom matches, needs_review False. Wrong item_key enters the cost book after accept. Fix: require score >= ~0.93 or set needs_review when score < 1.0 and token sets differ (numbers/colours must match).

## Medium
- M1 (V) db/schema.sql UNIQUE(tenant_id,direction,party_id,doc_no) and pipeline.py:~196 count-based numbering. The unique key includes party_id, so two customers can get the same QT number (insert of a duplicate doc_no for another party succeeded). Concurrent enquiries (S for the race itself) collide silently. Numbering also counts all years, so it never restarts per year. Fix: sequence per tenant, or unique(tenant_id,direction,doc_no) for direction='out'.
- M2 (V) v_stale_alerts includes cost DROPS (`abs(...)`). margin_delta becomes +10, but App.tsx AlertsView says "Quotes whose cost has risen" and renders "Margin down RM 10" and sums with abs(). Draft quotes are included too. Fix: filter `cur > snapshot` or wording/sign-aware UI.
- M3 (S, simple arithmetic) App.tsx:~190 provenance "margin down" = (snapshot-current)*line.qty, ignoring qty_consumed. 0.05 kg per part x10 parts overstates by 20x. Use the alert's margin_delta or multiply by qty_consumed (add it to the provenance view).
- M4 (V) pipeline.send_quote: total is sum of unrounded qty*unit_price and formatted with Decimal half-even; pricing uses per-line ROUND_HALF_UP. 2 lines of 1.5 x 0.33: customer message says 0.99, pricing subtotal 1.00; `f"{Decimal('0.485'):.2f}"` = 0.48 vs HALF_UP 0.49. SUMMARY.total in routes.py has the same unrounded sum. Fix: round each line with ROUND_HALF_UP then sum.
- M5 (V) Ingest dead end: if the LLM omits issued_on, staff `reviewed` transition fails 409 (check in_has_issue_date), and no endpoint edits issued_on. Doc is stuck. Fix: allow editing issued_on, or default to today at ingest with a flag.
- M6 (V) handle_enquiry has unhandled 500s: qty 1e12 -> NumericValueOutOfRange (qty column numeric(14,3)); `attrs: "red"` -> AttributeError in route_attrs. Via webhooks these are swallowed (no reply, 200 to provider, message lost). Fix: bound qty (<1e10) and require attrs dict in price_quote; map to 422.
- M7 (V) validate_extraction crashes (500) on: line that is a string (AttributeError), `qty: "nan"` (InvalidOperation on comparison), numeric `description` (AttributeError). Fix: coerce/skip non-dict lines, reject non-finite in `_num`, `str()` description/uom.
- M8 (V) validate.py:`date.today()` / pipeline `date.today()` use server tz (Replit = UTC). A quote issued "today" in MYT before 08:00 is flagged `issued_on_in_future` (reproduced with today=previous day). valid_until/expiry (`current_date` in scheduler) lag by 8h. Fix: use Asia/Kuala_Lumpur (zoneinfo) everywhere.
- M9 (V) Margin-guard flagged quotes (needs_review True) can be approved by owner with nothing but a flag; transition has no check for needs_review lines. Probably intended soft-guard, confirm. (approve flagged -> 200)
- M10 (S) Duplicate webhook delivery: dedupe is select-then-insert on messages(channel,external_id) with no unique index. Two concurrent deliveries both pass and create two quotes. Sequential retry is handled (test_whatsapp_routing_dedupe). Fix: partial unique index on (channel,external_id) where direction='in' and insert first.
- M11 (S) Enquiry cost lookup `distinct on (item_key)` ignores uom; supplier quote in "box" vs template "pcs" is used as-is. Validation only flags mismatch against the catalog uom when raw uom is present.
- M12 (S) routes.transition 'sent': the outbound HTTP call runs inside the open transaction while the row lock is held, and failure is only logged (200 returned, owner not told the customer got nothing; web/upload channels return False silently). If the failure was a DB error the transaction is aborted and get_doc then 500s, rolling back "sent" after a message may already have gone out.
- M13 (V) App.tsx edit mode includes status `reviewed`, API REVIEWABLE is received/parsed only: Save returns 409 locked in the UI (S for the UI path, code is explicit).

## Low
- L1 (V) pricing.stale_check TypeError when line_total is 0 (`_pct` None - None). Function is only used by tests; production uses v_stale_alerts, so test_stale_quote_margin_delta passes while testing dead code. Same for discount_guard, stl_grams, OwnerRequired, schema v_quote_bom (buggy, superseded), ilmu.transcribe_runpod, followups rows (written, never read or sent).
- L2 (S) Scheduler followup due_at=now() (not sent_at+hrs), one per quote forever; no unique(document_id) so two processes would double-insert (run.sh forces 1 worker, ok).
- L3 (S) tracker SUMMARY runs per row: correlated `max(audit_log.at)` (no index on audit_log(entity,entity_id)) and `exists(v_stale_alerts)` lateral view. O(docs x audit rows). Fine for a demo, slow later.
- L4 (S) hmac.compare_digest on non-ASCII header (telegram secret, WA signature) raises TypeError -> 500 instead of 403.
- L5 (S) db.apply_schema is not atomic across schema/transitions/functions; a failure after schema.sql leaves a DB that skips the rest on next boot.
- L6 (V, type only) Line.ocr_confidence is declared number in api.ts but API returns string "0.550" (works by JS coercion); `doc.terms` in api.ts never exists in real response (flat payment_terms etc.). vite proxy default :8000 vs run.sh :5000.
- L7 (S) bom.xlsx converts money Decimal to float.
- L8 (S) tax_rate accepted up to 1e10 but column numeric(5,2) -> DataError 500 at ingest.

## Checked, no bug found
Margin delta sign in SQL and stale_check agree (negative = leaked). Line numbering is 1-based consistently (pricing i+1, ingest enumerate). Double click on transition is serialised by `for update` and answered 409. Staff scrubbing verified by test. Rollback on error paths: ApiError/exception inside the FastAPI yield dependency rolls back.
