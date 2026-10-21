---
type: plan
date: 2026-10-22
status: in progress (update the Done column as fixes land)
sources: [[security-audit]], [[architecture-review]], [[code-review]], [[accessibility-review]], [[qa-report]]
---
# Consolidated fix list (de-duplicated across the five reviews)

Order: P0 blocks the demo, P1 data correctness and security, P2 polish. Each fix = one small commit plus a BUILD_LOG line.

## P0 demo blockers
| # | Fix | From | Owner |
|---|---|---|---|
| 1 | Frontend resolves user id from `/api/me` (no hardcoded X-User); seeded users get fixed UUIDs | QA1, ARCH P0-1, SEC F1, CODE H3 | web + db seed |
| 2 | Serve `web/dist` from FastAPI (guarded StaticFiles mount at the end) | QA4, ARCH P0-2 | src/app.py |
| 3 | Template items and recipes match the seed: add acrylic_3mm_sheet, vinyl_roll, signboard_60x30 (and align pla key) | QA2, ARCH P0-3 | config + seed |
| 4 | Seed only A-001 and QT-0001 (or fresh doc numbers) so SAMPLE-A-002 uploads live and triggers the stale flag | QA3 | seed |
| 5 | UI controls: upload supplier document, simulate enquiry (backup when channels fail) | QA5, ARCH P0-4 | web |
| 6 | Webhook routing: staff and supplier senders via `users.channel_handle` / party; unknown sender not auto-trusted | ARCH P0-4, SEC A4/A5 | src/api/webhooks.py |
| 7 | Mock data matches the demo script (acrylic signboards, RM2,400, RM100 to RM140) | QA mock | web/src/mock.ts |

## P1 correctness and security
| # | Fix | From |
|---|---|---|
| 8 | Margin includes labour and machine cost: `other_cost_per_unit` on lines, used by v_quote_margin and provenance | CODE H1, ARCH P1 |
| 9 | Fuzzy item match never auto-accepted: always `needs_review` with a suggestion | CODE H4 |
| 10 | Stale alerts only for real margin loss (drop abs), exclude drafts; UI provenance multiplies by qty_consumed | CODE M2, M3 |
| 11 | Shared demo bearer token; remove default-user fallback; owner endpoints need identity | SEC A1, CODE H2 |
| 12 | Staff: hide `messages` bodies on in docs, `tax_total`, attrs_unmapped | SEC A2, A3 |
| 13 | Customer quote totals use the pricing engine rounding (half-up per line) | CODE M4 |
| 14 | Header edit for issued_on (or default to today) so docs do not dead-end at parsed | CODE M5, ARCH |
| 15 | Bounds on qty and attrs in handle_enquiry; validate_extraction tolerates bad lines | CODE M6, M7, SEC P2 |
| 16 | Malaysia time (Asia/Kuala_Lumpur) for dates and expiry | CODE M8 |
| 17 | Quote number from a per-tenant sequence; unique (tenant, direction, doc_no) | CODE M1, ARCH |
| 18 | Send quote after commit; surface delivery failure; unique index on messages(channel, external_id) | ARCH P1, CODE M10, M12, SEC W2 |
| 19 | Telegram token out of logs; bytes in compare_digest; body size cap; upload Content-Length cap; OCR pixel and timeout caps; pin or upgrade pypdf | SEC W1 W3 W4 U1 U2 DEP1 |
| 20 | UI/API alignment: line edit allowed statuses, ocr_confidence type, proxy port 5000 | CODE M13, L6 |

## P2 accessibility and docs
| # | Fix | From |
|---|---|---|
| 21 | Focus management after actions and on route change; LineRow keyed on id | A11Y-01, 04 |
| 22 | DOM order Lines before aside; live regions for activity, filter, alerts, role | A11Y-02, 03, 08, 09, 12 |
| 23 | Titles with doc number, table caption, aria-invalid on save error | A11Y-05, 07, 10 |
| 24 | README refresh (routes exist, python 3.11+ not pinned to py -3.11, root npm install), deploy.md smoke tests, DESIGN.md logo note, .env.example cleanup and new vars | QA6, 7, SEC C2 |
| 25 | Drop dead code: stale_check use or removal, v_quote_bom, discount_guard wiring or removal | CODE L1, ARCH |

## Deferred (documented, not fixed)
Real auth and RLS, per-tenant webhook mapping, retention/erasure, redaction before LLM, DPO and breach runbook, pooling and pagination, quote PDF, ai_actions logging, WhatsApp template fallback.
