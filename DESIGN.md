# LARIS design direction (transcribed from the owner, 2026-10-22)

- **Identity:** a tool that feels built for any Malaysian SME, not one trade. Plain, trustworthy, practical.
- **Palette:** green and white. No other brand colour preference. One green accent family, neutral whites/greys, semantic colours only for warnings and errors.
- **Themes:** light and dark, user-switchable (toggle in the header). Both must fully work and meet WCAG AA.
- **Header branding:** LARIS logo on the left, the company/organization logo beside it (the tenant's own logo, e.g. a divider between the two). If the org has no logo yet, show an initial-based placeholder, never a made-up logo.
- **Logo status:** supplied 2026-10-22 and in `web/public/brand/` (`laris-logo.png` for light, `laris-logo-dark.png` for dark, `laris-mark.png` for favicon). The text wordmark is only the onError fallback. The logo is dark green with a small amber tag, so amber is the single warm accent, never used for text.
- **Dial:** ENERGY 1 / RHYTHM 2 / MOTION 1 (calm and legible; list and detail views may differ in composition; hover and focus states only).
- **Dashboard exception (2026-10-29):** the Home dashboard uses a bento layout with depth (MOTION 2): soft elevation shadows and 14px tile radius, one solid-green hero tile, a staggered entry, numbers that count up, and a small lift on hover. Building blocks live in `web/src/dash.tsx`, styles under "Dashboard" in `theme.css`. All motion stops under prefers-reduced-motion. Other pages stay at MOTION 1.
- **Not wanted:** gradients, glass, glow, decorative grid backgrounds, sparkle/AI iconography, clones of other products.
