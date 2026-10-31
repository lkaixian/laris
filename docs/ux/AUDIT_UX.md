# UX audit (before the upgrade slice)

Stack kept: React 19, Vite, TypeScript, Tailwind v4 layers in `web/src/theme.css`, hash routes, mock mode (`VITE_MOCK=1`). No new runtime libraries were added; the orbit uses SVG and CSS `offset-path` only.

| Area | Finding | Action in this slice |
|---|---|---|
| Positioning | Public page and `<title>` said "quotation tracker". | Kicker, title and a new "whole trade loop" section with the Trade Orbit story. |
| Dark theme | A near-black green, not the brand green. | Rebuilt on `#00563f` with layered surfaces; contrast checked by `tests/test_contrast.py`. |
| Theme choice | Light / Dark only. | Added "Match my device". |
| Languages | English, Malay, Chinese, Tamil already switchable; new strings are written in all four. | Parity is still enforced by `tests/test_strings.py` for `strings.ts`. |
| Motion | Page-level fades only; reduced motion already disabled globally. | Motion tokens added (`--dur-*`, `--ease-*`); orbit animates only transform/offset/opacity, pauses off screen and when hidden. |
| Supplier side | Supplier PO existed; no comparison, margin or link to the order it serves. | `src/buyside.py`, two routes, `serves` link, Supplier side panel on a deal. |
| First screen | Many tiles, no single "what needs me". | "Needs you" strip (max 3) above the orbit on Home. |
| Gaps | See DECISIONS.md "Roadmap". | Marked as Roadmap in the UI where a stamp is not backed by saved data. |
