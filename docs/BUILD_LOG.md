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
| 15 | Frontend restyled per DESIGN.md: green/white, light and dark toggle, LARIS logo plus org slot; contrast measured by script (all pairs pass); viewed in headless Edge, not clicked through | npm run build passes | e68aa4a |
| 16 | PRD, Tech & Tools Declaration, demo script, pitch outline (38 REAL DATA placeholders to fill; no em dashes, checked by grep) | docs/ | 9c06b2c |
| 17 | Fixed .gitignore bug that excluded web/package.json (would have broken npm ci on Replit) | git ls-files web shows package files | 7864bc2 |
| 18 | Replit Reserved VM config, run.sh, deploy guide, real README (nothing run on Replit yet) | bash syntax check only | c1db12e |
| 19 | FastAPI layer: all contract endpoints, staff scrubbing, ingest and enquiry pipelines, webhooks (fail closed), scheduler, v_quote_margin and stale view; stale alert margin_delta -400 | pytest 71 passed (PGlite socket); nothing run against real ILMU, WhatsApp, Telegram or Postgres | df16d60 |
| 20 | Security audit: 24 findings recorded (1 High for real use, 10 Medium, rest Low/Info); git history scanned for key patterns, 0 matches | knowledge/14-reviews/security-audit.md | 45e0192 |
| 21 | Architecture review: 4 P0 demo blockers (UI user id, no static serving, seed/template key mismatch, no upload/enquiry control and routing), P1 list | knowledge/14-reviews/architecture-review.md | c7b0301 |
| 22 | Code review: 4 High, 13 Medium, 8 Low; most reproduced against PGlite; pytest 71 pass | knowledge/14-reviews/code-review.md | 4f5b7a3 |
| 23 | Accessibility review in headless Edge: contrast and reflow pass; focus lost after actions (High), tab order, live regions (Medium) | knowledge/14-reviews/accessibility-review.md | 4705bb4 |
| 24 | QA end-to-end run: suites green; API drive passes; demo path blocked by 3 P0 issues | knowledge/14-reviews/qa-report.md | d176c26 |
| 25 | Consolidated, de-duplicated fix list (7 P0, 13 P1, 5 P2) from all five reviews | knowledge/14-reviews/fix-list.md | d176c26 |
| 26 | Fix list items: .env.example cleaned and new vars documented (Telegram secret, CORS, org logo, scheduler); DESIGN.md logo note updated | fix-list 24 (partial) | d12c698 |
| 27 | Fix list items 2,3,4,6,8,9,10 (backend): signboard recipe and seed match, only RM100 quote seeded so RM140 uploads live, SPA static serving, staff/supplier webhook routing with rate limit, margin includes machine and labour, fuzzy item matches always need review, stale alerts only for cost increases | pytest 78 passed, db_check ALL GREEN, schema_check OK | 27cab45 |
| 28 | Fix list items 1,5,7,20,21,22,23 (frontend): user id from /api/me, upload supplier quote and simulate enquiry controls, mock matches demo script (RM2,400 quote, RM100 to RM140, RM400 delta), focus and live-region fixes; checked in mock mode with headless Edge, not against the real API, no real key events | npm run build passes | 380e412 |
