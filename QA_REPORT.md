# QA_REPORT (3D printing edition, stage 1)

Date: 2026-10-31. Branch `feat/3dp-glass-bento`, nothing committed. **Only stage 1 of the brief is built** (see DECISIONS.md D-10 for the order of work and D-14 for the built-versus-roadmap table). This report covers that stage and says plainly what was not checked.

## Automated checks (run on this machine)

| Check | Result |
|---|---|
| Python suite, whole repo (`pytest`) | **392 passed, 0 failed, 607 skipped.** Skips are the database tests that need Postgres or PGlite; same behaviour as before this work |
| New: STL parsing and measuring (`tests/test_print3d_stl.py`) | 24 passed. Known cube and cylinder volumes and areas, binary and ASCII agree, holes and flipped faces detected, units, caps, bad files |
| New: price engine (`tests/test_print3d_pricing.py`) | 59 passed. Hand-worked cube price, lines always sum to the total, tiers, rush, discounts, margin floor, below-cost, minimum order, SST, 5-sen rounding, finishing, printer choice and turning, operator override, input validation, price-injection refusal, customer view hides cost, resin physics, bad-config failures |
| New: glass contrast (`tests/test_glass_contrast.py`) | 9 passed. Every text pair over every backdrop the moving orbs can create, both themes, plus solid fallback and non-text 3:1 |
| Web layout rules (`npm test`, Node's runner) | 9 passed |
| Web type check and production build | clean, built in about 0.5 s |

The contrast test found two real failures in the brief's starter tokens (error text, nested panels) and they were fixed (DECISIONS D-12). The first draft of one engine test also encoded a wrong number; the engine was right and the test was corrected.

## Checked by hand in the browser (mock mode, built-in browser pane)

- Home in **dark glass** and **light glass** at about 1100 px; hero tile, area tiles, chevrons and bars legible.
- Phone width **375 px**: one column, no sideways scrolling (page width equals screen width), edit toolbar wraps with full-size touch targets.
- **Edit layout:** toolbar on every tile with named controls; content made inert while editing; hidden-tile tray; move earlier/later; arrow keys on the handle; size cycle; hide and show (a shown tile keeps its place and size); presets (Owner, Operator, Accountant, Everything); Reset; Done; live-region announcements ("Needs a person is now 2 of 9"); saved per person and kept across a reload.
- **Real mouse drag** (found a bug and fixed it): after dropping, the dragged tile stayed faded and a drag across several tiles would have stopped after one swap, because React moves the element and a moved element loses pointer capture. Replaced capture with window listeners. Re-tested: a tile dragged from first to fourth place, announced, saved, drag state cleared.
- Staff role gets the Operator preset and no owner-only tiles; the owner's saved custom layout returned intact.
- Settings: System theme follows the device, **Reduce transparency** swaps to the solid surface and removes the blur, **Lite visuals** stops the orb animation and hides the grain; each reverses cleanly.

## NOT checked (be careful before relying on these)

- **The brief's QA matrix** (every route × 2 themes × 4 languages × 3 viewports, screenshots in `/qa/screens/`): not done. Only Home and Settings were viewed, in English, in dark and light, at desktop and phone width. Tablet (768) was not viewed. Other pages inherit the glass skin through the shared colour tokens but were **not looked at**; some page-specific colours may look wrong on glass.
- **Chinese, Malay and Tamil layouts** (text expansion, Tamil line height): not viewed. All new strings are unreviewed machine drafts (TRANSLATION_REVIEW.md).
- **Real devices, Safari and Firefox:** not tested. The skin relies on `backdrop-filter` and CSS `color-mix`; the fallback exists but was only checked by switching the setting, not by an unsupported browser.
- **Performance** (60 fps, LCP under 2.5 s on a mid-range phone): not measured. The design limits the cost (one animated layer, no nested blur, paused in hidden tabs, Lite mode) but no profile was taken.
- **Accessibility tooling:** the repo's axe script (`scripts/a11y.mjs`) was not run on the new Home. Keyboard and screen-reader behaviour was checked by inspecting attributes and announcements, not with a screen reader.
- **Touch dragging:** pointer events are used so it should work, but only mouse dragging was exercised. The earlier/later buttons exist for exactly this reason.
- **No database or API changes were made in this stage**, so there is no new SQL to verify. The price engine and STL analysis are pure functions with no HTTP route yet.

## Known limitations and rough edges

1. **Home is busy.** Upstream already had four area tiles and the earlier number tiles; they overlap (jobs and track appear in both). Presets hide some by default, but the content is not merged. A designer should decide which numbers survive.
2. The glass look has **not been shown to the owner**. D-01 records that it overrides `DESIGN.md`; the decision is flagged for review.
3. The mock-mode warning banner sticks to the top and overlaps scrolled content (existing behaviour).
4. The print-time model is a documented heuristic with an assumed accuracy of about plus or minus 20%. It has **not been compared with a real slicer**. The shipped prices, densities and speeds in `config/print3d.yaml` are invented placeholders.
5. The price engine packs copies on a plate by a simple area rule and does not model stacking, nesting or mixed jobs on one plate.
