# LARIS finals plan: 24-hour hackathon (Sat 31 Oct 09:30 to Sun 1 Nov 07:59:59)

Status as of 2026-10-28. Source for the schedule and judging order: `SDC_Hackathon_2026_Team_Idea_Guide.pptx`, slide 22. Rules there: 24 h build at XMUM, 10-minute live pitch + 5-minute Q&A on Sun 1 Nov, final files by 1 Nov 07:59:59 (updated PRD, declaration, solution report, backup video, GitHub, .pptx slides, demo materials). Tie-break order: Technical Execution, Problem-Solution Fit, Impact & Feasibility, Innovation, Presentation, Design & UX.

## 0. Open questions (settle on Discord before Sat)

1. Does "start work on 31 Oct" mean no code before then? Slide 22 says an upgrade round runs 28-30 Oct with mentor feedback. If that still holds, move the Section 3 items into it and use Saturday for polish and the pitch.
2. Pitch slot time on Sun (sets when the packaging deadline really bites).
3. Is the existing repo allowed as the starting point? Assumed yes (finalists "improve the app").

## 1. Where we stand

Built and live: Telegram bot, voice/text enquiry to rules-priced quote, approval, PDF/XLSX/CSV export, tracker and reminders, catalog photos on RunPod, availability and quote requests, roles, audit log, health page, jobs board. Last build-log row is 126.

Weakest against the judges' criteria (from PLAN.txt, PRD.md and the guide):

| Gap | Criterion hurt | Fix |
|---|---|---|
| No measured benefit: every number in `docs/PRD.md` is `[REAL DATA needed]` | Impact & Feasibility, Problem-Solution Fit | Time a manual quote at Yb's shop plus 2-3 owners (no code, do before Sat); show live minutes-to-quote in the app |
| Wow number too small (filament rise moves a quote by RM3.83) | Impact | Seed a month of filament-heavy jobs; show margin protected across the month |
| Demo story is catalog photos; the guide's journey is enquiry, quote, approve, customer signs, job card | Technical Execution | Make one clean loop end to end (Section 3, item 2) |
| PRD says FastAPI routes and RunPod are not built (stale) | Clarity | Rewrite status section on Sun morning |
| Reusable API, business model, growth path only in prose | Innovation | One slide each, one live curl for the API |
| RunPod pod cold start takes minutes | Technical Execution | Warm plan and recorded fallback (Section 5) |

## 2. Scope rule

One journey, shown flawlessly: **enquiry (voice note + photo) -> rules-priced quote -> owner approves -> customer accepts -> job card -> 48 h follow-up, all logged.** Everything below serves that loop or the pitch. Anything else goes in "Not doing".

## 3. Build list (priority order)

Each item is a single commit with a `docs/BUILD_LOG.md` row (127 onward), CI green, per the existing method.

1. **Demo reset + scenario seed (P0, 1 h).** One command resets the demo business to a known state: a month of filament-heavy jobs, one stale-cost supplier, one pending quote, one overdue follow-up. Everything else depends on this.
2. **Close the loop (P0, 3-4 h).** Verify, and build only what is missing: customer opens the tracking link, taps "Accept" (simulated eSign, labelled as such) -> quote moves to accepted -> job card appears on the board -> activity log shows each step. Check `src/api/track.py`, `src/api/jobs.py`, `web/src/Track.tsx`, `web/src/JobsBoard.tsx` first; most of it may exist.
3. **Measured-benefit card on Home (P0, 2 h).** From existing timestamps: median minutes from enquiry received to quote sent, quotes this week, RM margin protected (quotes the margin guard or stale-cost alert corrected). Baseline minutes from Yb's timing go in as a setting so the card shows "manual 14 min vs LARIS 2 min".
4. **Voice note wow run (P1, 2 h).** Manglish voice note + photo through ILMU to a priced quote in seconds, rehearsed on the venue network. Fix whatever breaks; do not add features.
5. **Reusable API demo (P1, 1 h).** Expose the price-from-items call as a documented endpoint with an API-key header; show FastAPI `/docs` and one curl. Framing: "receipt/price-list to cost to quote, callable by other Orbyte modules".
6. **Staff view check (P1, 30 min).** Prove staff cannot see cost or margin (guide must-have 4). A test plus one screenshot is enough.
7. **Polish pass (P2, as time allows).** Empty states, mobile width of the tracking page, error messages, loading state while the GPU warms.

Not doing: live WhatsApp (Meta approval cannot finish in 24 h; Telegram is the live channel and the guide accepts it), new trade templates, reply polish (purchase-order and BOM export already exist: `/api/export/po.csv`, `/api/export/bom.xlsx`), more hardening, refactors.

## 4. Timeline

| Time | Block | Output |
|---|---|---|
| Sat 09:30-10:30 | Kickoff | Pull master, CI green, start the pod, smoke-test baseline, tag `finals-start`, assign owners |
| 10:30-14:00 | Sprint 1 | Items 1-3 in parallel |
| 14:00-15:00 | Integrate | Merge, deploy to Replit, run the full loop once |
| 15:00-19:00 | Sprint 2 | Items 4-6, benefit numbers entered |
| 19:00-20:00 | Dinner + run 1 | Full demo and pitch run-through, list every stumble |
| 20:00-24:00 | Sprint 3 | Fix the stumble list, item 7, outside tester (mentor or another team) |
| **Sun 00:00** | **Feature freeze** | Only bug fixes after this, no new code paths |
| 00:00-03:00 | Deck + docs | .pptx deck, PRD and declaration updates, solution report |
| 03:00-06:00 | Sleep in shifts | Presenter sleeps first; two people always awake |
| 06:00-07:00 | Backup video + demo run 2 | Screen recording of the full loop, under 7 minutes |
| 07:00-07:30 | Package | Upload, push, open every link in incognito, send files |
| 07:30-07:59 | Buffer | Nothing new. Deadline is 07:59:59 |
| Sun, before slot | Rehearse x2 | Time against 10 minutes, practise Q&A |

## 5. Demo reliability (technical execution is tie-break #1)

- **GPU cold start:** pod costs about $0.59/h. Keep it stopped until Sat, start at kickoff, keep it warm through Sunday's slot, stop it after. Send a warm-up request 10 minutes before the pitch. Check the US$25 credit covers about 30 h.
- **Fallbacks, in order:** warm pod -> ILMU-only path (text quotes still work without vision) -> pre-recorded run of the same step. Know which slide/clip to cut to and rehearse it once.
- **Network:** test the XMUM Wi-Fi against Telegram and the Replit URL on Sat morning; bring a phone hotspot.
- **Deploy:** run as the `laris_app` role (db/roles.sql). `ALLOW_RLS_BYPASS=1` only lets the app start without it: row-level security is then off for every business, and public signup is open, so use it for synthetic demo data only, never real customer data. Set `REQUIRE_USER_TOKEN=1` and `SECRET_KEY`; set `TRUST_PROXY=1`, `SECRET_KEY`, `APP_PUBLIC_URL`. Publish once at kickoff to prove it boots, again only after freeze.
- **Own laptop + HDMI adapter + backup video on a USB stick.**
- Demo login is public in the README: leave until judging ends, then change the password and stop the pod.

## 6. Pitch (10 min) and Q&A

| Min | Content |
|---|---|
| 0:00-1:00 | Problem: one owner, one night of retyping quotes, one number with its source |
| 1:00-2:00 | LARIS in one sentence; AI reads, rules price, owner approves |
| 2:00-6:00 | Live demo of the Section 2 loop, including the stale-cost catch and the approval |
| 6:00-7:30 | Must-haves in one slide each: control (roles, audit, staff cannot see margin), Orbyte fit and reusable API, accuracy |
| 7:30-9:00 | Measured minutes saved and RM protected, usage-based model, growth path (more trades, supplier feeds, SG/ID), SDG 8.3 |
| 9:00-10:00 | Close, risk and backup, thanks |

Q&A prep sheet (one line each, drafted before Sat): does AI ever set a price (no, `price_src` has no AI value); real payments or filings (none); real customer data (synthetic only); PDPA (collect less, delete old, role access, breach runbook); what is Orbyte-specific vs standalone; why not just a chatbot; cost per quote (ILMU figures in PRD); what if the model misreads (confidence gate asks a question).

## 7. Prep that needs no code (do 28-30 Oct)

- [ ] Time a manual quote at Yb's shop and with 2-3 owners; record minutes and one quote each (`knowledge/08-validation/interview-and-timing.md`). Ask the pay-per-quote question.
- [ ] Discord: the three questions in Section 0.
- [ ] Draft the Q&A sheet and the deck outline against Section 6.
- [ ] Write each Section 3 item as a one-paragraph spec with exact contract (inputs, outputs, files) so agents can start at 10:30.
- [ ] Kit: laptops, chargers, extension cord, HDMI adapter, hotspot, USB stick with backup video, sleeping bag.
- [ ] Decide who owns: pitch/lead, backend, frontend + Replit, data/docs/video. Four people, one owner per Section 3 item.

## 8. Risks

| Risk | Mitigation |
|---|---|
| Scope creep at 3 a.m. | Freeze at 00:00 is hard; the "Not doing" list is final |
| Merge collisions on shared files (`routes.py`, `App.tsx`) | One owner per item, small commits, rebase before push |
| CI red near the deadline | Run tests locally before each push; no pushes after 07:00 except fixes |
| Sleep debt hits the presenter | Presenter sleeps first, no coding after 03:00 |
| Benefit numbers missing | Do the interviews before Sat; if still missing, say "measured on N quotes at Yb's shop" honestly, never invent |
