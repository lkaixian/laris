---
type: data-model
retrieved: 2026-10-22
updated: 2026-10-22
status: proposed
---
# State machines

One `doc_status` enum, one `doc_transitions` table keyed by `(direction, from, to)`. Schema: [[bidirectional-schema]].

## Shared (both directions)
| State | Meaning | Terminal |
|---|---|---|
| expired | `valid_until` passed with no decision (scheduler sets, actor `system:scheduler`) | yes (re-open = new doc with `parent_id`) |
| rejected | in: owner refuses supplier quote. out: customer declines | yes |
| cancelled | owner withdraws | yes |
| superseded | a newer revision/re-quote exists (`parent_id`) | yes |
| accepted | in: owner takes the price. out: customer says yes | no |

Shared mechanics: every transition writes `audit_log`; every non-terminal doc may get a `followups` row (out: chase customer at 48h; in: chase supplier for missing validity date). Same tracker board, filter by direction.

## Supplier quote / receipt (direction = in), actor in brackets
```
received [staff|system] -> parsed [system: OCR/STT + LLM parse_receipt_lines]
parsed -> reviewed [owner|staff: lines mapped to item_key, low-confidence lines fixed]
reviewed -> accepted [owner]            -- price is now valid to use
accepted -> in_cost_book [system: promote_document()]   -- cost_items created, effective_date = issued_on
received|parsed|reviewed -> rejected [owner]
accepted|reviewed -> expired [scheduler]   (valid_until passed before use; if already in_cost_book, cost_items.valid_until handles it, doc stays in_cost_book)
accepted -> superseded [system: newer quote same supplier+items]
```
Notes:
- Receipts (already paid, no validity) skip `accepted` semantics: allowed shortcut `reviewed -> in_cost_book` with `needs_role=owner`. Keep it one extra row in `doc_transitions`, not a new machine.
- Staff may do received and reviewed (they upload and fix OCR) but never see prices of other docs; owner is the only one who can accept. Decision: for the demo, owner does review+accept in one tap screen.
- `in_cost_book` is the success terminal for the in-direction.

## Customer quote (direction = out)
```
draft [system: rules engine prices from cost_items; AI only extracted the items]
draft -> approved [owner ONLY; margin guard must pass or owner gives override reason]
approved -> sent [system via Telegram/WA after owner taps send; can be same tap]
sent -> read [webhook: read receipt]        -- optional state; sent -> accepted allowed directly
sent|read -> accepted [customer reply, confirmed by owner (human confirms intent, AI only suggests)]
sent|read -> rejected [customer/owner]
sent|read -> expired [scheduler at valid_until]
accepted -> job_created [system: INSERT jobs]   -- terminal success
draft|approved -> cancelled [owner]
sent|read -> superseded [owner revises price: new draft with parent_id]
```
Guards:
- `draft -> approved`: `approved_by` role owner; CHECK `out_sent_needs_approval` makes `sent` impossible without it.
- Editing any line of an `approved`+ doc is forbidden: revise = new doc, old one `superseded`. Keeps the audit trail honest.
- Cost-staleness trigger: if a newer `cost_items` row lands for an item used in a doc in `draft|approved|sent|read`, flag (not auto-change) via `v_quote_bom.cost_is_stale`, and create an owner alert. Never auto-reprice.
- The 24h WhatsApp window affects `sent -> follow-up`, not the state machine: followup `reason` records whether template message required.

## Cross-direction link (the point of bidirectionality)
```
in: accepted -> in_cost_book   ==creates==>  cost_items
cost_items  ==priced==>        out: draft lines (line_cost_basis)
cost_items newer than basis    ==alerts==>   out docs not yet accepted
out: accepted -> job_created                  (BOM -> optional purchase list = future, cut)
```

## Transition seed (insert into doc_transitions)
| dir | from | to | role |
|---|---|---|---|
| in | received | parsed | staff |
| in | parsed | reviewed | staff |
| in | reviewed | accepted | owner |
| in | accepted | in_cost_book | owner |
| in | reviewed | in_cost_book | owner (receipts) |
| in | received/parsed/reviewed | rejected | owner |
| in | accepted | superseded / expired | owner (scheduler runs as owner-delegated) |
| out | draft | approved | owner |
| out | approved | sent | owner |
| out | sent | read | staff (webhook runs as system, mapped to staff) |
| out | sent/read | accepted / rejected / expired / superseded | owner |
| out | accepted | job_created | owner |
| out | draft/approved | cancelled | owner |

Build rule: if time is short, ship out-direction with all states, in-direction with `received -> reviewed -> in_cost_book` only (3 states). Expired/superseded for in-direction are demo-invisible.
