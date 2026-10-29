# LARIS finals: handoff for teammates

Refreshed 2026-10-29 from `docs/BUILD_LOG.md` (last row 147), `next_step.txt`, `docs/deploy.md`, git log (head `31f660e`), `src/` and `web/src/`. Read `docs/finals-plan.md` for the timeline. Anything not measured is marked [REAL DATA needed].

## 0. Rules that apply to everyone

- Synthetic data only. No real customer or company records anywhere (hackathon rule).
- No keys in the repo. Secrets live in Replit Secrets.
- One step = one commit, with a numbered row appended to `docs/BUILD_LOG.md` first (next row is 147). Commit message ends with only `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>`. Never add a `Claude-Session:` link; history was rewritten on 2026-10-29 to remove them.
- Run the checks in Section 0a before every push. Read the GitHub Actions run after pushing. Row 146 changed CI and its result is not yet read: check it first.
- After the history rewrite anyone with a clone must run `git fetch origin && git reset --hard origin/master`. Replit too.
- Feature freeze Sun 1 Nov 00:00. Final files due 1 Nov 07:59:59. Pitch is 10 minutes plus 5 minutes Q&A.

## 0a. What is built, and how to run it

### What is built (BUILD_LOG rows 1 to 147)

- Backend, FastAPI plus Postgres (`src/`, `db/*.sql`): enquiry pipeline (voice and text extraction through ILMU, pricing rules and margin guard, quote document and PDF, jobs), sign-in and roles with a licence gate, Telegram and WhatsApp channels (`src/channels/`), per-business Telegram bots with one-tap creation and bot settings (`src/api/telegram_bots.py`), staff linking and `/catalog` photo import through the helper bot, catalog photos via a RunPod vision model, Mailtrap emails, scheduler, usage and API keys with `/api/v1` price endpoints (`src/api/public_api.py`), PDPA parts 1 and 2 (DPO contact, breach register, export, erase, consent notice, `/privacy` `/mydata` `/forget`; `src/api/privacy.py`), customer accept link with simulated e-signature (`src/api/accept.py`), optional AI guide (`src/api/ai_guide.py`, default off).
- Frontend, React (`web/src/`): app shell, Home, Tracker, quote pages, Catalog (`Listings.tsx`), Jobs board, Contacts, Team and Roles, Channels, BotSettings, Licence and Issuer pages, Privacy and requests screens, ApiAccess, public accept page (`Accept.tsx`, route `#/q/<token>`), guided Tour, Help Center, Ctrl+K Palette, AI guide (`AiSettings.tsx`, `GuideChat.tsx`). Mock mode (`mock.ts`, `mockAccept.ts`, `mockAi.ts`) runs the UI without a backend.
- Tooling: accuracy tools (`scripts/eval_enquiries.py`, `scripts/eval_wer.py`, `tests/fixtures/enquiries_eval.jsonl`, protocol in `docs/eval-manglish.md`), `scripts/preview_emails.py`, `scripts/setup_channels.py`.
- Tests: 686 collected at row 145 and all four groups passed locally, plus the three PGlite checks and the web build.
- UI polish: only stage 1 (design tokens, row 137) is done. Stages 2 to 4 in `docs/ui-polish-spec.md` are NOT built.
- WhatsApp is built but not connected. Telegram has never run against the real Bot API (Section 2).

### Run the backend

```bash
git clone https://github.com/lkaixian/laris.git && cd laris
python -m venv .venv && source .venv/bin/activate     # Windows: .venv\Scripts\activate
pip install -r requirements-dev.txt
export DATABASE_URL=postgresql://localhost/laris        # PostgreSQL 16; the app does not read .env
cd web && npm ci && npm run build && cd ..
python -m uvicorn src.app:app --port 8000
```

Leave API keys unset for offline work. Use one uvicorn worker (the scheduler would otherwise run twice). `run.sh` is the Replit entrypoint and applies the base schema only when the `documents` table is missing. Replit and licence detail: `docs/deploy.md`.

### Run the tests (four file groups, not one process)

A single `pytest` process over all 686 tests runs out of memory and is killed (CI exit 143, row 146). Run the four groups from `.github/workflows/ci.yml`, each as its own process:

```bash
python -m pytest -q -rs "tests/test_[a-c]*.py"
python -m pytest -q -rs "tests/test_[d-l]*.py"
python -m pytest -q -rs "tests/test_[m-r]*.py"
python -m pytest -q -rs "tests/test_[s-z]*.py"
npm ci
node tests/schema_check.mjs
node tests/db_check.mjs
node tests/roles_check.mjs
```

Quote the globs as shown (Git Bash or Linux). On plain PowerShell list the files instead. Set `CI=1` to make the Postgres-backed tests fail instead of skip when PGlite is unavailable. CI also runs `pip-audit -r requirements.txt` and, in `web/`, `npm audit --omit=dev`. Close heavy apps first. Time of a full run on your machine: [REAL DATA needed].

### Build the web app

```bash
cd web && npm ci && npm run build
```

FastAPI serves `web/dist`. CI runs the same build.

## 1. Deployment secrets still needed (Replit Secrets and BotFather)

Names only; never commit values. The full table is in `docs/deploy.md` section 4.

| Setting | Why it matters |
|---|---|
| `SECRET_KEY` (long random) | Now REQUIRED for connecting a customer bot: bot tokens are encrypted with it. Changing it later makes every stored bot token unreadable, so every business must reconnect. Never rotate casually. |
| `APP_PUBLIC_URL` (https, no trailing slash) | Needed to register webhooks, for emails with links, and for the one-tap bot creation. |
| `DATABASE_URL`, plus `DATABASE_URL_OWNER` if you use the `laris_app` role | `run.sh` stops without `DATABASE_URL`. See the RLS risk below. |
| `ALLOW_RLS_BYPASS=1` (only if the `laris_app` role is not possible) | Without it the app refuses to start on a deployment when the database user bypasses row level security. |
| `TELEGRAM_BOT_TOKEN`, `WHATSAPP_*` | Only for the channels you show. WhatsApp stays "built, not connected". |
| `LICENSE_PUBLIC_KEY` | Public key from the licence issuing page. |
| `TRUST_PROXY=1` | Correct client IPs behind Replit's proxy. |
| `LARIS_HELPER_BOT_TOKEN`, `LARIS_HELPER_WEBHOOK_SECRET` | The one LARIS helper bot. Create it in BotFather first. |
| `LICENSE_ISSUER_EMAIL` | The owner account with this verified email gets the "Issue licences" page. |
| `MAILTRAP_API_TOKEN`, `MAILTRAP_SENDER_EMAIL`, `MAILTRAP_SENDER_NAME` | Emails. Leave `MAILTRAP_INBOX_ID` set while testing (sandbox, nothing is delivered); remove it for real delivery. |
| `ILMU_API_KEY` | Voice notes and extraction. |
| `RUNPOD_API_KEY`, `RUNPOD_VISION_URL` | Catalog photos. Pod costs about $0.59 per hour: start at kickoff, warm 10 minutes before the pitch, stop afterwards. |

One-time Telegram steps (in this order):
1. Create the helper bot with BotFather and put its token in Secrets.
2. In the BotFather mini app, switch on **Bot Management Mode** for the helper bot (needed for one-tap bot creation).
3. Register the helper webhook: `python scripts/setup_channels.py helper-webhook https://<host>/webhooks/telegram/helper`. It must include `managed_bot` in its allowed updates (check the script output).
4. The existing demo bot keeps working through the old environment settings. Do not remove those until the dashboard connection is proven.

### Deploy risk: ALLOW_RLS_BYPASS (documented in `docs/deploy.md`, the `laris_app` section)

Tenant isolation relies on Postgres row level security. If the connected database user is a superuser or has BYPASSRLS (UNVERIFIED whether Replit's user is), isolation is OFF and the app logs `tenant isolation OFF`. On a deployment, or with more than one business, the app refuses to start in that state unless `ALLOW_RLS_BYPASS=1`, which is logged as an ERROR on every start. `REQUIRE_RLS=1` makes it always refuse. The proper fix is the `laris_app` role (`db/roles.sql`) in `DATABASE_URL` with the owner URL in `DATABASE_URL_OWNER`, or a separate Postgres (Neon, Supabase). UNVERIFIED on Replit: whether its user may `CREATE ROLE`. Decide before the final deploy and say honestly in the pitch which one was used.

## 2. Never tested for real (everything below passed only against fakes or mocks)

Give each to a teammate with a phone and a laptop. Record pass or fail in the PR or in `docs/BUILD_LOG.md`.

| Area | What to test | Why it could fail |
|---|---|---|
| Telegram reactions and typing | Send text, voice, photo to a business bot. Expect eyes at once, thumbs up or crying face at the end. | Telegram allows one reaction per message and only certain emoji; never run against the real API. |
| Customer bot connect | Paste a BotFather token on Channels. Check status chip, send a message, check reply. Then Disconnect. | getMe, setWebhook, getWebhookInfo untested live. |
| One-tap bot creation (managed bots) | Link own Telegram first, press "Create my bot in Telegram", confirm in Telegram, return. | Newest Telegram feature (Bot API 9.6, April 2026), built from the changelog. Fallback is the paste-a-token guide. |
| Staff linking | Team > Link Telegram, open link on a phone, press Start, then send a `/catalog` photo to the helper. | Helper webhook and code flow untested live. |
| Bot customisation | Change welcome text, quick replies, language, after-hours; send `/start` and a message outside hours. | After-hours uses Malaysia time and ISO weekdays (Monday=1 to Sunday=7). |
| Licence issuing | Create keys in the browser, save the public key, issue to a test request, activate as the customer. Try Chrome, Edge, Firefox and Safari. | Ed25519 in WebCrypto only tested in Node. Unsupported browsers show a message. |
| Ctrl+K palette | Keyboard only, 360px phone, both themes, screen reader if possible. | Never opened in a browser. |
| UI after the new design tokens | Check every page at 360px and 1440px, light and dark. | Body text is now 14px, controls 36px on desktop, radius larger; wrapping changes. A local class named `.btn-sm` may clash. |
| Emails | Open the preview files (`python scripts/preview_emails.py OUTDIR`) in a browser, then send real ones to Gmail, Outlook and Apple Mail. | Never rendered in a real mail client; dark mode support varies. |
| Manglish accuracy | Run `python scripts/eval_enquiries.py --live` with the ILMU key, then record 20 voice notes and run `scripts/eval_wer.py` (see `docs/eval-manglish.md`). Report the number WITH the sample size. Result so far: [REAL DATA needed]. | No published ILMU accuracy exists; the harness has only run offline. |
| Real Postgres | Start once against the Replit Postgres (not PGlite) with the owner and `laris_app` roles. | Tests use PGlite plus role checks only. |
| Customer accept page and PDPA bot commands | Open `#/q/<token>` on a real phone and in a second browser; accept and decline. In Telegram send a first message (consent notice), then `/privacy`, `/mydata`, `/forget`. | Rows 143 and 144: not tried on a real phone; legal wording not reviewed by a lawyer. |
| AI guide | As owner turn it on in settings, ask a question in Ctrl+K. Try hosted ILMU and an own server URL. | Row 145: answers never checked against a live model. |
| WhatsApp | Leave as "built, not connected". Say so in the pitch. | Meta setup is slow and billing changed on 1 Oct 2026. |

## 3. Known gaps and decisions still open

Product gaps
- **Raw-material enquiries cannot be matched.** The live extraction schema only allows recipe items (signboard, shelf, 3D part, design service). "pla hitam" or "skru m4" is not accepted. Fix it or disclose it. The evaluation script shows both numbers (`--catalog`).
- `GET /api/me` now returns `telegram_linked` (row 139). Check that the Account page uses it.
- Speed-to-quote uses `sent_at`; a re-sent quote counts from its latest send. No manual baseline is shown yet because nobody has timed one.
- Unsupported or too-large files still get the generic "sorry". Messages from unknown senders and duplicates get a thumbs up.
- Margin report is reached at `#/alerts`. The Settings page has no anchors, so the palette breadcrumbs tell people where to click.
- Breadcrumbs and most of the app are English only; only the palette, tour and help are meant to be bilingual.

Optional hardening (none is required for the submission)
- UI polish stages 2 to 4 were built in row 147 but never opened in a browser. Open every screen at 360px and desktop, in both themes, and tab through it. Skipped from the spec: row density toggle, sort UI, quote header primary action, confirm dialogs for reject, expire, delete contact and remove member.
- Rate limits on the public accept endpoints and API keys are per process (rows 139, 140); public endpoints sit outside the licence gate.
- One cost lookup query is duplicated between the API pricing and the pipeline (row 140).
- Help Center Malay text not reviewed by a native speaker; margin guard wording (flagged versus blocked) not yet checked against the code (row 136).
- Run against the real Replit Postgres with the `laris_app` role (Sections 1 and 2).

Decisions for the team leader
- AI guide: built in row 145 as an in-app guide, default OFF, owner opt-in, hosted ILMU or own server. Confirm this is the intended scope (not an agent that acts, not an outside AI connecting in).
- Whether the existing `Co-Authored-By` trailers stay (currently kept).
- Whether to delete the local branches `backup-before-rename` and `backup-before-squash` (they still contain the old history and were never pushed).
- Who acts as the data protection officer for the privacy notice, and who reviews the PDPA wording. The deadlines in the breach register (72 hours to the Commissioner, 7 days to individuals) come from law-firm summaries and must be confirmed at pdp.gov.my.
- Sanity-check the unit assumptions in `tests/fixtures/enquiries_eval.jsonl` (1 lusin = 12, 500 g = 0.5 kg).

## 4. Documents that must be updated before 1 Nov 07:59:59

- `docs/PRD.md`: its status section may still say routes and RunPod are not built (check); every benefit number is still `[REAL DATA needed]`. Fill from the timing session and the accuracy run. Never invent a number.
- `README.md`: new features, honest limits (WhatsApp not connected, never run on real Telegram if still true), PDPA section, how to run.
- `docs/tech-and-tools-declaration.md` and the PDF in `submission/`: every API, model and library must be listed. New since the submission: Telegram managed bots and reactions, Mailtrap emails, browser WebCrypto Ed25519, the sample templates, and the optional AI guide if built.
- Final solution report, updated slides (.pptx), backup video (under 7 minutes), demo materials. The old pitch deck predates the Telegram dashboard setup, licence page, palette and tour.
- Q&A sheet (one line each): does AI set a price (no), real payments or filings (none), real data (synthetic only), PDPA (what is in place and what is not), why not just a chatbot, cost per quote, what happens when the model misreads.

## 5. Human-only tasks

1. Time a manual quote at Yb's shop and with 2 or 3 other owners (stopwatch from enquiry received to quote ready). Record minutes and one quote each. Ask the pay-per-quote question. Save in `knowledge/08-validation/interview-and-timing.md`. Result: [REAL DATA needed].
2. Run the live accuracy numbers (Section 2).
3. Watch the mentor session on 31 Oct. Questions to bring: is Telegram accepted as the live channel; does the sponsor checkbox accept Replit plus RunPod; may sample trade templates count as reuse evidence; how the measured benefit will be scored.
4. After judging: change the public demo password, stop the RunPod pod.

## 6. How to work in parallel without breaking each other

- Suggested owners: pitch and lead; backend; frontend and Replit; data, docs and video.
- Files that attract conflicts: `src/api/webhooks.py`, `src/api/telegram_bots.py`, `web/src/Shell.tsx`, `web/src/App.tsx`, `web/src/mock.ts`, `web/src/api.ts`, `docs/BUILD_LOG.md`, `docs/deploy.md`, `docs/api-contract.md`, `tests/test_permissions.py`. One person edits each at a time; pull before editing.
- Every new write route must be added to the table in `tests/test_permissions.py` or the suite fails.
- Every new frontend page needs: loading, empty and error states, keyboard access, both themes at AA contrast, no horizontal scroll at 360px, no em dash characters in text, and must follow `DESIGN.md` (green and white, no gradients, glass or glow).
- Mock mode (`web/src/mock.ts`) lets the UI run without the backend; add mock switches for every new state.

## 7. Plan for the future improvements listed in the README

Order is by what unblocks the others. None of these may invent a number: results go in as measured or stay `[REAL DATA needed]`. Add a BUILD_LOG row for each step that ships, and run pytest in the four file groups first.

| # | Item | Owner (suggested) | Needs first | Steps | Done when |
|---|---|---|---|---|---|
| 1 | Time real owners, manual versus LARIS | Researcher / Tester | Nothing; start now | Follow Section 5 task 1. Save raw times and one quote each in `knowledge/08-validation/interview-and-timing.md`. Add the baseline next to speed-to-quote on the Home screen only when real. Then fill the PRD benefit rows. | The file exists with real stopwatch times and the PRD rows are filled or still marked `[REAL DATA needed]` |
| 2 | Run Manglish accuracy tools with a live ILMU key, and match raw-material enquiries | Backend | An ILMU key in a shell variable (never in the repo), the 20 recorded voice notes with `refs.csv` | Run `eval_enquiries.py --live` with and without `--catalog`, then `eval_wer.py --live` (see `docs/eval-manglish.md`). Record both extraction numbers. If the raw-material gap matters, extend the live extraction schema to accept catalog keys, add tests, rerun. | Results saved under `knowledge/08-validation/` and quoted in the README limits; schema change, if made, has tests |
| 3 | Connect WhatsApp through Meta and verify the webhook | Backend / Replit | Meta app, verified business, permanent token and app secret in Replit Secrets (Section 1) | Set the webhook URL, subscribe to messages, send a real message from a phone, check the signature check, tenant mapping by phone number id and the outside-window template fallback. Fix what the real API rejects. | A real enquiry becomes a draft quote, and the reply leaves from the right number |
| 4 | DONE (row 150). Per-size prices and quantity tiers on catalog items | Backend then frontend | Decide with the team leader whether the supplier tier model (row 73, `min_qty` on cost items) is reused for customer-facing catalog prices | Reuse the existing tier pricing path in the rules engine instead of a second one. Add the columns in a new SQL file applied on start, route changes in `tests/test_permissions.py`, mock switches in `web/src/mock.ts`, catalog form fields, tests for tier boundaries. | Price for 1, a mid tier and a large size comes from the rules engine, never from the model, with tests |
| 5 | DONE (row 150). Stock levels so availability replies can say "in stock" | Backend then frontend | Item 4 decided (same catalog table) | Add an optional stock count per confirmed catalog item, show it in the catalog, and let `src/availability.py` say "in stock" only when a count exists; otherwise keep today's wording. | A reply never claims stock when no count is set; test covers both |
| 6 | Lawyer review of the privacy wording and DPO appointment | Team leader | A named person to act as DPO and a reviewer | Confirm the 72 hour and 7 day deadlines at pdp.gov.my, review the notice text in `web/src/Privacy.tsx` and the bot notice, name the DPO in Settings. Update `docs/privacy-and-breach-runbook.md`. | Reviewer sign-off recorded and the DPO contact is set |

Then, in this order, update `README.md` (tick the item and remove it from the limits) and `docs/PRD.md`.

Items 4 and 5 shipped in row 150: `listing_items.price_tiers` and `stock_qty` (`db/catalog_tiers.sql`), `pricing.catalog_price` reuses `pick_tier`, the Catalog edit form has a price-row editor (owner, `view_costs`) and a stock count (any role with `upload_documents`). Decision taken: reuse the supplier tier rule, stored per catalog item as JSON rather than a second tier table. Still to check by hand: the editor at 360px in dark mode with a screen reader, and a real Telegram "quote 20 spool 3kg" against an item with tiers. Limits: no unit conversion between the tier quantity and what the customer types; stock is not lowered by sales; a one-letter size such as "L" is matched as a whole word in the message, which can misfire on Malay text.

## 8. Status refresh

This file was refreshed on 2026-10-29 at BUILD_LOG row 164. CI is green on master (backend groups on PGlite and on Postgres 16, checks, web). Re-check against `docs/BUILD_LOG.md` and `next_step.txt` after any new row.

Done since row 147:
- Section 7 items 4 and 5: catalog per-size prices, quantity tiers and stock counts (row 150).
- Manual brief features (row 154): age colours on Track and Follow-ups, Activity log filters with a CSV or PDF download of chosen entries, jobs made by hand, a floating Ask button whose Assistant can move a job or skip a follow-up after the person confirms.
- Four languages on the menus and main work screens: English, Bahasa Melayu, Chinese, Tamil (row 160).
- User manual for owners and staff: `docs/user-manual.md` (row 164).

Still to do:
- Replit: `git fetch origin && git reset --hard origin/master`, Run once (new columns: listing_items.price_tiers and stock_qty, jobs.title, party_id and amount), then Redeploy. Until then the live demo lacks rows 150 to 163.
- Native-speaker review of the Malay, Chinese and Tamil text (`web/src/strings.ts`).
- The Assistant's proposed actions against a live model; the new screens on a real phone and with a screen reader.
- Section 7 items 1, 2, 3 and 6 are unchanged (timing study, live Manglish accuracy, WhatsApp through Meta, lawyer review and DPO).
