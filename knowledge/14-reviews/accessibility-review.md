---
type: review
date: 2026-10-22
reviewer: voltagent-qa-sec:accessibility-tester (headless Edge via CDP, mock mode)
status: findings open
---
# Accessibility review (WCAG 2.2 AA)

Method: Vite mock server, headless Edge (Chromium 155) over CDP, screenshots at 360 and 1280 px in light and dark, scripted Tab traversal, computed styles, 320 px reflow, text-spacing injection, contrast computed from tokens. No screen reader and no axe-core were available.

| ID | WCAG | Sev | Evidence | Fix |
|---|---|---|---|---|
| A11Y-01 | 2.4.3, 2.1.1 | High | Focus drops to `<body>` after Approve quote (App.tsx:174-176, button unmounts on reload) and after Save line (key on LineRow remounts, App.tsx:261) | Move focus to a stable target after an action; key LineRow on `l.id` only |
| A11Y-02 | 1.3.2, 2.4.3 | Med | At 1024px+ the Decision/Provenance aside is visually right but first in DOM and tab order (App.tsx:195,248) | Lines before aside in DOM, position with CSS |
| A11Y-03 | 4.1.3 | Med | 4 s activity poll prepends rows with no live region | One visually hidden polite status announcing "N new events" |
| A11Y-04 | 2.4.3, 4.1.2 | Med | Route changes do not move focus or announce | Focus the h1 or #main on route change |
| A11Y-05 | 1.3.1 | Low | Lines table has no caption; long region label | sr-only caption, short label |
| A11Y-06 | 1.4.11 | Low | `--soft` dividers 1.27:1 light, 1.42:1 dark (decorative) | Use `--line` if dividers must be perceivable |
| A11Y-07 | 2.4.2 | Low | Titles not descriptive (no doc number) | "QT-2026-0007 · LARIS" |
| A11Y-08 | 4.1.3 | Low | Filter result count not announced | Polite status "Showing 3 quotes" |
| A11Y-09 | 4.1.3 | Low | Alerts count role=status mounted with its content | Keep an empty status region mounted, fill after load |
| A11Y-10 | 3.3.1 | Low | Per-line save error not tied to its input | aria-invalid and aria-describedby |
| A11Y-11 | 2.1.1 | Low | Lines scroll region is a Tab stop even when it does not scroll | tabIndex only when overflowing |
| A11Y-12 | 4.1.3 | Low | Role switch remounts main with no announcement | Polite "Viewing as Staff/Owner" |
| A11Y-13 | 2.5.8 | Info | Inline provenance links 19 px tall (exempt) | Optional min-h-11 |

## Passes (verified)
Text contrast all pairs 4.5:1 or better in both themes; non-text contrast of inputs and focus ring; 3px focus outline on all controls; skip link; landmarks and headings; form labels; specific button names; theme toggle aria-pressed; table th scope; badges not colour only; logo and org alt text; lang="en"; no interactive element under 44 px; no horizontal overflow at 320 px or with text spacing; no hover-only content; reduced motion respected; no keyboard traps.

## Not verified
Real screen readers (live-region findings are inferred), axe-core scan, browser zoom control, prefers-* emulation, empty and error states (mock has data), staff views beyond Lines and Decision, vertical clipping under text spacing.

Note: DESIGN.md still says the logo file was not supplied; it now is.
