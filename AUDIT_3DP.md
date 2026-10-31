# AUDIT_3DP: what LARIS has today, what the 3D printing edition reuses, what it adds

Audited 2026-10-31 on `master` at `7b0a3bd` (fresh clone of lkaixian/laris). Branch: `feat/3dp-glass-bento`. Corrected the same day after reading `Areas.tsx` and `theme.css` (the first pass of section 3 had missed the existing glass Home).

## 1. Stack (kept as is)

| Layer | What is there | Notes for this work |
|---|---|---|
| API | FastAPI, psycopg 3, Postgres (PGlite for tests), APScheduler | Routers in `src/api/*.py`; every write route needs a `REQ` entry in `tests/test_permissions.py` |
| Web | React 19, TypeScript, Vite 8, Tailwind 4 (`@theme` tokens in `web/src/theme.css`), hash routes (`#/jobs`), no router library | Route table at `web/src/App.tsx` (~line 408). Mock mode (`npm run dev:mock`) runs the whole UI without a server |
| Tenancy and safety | Row level security FORCE on every table, `write_audit()` trigger, append-only tables, same-tenant composite foreign keys | New tables copy the pattern in `db/chain.sql` |
| Roles | Two classes (owner, staff) plus custom roles holding a `text[]` of permissions; catalog in `src/perms.py`; owner-only actions are not assignable | Spec roles map onto custom roles (section 4) |
| Languages | `web/src/i18n.ts` (en, ms, zh, ta, `pick()`), strings in `web/src/strings.ts` (403 lines, all four languages), PDFs follow one `doc_language` per business | Reused as is. Older strings fall back to English |
| Documents | `src/quote_doc.py` (`compose()` lines and totals), `src/doc_layout.py` (layout spec per kind), `src/quote_pdf.py` (reportlab, Noto Sans SC and Tamil embedded) | One renderer for PDF, web preview and XLSX |
| Hosting | Replit (`.replit`, `replit.nix`, `run.sh`), GitHub Actions CI | Unchanged |
| Tests | pytest (43 pass, 31 skipped here because they need a database), `tests/*.mjs` PGlite checks, axe a11y script | Baseline recorded before any change |

## 2. The chain today (the surprise: more exists than the brief assumes)

The brief says the system "stops at Quotation". On current `master` it does not. `docs/order-chain-plan.md` and `db/chain.sql` (commits `4605bdc`, `7b0a3bd`) already add steps 1 and 2 of the chain.

| Brief document | Today | Gap |
|---|---|---|
| Quotation (QT) | Complete: states, approval, versions through revise, PDF, accept link, expiry rule in the scheduler | Model thumbnail and 3D specs on the page. Versions v1, v2 are not numbered |
| Order confirmation / Customer PO (SO) | The **job is the order** (`jobs` row, created on accept). `jobs.order_total` freezes the amount | No customer PO number or attachment, no duplicate-PO check, no SO document or number |
| Proforma (PF) | Done: `deal_docs` kind `proforma`, deposit at `deposit_pct`, one live proforma per order | 3DP default deposit rule (50% custom, 0% small) |
| Payments and Receipt (RCP) | Done: append-only `payments` with row-lock overpayment guard, receipt auto-issued per payment, reversal rows, AI slip proposal | Spec wants prefix `RCP`; today `RC` (prefix is a tenant setting, so this is data, not code) |
| Production job | `jobs` has status todo/doing/done, due date, assignee, priority | No printers, no queue, no QC, no stock, no failures. This is the largest gap |
| Delivery order (DO) | Schema only (`delivery_signatures`, kind `delivery_order`); **no API, no screen** (plan step 3) | Whole feature. Many DOs per order are already allowed in the schema, so partial delivery is possible |
| Invoice (INV) | Schema kind `invoice`, one live per order; **no API** (plan step 4) | Whole feature: delivered quantities only, deposit credit |
| Credit note (CN) | Deferred in the plan ("void only") | Brief requires it: add table and kind |
| Supplier PO and GRN | Not present | New |
| Public instant-quote page | Not present. The only public pages are accept, signup, landing, status | New |
| Living deal link | Accept link exists and keeps working after accept (`src/api/accept.py`); unified timeline page is plan step 6 | Extend |
| E-invoice prep | Researched, out of scope in the plan | Brief asks for preparation only (TIN, MSIC, JSON preview, checklist) |

## 3. Existing pieces the brief overlaps

- `config/templates/made_to_order.yaml` already lists a `print_part_small` recipe, PLA items and a machine-hour rate. It is a generic recipe quoter (cost items times markup), not a parametric one. Instant Quote Studio needs volume, layer height, infill and printer time, so it gets its **own engine** (`src/print3d/`) and its own config (`config/print3d.yaml`). The two stay separate on purpose; the studio's output is converted into ordinary quote lines so the rest of the chain does not know the difference.
- `src/pricing.py` has the rule "the AI supplies item_key and qty, never prices" and the `PRICE_KEYS` injection guard. The new engine keeps that rule: AI may extract specs from a message, never a price.
- `src/track_rules.py` and `src/scheduler.py` hold the "something is overdue" logic. Leakage Radar and the filament and deposit rules extend these, they do not duplicate them.
- **Home is already a glass bento, twice over.** `web/src/Areas.tsx` (`AreaBento`, commit `08535a2`, owner request of 2026-10-30) draws four area tiles on a `.glass` class with its own green wash: Work (chevron stages), Suppliers (cycle), Insight (bars), Audit Log (timeline). Below it `Home.tsx` still has the tiles from the earlier PR #1 (`dash.tsx`: needs-a-person hero, documents, jobs, track, contacts). The two overlap (jobs and track numbers appear in both) and neither can be rearranged. This work keeps both sets of tiles, puts them under one reorderable bento shell with presets, and lets a preset hide the overlap. `theme.css` already says the glass Home "departs from DESIGN.md's no glass"; `DESIGN.md` itself was never updated, which this work fixes.
- **A name collision to handle:** `theme.css` defines a `.glass` tile class that mixes `--surface` with transparent. That was safe while `--surface` was opaque; under the frosted skin it would halve the tile opacity. `glass.css` therefore overrides `.glass` to use the tested surface as is.
- Also already present and reused: `Guide.tsx` and `guides.ts` (step-by-step guides with a mask), the floating Ask Laris assistant, `Activity.tsx` (audit log by day), per-kind PDF layouts.
- `DESIGN.md` is the owner's binding direction and says **no glass, no gradients, no glow**, MOTION 1. The 3DP brief explicitly asks for the opposite. See DECISIONS.md D-01.

## 4. Roles: brief versus catalog

Brief roles: Owner, Manager, Print Operator, Designer, Accountant, Viewer. Today: owner class plus custom staff roles with assignable permissions (`src/perms.py`).

Plan: keep the two classes. Ship the five non-owner roles as **seeded custom roles** per tenant (permission sets, not new code paths) and add permissions that do not exist yet: `view_production`, `operate_printers`, `approve_discounts` (manager, owner-class action), `manage_stock`, `manage_catalog`, `view_finance_docs`. Operators and Designers get no `view_costs`, which already scrubs cost and margin from every response server-side. That reuses the existing field-level masking instead of inventing a second one.

## 5. Library decisions

| Need | Choice | Why |
|---|---|---|
| 3D viewer | `three` (STLLoader ships inside it) | The one new runtime dependency that earns its weight. Loaded lazily so the rest of the app does not pay for it |
| Animation | CSS and the existing `prefers-reduced-motion` rule. No framer-motion, no GSAP | Bundle is already over 500 kB. Everything asked for (stagger, lift, tickers, rings) is CSS or a 20-line hook, and `dash.tsx` already has `CountUp` and `Ring` |
| Bento drag and resize | CSS grid plus pointer events, no react-grid-layout | `MarkPhoto.tsx` already established pointer-event dragging that works on touch, and the plan forbids HTML5 drag. Every reorder also has up and down buttons |
| Charts | Hand-drawn SVG (sparkline, rings, waterfall) | No recharts or d3. A dozen small shapes does not justify 100+ kB |
| STL analysis and price maths | Python, `Decimal`, in `src/print3d/` | The server must be the authority on money. The browser only displays. It matches `src/pricing.py` |

## 6. What is rewritten, reused, new

- **Reused unchanged:** auth, tenancy, RLS, audit, i18n, layout engine, PDF renderer, accept link, payments, receipts, proforma, scheduler, tracker, mock mode.
- **Extended:** `jobs` (production fields, customer PO), `deal_docs` (kinds), `perms.py`, `track_rules.py`, `quote_doc.compose()` (3D spec block and thumbnail), `Home.tsx`, theme tokens.
- **New:** `src/print3d/` (STL, pricing, scheduler, samples), `config/print3d.yaml`, printers/materials/spools/stock/QC/supplier PO/GRN/credit note tables, public instant-quote and deal pages, glass skin, bento shell, 3D viewer.

## 7. Risks found during the audit

1. **Scope.** The brief is several months of work. This audit and DECISIONS.md fix an order of work; each part lands with tests before the next starts.
2. **Glass versus accessibility.** Text over translucent surfaces can fail contrast depending on what is behind it. Mitigation: a contrast test that blends every token pair over the worst-case background colour (`tests/test_glass_contrast.py`), plus a solid fallback.
3. **Database tests do not run in this environment** (31 skipped): schema changes cannot be proven here until Postgres or PGlite is available. They are written and reviewed but flagged unverified in `QA_REPORT.md`.
4. **Deep Windows paths** break `pip install` in the session folder; the virtualenv lives outside the repo. Not a product issue.
5. **Print time and weight are heuristics** (about plus or minus 20%). The UI says so and operators can override.
