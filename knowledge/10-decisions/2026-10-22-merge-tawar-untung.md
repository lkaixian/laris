---
type: decision
date: 2026-10-22
status: accepted
---
# Merge TAWAR + UNTUNG into bidirectional LARIS

- TAWAR (customer quote OUT) and UNTUNG (supplier receipt IN, cost recalculation) share one object: a quotation/document with `direction`.
- Supplier quotes feed the cost book; customer quotes cite the cost line and date that priced them.
- General SME, not only 3D printing: trade templates are config. Which templates lead depends on [[../02-market/made-to-order-share]].
- UNTUNG kept only as cost book + price-trend flag; recipe costing becomes a BOM template.
- Why: single journey (hackathon rule), strongest explainability story, avoids chatbot look.
