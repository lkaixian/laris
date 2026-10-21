---
type: review
date: 2026-10-22
reviewer: voltagent-qa-sec:qa-expert (live HTTP drive against PGlite, SEED=1)
status: findings open
---
# QA report

## Suites
pytest 71 passed; `node tests/db_check.mjs` ALL GREEN (RM400 delta); `node tests/schema_check.mjs` SCHEMA OK.

## Live HTTP drive (what passed)
/api/me, tracker (3 received in_cost_book, 1 sent stale), document detail (owner provenance, staff none), stale alert acrylic 100 to 140 delta -400, staff 403 on alerts, cost-items and both exports, supplier ingest and enquiry with ILMU down give clean 502 and create nothing, fake-ILMU path ingests to parsed/needs_review, duplicate supplier doc 409, staff accepted 403 and owner accepted 200, promote blocked while a line lacks item_key, owner approve and send 200 and staff approve 403, illegal transitions 409, xlsx and csv exports valid, audit feed `?after=` works, bad `after` gives 422.
Negative cases: bad JSON 422, missing X-User on write 401, bad role 400, 10.5 MB upload 413, garbage image 422, unknown id 404, non-uuid 422, staff out-line price edit 403, WhatsApp bad or missing signature 403, duplicate WhatsApp and Telegram deliveries create one document.

## Bugs
P0 (blocks the demo)
1. web/src/api.ts hardcodes X-User 0000...0001, not a seeded user: every real-mode call returns 401.
2. made_to_order.yaml has no acrylic, vinyl or signboard_60x30; seed keys (pla_1kg, vinyl_roll, acrylic_3mm_sheet) do not match the template, so the acrylic enquiry cannot be priced live. Only the seeded stale view works as scripted.
3. Seed already promotes A-001 and A-002 and sends QT-0001, so demo step 4 (upload SAMPLE-A-002 live) returns 409 duplicate. Seed only A-001 plus the quote, or use new doc numbers.
P1
4. FastAPI does not serve web/dist (GET / is 404).
5. The UI has no supplier upload or manual line entry; no backup if Telegram or WhatsApp fail.
P2
6. README stale (says routes missing), pins py -3.11 (fails here; only 3.14 installed), omits root `npm install` before pytest.
7. docs/deploy.md smoke tests still say /api returns 404.
P3
8. Missing DATABASE_URL gives a plain-text 500, not the error JSON shape.
9. Quote numbers come from count+1 (collision risk).
10. ILMU 502 says "key the lines in manually" but no UI exists for it.

Not run: real venv creation, `npm ci`, Postgres steps and run.sh (no createdb/psql here).
