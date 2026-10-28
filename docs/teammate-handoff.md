# LARIS finals: handoff for teammates

Written 2026-10-29. Covers everything that is NOT already in the pending-task table (the 19 numbered tasks). Read `docs/finals-plan.md` for the timeline and `docs/BUILD_LOG.md` (last row 132) for what is built.

## 0. Rules that apply to everyone

- Synthetic data only. No real customer or company records anywhere (hackathon rule).
- No keys in the repo. Secrets live in Replit Secrets.
- One step = one commit, with a numbered row appended to `docs/BUILD_LOG.md` first (next row is 133). Commit message ends with only `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>`. Never add a `Claude-Session:` link; history was rewritten on 2026-10-29 to remove them.
- Run `python -m pytest -q` (about 6 minutes), `node tests/schema_check.mjs`, `db_check.mjs`, `roles_check.mjs` and `cd web && npm run build` before every push. Read the GitHub Actions run after pushing.
- After the history rewrite anyone with a clone must run `git fetch origin && git reset --hard origin/master`. Replit too.
- Feature freeze Sun 1 Nov 00:00. Final files due 1 Nov 07:59:59. Pitch is 10 minutes plus 5 minutes Q&A.

## 1. Deployment settings that only a person can do (Replit Secrets and BotFather)

| Setting | Why it matters |
|---|---|
| `SECRET_KEY` (long random) | Now REQUIRED for connecting a customer bot: bot tokens are encrypted with it. Changing it later makes every stored bot token unreadable, so every business must reconnect. Never rotate casually. |
| `APP_PUBLIC_URL` (https, no trailing slash) | Needed to register webhooks, for emails with links, and for the one-tap bot creation. |
| `ALLOW_RLS_BYPASS=1` (or use the `laris_app` role, see `docs/deploy.md`) | Without it the app refuses to start on a Replit deployment. |
| `TRUST_PROXY=1` | Correct client IPs behind Replit's proxy. |
| `LARIS_HELPER_BOT_TOKEN`, `LARIS_HELPER_WEBHOOK_SECRET` | The one LARIS helper bot. Create it in BotFather first. |
| `LICENSE_ISSUER_EMAIL` | The owner account with this verified email gets the "Issue licences" page. |
| `MAILTRAP_API_TOKEN`, `MAILTRAP_SENDER_EMAIL`, `MAILTRAP_SENDER_NAME` | Emails. Leave `MAILTRAP_INBOX_ID` set while testing (sandbox, nothing is delivered); remove it for real delivery. |
| `ILMU_API_KEY` | Voice notes and extraction. |
| `RUNPOD_API_KEY`, `RUNPOD_VISION_URL` | Catalog photos. Pod costs about $0.59 per hour: start at kickoff, warm 10 minutes before the pitch, stop afterwards. |

One-time Telegram steps (in this order):
1. Create the helper bot with BotFather and put its token in Secrets.
2. In the BotFather mini app, switch on **Bot Management Mode** for the helper bot (needed for one-tap bot creation).
3. Register the helper webhook: `python scripts/setup_channels.py helper-webhook https://<host>/webhooks/telegram/helper`. It must include `managed_bot` in its allowed updates (the script does this once the backend change is merged; check the script output).
4. The existing demo bot keeps working through the old environment settings. Do not remove those until the dashboard connection is proven.

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
| Manglish accuracy | Run `python scripts/eval_enquiries.py --live` with the ILMU key, then record 20 voice notes and run `scripts/eval_wer.py` (see `docs/eval-manglish.md`). Report the number WITH the sample size. | No published ILMU accuracy exists; the harness has only run offline. |
| Real Postgres | Start once against the Replit Postgres (not PGlite) with the owner and `laris_app` roles. | Tests use PGlite plus role checks only. |
| WhatsApp | Leave as "built, not connected". Say so in the pitch. | Meta setup is slow and billing changed on 1 Oct 2026. |

## 3. Known gaps and decisions still open

Product gaps
- **Raw-material enquiries cannot be matched.** The live extraction schema only allows recipe items (signboard, shelf, 3D part, design service). "pla hitam" or "skru m4" is not accepted. Fix it or disclose it. The evaluation script shows both numbers (`--catalog`).
- A staff member cannot see on their own Account page whether Telegram is already linked (the API has no field). Add `telegram_linked` to `GET /api/me`.
- Speed-to-quote uses `sent_at`; a re-sent quote counts from its latest send. No manual baseline is shown yet because nobody has timed one.
- Unsupported or too-large files still get the generic "sorry". Messages from unknown senders and duplicates get a thumbs up.
- Margin report is reached at `#/alerts`. The Settings page has no anchors, so the palette breadcrumbs tell people where to click.
- Breadcrumbs and most of the app are English only; only the palette, tour and help are meant to be bilingual.

Decisions for the team leader
- AI guide (task 19): confirm it means an in-app guide that navigates, not an agent that acts or an outside AI connecting in. Default OFF, owner opt-in, hosted ILMU or own server, question text only, redacted, never stored.
- Whether the 144 `Co-Authored-By` trailers stay (currently kept).
- Whether to delete the local branches `backup-before-rename` and `backup-before-squash` (they still contain the old history and were never pushed).
- Who acts as the data protection officer for the privacy notice, and who reviews the PDPA wording. The deadlines in the breach register (72 hours to the Commissioner, 7 days to individuals) come from law-firm summaries and must be confirmed at pdp.gov.my.
- Sanity-check the unit assumptions in `tests/fixtures/enquiries_eval.jsonl` (1 lusin = 12, 500 g = 0.5 kg).

## 4. Documents that must be updated before 1 Nov 07:59:59

- `docs/PRD.md`: its status section still says routes and RunPod are not built; every benefit number is still `[REAL DATA needed]`. Fill from the timing session and the accuracy run. Never invent a number.
- `README.md`: new features, honest limits (WhatsApp not connected, never run on real Telegram if still true), PDPA section, how to run.
- `docs/tech-and-tools-declaration.md` and the PDF in `submission/`: every API, model and library must be listed. New since the submission: Telegram managed bots and reactions, Mailtrap emails, browser WebCrypto Ed25519, the sample templates, and the optional AI guide if built.
- Final solution report, updated slides (.pptx), backup video (under 7 minutes), demo materials. The old pitch deck predates the Telegram dashboard setup, licence page, palette and tour.
- Q&A sheet (one line each): does AI set a price (no), real payments or filings (none), real data (synthetic only), PDPA (what is in place and what is not), why not just a chatbot, cost per quote, what happens when the model misreads.

## 5. Human-only tasks

1. Time a manual quote at Yb's shop and with 2 or 3 other owners (stopwatch from enquiry received to quote ready). Record minutes and one quote each. Ask the pay-per-quote question. Save in `knowledge/08-validation/interview-and-timing.md`.
2. Run the live accuracy numbers (Section 2).
3. Watch the mentor session on 31 Oct. Questions to bring: is Telegram accepted as the live channel; does the sponsor checkbox accept Replit plus RunPod; may sample trade templates count as reuse evidence; how the measured benefit will be scored.
4. After judging: change the public demo password, stop the RunPod pod.

## 6. How to work in parallel without breaking each other

- Suggested owners: pitch and lead; backend; frontend and Replit; data, docs and video.
- Files that attract conflicts: `src/api/webhooks.py`, `src/api/telegram_bots.py`, `web/src/Shell.tsx`, `web/src/App.tsx`, `web/src/mock.ts`, `web/src/api.ts`, `docs/BUILD_LOG.md`, `docs/deploy.md`, `docs/api-contract.md`, `tests/test_permissions.py`. One person edits each at a time; pull before editing.
- Every new write route must be added to the table in `tests/test_permissions.py` or the suite fails.
- Every new frontend page needs: loading, empty and error states, keyboard access, both themes at AA contrast, no horizontal scroll at 360px, no em dash characters in text, and must follow `DESIGN.md` (green and white, no gradients, glass or glow).
- Mock mode (`web/src/mock.ts`) lets the UI run without the backend; add mock switches for every new state.

## 7. Status refresh

This file is a snapshot. When the Telegram backend, email wiring and PDPA part 1 agents finish, re-check Sections 1, 2 and 3 against their reports before handing it over.
