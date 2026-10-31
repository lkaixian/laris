# DECISIONS (3D printing edition)

Each entry: what was decided, why, and what to review. Newest last.

## D-01 Glass overrides DESIGN.md for the whole app
`DESIGN.md` (owner direction, 2026-10-22) says "Not wanted: gradients, glass, glow". Home already broke that rule on the owner's own request (2026-10-30, `Areas.tsx`; `theme.css` says "departs from DESIGN.md"), and the 3DP brief (2026-10-31) asks for a full-screen glass theme with a mesh-gradient background. The newer, more specific instruction wins. The skin is applied to the whole app, not just Home, because glass on one page and flat cards on the others would look broken. `DESIGN.md` is rewritten to match.
**Safeguards kept from the old rules:** WCAG AA stays mandatory and is now tested by computation; amber stays the single warm accent; a "Reduce transparency" switch and `prefers-reduced-transparency` give a solid fallback; motion respects `prefers-reduced-motion`.
**Review:** confirm the owner accepts dropping "no glass". DESIGN.md is updated to say so.

## D-02 Brand green `#00563f` is the anchor of the dark glass theme
The brief gives `#00563f` as brand green and the repo's accent is `#0f5c47`. Dark glass uses the brief's token set. Light glass derives from the same hue. The existing logo (dark green with an amber tag) stays; on dark glass the existing `laris-logo-dark.png` is used.

## D-03 Server owns the money, TypeScript only displays
STL analysis and the pricing engine are Python with `Decimal` in `src/print3d/`, tested with pytest like `src/pricing.py`. The Instant Quote Studio calls the API as sliders change (debounced) and animates the answer. Rejected: duplicating the maths in TypeScript, which would let the page and the invoice disagree. Cost: a network round trip per change; in mock mode a small fixture stands in.
**Review:** the client still parses the STL to draw it and show the bounding box, but sends only the file (or its hash) for pricing; the server re-analyses it.

## D-04 The job stays the order; no `orders` table
`docs/order-chain-plan.md` already decided that the `jobs` row is the order. The brief's "Order Confirmation / Customer PO (SO)" is implemented as a numbered document (`deal_docs` kind `order`) plus customer PO fields on the job. This keeps one source of truth and the existing accept-link logic.

## D-05 Spec roles are seeded custom roles
See AUDIT_3DP.md section 4. Owner stays the only class that can approve. "Manager" is a custom role whose approvals are limited by value thresholds in settings, enforced server-side.
**Review:** the existing rule "approving needs an owner-class user (the database guard)" conflicts with a Manager approving. Proposed fix: a `approval_limits` setting plus a signed approval row the guard accepts. Not built yet.

## D-06 Document numbering keeps the tenant prefix scheme
Existing: prefix per kind plus a yearly sequence. The brief's `QT-3DP-2026-0001` is the prefix `QT-3DP` (prefix pattern allows up to 8 characters of `A-Z0-9-`). No new numbering code. Receipt prefix defaults to `RC`; the 3DP seed sets `RCP`.

## D-07 No new animation or grid libraries
Reason in AUDIT_3DP.md section 5. If a later review wants spring physics on the bento drag, framer-motion can be added behind the same component API.

## D-08 Printer and material data is config, not code
`config/print3d.yaml` holds materials (density, price per kg, waste), printers (build volume, hourly rate, materials), speed constants and rates. Settings can override per tenant later. Rejected: constants inside the engine. Other sectors stay out of scope as instructed, but the engine reads a config file, so they remain possible.

## D-09 Print-time model
Print hours are a documented heuristic: volumetric flow of the nozzle at a layer-height-dependent speed, plus per-layer overhead, plus infill and support factors. Constants live in config. The UI always says "estimate, about plus or minus 20%" and operators can override the hours (the override is logged).

## D-10 Build order and what lands when
Following the brief's execution order, but each stage must pass its tests before the next begins:
1. Audit, decisions, glass tokens and contrast test, bento shell (this stage).
2. STL parser and pricing engine with unit tests (this stage).
3. Instant Quote Studio (viewer, configurator, API, public page).
4. Document chain: finish DO and Invoice (existing plan steps 3 and 4), add SO, CN, SPO, GRN.
5. Production board, scheduler, QC, stock.
6. Living deal link, dashboard tiles, Leakage Radar, languages and QA matrix, docs.
Anything not yet built is marked "Roadmap" in the UI, never a dead control.

## D-11 Database changes are written but unverified here
This machine has no Postgres, so DB tests are skipped (31 of 74 in the baseline). New SQL follows `db/chain.sql` exactly and is listed in `QA_REPORT.md` as unverified until CI or a local Postgres runs it.

## D-12 Two starter tokens from the brief failed the contrast test and were adjusted
The brief's dark-glass tokens are labelled "verify contrast programmatically". `tests/test_glass_contrast.py` stacks every background orb at peak opacity under each panel and checks every text pair against WCAG AA (4.5:1). Result: error text `#FF8A80` fell to 3.6:1 over the brightest backdrop, and muted text on a nested panel also came close. Changes: dark `--surface` opacity 0.62 to 0.70, error text `#FF8A80` to `#FFABA2`, error wash opacity 0.16 to 0.12. Everything else in the brief's token set passes unchanged (ink `#F2FBF7`, muted `#BFDCD0`, accent `#5CF2B0`, brand `#00563f`, deep `#00281d`). Worst measured ratio after the change is above 5:1.
**Review:** the error colour is a touch pinker than the brief's. It is the least invasive fix that passes.

## D-13 One bento shell for all of Home; layouts are per person and repaired on load
Upstream Home had two separate bentos that could not be rearranged. Both sets of tiles now go through `web/src/Bento.tsx`, with the rules in `web/src/bentoLayout.ts` (pure, tested). Presets (Owner, Operator, Accountant, Everything) choose the visible tiles and their order; a person's own edits are saved on this device under their user id and **repaired against today's tiles on every load** (unknown tiles dropped, bad sizes defaulted, tiles added by an update appended and shown), so an update cannot leave Home blank or silently hide a new tile. Staff default to Operator, owners to Owner.
Rejected: `react-grid-layout` (new dependency, HTML5-style drag that fails on touch). Dragging uses window-level pointer listeners; not pointer capture, because React moves the element on reorder and a moved element loses its capture (found and fixed in testing). Every drag has a keyboard and button equivalent.
**Review:** layouts live in browser storage, so they do not follow a person to another device. Saving them on the server needs a small table and is listed as roadmap.

## D-14 What is built in stage 1 and what is roadmap
Built and tested: STL parser and analyser (binary and ASCII, volume, area, bounding box, holes, unit check, fit and turn); five built-in sample shapes; the price engine (all formulas in the brief, itemised lines that sum exactly, tiers, rush, SST, 5-sen rounding, margin floor and approval reasons, operator override, customer view); `config/print3d.yaml`; the glass skin, contrast proof, reduce-transparency and lite switches; the bento shell with presets.
**Roadmap, not built, and not shown anywhere in the UI as if it worked:** the 3D viewer and Instant Quote Studio screen and its API route; public quote page; sales order, delivery order, invoice, credit note, supplier PO and goods received note (the schema for proforma, payments, receipts and delivery signatures already exists upstream); printer fleet, queue, scheduler, QC, stock and waste; living deal link; Leakage Radar and the other 3DP tiles; seeded 3DP demo data; seeded roles (Manager, Print Operator, Designer, Accountant, Viewer) and their new permissions; e-invoice preparation; PDPA page additions; Simple/Detailed toggle; command palette and "New" menu; guided first run; confetti and other smart-art motion; four-language glossary of the 3DP terms; OpenAPI file and webhooks; end-to-end tests; `DEMO_SCRIPT_3DP.md` and `PITCH_OUTLINE_3DP.md`.
**Review:** the order of the roadmap items matters. The next stage should be the Instant Quote Studio (route, viewer, configurator) because everything else in the brief hangs off a quote that has a 3D model and a price.

## D-15 The Tutorial buttons can be turned off in Settings (per device)
Settings, General, new "Help" section: "Show the Tutorial button", on by default. **One switch controls all of the tutorial help buttons:** the "Tutorial" pill beside page titles (`GuideButton`, `ui.tsx`) and the "?" beside each main-menu item (`NavList`, `Shell.tsx`; both the step-by-step guide buttons and the Help Center article links, which look the same). Off hides all of them at once; on brings them all back. Stored on this device like the other appearance choices (`web/src/helpPrefs.ts`); everything updates at once without a reload and follows a change made in another tab. The guides and articles are not removed, only the buttons that open them.
**Correction (same day):** the first version hid only the page pill and its hint claimed guides stay reachable from "Take the tour". That was wrong: "Take the tour" starts a different feature (`Tour.tsx`), and the owner asked for the menu "?" to go too. With the switch off, the way back to the guides is Settings, Help.
Rejected: removing the button for good, or saving the choice to the account. The first leaves new users without their hint; the second needs a server column for a cosmetic choice.
**Review:** per device, so someone who turns it off on a laptop will see it again on their phone.

## D-16 Merge with upstream's parallel glass work (2026-10-31)
While this branch was open, upstream merged pull request #4 and, separately, its own glass redesign in `theme.css` (new `.glass-pane`, `.glass-lite`, `.glass-dialog`, glass `.card`, `.input`, `.btn`, `.toast`, a new dark palette, Trade Orbit, a "Needs you" strip, a hover tooltip on menu items, and its own Light/Dark/Match-my-device switch). Two glass systems now meet in one tree. Decisions:
- **One source of truth for colour:** `glass.css` keeps owning the tokens (`--surface` and friends), because its contrast is proved by test. Upstream's dark palette values are therefore overridden where they overlap.
- **Compatibility layer:** upstream's rules mix `--surface` with transparency, which assumed an opaque surface and would stack to about 55% under the frosted one. `glass.css` now points each of them at the tested surface (floating things use the firmer `--surface-solid`). `tests/test_glass_contrast.py` counts those rules in `theme.css` and fails if a new one appears without an override.
- **Theme switch:** both sides had added a three-way Light/Dark/System switch. Mine (`skin.ts`: also follows the device live, used by the startup code) is kept; upstream's wording "Match my device" and button width are kept; upstream's `pref()` helper and `data-dark` attribute are removed because they only existed to force a re-render.
- **Home:** upstream's "Needs you" strip and Trade Orbit stay above; my bento replaces their two old bentos. Because "Needs you" now covers what my "Needs a person" tile showed, the three default presets no longer include that tile (it stays in "Everything").
- **Menu:** their hover tooltips and my Tutorial switch both apply to the same menu items.
**Review:** the owner should decide whether Home keeps both "Needs you" and the bento's own numbers, and whether upstream's dark palette or the brief's `#00281d` deep green should win; today the brief's wins.
