---
source_url:
  - https://niagawan.com/quotation/
retrieved: 2026-10-22
confidence: low
status: REAL DATA needed (only the niagawan validity guidance is sourced; the trade layouts are inference from general industry knowledge, no Malaysian samples fetched)
---
# Trade variants of the quotation

Related: [[anatomy-and-layout]], [[malaysia-conventions]], [[summary]]. Everything below is inference unless tagged (src). Treat as hypotheses to confirm against 3 to 5 real quotes per trade. Maps to the three templates in [[../07-data-model/bidirectional-schema]] (made_to_order, fnb_catering, service_renovation).

| Trade | Line structure | Trade-specific fields | Pricing unit(s) | Schema fit |
|---|---|---|---|---|
| Contractor / renovation | BOQ: numbered sections (A. Preliminaries, B. Hacking, C. Tiling...) with sub-items 1.1, 1.2; section subtotals; provisional sums (PS) and "by owner" / "excluded" items; lump sum (LS) lines | section header rows, item no hierarchy, provisional sum flag, variation order clause, retention %, progress-payment schedule (e.g. 30/30/30/10) | LS, sqft, m, nos, set | needs `parent_line_id` / `section`, `is_provisional`, `is_header` (no price) |
| Printing / signage | Spec lines: size, material, finishing, sides, colour; quantity-break table (100 / 500 / 1000) | artwork supplied?, proof approval, size (W x H), material (art card 260gsm, PVC, acrylic), finishing (laminate, eyelet), install | per pcs, per sqft, per set; price tiers | qty breaks = multiple lines or a tier table; missing `spec` jsonb |
| Catering | Per pax / per set / per table menu, or per tray; optional extras | pax count, event date and venue, menu items list, minimum pax, halal note, setup/service/transport charges, deposit 50% typical (inference) | per pax, per set, per table | event date not in schema; minimum qty |
| Tailoring | Per garment/uniform; measurements | style, fabric, size breakdown, fitting dates, embroidery, MOQ | per pcs | size matrix per line |
| 3D printing / fabrication | Material, grams or volume, machine time, post-processing | material, infill, layer height, grams, print hours, MOQ, file (STL) ref | per gram + per hour + setup; per pcs | handled by template recipes (`stl_grams` optional plugin in schema note) |
| Services (hourly/day rate) | Role/service x hours/days | rate basis, minimum hours, travel, overtime, scope and exclusions | per hour, per day, per visit | fits: uom = hour/day |

## Validity guidance by cost basis (src niagawan, paraphrase)
- Stock held: about 30 days.
- Imported or priced off a supplier quote that itself expires: 7 to 14 days.
- Labour-only services: 30 to 60 days.
This suggests `valid_until` of an `out` quote should not exceed the earliest `valid_until` of its `cost_items` (inference, nice rule for LARIS).

## Open questions needing real samples
- How often do SMEs quote tiers (qty breaks) versus separate lines?
- Do real renovation quotes use LS lines without qty? Current `qty > 0` check is fine (qty = 1, uom = LS).
- Are headers/section rows common enough to need non-priced lines?
