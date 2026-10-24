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

## Onboarding and licence screens (step 97)

New files: `web/src/Signup.tsx` (Register, Forgot), `web/src/Licence.tsx` (gate, banner, Licence page, purchase page, `useLicense`, `useWriteGate`), `AuthPage` in `Login.tsx`. API: `publicApi()` (no identity headers) and the 402 hook in `api.ts`.

**Routes**

| Hash | Who | What |
| --- | --- | --- |
| `#/login` (and any route while signed out) | public | Sign in: "Email or username", show/hide, Caps Lock hint, Forgot password, Create a business account. 429 cooldown, one-time notice and the access-token fallback (only when `/api/auth/config` says login is not required) are unchanged |
| `#/register` | public | Business form, live password checklist, then the 6-digit code step (auto-submits on the 6th digit, single in-flight guard), Resend with 30 s cooldown, pending email in `sessionStorage` (`laris.pending`). Verified: sign-in with the email prefilled and "Your account is ready. Sign in to continue." |
| `#/forgot` | public | Email, then code + new password (+ checklist), then sign-in with a success notice |
| `#/licence` | signed in | Licence page (status, plan, seats, expiry, clock source, rollback warning, activate form; staff see status only). Nav item under Admin, only while licensing is enforced |
| `#/purchase` | signed in, owner | Plans (`GET /api/license/plans`), request form (`POST /api/license/request`) |

**Gates in `AppShell`** (order): `checking` skeleton; signed-out screens (`gate === 'login'` or a public route while no session): Login / Register / Forgot, full width, no sidebar; then, once `/api/me` and `/api/license` have answered, if `enforced` and status is not `active`/`expiring` and the person has not chosen read-only: `LicenceGate` (owner: activate, staff: ask the owner; `#/purchase` renders in the same minimal `Frame`); otherwise the normal `Shell`. `enforced:false` renders nothing licence-related (no banner, no nav item).

**Read-only**: `LicenceBanner` (slim, above the page) when `read_only` or `expiring`. `useWriteGate()` gives `{aria-disabled, title}` and drops the click while read-only; applied to Upload quote (Tracker), Add contact, New role. Other write buttons are not gated: the server answers `402 license_required`, `api.ts` raises `laris:license402`, the shell shows a toast with an "Open licence" link and re-reads the licence. The user is never signed out by a 402. A 409 `seat_limit` from Team shows through the existing `ActionError`.

**Walk it in mock mode** (`cd web && npx vite --mode mock --port 5175`)

- `/#/login`, `/#/register`, `/#/forgot`: any code but `123456` is refused, `123456` is accepted. The mock answer carries `dev_code` (shown as "Demo code"); `?licence=nodev` hides it.
- Licence is off by default. `/?licence=missing#/home` (gate), `?licence=expired`, `?licence=expiring` (banner only). Any key starting `LARIS1.` with 14+ characters activates; others give 422. `?licence=noemail` makes the purchase request answer 422 `email_needed`.
- Mock sign-in accepts anything. The licence gate's Sign out returns to the sign-in screen.

Add a new pre-login screen: add a route check before the licence gate in `AppShell` and render it inside `AuthPage`.

## Could not verify / not done

- Not run against a real backend (only `dev:mock`). `scripts/a11y.mjs` needs a seeded server with accounts, so it was skipped; instead axe-core was run through `scripts/cdp.mjs` on 16 mock pages at 1100px light and 390px dark (see the report for results). Real sign-in, Sign out in the user menu, the idle dialog and IdleGuard were not exercised in a browser.
- Screen reader behaviour (announcement of toasts, drawer) was not tested with a real screen reader.
- `docs/demo-script.md` still says "top menu" and "role selector top right"; the menu is now the left sidebar (drawer on phones). The role picker is still top right on desktop.
- Doc lines and Ask replies tables scroll sideways at 390px (with hint) instead of turning into cards.
- The Jobs board counters on Home link to the whole board, not a single column.
- Onboarding and licence screens (step 97) were only walked against `dev:mock`: no real backend round trip, no real email, no real signed licence key. The access-token fallback on Sign in depends on `/api/auth/config` (login_required false); there is no separate flag for APP_TOKEN.

## Business picker, invites, accept invite (step 100)

- **Business picker** (`Login.tsx`): `POST /api/login` may answer 409 `choose_business` with `businesses:[{id,name}]` (no session). The sign-in card switches to "Choose a business" (radio list, selected radio focused, Continue re-sends the same credentials plus `business_id`, Back returns to the form). Credentials stay in component memory only. Any later error (wrong password, 429) returns to the form with the normal message. Last choice per email is kept in `localStorage` key `laris.biz` (try/catch) and preselected. `ApiError.businesses` carries the list.
- **Invites on Team** (`Team.tsx`, owner only, the page is already owner only): "Invite by email" card (`POST /api/invites`), "Pending invitations" list (`GET /api/invites`, shows pending and expired only, status as text badge, Resend, Revoke with inline confirm, expired: Resend only), EmptyState when none. The old form is now "Add with a password".
- **Accept invite** (`Invite.tsx`, route `#/invite?token=...`, public, rendered before the sign-in gate): token read once from the hash, URL replaced with `#/invite` via `history.replaceState`, token kept in a module variable (never storage/toast). Preview, then name, username, password + checklist, confirm. Success sets the notice and prefill and goes to `#/login`.
- `Field` and `Card` are now exported from `Signup.tsx`. Copy: Forgot says a reset applies to every account using the email; Register hints the same email can be used for a second business.
- **Mock**: sign in as `multi@demo.test` (any password) for the picker (Acme Printing, Bright Catering). `#/invite?token=good` previews Acme Printing / Staff / new.hire@demo.test; `token=bad` is invalid; username `taken` gives 409. Team invites: pending, expired and accepted samples; `full@demo.test` gives seat_limit, `member@demo.test` already_member.
- Not verified: against the real backend (contracts mocked from the brief), real email links, screen reader behaviour.

## Error handling and graceful failure (step 103)

**Error boundaries** (`web/src/ErrorBoundary.tsx`). Root: wraps `<App/>` in `main.tsx`; plain full-page fallback (LARIS, "Something went wrong", Reload, reference when known, no stack). Page: one around every page render in `App.tsx`, inside the keyed route wrapper, so navigating away resets it. Fallback is a `role=alert` card, "This page hit a problem", heading takes focus, "Try again" resets, Home link; sidebar and header keep working. The error is logged once with `console.error` (`createRoot(..., { onCaughtError })` silences React's duplicate). `decodeURIComponent` of a hash argument goes through `safeDecode` (malformed `%E0%A4%A` means empty search, not a blank app).

**Request wrapper** (`api.ts`, one internal `request()` behind `api`, `publicApi`, `download`, `imageUrl`, `login`, `authConfig`).
- Timeout via `AbortSignal.timeout`: 30 s; 120 s for FormData bodies and `/listings`, `/rfq`, `/documents/ingest`, `/assistant`. Override with the last argument `{ timeoutMs, signal }`. Timeout gives `ApiError(0,'timeout',...)`, no connection gives `ApiError(0,'network',...)`.
- Only GET/HEAD retry, once after 800 ms, on network error, timeout, 502, 503, 504. Never POST/PUT/PATCH/DELETE.
- Server envelope `{error:{code,message,request_id,fields?}}` plus `X-Request-Id`. `ApiError.requestId` (optional), `.fields`, `.retryAfter` (seconds, 429 only). 5xx text is `Server error. Reference: <id>` (or `Server error (500)`); a 503 that carries a message (db_unavailable) shows it; 409 and 422 show the server message (422 prefers `fields[0]`, as "Field label: message").
- 401 with no token calls `signedOut()` (sign-in screen, no "session ended" notice). A failed `/license` read keeps the previous state, logs, retries once after 5 s and never switches enforcement off by itself.

**Toasts** (`Toast.tsx`). `toast(text)` polite, 5 s. `toast.error(text)`: separate `role=alert` region, stays until dismissed, de-duplicated by text for 10 s, max 3 in total. Fired by `window` `unhandledrejection` and `error` (AbortError, ResizeObserver and cross-origin "Script error" ignored; generic text) and by `request()` for a 5xx (not 503 unless db_unavailable) that nobody showed within 300 ms: `msg()`, `useAction` and `Async` set `ApiError.shown`, so an error already inline is not toasted again; when the toast fires, `.toasted = true`.

**Offline** (`OfflineBanner` in `ui.tsx`, in the Shell banner slot). `role=status`: "You are offline. Changes cannot be saved until you reconnect.", then "Back online" for 3 s. On reconnect it fires `laris:online`; `useFetch` loads that had failed reload themselves (loads that worked and form state are not touched).

**Other**: Login keeps the password on network, timeout and 5xx errors (cleared on 4xx except 429). A 409 on a document transition or an invite action reloads that data. Catalog upload after timeout/502/504 says "The upload may still be processing. Check the list below before trying again."

**Test it in mock mode** (`cd web && npx vite --mode mock`; query goes before the hash, e.g. `http://localhost:5173/?fail=500#/contacts`)
- `?crash=1#/contacts`: the Contacts page throws while rendering (page fallback). Mock only (build constant, dropped from real builds). Open another page from the sidebar to see it recover.
- `?fail=500`: `GET /contacts` answers 500 with the new envelope (request id `mock-500-7f3a`). `&failpath=/users` picks another GET path; on Home that one is not shown inline, so you get the error toast.
- `?slow=40000`: `GET /contacts` waits 40 s. `&timeout=1500` shortens the default timeout (mock only) so the timeout path takes about 3.5 s including the one retry.
- Offline: `dispatchEvent(new Event('offline'))` / `'online'` in the console, or DevTools Network, Offline.
- `#/search/%E0%A4%A` must show an empty search, not a blank app.
- Not exercised against a real server: retry on 502/503/504, `Retry-After`, 401 without token, `/license` retry, Login keeping the password, 409 reload (code read, no walk).

## Permissions in the UI (step 107)

The server is the authority (every write route answers 403 `permission_required` or `owner_only`); the UI only spares people a button that cannot work. Source of truth for a person's permissions is `GET /api/me` `permissions`, kept in `api.ts`.

- **Helper** (`api.ts`): `can('key')` (does this person hold it), `needs('key', onClick)` (spread on a button: `<button {...needs('manage_contacts', go)}>`; allowed gives `{ onClick }`, otherwise `aria-disabled`, `title` "Needs the “<label>” permission", `data-locked`, no click), `why('key')` (the same sentence, for a visible note), `canOpen(route, owner)` with the `NEED` map for whole pages (no nav item, no fetch).
- **Label map**: `PERM_LABEL` in `api.ts`, key to human label, same wording as the server catalog. Add a key there when you gate a control on it.
- **Rules**: a whole nav item or page may be hidden (`NEED`); a control inside a page is disabled with a reason, and where the reason matters (line edit, Jobs, Simulate enquiry, supplier fields) a visible sentence says it too, so touch users are not left with a hover-only title. Cost fields are tolerated as missing (`rm(undefined)` is "Not set"; the margin report card is hidden without `view_costs`).
- **Gate a new control**: 1) find the key in `docs/roles.md` (route table); 2) make sure `PERM_LABEL` has it; 3) `{...needs('key', handler)}` on the button, or `can('key') && ...` to leave it out; 4) for a new page, one line in `NEED` and the `NAV` entry; 5) do not fetch for a page the person cannot open (`useFetch(null)`).
- **403 handling**: `errText`/`msg` (`ui.tsx`) turn 403 `permission_required` / `owner_only` into "You do not have permission to do that. Ask the owner." (shown through the existing inline error paragraph or `ActionError`; never a sign-out). `api.ts` also raises `laris:perms` (at most every 10 s) and the shell re-reads `/me`, in case the role changed.
- **Applied**: document line edit needs `upload_documents` (unit cost input also `view_costs`); document transitions that staff may do need `upload_documents` (owner-only buttons unchanged); Jobs Move and Simulate enquiry need `manage_contacts`; Contacts Add and Edit need `manage_contacts`, the Supplier type and a supplier's name and number need `edit_supplier_contacts`; **Follow-ups is now its own page** (`#/followups`, nav item under Work, `NEED.followups = manage_followups`; the old `#/alerts/followups` link opens it; Home counter and its link need the permission; no `/followups` fetch without it).
- **Settings > Channels** (`Channels.tsx`, owner only, under the settings form): WhatsApp phone number ID, `GET/POST /api/settings/channels`, warning with icon and text when `tenants_total_hint` and a channel is unmapped (only that channel's sentence when one is mapped). 422 gives "Digits only, 5 to 32 characters", 409 `number_in_use` gives "That number is already connected to a business."
- **Mock test switches** (query before the hash): `?perms=none` (staff holds no permission), `?deny=1` (every gated write answers 403 though `/me` lists the permission), `?seed=1` (parsed supplier quote `#/doc/in-2` exists at start), `?jobs=1` (one sample job), `?tenants=one` (no channels warning), `?wa=1` (WhatsApp starts mapped). Number `99999999` gives 409 `number_in_use`. Pick Staff in the role picker (or `localStorage.role = 'staff'`).
- Not verified against the real backend (mock only); screen reader behaviour not tested.

## Quote documents: settings, preview, export, send (step 108)

New files: `web/src/QuoteSettings.tsx` (Settings > Quotations card, owner only, under Channels), `web/src/QuoteDoc.tsx` (`QuotePanel`, `QuotePaper`, `SendBox`, `Messages`, `chanLabel`). `App.tsx` only mounts them (`DetailView`, `SettingsView`). `api.ts`: `Settings` has the six quote keys, `blobUrl()` (object URL for a GET, caller revokes), `PERM_LABEL.decide_quotes`, mock answers may be a `Blob`.

- **Quotations card**: validity days, number prefix (uppercased as you type, live example `QT-2026-0001`), payment terms (500) and terms text (2000) with characters left, issuer email and phone. Save sends only changed keys, an emptied field sends `null` (back to the default 30 / QT). Client checks first; a server 422 puts `fields[]` messages under the matching field. Toast "Quotation settings saved."
- **Quote document panel** (outgoing documents only): Send quote, Export, Open PDF in a new tab, Show/Hide preview (open by default for draft and approved). The preview renders the `/documents/{id}/preview` JSON as a white paper in both themes (logo with the org name as alt text, issuer, customer, dates, lines with section rows, discount column only when a line has one, subtotal / SST only when `tax_total` is not null / total, payment terms, terms text, bank details). Table header uses the brand colour with a computed readable text colour; the table scrolls inside its own focusable region. The model has no cost or margin.
- **Export**: Customer PDF, Excel, CSV for everyone; Internal Excel and CSV (with the warning) only when `can('export_data') && can('view_costs')`. Uses `download()` with a pending label; failure is an error toast. Open PDF opens a blank tab inside the click (so pop-up blockers allow it), then points it at a blob URL, revoked after 60 s.
- **Send**: inline `role=dialog` (focus moves to the first enabled channel, Escape closes and returns focus to Send quote, no focus trap because it is not modal). Channel radios come from `preview.channels`; unavailable ones are disabled with the reason in words. Delivered: toast "Sent by <channel>" and the document and preview reload. Failed: inline message with the server text, "The quote stays as it is. Try another channel." 409, 422, 429, 403, 402 and 404 have friendly text. Non-owners get a disabled button with the `why()` title and a visible note. The Decision buttons are unchanged.
- **Why the PDF is not embedded**: `src/app.py` sends `default-src 'self'` and `object-src 'none'` with no `frame-src` for `blob:`, so an `<iframe>` or `<object>` of a blob PDF is blocked. The HTML preview is rendered from the JSON, and the real PDF opens as a top-level tab (not subject to those directives).
- **Messages** list on the document page (any document with messages): email shows as Email, an unknown channel is shown capitalised as written. The old "Download quote PDF" header button was removed (Export has it); BOM and purchase list buttons stay.
- **Mock switches** (query before the hash): `?approved=1` adds approved quote `#/doc/out-2` (header row, 3 lines, one discounted, an email message and an unknown-channel message); `?sst=1` adds an SST line to previews; `?noemail=1` makes Email unavailable (`no_email`); `?sendfail=1` makes a send answer `failed`; `?slowdown=1` answers 429. Telegram is always unavailable (`no_contact`) so the disabled state is visible. Export answers a tiny Blob with the right content type; internal needs `export_data` and `view_costs` (Staff gets 403), internal PDF 415. Every outgoing mock quote (e.g. `#/doc/out-1`, sent) previews and can be re-sent.
- Not verified: against the real backend, a real PDF opening in a new tab (the click was checked with `window.open` stubbed), real downloads on disk, screen reader behaviour.
