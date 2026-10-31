# Suppliers section

Supplier directory, product price comparison with an explainable recommendation, contracts, a contract timeline, and the In contract / Not in contract split.
All data in the demo is synthetic. The contract record tracks an agreement; it is not a legal document and not legal advice. No real payments.

## Where things are

| Part | File |
|---|---|
| Rules (landed cost, guardrails, ranking, contract state machine, coverage, timeline dates, nudge) | `src/suppliers_engine.py` (pure, no DB) |
| Tables, DB guard on contract states, row-level security | `db/suppliers.sql` |
| Demo data function `seed_supplier_demo(tenant)` | `db/suppliers_seed.sql` |
| API | `src/api/suppliers.py` |
| Screens | `web/src/Suppliers.tsx`, `Contracts.tsx`, `suppliersKit.tsx` |
| Tests | `tests/test_suppliers_engine.py`, `test_suppliers_db.py`, `test_suppliers_api.py` |

Load the demo: owner opens Supplier directory and presses **Load demo suppliers**, or `POST /api/suppliers-demo`.

## Rules in one place

- **Landed cost** = pack price at the quantity tier x packs, minus discount, plus delivery (free over a threshold), plus SST on goods. Optional rounding to 5 sen. An unknown delivery fee is reported as missing; it is never guessed.
- **Guardrails** (an offer is ruled out with a visible reason): blocked supplier, below MOQ, over stock, lead time later than needed-by, quote expired, certification missing, reliability below the minimum.
- **Recommendation** = lowest landed cost among qualified offers. Ties: faster, then more reliable, then name, then id, so the same input always gives the same order. Badges (fastest, most reliable, best value, closest) are alternatives. The best-value weights (price 50, reliability 25, lead time 15, terms 10) only change that badge.
- **No AI ranks or decides.** The "why" text is built from rules in four languages. Nothing is sent by the system.
- **In contract** = an active, expiring or renewal contract covers the product on that date. **Partially covered** when the volume cap is spent or the pack size differs; "starts later" is explained.
- **Contract states**: draft, pending approval, active, expiring soon, renewal, renewed, expired, terminated. Enforced in the API and by a database trigger. Expiring soon and expired also follow the calendar (notice deadline, end date, Malaysia time UTC+8).
- **Approval**: anyone with *Draft supplier contracts* drafts. The owner approves anything. A role with *Approve contracts up to a limit* approves up to `supplier_settings.manager_limit` (default RM 5,000). Nobody but the owner approves their own draft.
- **Off-contract guard**: ordering a contracted product from another supplier needs a reason; an approver's order is recorded at once, anyone else's waits as pending in "Needs you".

## Permissions

Seeing supplier prices and contracts needs *See costs and margins* (owner) or *Draft supplier contracts* (a buyer role). Responses are built without the scrubbed key names, after an explicit check. New permissions: `manage_contracts`, `approve_contracts` (assignable; documented in `src/perms.py`).

## API (all under `/api`)

`GET /suppliers`, `/suppliers/summary`, `/suppliers/{id}`; `PUT /suppliers/{id}/profile`; `GET /products`, `/products/match`, `/products/{id}/compare`, `/products/{id}/rfq-candidates`; `POST /products`, `/products/{id}/recommendation`; `PUT /products/{id}/shortlist/{offer}`; `PUT /offers`; `POST /offers/from-reply/{reply}` (an Ask-suppliers reply becomes an offer); `POST /offers/{id}/to-cost-book` (owner); `GET/POST /contracts`, `/contracts/timeline`, `/contracts/coverage`, `/contracts/{id}`, `/contracts/{id}/transition`, `/contracts/{id}/renewal-pack`, `/contracts/{id}/acknowledge`; `POST /purchases/check`, `/purchases`, `/purchases/{id}/decide`; `GET /purchases/pending`, `/purchases/nudges`; `POST /suppliers-demo`.

## Decisions

1. **Adapted to LARIS, not the v2/Trade Orbit base.** LARIS has no Trade Orbit, no #00563f theme and no PO/GRN chain. The accent stays `#0f5c47` and the calm motion rules in `DESIGN.md` apply: no confetti or parcel animation. Only the price-race reorder, bar draw and today-line sweep, all off under reduced motion.
2. **Suppliers stay in `parties`.** `supplier_profiles` adds state, certifications, payment days, standing and reliability inputs.
3. **Reliability** shown = 70% on-time + 30% price stability (stored inputs, not invented).
4. **RFQ reuse.** "Request quotes" opens the existing Ask suppliers screen (it needs a photo); `rfq-candidates` suggests whom to ask. A reply with a price becomes an offer through `offers/from-reply`.
5. **Cost book link.** The owner can write a chosen offer's per-unit price to the cost book through the existing inbound-quotation path, so quote pricing follows it.
6. **Orders** are recorded as `purchases` (no PO/GRN documents yet).
7. **Demo data** is not seeded at start (existing tests count suppliers); the owner loads it.
8. **Calendar states are computed, not written.** The stored state moves only on human action; the display state follows the dates.

## Roadmap (not built)

PO/GRN/supplier-invoice documents linked to a contract; automatic scheduled reminders (the timeline lists them, nothing is sent); signed-document attachment; supplier profile Documents and Activity tabs (link to Contacts and the Audit log); saved filter presets; map view of suppliers; AI extraction of pasted WhatsApp/PDF offers (the rules-only path works without any key); dual-sourcing beyond the stock-short hint; QA screenshots matrix (2 themes x 4 languages x 3 viewports).

## Translations

All new strings are inline in four languages (English, Bahasa Melayu, Chinese, Tamil). None has been reviewed by a native speaker. The server sentences for the recommendation (`WHY`, `SAVING`, `REL`, `ASK`, `NONE` in `src/api/suppliers.py`) and the glossary terms (contract, in contract, not in contract, expiring soon, renewal, lowest price, recommended, lead time, minimum order quantity, total cost delivered, days left, price review) need review first.

## Demo script (3 minutes)

1. Supplier directory: filter by state and Halal; show the summary strip and "Needs you".
2. Compare prices > Cooking oil 17kg at 85 kg: the cheapest per tin (Johor) is ruled out for MOQ; Penang for lead time when needed-by is 3 days away; KL for an expired quote; Kedah is blocked. Read the "why" card. Change quantity to 170: the winner changes (Perak tier).
3. Switch to Not in contract: Request quotes, Order once.
4. Start a contract from the quote; as a buyer role submit it; as a manager approve it (the buyer cannot approve their own).
5. Contracts timeline: durations, notice deadline, the 20-day expiring contract, the hatched bar, the coverage gaps.
6. As a buyer, order cooking oil from another supplier: the guard asks for a reason; the manager approves in "Needs you".
7. A4 paper contract: market is cheaper, review at the next price review; open the Renewal pack.
8. Switch language to Tamil and dark mode.
