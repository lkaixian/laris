# UX refactor of the web app (web/src)

Behaviour, API calls, mock contracts, permission gating and every existing `#/...` URL are unchanged. Only structure, navigation and feedback changed.

## Problems seen in the screenshots (before)

1. A flat 12-item top tab bar with no grouping. At 390px it wraps to three rows.
2. Header chrome ate the screen: logo row, search row and tab rows came to about 190px at 1100px and about 280px at 390px before any content.
3. A "Search" button duplicated the Enter key of the search box.
4. Page titles were written ad hoc on every page. The primary action had no fixed place (Add contact sat in a row of six controls).
5. Detail pages (document, contact) had only a small "Back to ..." link. After Back the list lost its filter and scroll position.
6. Lists showed a bare "Loading..." line, and empty lists were one grey sentence with no next step.
7. One-line confirmations ("Settings saved.") were inline status text that could sit off screen.
8. Home counters did not lead to the list they count (Documents to review opened the whole tracker). No first-run guidance, no quick actions.
9. Wide tables at 390px had a thin scrollbar and no hint. The Ask suppliers replies list made the whole page scroll sideways (measured, 1100px and 390px).
10. Jargon was unexplained (item key, MOQ, margin floor). The Ask form numbering skipped step 2 until a photo was chosen. Several primary buttons competed in one view.

## What changed

- **Shell** (`Shell.tsx`): grouped sidebar on desktop (Work, Suppliers, Insights, Admin), collapsible to icons (remembered in `localStorage`, try/catch). Below `md`: top bar plus slide-over drawer (focus moves in, Tab is trapped, Escape/scrim/close button close it and return focus to the menu button, closes on route change, page behind is `inert` and scroll-locked). Header: org mark, one search box (`/` still focuses it, no duplicate button), icon theme toggle, role picker (only when not signed in with an account, as before), user menu (Account, Sign out). Active item: bold, tinted, left bar and `aria-current="page"`. Groups and items the user cannot open (`canOpen`, `canUpload`) are not shown.
- **PageHeader** on every page: one h1 (focus target), description, meta, primary action slot, Back link for detail pages, and `<title>` follows the page. Detail pages show a skeleton and no h1 until loaded (so focus logic is unchanged).
- **Fluidity**: skeleton loaders (`aria-busy`, pulse only when motion is allowed), toasts for one-line confirmations (errors stay inline), 150 ms fade/translate on route change (off under `prefers-reduced-motion`), pending text plus `aria-disabled` on action buttons (Settings, Contacts, document actions, Jobs, Follow-ups, Field proposals, Team), Back from a document or contact restores the list scroll position and the tracker filter / contact search.
- **Home as launchpad**: "Get started" checklist (supplier, first quote, organisation details and team member for owners; computed from the dashboard, `/settings` and `/users`; hidden when complete or dismissed, dismissal in `localStorage`), "Needs a person" counters link to filtered lists, quick actions row (Upload quote, Ask suppliers, Catalog photo, New contact; only what the user can do).
- **New in-app links**: `#/tracker/review`, `#/tracker/open`, `#/tracker/upload`, `#/contacts/new`, `#/alerts/followups`.
- **EmptyState** with a next-step button for Tracker lanes, Contacts, Jobs, Catalog photos, Ask replies and suppliers, Home panels.
- **Tables**: `TableRegion` gives a focusable scroll region plus a visible "Scroll sideways" hint while columns are cut off. The Ask replies overflow is fixed.
- **Help text**: item key, MOQ and price breaks, margin floor, SSM/SST, with `aria-describedby` where it is a field. Ask form step numbers removed (they skipped a number).
- Demoted repeated or secondary primaries (manual quote form, stale-cost "Review" links).

## Shared components

| What | Where |
| --- | --- |
| `Shell`, `NAV`, `visibleNav` (sidebar, drawer, header, user menu) | `web/src/Shell.tsx` |
| `PageHeader`, `EmptyState`, `Skeleton`, `TableRegion`, `Hint`, `Async` (uses Skeleton and EmptyState), `OrgCtx` | `web/src/ui.tsx` |
| `ToastProvider`, `useToast()` | `web/src/Toast.tsx` |
| `Icon` (inline SVG, add a path to `P`) | `web/src/icons.tsx` |
| `PAGES` route registry, sign-in `gate`, scroll memory | `web/src/App.tsx` |
| Shell, skeleton, toast, page-in styles | `web/src/theme.css` |

## How to add a nav item or a page

1. Write the view. Start it with `<PageHeader title="..." />`. Use `useToast()` for one-line success messages and `Async`/`EmptyState` for loading and empty states.
2. `App.tsx`: add one entry to `PAGES` (`route: { title, render }`). Detail routes read `arg` (`#/thing/<id>`).
3. `Shell.tsx`: add `{ key: 'route', label, icon }` to a group in `NAV` (`when` for extra rules from `/api/me`). Child routes that should keep a parent highlighted go in `PARENT`.
4. Permission gate: one line in `NEED` in `api.ts` (team, roles, settings are owner-only there already).
5. Login, register, verify and licence screens: add a value to `gate` in `AppShell` (App.tsx) and render it before `<Shell>`; the shell and pages only render once `gate` is `ready`. `ToastProvider` wraps everything, so toasts work on those screens too.

## Could not verify / not done

- Not run against a real backend (only `dev:mock`). `scripts/a11y.mjs` needs a seeded server with accounts, so it was skipped; instead axe-core was run through `scripts/cdp.mjs` on 16 mock pages at 1100px light and 390px dark (see the report for results). Real sign-in, Sign out in the user menu, the idle dialog and IdleGuard were not exercised in a browser.
- Screen reader behaviour (announcement of toasts, drawer) was not tested with a real screen reader.
- `docs/demo-script.md` still says "top menu" and "role selector top right"; the menu is now the left sidebar (drawer on phones). The role picker is still top right on desktop.
- Doc lines and Ask replies tables scroll sideways at 390px (with hint) instead of turning into cards.
- The Jobs board counters on Home link to the whole board, not a single column.
