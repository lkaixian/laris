# LARIS owner dashboard: UI polish spec

Scope: `web/` (React 19, TS, Tailwind 4 via `@theme`, Vite). Binding direction: `DESIGN.md` (green and white, light and dark both WCAG AA, ENERGY 1 / RHYTHM 2 / MOTION 1, no gradients, glass, glow, grids, sparkle icons; amber is the one warm accent and never text; no new brand colours). No em dashes anywhere. Patterns are borrowed from mature admin tools (Stripe, Shopify, Xero, Linear), never their look.

Method note: no browser or screenshot tool was loaded in this session (only shell and file tools), so no screenshots were taken and no dev server was started. Everything below is judged from code, with file:line evidence. Contrast ratios in section B were computed with a read-only script in the scratchpad (WCAG 2.x relative luminance formula).

---

## A. Diagnosis: 10 biggest prototype tells (ranked)

1. **One 4px radius and one flat `.card` for everything** (`theme.css` `--radius-ui: 4px`, `.card`). Page sections, stat tiles, list rows, toasts, menus and empty states all look identical, so nothing has hierarchy. Product UIs separate page, panel, row, popover and dialog by elevation and radius.
2. **Status is a grey outlined `.badge` for every state** (`ui.tsx` `Status`, `theme.css` `.badge`; `Track.tsx` `<span className="badge">{i.stage_label}</span>`). Draft, sent, accepted and rejected are indistinguishable at a glance. Only "overdue" gets colour. Quote states are also labelled differently in `Track.tsx` `LABELS` vs `label()` in `ui.tsx` (snake_case with underscores stripped), so the same state reads two ways.
3. **Every control is 44px tall on desktop** (`.btn`, `.input`, `.sidelink` all `min-h-11`; `Track.tsx` filter `Seg` buttons are full `.btn`). Touch target sizing is right for phones but on a 1440px screen it makes tables, filter bars and toolbars look chunky and sparse. Dense tools use 32 to 36px on pointer devices.
4. **Filters are a stack of labelled form fields** (`Track.tsx` lines ~212-228: "Kind" segmented buttons, "Stage" select, "Overdue only" checkbox, search, then a second row for View). It reads as a form, not a filter bar. Each toggle is a full bordered button, so five of them in a row is visually louder than the data under them.
5. **Stat tiles are link cards with one big number and no context** (`Home.tsx` `Stat`: `text-3xl`, an arrow icon that fades in on hover, and a `border-l-4 border-l-amber` stripe for warnings). 17 tiles on one page in 5 sections (`Home.tsx` ~lines 112-170), no tile grouping, no delta, no unit alignment. The amber stripe is the only emphasis and it is used on both "needs attention" and informational counts.
6. **Tables are bare** (`theme.css` `th`, `td`, `tbody tr`; `Track.tsx` `ItemTable`). No sticky header, no row hover, no numeric-column right alignment (Total is left aligned, `Track.tsx` Total `<td>`), header text is `text-xs` same weight as body, links in cells are underlined and bold (`Open` uses `.link` which is always underlined), and mobile falls back to a `.card` per row that repeats label text ("in stage", "Total"). Contacts and Jobs tables use the same unstyled base.
7. **Type scale is unmanaged.** `text-2xl` page title, `text-lg` section title, `text-base` body, `text-sm` secondary, `text-xs` table heads, with no named tokens and inconsistent use (`Home.tsx` section h2 is `text-lg font-semibold` directly above `text-3xl` numbers; QuoteDoc uses `text-xl`). Body is 16px, which is large for an admin table and wastes width.
8. **Empty, loading and error states are generic.** `EmptyState` in `ui.tsx` always shows a circle with the same inbox icon (generic illustration slot), `Skeleton` is N identical grey bars (`h-16` / `h-24`) that do not match the real layout, so the page shifts when data lands. Errors are a full-width red `.card` with a bare "Retry loading" button.
9. **Page header has no structure.** `PageHeader` (`ui.tsx`) is title, description and an action slot; "back" is a text link with an arrow, not a breadcrumb. Primary actions on Home are a loose row of `Quick` buttons below the header (`Home.tsx` "Quick actions" group) instead of inside it. Detail pages (QuoteDoc, Contacts) have no status chip or key facts strip next to the title.
10. **No confirmation or undo pattern, and feedback is minimal.** Destructive actions (`Listings.tsx` "Discard product n", `btn-danger`) act immediately; there is no shared `ConfirmDialog`. Toasts (`Toast.tsx`) are correct for a11y but have a fixed 4px left stripe and no undo slot. The mock banner (`Shell.tsx` "SAMPLE data" strip) is a full-width warn-coloured bar that shifts the layout.

Runners-up (not ranked): sidebar group labels are uppercase `text-xs` with letter spacing, adding noise (`.sidegroup`); `Home` GetStarted card has its own progress bar and checklist idiom not reused elsewhere; sidebar "Collapse menu" occupies a full 44px row.

---

## B. Design tokens (edit `web/src/theme.css`)

Rule: add tokens inside the existing `:root` / `:root[data-theme="dark"]` blocks and expose via `@theme inline`. Do not rename existing tokens; existing pages keep working. Keep `--line` for form-control borders (needs 3:1, measured 4.38:1 light, 4.28:1 dark) and add a quieter `--hairline` for decorative dividers.

### B1. Type scale (Tailwind `@theme`, override defaults used by the app)

| Token | Size / line height | Weight | Use |
|---|---|---|---|
| `--text-xs` | 12px / 16px | 500 | chips, table head, captions |
| `--text-sm` | 13px / 20px | 400 | table cells, secondary text, helper text |
| `--text-base` | 14px / 22px | 400 | default body in app shell (set on `body`) |
| `--text-md` | 16px / 24px | 600 | card titles, section titles (h2) |
| `--text-lg` | 20px / 28px | 600 | page title (h1) |
| `--text-xl` | 24px / 32px | 600 | KPI number (replaces `text-3xl`), quote document title |

Rules: letter-spacing `-0.01em` on `lg` and `xl` only. Numbers in tables and KPIs use `font-variant-numeric: tabular-nums` (add `.num { font-variant-numeric: tabular-nums; text-align: right; }`). Inputs stay `font-size: 16px` below `md` breakpoint (stops iOS zoom), 14px from `md` up. Font stack unchanged (system UI, offline). No new font.

### B2. Spacing scale (4px base, use only these)

`1=4, 2=8, 3=12, 4=16, 5=24, 6=32, 8=48` (Tailwind `p-1`..`p-12` already map; the rule is to use only 4/8/12/16/24/32/48). Page gutter: 16px under `md`, 24px from `md`, 32px from `xl`. Section gap: 24px. Card inner padding: 16px (12px in dense tables). Vertical rhythm: h1 to content 16px, h2 to content 12px.

### B3. Radius scale

`--radius-xs: 3px` (chips, kbd), `--radius-ui: 6px` (buttons, inputs, menu items; was 4px), `--radius-card: 8px` (panels, tables, dialogs, popovers). No pill shapes except avatars and the progress bar. Add `rounded-card` via `--radius-card`.

### B4. Elevation (no glow; hairline plus a short neutral shadow only)

| Level | Use | Light | Dark |
|---|---|---|---|
| 0 | page, table body | none | none |
| 1 | panel / card / table region | 1px `--hairline` border, no shadow | same |
| 2 | menu, popover, toast | `0 4px 12px rgb(22 35 29 / 0.10)` + hairline | `0 4px 12px rgb(0 0 0 / 0.40)` + hairline |
| 3 | dialog, drawer | `0 12px 32px rgb(22 35 29 / 0.16)` | `0 12px 32px rgb(0 0 0 / 0.55)` |

Define as `--shadow-2`, `--shadow-3` in each theme block, then `shadow-2` / `shadow-3` through `@theme inline`. Replace `shadow-lg` / `shadow-xl` usages (`Shell.tsx` user menu, drawer; `.toast`).

### B5. New surface and line tokens

| Token | Light | Dark | Notes |
|---|---|---|---|
| `--hairline` | `#d5e0d9` | `#2d4a3f` | decorative dividers and card borders only (1.36:1 / 1.65:1 vs surface, deliberately quiet, never carries meaning) |
| `--surface-2` | `#eef5f0` | `#18302a` | table head, row hover, filter-bar fill. Ink on it: 14.67:1 light, 12.40:1 dark (hover) |
| `--ink-2` | `#2c3d34` | `#d4dcd5` | table body text (11.51:1 / 11.46:1 on surface) |
| `--skeleton` | `#e6eee9` | `#1d352c` | skeleton blocks (decorative; the "Loading" text is the accessible signal) |

Existing `--muted` (6.88:1 light on bg, 7.97:1 dark on surface), `--accent` (7.42:1 light on bg, 6.55:1 dark on surface), `--warn`, `--amber` stay. Amber stays decorative only (dots, the left rule on attention tiles): `#8a5a00` 5.93:1, `#f2ad2e` 8.24:1 against their surfaces, still never used as text.

### B6. Status chip colour pairs (single mapping, both themes)

Chips are 20px tall, `--radius-xs`, 12px/500 text, a 6px leading dot that varies in **shape or fill** (not only colour), and always carry the text label. Only green-family, neutral and the existing `--warn` family are used: no new brand colour.

| State | Label | Dot | Light text on bg | Ratio | Dark text on bg | Ratio |
|---|---|---|---|---|---|---|
| draft | Draft | hollow ring | `#3b4a42` on `#eceff0` | 8.10 | `#c3d0c9` on `#1d2f28` | 8.85 |
| approved | Approved | half dot | `#0a4434` on `#e1f0e8` | 9.44 | `#bfe8d6` on `#1a3a2f` | 9.31 |
| sent | Sent | solid dot | `#0a4434` on `#cfe6da` | 8.46 | `#d3f0e2` on `#245244` | 7.33 |
| read | Opened | solid dot plus check | `#ffffff` on `#2f6b58` | 6.24 | `#06140f` on `#68cca6` | 9.67 |
| accepted | Accepted | check | `#ffffff` on `#0f5c47` | 7.95 | `#06140f` on `#45b98d` | 7.69 |
| job_created | Job created | check in square | `#ffffff` on `#0a3d2f` | 12.20 | `#06140f` on `#7fd6b5` | 10.93 |
| rejected | Rejected | cross | `#8f2a1a` on `#fbeeea` | 7.37 | `#ffa391` on `#3a1b16` | 8.08 |
| expired | Expired | dashed ring | `#475a50` on `#ffffff` with 1px `--line` border | 7.38 | `#a9bbb1` on `#12251e` with 1px `--line` border | 7.97 |

Progress reads left to right by increasing fill (hollow, half, solid, solid plus check, filled chip). Rejected and overdue use the warn pair; expired is neutral with a dashed ring so it is distinct from draft without a new colour. Overdue is a separate chip (`warn` pair with the warn icon), not a state. Other doc states (received, parsed, reviewed, in_cost_book, cancelled, superseded, waiting, needs_review, ready, confirmed, discarded) map to the nearest of the 8 by meaning: received/parsed/waiting/needs_review = draft look (needs_review uses warn pair), reviewed/ready/confirmed/in_cost_book = approved look, cancelled/superseded/discarded = expired look. One map `STATUS_CHIP` in `ui.tsx` is the only place that does this.

Implement as CSS classes `.chip`, `.chip-draft` ... in `theme.css` setting `--chip-bg`, `--chip-fg`; dot drawn with `::before` (border, `background`, `clip-path` only; no images).

### B7. Controls

- Height: `--control-h: 36px` default for pointer fine; `@media (pointer: coarse), (max-width: 767px) { --control-h: 44px; }`. `.btn`, `.input`, `.sidelink` use `min-height: var(--control-h)`.
- Buttons: `.btn` secondary = surface fill, 1px `--line`; add `.btn-quiet` (no border, hover `--surface-2`, for toolbar icons and row actions), `.btn-sm` (28px desktop, 44px coarse).
- Focus ring unchanged (3px accent, 2px offset, passes 3:1).
- Motion: only `transition-colors 120ms`, existing `page-in` 150ms, and the 160ms drawer. No new animation. All covered by the existing reduced-motion rule.

---

## C. Component upgrades

New file `web/src/kit.tsx` for components that do not exist today; edit `ui.tsx` for the ones that do. Each component keeps current a11y (aria-live, focus return, labels).

### C1. App shell and header (`Shell.tsx`)
- Header height 56px (from 64). Left: sidebar toggle on md+, Brand on phones. Centre: search (max 560px), with `/` hint already present. Right: theme toggle, user menu. Org mark moves into the sidebar top (under the logo) on md+; stays in the header on phones.
- Sidebar: width 232px (collapsed 56px). Group labels become 12px/500 sentence case in `--muted`, no uppercase, no tracking. Item height `--control-h`. Active item: `--surface-2` fill plus the existing inset 3px bar and `font-weight:600` (never colour alone). Collapse button moves to the sidebar header as an icon-only `btn-quiet` with the same accessible name.
- The "SAMPLE data" banner becomes a 28px strip, text 12px, `--surface-2` fill, `--warn` text, `position: sticky; top: 0`, with no layout shift on scroll. Offline banner uses the same strip.
- Main: `max-w-6xl` stays for forms and detail pages; list pages (Track, Contacts, Jobs, Tracker) get `max-w-[1280px]`. Page background `--bg`; panels `--surface`.

### C2. Page header with breadcrumb and primary action (`PageHeader` in `ui.tsx`)
- Props add `crumbs?: {href?: string; label: string}[]` and `status?: ReactNode` (chip next to the title); keep `back` working (maps to a single crumb) so no caller breaks.
- Layout: crumbs row (13px, `--muted`, `/` separators drawn with CSS, last crumb `aria-current="page"` and not a link); title row = h1 (20px) + status chip + meta text; right side `actions`: exactly one `btn-primary` (rightmost) plus at most two secondary. More than three actions go into a "More" menu button (disclosure pattern as in `UserMenu`).
- Under `md` the actions wrap below the title; primary stays first in tab order after the title.
- Quick actions block on Home is deleted and its buttons move into `actions`.

### C3. KPI stat tiles (`Stat` in `Home.tsx`, moved to `kit.tsx` as `StatTile`)
- Tile: panel level 1, 12px padding; label 13px `--muted`; value 24px/600 tabular; optional hint 13px; the whole tile is still one link with a visible focus ring; arrow icon removed (hover = `--surface-2` fill).
- Attention state: 2px amber dot before the label (amber decorative only) and the value stays `--ink`. The count text carries the meaning ("3 to review"), not the dot.
- Grouping: one panel per section containing a row of tiles separated by hairlines (like a single segmented strip), not 17 separate cards. Home sections: "Needs attention" (4), "Pipeline" (Track 3 plus open quotes), "Jobs" (5), "Contacts" (3, shown as one inline line, not tiles).
- Sparkline: **not shown**. The dashboard payload (`Dash` in `Home.tsx`) has only point-in-time counts and `quote_speed.median_minutes`; there is no time series, so no sparkline is drawn (no invented data). If the API later adds `series: number[]`, add a 56x20 inline SVG polyline, `--accent` stroke 1.5px, `aria-hidden`, value text unchanged.

### C4. Data table (`kit.tsx` `DataTable<T>`, wraps existing `TableRegion`)
- Look: panel level 1; header row `--surface-2`, 12px/500 `--muted`, `position: sticky; top: 0` inside the scroll region (and `top: 56px` when the table scrolls with the page on md+); row height 40px comfortable / 32px compact (toggle stored in `localStorage` key `laris.density`, default comfortable); hairline row dividers; **no zebra**; row hover `--surface-2`; cell text 13px `--ink-2`; first column is the link (font-weight 600, `--ink`, underline only on hover and focus; focus ring stays).
- Numbers and money: right-aligned header and cells, `.num`, `RM` prefix kept, unit in the header ("Total (RM)") so rows can drop the prefix on tables with one currency; dates left, `tabular-nums`, format `28 Oct 2026`.
- Sorting: a column is sortable only if the API takes `sort`/`order` for that list. Today `/track` takes `kind, stage, overdue, q, limit, offset` only (`Track.tsx` `load`), so **no sort UI is added now**; keep server order (overdue first). Sort buttons (`<button>` in `<th aria-sort>`) are added per list when the backend supports it. Client-side sort is allowed only on fully loaded short lists (Contacts if all rows are loaded).
- Row actions: a trailing `btn-quiet` icon "More" (menu) revealed always on touch, on hover and focus-within on desktop.
- Mobile fallback (`< md`): each row becomes a `<li>` card: line 1 = reference (link) and chip; line 2 = party; line 3 = two `dl` pairs max (due, total) with `label: value` text 13px. Do not repeat words like "in stage". Same component renders both from one column definition (`mobile: 'title' | 'sub' | 'meta' | 'hide'` per column).
- Footer: row count text ("20 of 64 shown") and "Load more" aligned right; keep the `role=status` live text.
- Must keep: `<caption class="sr-only">`, `scope="col"`, focusable scroll region, the "scroll sideways" hint.

### C5. Status chips (`Status` in `ui.tsx`)
- `Status v={...}` renders `<span class="chip chip-{kind}">` using the `STATUS_CHIP` map in B6. Labels come from one `STATUS_LABEL` map (merge `LABELS` from `Track.tsx` and export `stageLabel` from there unchanged so imports keep working). `badge` and `badge-warn` stay for non-status tags (roles, counts) but restyle to 12px, `--radius-xs`, `--hairline` border.

### C6. Filters bar (`kit.tsx` `FilterBar`)
- One toolbar row, panel fill `--surface-2`, 8px gap, wraps on phones: search input (flex 1, min 220px, placeholder text instead of a visible label, with `aria-label`), then dropdown filters as compact selects (label inside the control as a prefix "Stage: Any"), then a single "Overdue" toggle chip (`aria-pressed`), then right-aligned view toggle (List / Board) as an icon segmented control with text labels in `sr-only`.
- Active filters show as removable chips under the bar ("Kind: Quotes x"), each chip a button with `aria-label="Remove filter Kind: Quotes"`, and one "Clear all" link.
- Replace the large `Seg` button groups for Kind with a tab strip (`role=tablist`-style links or `aria-pressed` buttons) with counts, underline indicator 2px `--accent` plus bold text. Counts come from `data.counts` already returned.
- URL sync stays as is (`hashParams`); no new state store.

### C7. Empty states (text only)
- `EmptyState` loses the circle and icon. Layout: left aligned inside a bordered panel on list pages; 16px title (600), one sentence of cause (13px `--muted`, max 60ch), then at most one primary action and one text link. Copy pattern: what is empty, why, what to do ("No quotes are waiting for approval. Quotes appear here once drafted. Upload a supplier quote to start.").
- Filtered-empty uses different copy: "No items match these filters." plus a "Clear filters" action. Error-empty is not an empty state (see C8).

### C8. Skeleton loaders that match layout (`Skeleton` in `ui.tsx`)
- Replace `shape` guesses with real layouts: `shape="table"` (header bar plus N rows with fixed column widths equal to the real table's column min-widths), `shape="tiles"` (4 tiles of exact tile height 76px), `shape="detail"` (title bar, chip, 2-column key facts, panel). Each page picks the shape so height matches within 10%, preventing layout shift.
- Blocks use `--skeleton`; pulse stays (existing `pulse-soft`, stopped by reduced motion); `role="status"` + sr-only "Loading..." stay.
- Error state (`Async` error branch): panel with `--warn-bg` fill, warn icon, one sentence, "Try again" button, and the request reference text if the error has one (`ApiError` carries it). Keep `role="alert"`.

### C9. Toasts (`Toast.tsx`)
- Position bottom-centre on phones, bottom-left of main content on desktop; 360px max width; elevation 2; remove the thick 4px left border, use a 16px status icon (check / warn) instead of colour only. Optional `action` slot ("Undo") via `toast(text, { action })`, keeping the existing `link` arg working. Auto-dismiss stays 5s; hover or focus pauses the timer; errors persist until dismissed (unchanged). Keep max 3 and dedupe.

### C10. Confirmation dialogs (`kit.tsx` `ConfirmDialog`)
- Native `<dialog>` with `showModal()` (focus trap, Escape, inert background come free). Props: `title`, `body`, `confirmLabel`, `danger`, `onConfirm`. Layout: 440px max width, elevation 3, radius 8px; title 16px; body 14px; buttons right aligned, cancel first, confirm last; destructive confirm uses `btn-danger` filled with the warn pair. Initial focus on Cancel for destructive actions. Focus returns to the opener on close. Backdrop `rgb(22 35 29 / 0.5)` (solid, no blur).
- Used for: discard product (Listings), disconnect WhatsApp number (Channels, when value emptied), reject / expire quote, delete contact, remove team member. Reversible actions use a toast with Undo instead of a dialog.

---

## D. Page-by-page changes

### Home (`Home.tsx`)
- Move Quick actions into `PageHeader.actions` (Upload quote primary; Ask suppliers, Catalog photo, New contact as secondary, the rest in "More").
- Replace the 17 separate `Stat` cards with 3 segmented panels (Needs attention, Pipeline, Jobs) using `StatTile`; Contact book becomes one line of three text links, not tiles.
- "Customers who replied", "Recently active contacts", "Latest documents" become compact two-line rows in panels with the chip right aligned and money right aligned (`.num`); remove the always-underlined bold link style, use ink with underline on hover.
- Speed to quote becomes a fourth tile in the Pipeline panel ("Median time to send a quote: 42 min", hint "from 12 quotes in 30 days"), not its own section.
- GetStarted: drop the progress bar and strike-through; show a numbered list with a "2 of 4" text counter; keep dismiss. Skeleton `shape="tiles"` then rows.

### Track (`Track.tsx`)
- Replace the summary strip and chip rows with the FilterBar (C6) and a Kind tab strip showing counts from `data.counts`; keep the Overdue toggle with the warn count.
- Table via `DataTable`: columns Reference (link), Party, Kind (icon only with `title` and sr text, to save width), Stage (chip, plus warn "Overdue" chip), Time in stage (right aligned, "6 days"), Due, Total (right aligned). Overdue rows get no row tint; the warn chip is the only signal.
- Mobile cards per C4; Board columns get a header with chip and count, cards 13px, no underline-bold ref, 8px gaps; board scroll region keeps its label.
- "Average days per stage" moves into a collapsed `<details>` panel under the list ("Stage timings, last 90 days") to cut noise; table right aligns numbers.
- Empty copy: "Nothing is waiting." (drop "Nice.") with the filtered and unfiltered variants from C7.

### Quote document (`QuoteDoc.tsx`)
- Page header gets `status={<Status/>}`, crumbs `Tracker / {doc_no}`, primary action = the next valid state action (Approve or Send) and an "Export" menu button for the existing PDF/Excel/CSV choices (group labelled Customer copy and Internal copy).
- Add a key-facts strip above the paper: Customer, Total, Valid until, Last sent. Data is already in `Preview`; show only fields that exist.
- Paper stays white with dark text in both themes (intentional, keeps print fidelity); give it elevation 1, 24px outer padding, a max width of 860px centred, and place the Messages and Timeline panels in a right rail on `xl`, below on smaller screens.
- Lines table inside the paper: numbers right aligned with `.num`, header uses the brand colour as today, totals block gets a 1px top rule and a larger Total (16px/600).
- Send dialog uses the shared dialog styling (C10) and channel rows show a chip for available / unavailable with the reason text.

### Catalog (`Listings.tsx`)
- Header: title, description shortened to one sentence, primary action "Upload photo" opening the upload panel (collapsed by default once at least one photo exists).
- Recent photos become a `DataTable` (Date, Supplier, Products, Review status chip) instead of tall `row card` blocks; the open row is `aria-current` with an inset accent bar.
- Product cards: image left 120px, facts as a two-column `dl` with muted labels on separate lines (not inline "SKU: "), a status chip, and the four action buttons collapsed to one primary (Confirm) plus a "More" menu (Edit, Ask suppliers, Discard). Discard goes through `ConfirmDialog`.
- Photo overlay boxes keep accent borders; numbered tags use 20px square labels. Skeleton `shape="detail"`.

### Contacts (`Contacts.tsx`)
- List as `DataTable`: Name (link), Role chip, Phone, Last activity (date), with the role filter as the Kind-style tab strip (All, Customers, Suppliers, Contractors) and search in the FilterBar.
- Detail page: header with role chip, key facts strip (phone, email, last document), costs table via `DataTable` with money right aligned and a "Updated" date column.
- Empty state text-only with "Add a contact" action; error state per C8.
- Mobile: cards per C4 (name, role chip, phone).

### Jobs (`JobsBoard.tsx`)
- Board columns To do / In progress / Done with count in the header and a hairline column background `--surface-2`; cards 13px with quote link, customer, due date, and an overdue warn chip; no extra borders.
- Agenda table via `DataTable` (Due, Job, Customer, Quote, Status chip); Total right aligned.
- View toggle (Board / Agenda) lives in the FilterBar's right slot; overdue filter chip as on Track.
- Status change controls become a "Move to" menu on each card (also keyboard reachable) instead of loose buttons; keep any existing confirm requirements.

### Channels (`Channels.tsx`)
- Becomes a settings panel with a header row (title, one-line description) and a status line using chips: "WhatsApp: Connected" (accepted look) / "Not connected" (expired look), same for Telegram, in a two-row `dl`.
- The multi-business warning becomes an inline alert block (warn pair, warn icon, short sentence plus a "How to fix" line), not a four-sentence paragraph; keep `data-testid="channels-warning"`.
- Field label, hint and error stay as is; submit button right aligned in a footer bar of the panel; disconnecting (empty value) triggers `ConfirmDialog`.
- Skeleton matches the panel (one input row and one status row).

---

## E. Implementation plan (4 stages, each independently shippable)

Every stage ends with `npm run build` green and visual check of light and dark at 1440 and 390.

**Stage 1: tokens and base (foundation).** Files: `web/src/theme.css` only (plus `icons.tsx` if a dot or chevron glyph is missing). Adds B1 to B7 tokens and the `.chip*`, `.num`, `.btn-quiet`, `.btn-sm` classes, restyles `.card`, `.badge`, `.btn`, `.input`, `th`/`td`/`tbody tr`, `.toast`, `.skeleton`. No component file changes, so every existing page already looks calmer (smaller body size, hairlines, table head fill, hover). Risk: body 14px may change wrapping; check at 360px.

**Stage 2: shell and shared components.** Files: `Shell.tsx`, `ui.tsx` (PageHeader, Status, Skeleton, EmptyState, Async error branch, STATUS maps), `Toast.tsx`, new `kit.tsx` (StatTile, DataTable, FilterBar, ConfirmDialog). Requires Stage 1. Keep all existing prop shapes (additive props only) so no page file must change for the build to stay green.

**Stage 3: page rollout A (data-heavy).** Files: `Home.tsx`, `Track.tsx`, `Contacts.tsx`, `JobsBoard.tsx`. Requires Stage 2. These four share no files with each other, so they can be split across four parallel workers.

**Stage 4: page rollout B (documents and settings).** Files: `QuoteDoc.tsx`, `Listings.tsx`, `Channels.tsx`, and the `DocView` section of `App.tsx` (document detail, tracker list around lines 160-330). Requires Stage 2. Independent of Stage 3 and may run in parallel with it, except that `App.tsx` holds the tracker list: assign `App.tsx` to exactly one worker.

Parallel map:
- Stage 1 alone first (single file, blocks everything visually).
- Stage 2 can start in parallel with Stage 1 if the author only reads token names from section B (it does not edit `theme.css`); the shell and `ui.tsx`/`Toast.tsx`/`kit.tsx` are disjoint from `theme.css`.
- Stages 3 and 4 in parallel after Stage 2; file sets are disjoint (Home/Track/Contacts/JobsBoard vs QuoteDoc/Listings/Channels/App).
- Files others also touch and so must not be edited by two workers: `ui.tsx` (Stage 2 only), `theme.css` (Stage 1 only), `App.tsx` (Stage 4 only). Other pages that import `Status` or `PageHeader` (Team, Licence, Ask, Assistant, Roles, Settings, Invite) get the new look automatically; none needs editing.
- Existing uncommitted edits in `web/src/{Ask,Assistant,Channels,Home,JobsBoard,Licence,Listings,Team,mock}.tsx` (git status) must be committed or stashed by the owner before Stages 3 and 4 start, to avoid merge conflicts.

---

## F. Acceptance checks

Contrast (re-run the scratchpad-style script or the `antislop-contrast` checker on every token pair):
- All 8 chip pairs in B6 >= 4.5:1 in both themes (lowest: 6.24 light `read`, 7.33 dark `sent`).
- Body text on `--bg` and `--surface`, `--ink-2` on `--surface` >= 7:1; `--muted` on `--bg` / `--surface-2` >= 4.5:1 (check `--muted` on the new `--surface-2`: light must stay >= 4.5).
- Form control borders (`--line`) >= 3:1 on `--surface` (4.38 light, 4.28 dark). Focus ring >= 3:1 against both `--bg` and `--surface`.
- `--hairline` is only used where meaning is carried by something else (text, position); no input or button border uses it.
- Amber appears only as dot or rule; grep for `text-amber` and `color: var(--amber)` returns nothing.

Layout and behaviour:
- At 360px and 390px: `document.documentElement.scrollWidth === clientWidth` on login, Home, Track (list and board), a quote document, Catalog, Contacts, Jobs, Channels. Only the labelled table regions and the board scroll horizontally.
- Tap targets >= 44px on `(pointer: coarse)` and under 768px; desktop controls 36px.
- At 1440px: Track shows 12+ rows above the fold with the header sticky; scrolling keeps the header visible.
- No layout shift on data arrival: skeleton height within 10% of loaded height on Home, Track and Contacts (check by comparing container heights before and after load).
- Every status in the 8-state list renders the same chip and label on Home, Track, Tracker and the quote header (one `STATUS_CHIP` source; grep shows no other status label map used for display).

Keyboard and screen reader:
- Keyboard path: Tab from page load reaches Skip link, sidebar items, search (`/` focuses it), theme toggle, user menu, page primary action, filter bar controls, table first-column links, row menus, Load more; no keyboard trap; Escape closes menus and dialogs and returns focus to the opener.
- `ConfirmDialog`: focus lands on Cancel for destructive actions, Tab stays inside, Escape cancels.
- Chips are never colour-only (dot shape plus text); sortable headers (when added) expose `aria-sort`.
- Reduced motion: with `prefers-reduced-motion: reduce` no animation or transition runs.

Build and content:
- `npm run build` (runs `tsc --noEmit` and `vite build`) is green after each stage; no new dependency in `package.json`.
- No `linear-gradient`, `radial-gradient`, `backdrop-filter`, `blur(`, `box-shadow` with a colour spread, or sparkle/AI icons added (grep the diff).
- No em dash character in any added file or string (grep for the U+2014 character returns nothing).
- No invented logos, numbers or testimonials in copy or mock data; sparkline absent unless the API supplies a series.
