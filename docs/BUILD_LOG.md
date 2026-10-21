# LARIS build log

One line per completed step: date, what, evidence, commit. Newest at the bottom. Each step is committed and pushed right after it is logged.

## 2026-10-22
| # | Step | Evidence | Commit |
|---|---|---|---|
| 1 | Vault skeleton, research (market, regulation, competitors), architecture review | knowledge/ notes with sources | 0137887 |
| 2 | Owner decisions: WhatsApp required, ILMU first, LoRA dropped | knowledge/10-decisions | 231d5f6, f26c49b |
| 3 | FastAPI skeleton with /health | pytest 1 passed | 897614b |
| 4 | Postgres schema from design note | loads on PGlite | 5b55299 |
| 5 | Research: extraction approaches, quote value and dynamic fields | knowledge/12, 13 | d72c92c |
| 6 | Research: quotation anatomy, names, Malaysia conventions | knowledge/11 | c5f0e64 |
| 7 | Schema extended: attrs registry, SST, terms, extraction column, nullable qty | tests/schema_check.mjs | b090ae3 |
| 8 | API contract v0 | docs/api-contract.md | 61e4dcc |
| 9 | DB guard, audit trigger, promote_document, stale-cost seed | node tests/db_check.mjs ALL GREEN (RM400 delta) | 0a5ac41 |
| 10 | WhatsApp, Telegram, ILMU, OCR clients (mocked, unverified live) | pytest 21 passed | 65fff2c |
| 11 | Pricing engine, margin guard, extraction validator, templates | pytest 41 passed | 029a714 |
| 12 | React frontend draft, mock mode | npm run build passes, not viewed in browser | 7ef1fef |
| 13 | DESIGN.md direction, contract: org branding, item_key, line_id | docs updated | f69e92a |
| 14 | Synthetic SAMPLE quotation documents, enquiry texts, expected JSON; OCR overlap 0.98 clean, 0.88 degraded (Tesseract eng, hand-measured) | pytest tests/test_samples.py 15 passed | fad8cd4 |
| 15 | Frontend restyled per DESIGN.md: green/white, light and dark toggle, LARIS logo plus org slot; contrast measured by script (all pairs pass); viewed in headless Edge, not clicked through | npm run build passes | 3762679 |
| 16 | PRD, Tech & Tools Declaration, demo script, pitch outline (38 REAL DATA placeholders to fill; no em dashes, checked by grep) | docs/ | 3a01fc5 |
| 17 | Fixed .gitignore bug that excluded web/package.json (would have broken npm ci on Replit) | git ls-files web shows package files | 7e415fe |
| 18 | Replit Reserved VM config, run.sh, deploy guide, real README (nothing run on Replit yet) | bash syntax check only | 2783ee6 |
| 19 | FastAPI layer: all contract endpoints, staff scrubbing, ingest and enquiry pipelines, webhooks (fail closed), scheduler, v_quote_margin and stale view; stale alert margin_delta -400 | pytest 71 passed (PGlite socket); nothing run against real ILMU, WhatsApp, Telegram or Postgres | 951e003 |
| 20 | Security audit: 24 findings recorded (1 High for real use, 10 Medium, rest Low/Info); git history scanned for key patterns, 0 matches | knowledge/14-reviews/security-audit.md | 89bdd5e |
| 21 | Architecture review: 4 P0 demo blockers (UI user id, no static serving, seed/template key mismatch, no upload/enquiry control and routing), P1 list | knowledge/14-reviews/architecture-review.md | 4063e1c |
| 22 | Code review: 4 High, 13 Medium, 8 Low; most reproduced against PGlite; pytest 71 pass | knowledge/14-reviews/code-review.md | ec97436 |
