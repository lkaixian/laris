# LARIS: Quotation Tracker for Malaysian SMEs

[![ci](https://github.com/lkaixian/laris/actions/workflows/ci.yml/badge.svg)](https://github.com/lkaixian/laris/actions/workflows/ci.yml)

LARIS lets a small made-to-order business quote from the chat apps it already uses: customers ask on Telegram (WhatsApp is built but not connected to Meta), AI reads the request, rules set the price, and the owner approves.

## Team Information

| Field | Details |
|---|---|
| Team Name | SPARK SURGE |
| Team Domain | Domain 2 |
| SDG Track (1–17) | SDG 8: Decent Work and Economic Growth (Target 8.3) |
| Team Leader | Harrish Govind a/l Sethulingam |
| University | Universiti Tun Hussein Onn Malaysia (UTHM) |
| Number of Members | 4 |

## Links

| Resource | Link |
|---|---|
| GitHub Repository | https://github.com/lkaixian/laris |
| Live Demo | https://laris-malaysia.replit.app |
| RunPod Endpoint | vLLM GPU pod serving Qwen2.5-VL-7B (private, key required). See the RunPod proof of use |
| Slide Deck | [PDF](submission/SDC2026_SparkSurge_SlideDeck.pdf) · [PPTX](submission/SDC2026_SparkSurge_SlideDeck.pptx) |
| Demo Video | https://youtu.be/JVA05hTM_HU |

## Demo

Try it with the live app and the Telegram bot. All data is synthetic.

| What | Where |
|---|---|
| Web app (owner view) | https://laris-malaysia.replit.app |
| Telegram bot | [@Gyser3DPrintBot](https://t.me/Gyser3DPrintBot) |
| Demo login | `lkaixian91@gmail.com` / `sparksurge` (demo account, synthetic data only, may be reset) |

**Customer flow (Telegram)**
1. Open the bot and press **Start**. It replies with a short guide.
2. Ask: `is there any eSUN filament available` (or a Malay version such as `ada filament esun tak?`). The bot answers from the confirmed catalog.
3. Reply: `quote 50 kg` (typed, or as a voice note). LARIS drafts a quote request and tells the customer the owner will confirm the price.

**Staff flow (Telegram, linked staff account)**
1. Send a photo of labelled products with the caption `/catalog`. LARIS reads it, and the products appear as items to review.
2. Forward a supplier PDF or photo to record its prices.

**Owner flow (web app)**
1. Open **Catalog photos**, check each product, fill in prices and confirm.
2. Open the new draft quote, adjust, approve and send it. Export it as PDF, XLSX or CSV.
3. Open the tracker to see the quote's timeline and follow-up reminders.

The first catalog photo after the GPU has been idle can take a few minutes while the model loads. A recording script for the signage sample data is in [`docs/demo-script.md`](docs/demo-script.md).

## Overview

### Problem

Malaysia has about 1.07 million MSMEs, which produce 39.7% of GDP and employ 48.7% of workers (DOSM). Made-to-order trades such as signage, printing and 3D printing run quotations through chats, PDFs, photos and spreadsheets. Replies are slow, quotes are priced on remembered costs, and unanswered quotes are never chased. Average business payment delay is 61 days (Experian 2025), so lost margin and lost jobs hurt small firms most. Sources and confidence notes are in `knowledge/03-stats/`.

### Solution

A customer sends a text or a Manglish voice note. ILMU transcribes it and extracts the items as JSON. A rules engine, never the AI, prices the quote from the supplier cost book and applies the owner's margin floor. The owner approves, LARIS sends and tracks the quote, and reminders chase unanswered ones. Staff can also photograph a shelf or price board: a vision model on a RunPod GPU turns it into catalog items for review, and customers can then ask whether something is available or request a quote for it.

### Key Features

- **Chat enquiries**: text and voice notes on Telegram, extracted to structured items. Each business can connect its own Telegram bot from the Channels page (paste a BotFather token, or the one-tap managed-bot flow). WhatsApp Cloud API code is in place but untested against Meta.
- **Rule-based pricing**: cost book, margin guard, discount guard, stale-cost alerts, supplier price tiers and minimum order quantities. No AI output sets a price.
- **Catalog photos**: one photo of labelled products becomes reviewable catalog items (Qwen2.5-VL on RunPod, Tesseract cross-check of every price and SKU).
- **Availability and quote requests**: customers ask "is there eSUN filament?" and get an answer from confirmed catalog items only; "quote 50 kg" creates a draft for the owner, priced by the rules engine from the item's per-size prices and quantity tiers. Replies say "in stock" only when the owner has set a stock count.
- **Supplier work**: price lists by PDF, photo, XLSX, DOCX and CSV; "Ask suppliers" with a circled photo over WhatsApp or Telegram and a price comparison of the replies.
- **Quotes and tracking**: quote PDF, XLSX and CSV export; tracker with stage and overdue rules, follow-up reminders, job board, "speed to quote" on Home.
- **Customer accept link**: the customer opens a link, types a name and accepts or declines. This is a simulated e-signature, labelled so in the app, and creates the job.
- **Owner control**: approval step, custom roles and permissions, audit log, multi-business isolation with row-level security, sign-in with sessions and email invites, signed software licence.
- **Privacy tools (PDPA)**: consent notice on first chat contact, bot commands `/privacy`, `/mydata` and `/forget`, per-person export and erase, breach register with deadline clocks, DPO contact, retention purge. Not reviewed by a lawyer.
- **Help**: guided tour, Ctrl+K command palette, 17 help articles. An optional in-app AI guide is off by default and the owner opts in; it sees only a redacted question.
- **API access**: API keys (hash stored) for a read-only recipe list and a price check priced by the same rules engine, without costs or margins.

## Tech Stack

| Layer | Technology |
|---|---|
| Frontend | React 19, TypeScript, Vite, Tailwind CSS (English and Bahasa Melayu help, tour and command palette) |
| Backend | Python, FastAPI, uvicorn, APScheduler |
| Database | PostgreSQL (row-level security); PGlite for tests |
| AI / Compute | RunPod GPU (vLLM, Qwen2.5-VL-7B-Instruct); ILMU API (`ilmu-mini-v3.3`, `ilmu-asr-v4.2`); Tesseract OCR (PaddleOCR optional) |
| Channels | Telegram Bot API (demo bot live), WhatsApp Business Cloud API (built, not connected) |
| Email | Mailtrap API (verification, reset, invites, quotes, licences; sandbox inbox while testing) |
| Licence | Ed25519-signed keys, verified in the app; signing in the browser (WebCrypto) |
| Hosting / Dev | Replit |

The full model and library list with licences is in `submission/SDC2026_SparkSurge_TechDeclaration.pdf` and `docs/tech-and-tools-declaration.md`.

## Project Structure

```
.
├── src/                  # FastAPI app, pricing, pipeline, ILMU, vision, channels
├── web/                  # React + Vite frontend
├── db/                   # Schema, migrations, roles, synthetic seed
├── config/templates/     # Trade templates (YAML)
├── scripts/              # Channel setup, licence tools, checks
├── tests/                # pytest suite and PGlite schema/role checks
├── docs/                 # PRD, deployment, API contract, roles, licensing, privacy runbook, build log
├── knowledge/            # Research notes, sources, decisions
├── submission/           # Final submission PDFs (Preliminary, TechDeclaration, Replit and RunPod proof of use)
├── .replit, replit.nix, run.sh   # Replit run and deploy configuration
├── .env.example          # Environment variable names (no values)
├── requirements.txt
├── LICENSE
└── README.md
```

## Architecture

```
Customer / staff (Telegram or WhatsApp)
        │  text · voice note · photo · document
        ▼
Replit  FastAPI webhooks ──► ILMU (speech-to-text, item extraction)
        │                └─► RunPod vLLM (catalog photos) + Tesseract
        ▼
Rules engine + PostgreSQL cost book  ──► draft quote
        ▼
Owner approves in the web app ──► quote sent to chat, tracked, exported
```

Core rule: AI output never sets a price. `src/pricing.py` rejects price-like keys from extraction.

Every tenant table has row-level security. It holds only when the app connects as the `laris_app` role; the app refuses to start on a Replit deployment otherwise unless `ALLOW_RLS_BYPASS=1`.

## How to Run

### Option 1: Run on Replit (recommended)

1. Import this repository into Replit.
2. Open **Secrets** and add the variables from `.env.example`. The minimum is `DATABASE_URL`, `BOOTSTRAP_OWNER_USERNAME` and `BOOTSTRAP_OWNER_PASSWORD`. For Telegram add `TELEGRAM_BOT_TOKEN`, `TELEGRAM_WEBHOOK_SECRET` and `TELEGRAM_TENANT_ID`, or set `SECRET_KEY`, `APP_PUBLIC_URL` and the helper bot variables to connect bots from the Channels page. For email add the `MAILTRAP_*` variables. For catalog photos add `RUNPOD_API_KEY` and `RUNPOD_VISION_URL`.
3. Click **Run**. `.replit` starts `run.sh`, which installs dependencies, builds the web app, prepares the database and starts the server on port 5000.

Full Replit, webhook and licence setup: `docs/deploy.md`.

### Option 2: Run locally

```bash
git clone https://github.com/lkaixian/laris.git && cd laris
python -m venv .venv && source .venv/bin/activate     # Windows: .venv\Scripts\activate
pip install -r requirements-dev.txt
export DATABASE_URL=postgresql://localhost/laris        # a PostgreSQL 16 database
cd web && npm ci && npm run build && cd ..
uvicorn src.app:app --port 8000
```

The app reads environment variables directly and does not load `.env`. Leave API keys unset for offline work.

### Run Tests

```bash
python -m pytest -q
npm ci && node tests/schema_check.mjs && node tests/db_check.mjs && node tests/roles_check.mjs
```

The suite has 686 tests. GitHub Actions runs them on every push in four file groups, each in its own process, after one single-process run was killed for memory. The result of that CI change has not been read yet.

## How We Use Replit (Required)

- **Hosting:** the app runs as a Replit deployment at the Live Demo link, with a Replit PostgreSQL database.
- **Secrets:** all keys live in Replit Secrets, never in the code.
- **Development:** coded in the workspace and on GitHub; the Telegram webhook points at the deployment.

Proof of use: `submission/SDC2026_SparkSurge_REPLIT_PROOF_OF_USE.pdf`

## How We Use RunPod (Required)

- **Workload:** vision inference for catalog photos runs on a RunPod GPU, serving `Qwen/Qwen2.5-VL-7B-Instruct` with vLLM.
- **Integration:** the app calls the pod's OpenAI-compatible API using `RUNPOD_VISION_URL` and `RUNPOD_API_KEY`.
- **Cost control:** the pod is stopped when not in use.

```bash
curl https://<pod-id>-8000.proxy.runpod.net/v1/models -H "Authorization: Bearer $RUNPOD_API_KEY"
```

Proof of use: `submission/SDC2026_SparkSurge_RUNPOD_PROOF_OF_USE.pdf`

## Challenges & Learnings

- A vLLM template sized for a 48 GB GPU ran out of memory on a 24 GB card; lowering the context length or moving to a larger GPU fixed it.
- The vision model only reports a price when OCR also finds the same digits, so many catalog items arrive without prices and need an owner to fill them in.
- Telegram, licence and database settings differ between the Replit workspace and the deployment, which cost time to debug.
- Honest limits:
  - Stock is a count the owner keys in; sales and jobs do not lower it, so it is only as fresh as the last edit. Items without a count still say "listed", not "in stock". Catalog quotes are priced by tier but still wait for the owner to confirm; quantity tiers do not convert units (a tier "from 10" means 10 of whatever unit the customer asks in).
  - WhatsApp is untested against Meta.
  - Telegram bot connection from the dashboard, one-tap bot creation, reactions and typing indicators have only been tested against fakes, not the real Telegram API.
  - ILMU speech and extraction are not validated on real Manglish audio; the accuracy tools exist (`docs/eval-manglish.md`) but have not been run live. Accuracy: [REAL DATA needed].
  - Enquiries for raw materials (for example "skru m4") cannot be matched by the live extraction schema, only recipe items and confirmed catalog items.
  - OCR accuracy on real receipts is unmeasured. Minutes saved per quote and margin protected: [REAL DATA needed], nobody has timed a manual quote yet.
  - All data is synthetic. Single-process deployment with no failover; some rate limits and the 15-minute catalog memory are per process.
  - Row-level security and the database roles have not been tried on Replit's own Postgres, only on PGlite.
  - Emails, the command palette, the guided tour and the customer accept page have not been checked in real mail clients, browsers or phones. Malay text is not reviewed by a native speaker.
  - The AI guide has not been checked against a live model.
  - PDPA: the tools above exist, but the legal wording is not reviewed by a lawyer, the 72 hour and 7 day deadlines come from law-firm summaries and are not verified at pdp.gov.my, and no data protection officer is named. Do not use real customer data until `docs/privacy-and-breach-runbook.md` is completed.
  - The e-signature is simulated, not a legally binding signature. The licence is a deterrent, not copy protection.

## Future Improvements

- [ ] Connect WhatsApp through Meta and verify the webhook
- [x] Per-size prices and quantity tiers on catalog items (row 150)
- [ ] Time real owners on manual versus LARIS quotes to measure minutes saved
- [x] Stock levels so availability replies can say "in stock" (row 150)
- [ ] Match raw-material enquiries, run the Manglish accuracy tools with a live ILMU key
- [ ] Lawyer review of the privacy wording and DPO appointment

Owners, prerequisites and done-when for each item are in `docs/teammate-handoff.md`, Section 7.

## Team

| Name | Role | GitHub |
|---|---|---|
| Harrish Govind a/l Sethulingam | Team Leader | - |
| Larm Kai Xian | Full-stack developer | [@lkaixian](https://github.com/lkaixian) |
| Kevinraj Gaunder a/l Selvaraju | Researcher / Tester | - |
| Teoh Yeong Boon | Store and quotation dataset synthesizer | - |
| Muhammad Aqil bin Abdul Malik | Deck designer / Tester | - |

## Submission Checklist

- [x] Team name, domain and SDG track filled in
- [x] Slide deck link added
- [x] Demo video link added
- [x] Replit used, with proof of use in `submission/`
- [x] RunPod used, with proof of use in `submission/`
- [x] Preliminary submission (`SDC2026_SparkSurge_Preliminary.pdf`) in `submission/`
- [x] Technology declaration in `submission/`
- [x] Submission files renamed with the team name
- [x] "How to Run" steps verified on a clean machine
- [x] No API keys or secrets committed to the repository

## License

This project is licensed under the Apache License 2.0. See [LICENSE](LICENSE).
