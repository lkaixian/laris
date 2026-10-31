# Decisions and roadmap (UX upgrade slice)

## Built
- Brand-green dark theme (`#00563f`), token pairs tested for WCAG AA; Light, Dark, Match my device.
- Trade Orbit (Customer, Business, Supplier): keyboard-focusable nodes, panels with real numbers from `/chain`, lane click opens Deals, still picture under reduced motion, pauses when off screen or tab hidden. Landing page runs it as a six-step, twelve-second story with a pause button.
- Supplier side of a deal: quote comparison (2 to 4 quotes, ranked by price then speed, with the reason in words), deal profit ring with below-target and loss warnings, a simplified orders/goods/bills match, and "draft purchase order from the best quote" which links the supplier PO to the customer order (`serves`). Drafts only; the owner approves before it is sent.
- "Needs you" strip on Home (max three one-tap items).

## Decisions
- The comparison and margin are stateless rules (`src/buyside.py`). The AI never picks a supplier or sets a price.
- Supplier documents reuse the existing `spo` document; goods received is derived from its status (partially received / received).
- Animation uses CSS `offset-path`, not an animation library, to stay far under the 150 KB budget.
- Chips show a dot or icon and a word, never colour alone.

## Roadmap (labelled in the UI where it shows)
- Saving RFQ, supplier quote, goods received note, supplier invoice and payment records as their own documents (the state machines are in `src/buyside.py` and tested, persistence is not built).
- Customer and supplier share-link portals; reliability scores; Cash Flow Sankey, stock jars, heatmap calendar, leakage radar, swipe approval cards, command palette, bottom navigation, sector illustration set, confetti, paper-fold animation, bilingual PDF, pseudo-locale, QA screenshot archive in CI.
- Native-speaker review of every translation (see TRANSLATION_REVIEW.md).
