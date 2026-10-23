# LARIS demo video script (5 to 7 minutes, stop by 6:45)

Follows the video plan in the deck (slide 21). Over 7:00 costs 1 point per 30 seconds. Synthetic data only. Every figure below that is not from the vault is labelled.

## Setup before recording

- Seed the database from `db/seed_made_to_order.sql` so the scenario is real data in the app: 40 acrylic signboards at RM60, sent quote `SAMPLE-QT-0001`, old supplier quote `SAMPLE-A-001` (acrylic RM100 per sheet), newer quote `SAMPLE-A-002` (RM140 per sheet).
- The seed gives the numbers: each signboard uses 0.25 sheet of acrylic and 0.5 m of vinyl at RM8, so unit cost RM29 and quote cost RM1,160 against RM2,400 revenue. After the rise, unit cost is RM39 and cost RM1,560. Margin falls from RM1,240 to RM840, a drop of RM400 (derived from the seed; synthetic prices).
- Two browser windows on the web app: owner and staff. In demo mode (no account has a password) use the role selector top right, "Role (simulated)". With accounts set up, sign in as an owner in one window and a staff user in the other. The app opens on **Home**; the click path below starts from Tracker and Stale costs in the left menu (a drawer on a phone).
- Telegram bot and, if ready, the WhatsApp test number open on a phone mirrored to the screen.
- The web mock data (`web/src/mock.ts`) uses plywood, not acrylic. Do not record against mock mode if the script says acrylic; point the web app at the real API with the seed loaded, or change the script to the plywood numbers shown on screen.
- Warm the RunPod endpoint 10 minutes before. Record a spare take of the voice note step as backup.
- Close tabs with real keys. Check the Replit URL in an incognito window.

## Timeline

### 0:00 to 0:40 Problem (face or voiceover, no app yet)

Say:
"Small shops in Malaysia get supplier prices as WhatsApp photos and PDFs. They quote customers from memory. When the supplier raises a price, the quotes already sent lose margin and nobody notices. In Malaysia, 67% of SMEs say rising costs are a key pressure (The Star, October 2026). We do not yet have a measured figure for how much margin stale quotes lose. That is what we are measuring with shop owners this week." [If the team has real interview data by recording time, replace the last two sentences with `[REAL DATA needed]`.]

Show: one slide with the 67% number and its source. Nothing else.

### 0:40 to 1:15 Solution (one sentence plus the loop)

Say:
"LARIS ties every supplier price to a dated cost line, prices customer quotes from those lines by rule, and warns the owner when a sent quote is priced on an old cost. A model reads the messy input. Rules set the price. The owner approves."

Show: one diagram with two lanes, "Supplier quote in" to "Cost book" to "Customer quote out" to "Approved by owner" to "Job and log".

### 1:15 to 4:30 Live demo (3 min 15 s)

Click path:

1. **1:15 Staff uploads a supplier quote (45 s).** Open the Telegram chat. Staff sends the photo of supplier quote `SAMPLE-A-001`. Switch to the web app as **Staff**: Tracker, open the new supplier document. Say: "Staff can upload and fix lines. Price cells say Hidden for staff. Staff cannot see cost or margin." Show a flagged line (`needs_review`) and fix the item.
2. **2:00 Owner accepts into the cost book (30 s).** Switch role to **Owner**. Tracker, open the supplier document, click **Approve supplier quote**, then **Add prices to cost book**. Say: "Only the owner can do this. Now acrylic 3mm sheet costs RM100, from this supplier line, on this date."
3. **2:30 Customer enquiry to priced quote (60 s).** In Telegram, send a Manglish voice note: "Boss, nak quote 40 signboard acrylic 60 kali 30." Transcript appears (ILMU speech to text). Say: "The model only reads item and quantity. It cannot write a price." Open the draft quote `SAMPLE-QT-0001` in Tracker. Open the line: **Cost provenance (owner only)** shows supplier, source document, cost date, unit cost. Say: "Every price traces to a supplier line and a date." Click **Approve quote**, then **Send quote to customer**. Show the Telegram message.
4. **3:30 Wow moment: the supplier raises the price (60 s).** In Telegram, staff sends the new supplier quote `SAMPLE-A-002` (acrylic RM140). As Owner: open it, **Approve supplier quote**, **Add prices to cost book**. Go to **Stale costs**. Say: "The supplier raised acrylic by RM40 a sheet. The quote we already sent is flagged." Point at the badge: "Margin down RM400" and the line "10 sheets times RM40". Open the quote: provenance shows old cost RM100, current cost RM140. Say: "LARIS does not reprice by itself. It tells the owner, who decides whether to re-quote."
5. **4:30 Activity log (15 s).** Open **Activity**. Show each step with actor and time. Say: "Append-only. Nobody can edit it, including us."

### 4:30 to 5:30 Must-haves (60 s)

Spend about 10 seconds each, on screen where possible:
1. Problem: slide from 0:00.
2. Journey: five steps mapped on one slide, both directions.
3. Accuracy and ease of learning: show a flagged line the validator caught; say "The model never scores itself. Checks for arithmetic, date, OCR confidence and item match do." First-time-user time: `[REAL DATA needed]`.
4. Control: owner and staff views side by side; discount over the cap needs the owner; audit log.
5. Orbyte fit: "LARIS is the step before Clients and projects. We simulate roles, approval, eSign and Connect. The cost book is a separate API other modules can call" (contract in `docs/api-contract.md`; not deployed).
6. Benefit and SDG: next section.

### 5:30 to 6:30 Proof and impact (60 s)

Say, filling only measured numbers:
- "Manual quote: `[REAL DATA needed]` minutes. With LARIS: `[REAL DATA needed]` minutes. Timed with `[REAL DATA needed]` owners, including Yb's shop."
- "Margin protected in our test scenario: RM400 on one 40-piece job. These are synthetic prices; the real figure per shop is `[REAL DATA needed]`."
- Show the Replit URL and the RunPod endpoint screenshot with Pod or endpoint id, GPU type and runtime.
- Biggest risk and backup: "Many teams will do quotations. Our difference is the supplier-to-customer loop and the stale-cost flag. If the model misreads, the app asks the owner to confirm."
- SDG: "8.2 productivity, 8.3 support for micro and small firms, 9.3 integration into value chains. We have not measured outcomes on these yet."
- Privacy: "Synthetic data only. For real use, we collect less, delete old audio, restrict roles, and follow the PDPA breach and DPO rules."

### 6:30 to 6:45 Close

Say: "LARIS. Know which price you quoted on, and when it goes stale." Show repo URL and live URL. Stop recording at 6:45 at the latest.

### Optional extras if time allows (each 15 to 20 s)

- **Quote PDF and exports:** on a sent quote click **Download quote PDF** (customer sees selling prices only); as Owner also **Download BOM (xlsx)** and **Download purchase list (csv)**.
- **Follow-up:** Stale costs page, "Quotes waiting for a reply": read the suggested message, **Send follow-up**. Say: "Nothing goes to a customer without the owner."
- **Last 7 days** block on the same page: quotes, margin, won and lost, thinnest margins.
- **Jobs:** after the customer accepts, **Sign and create job**, then Jobs page: move the card to In progress.

## Backups

**If WhatsApp fails (webhook, template, test number):** switch to Telegram. It runs the same pipeline behind one channel adapter (`src/channels/base.py`, `telegram.py`). Say one line: "WhatsApp is our target channel; today's demo uses Telegram, same code path." Do not pretend it is WhatsApp. If Telegram is also down, use the web app's `POST /api/enquiries/simulate` helper (documented in `docs/api-contract.md`) with typed text.

**If ILMU fails (no key, endpoint 4xx, wrong audio path, bad transcript):**
1. Switch speech to text to the Mesolitica Whisper endpoint on RunPod (`transcribe_runpod` in `src/ilmu.py`). That also satisfies the RunPod proof.
2. If RunPod is cold or down, use the typed-text path (the same extraction runs on text) and say so.
3. If the extraction model fails, the simulate helper with a fixed fixture still shows rules pricing, approval, stale flag and log, which are the parts that do not need a model. Say: "This is a fixed fixture because the model service is down."
4. Keep a recorded successful run of the voice step (spare take) and cut it in.

**If OCR fails:** use the clean synthetic quote image; if still failing, show the review screen with the hard-coded fixture and say so (the confidence gate is the safety story).

**If the live app is down:** play the recorded take of the stale-cost moment; the video must still show a live run at some point, so record two takes.

## Checklist before upload

- Length 5:00 to 6:45. Chapter markers at the section times above.
- Every `[REAL DATA needed]` replaced, or the sentence cut.
- No keys, no real phone numbers, no real names on screen.
- Link tested in an incognito window. Deadline: Sun 25 Oct 2026, 7:59:59 AM (handbook); submit Saturday night.
