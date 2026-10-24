# On-track tracker (step 109)

`GET /api/track` lists everything in flight, inbound and outbound, with how long each item has sat in its stage and whether that is too long; `GET /api/documents/{id}/timeline` shows one document's history. Both are read only. Shapes: `docs/api-contract.md`. Gates: `docs/roles.md`.

## Stage age

`status_changed_at` (documents, ask-supplier replies, catalog items) is set when the row is created and moved by a small trigger (`db/track.sql`) whenever `status` changes; other edits leave it alone. For rows that existed before, it was back-filled once from the last `status a->b` audit event of the document, else `created_at` (replies and catalog items: `created_at`). Age is in calendar days in Asia/Kuala_Lumpur (`pipeline.MY`), so a quote moved at 23:00 is one day old at 01:00.

## Overdue rules (`src/track_rules.py`, constants at the top)

"Older than N days" means more than N days. Terminal states are never overdue: accepted, rejected, expired, superseded, cancelled, in_cost_book, job_created, and the catalog end states confirmed and discarded.

| Item | Stage | Overdue when | Reason |
|---|---|---|---|
| Outbound quote | draft, approved | older than 3 days | quote waiting for approval/sending |
| Outbound quote | sent, read | more than the template's `followup_hours` (default 48) since `sent_at` | no reply since sent |
| Outbound quote | any open stage | `valid_until` is within 3 days, or passed | expires soon |
| Supplier document | received, parsed | older than 2 days | waiting for review |
| Supplier document | reviewed | older than 2 days | waiting for owner decision |
| Ask-suppliers reply | waiting | older than 2 days | supplier has not replied |
| Catalog item | needs_review | older than 3 days | catalog item waiting for review |

When more than one fires, the first row that matches wins (expiry is checked first). The follow-up window is the same `followup_hours` the scheduler uses for chase messages.

## List behaviour

Sorted overdue first, then open before finished, then oldest in stage first. Each kind is read with one query of at most 1000 rows, finished rows last in it, so old closed rows never cut off open work. `counts` and `stats` cover the whole business; `stats` (average days per stage over 90 days, from audit status events) needs `view_audit`. `dashboard.track` applies the same rules to the open rows only.
