# LARIS: Quotation Tracker for Malaysian SMEs

[![ci](https://github.com/lkaixian/laris/actions/workflows/ci.yml/badge.svg)](https://github.com/lkaixian/laris/actions/workflows/ci.yml)

LARIS lets a small made-to-order business quote from the chat apps it already uses: customers ask on Telegram (WhatsApp is built, not yet connected), AI reads the request, rules set the price, and the owner approves.

## Team Information

| Field | Details |
|---|---|
| Team Name | SPARK SURGE |
| Team Domain | Domain 2 |
| SDG Track (1–17) | SDG 8 — Decent Work and Economic Growth (Target 8.3) |
| Team Leader | Harrish Govind a/l Sethulingam |
| University | Universiti Tun Hussein Onn Malaysia (UTHM) |
| Number of Members | 4 |

## Links

| Resource | Link |
|---|---|
| GitHub Repository | https://github.com/lkaixian/laris |
| Live Demo | https://laris-malaysia.replit.app |
| RunPod Endpoint | vLLM GPU pod serving Qwen2.5-VL-7B (private, key required). See the RunPod proof of use |
| Slide Deck | [TO ADD] |
| Demo Video | [TO ADD] |

## Overview

### Problem

Malaysia has about 1.07 million MSMEs, which produce 39.7% of GDP and employ 48.7% of workers (DOSM). Made-to-order trades such as signage, printing and 3D printing run quotations through chats, PDFs, photos and spreadsheets. Replies are slow, quotes are priced on remembered costs, and unanswered quotes are never chased. Average business payment delay is 61 days (Experian 2025), so lost margin and lost jobs hurt small firms most. Sources and confidence notes are in `knowledge/03-stats/`.

### Solution

A customer sends a text or a Manglish voice note. ILMU transcribes it and extracts the items as JSON. A rules engine, never the AI, prices the quote from the supplier cost book and applies the owner's margin floor. The owner approves, LARIS sends and tracks the quote, and reminders chase unanswered ones. Staff can also photograph a shelf or price board: a vision model on a RunPod GPU turns it into catalog items for review, and customers can then ask whether something is available or request a quote for it.

### Key Features

- **Chat enquiries** — text and voice notes on Telegram, extracted to structured items. WhatsApp Cloud API code is in place but untested against Meta.
- **Rule-based pricing** — cost book, margin guard, discount guard, stale-cost alerts. No AI output sets a price.
- **Catalog photos** — one photo of labelled products becomes reviewable catalog items (Qwen2.5-VL on RunPod, Tesseract cross-check of every price and SKU).
- **Availability and quote requests** — customers ask "is there eSUN filament?" and get an answer from confirmed catalog items only; "quote 50 kg" creates a draft for the owner.
- **Supplier price lists** — PDF, photo, XLSX, DOCX and CSV imports; quote export to PDF, XLSX and CSV.
- **Owner control** — approval step, custom roles, audit log, signed licence, multi-business isolation with row-level security.
- **Tracker** — sent quotes, timeline, follow-up reminders, customer tracking link.

## Tech Stack

| Layer | Technology |
|---|---|
| Frontend | React 19, TypeScript, Vite, Tailwind CSS |
| Backend | Python, FastAPI, uvicorn, APScheduler |
| Database | PostgreSQL (row-level security); PGlite for tests |
| AI / Compute | RunPod GPU (vLLM, Qwen2.5-VL-7B-Instruct); ILMU API (`ilmu-mini-v3.3`, `ilmu-asr-v4.2`); Tesseract OCR |
| Channels | Telegram Bot API (live), WhatsApp Business Cloud API (built) |
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
├── docs/                 # Deployment, API, roles, licensing, build log
├── knowledge/            # Research notes, sources, decisions
├── submission/           # Hackathon submission documents
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

## How to Run

### Option 1 — Run on Replit (recommended)

1. Import this repository into Replit.
2. Open **Secrets** and add the variables from `.env.example`. The minimum is `DATABASE_URL`, `BOOTSTRAP_OWNER_USERNAME` and `BOOTSTRAP_OWNER_PASSWORD`. For Telegram add `TELEGRAM_BOT_TOKEN`, `TELEGRAM_WEBHOOK_SECRET` and `TELEGRAM_TENANT_ID`. For catalog photos add `RUNPOD_API_KEY` and `RUNPOD_VISION_URL`.
3. Click **Run**. `.replit` starts `run.sh`, which installs dependencies, builds the web app, prepares the database and starts the server on port 5000.

Full Replit, webhook and licence setup: `docs/deploy.md`.

### Option 2 — Run locally

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

About 500 tests run on every push in GitHub Actions.

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
- Honest limits: no stock tracking (replies say "listed", not "in stock"); quotes for catalog items need the owner to confirm bulk pricing; WhatsApp is untested against Meta; ILMU speech and extraction prompts are not yet validated on real Manglish audio; OCR accuracy on real receipts is unmeasured; all data is synthetic; single-process deployment with no failover; the PDPA obligations in `docs/privacy-and-breach-runbook.md` are not yet in place for real customers.

## Future Improvements

- [ ] Connect WhatsApp through Meta and verify the webhook
- [ ] Per-size prices and quantity tiers on catalog items
- [ ] Time real owners on manual versus LARIS quotes to measure minutes saved
- [ ] Stock levels so availability replies can say "in stock"

## Team

| Name | Role | GitHub |
|---|---|---|
| Harrish Govind a/l Sethulingam | Team Leader | [TO ADD] |
| [TO ADD] | [TO ADD] | [TO ADD] |
| [TO ADD] | [TO ADD] | [TO ADD] |
| [TO ADD] | [TO ADD] | [TO ADD] |

## Submission Checklist

- [x] Team name, domain and SDG track filled in
- [ ] Slide deck link added
- [ ] Demo video link added
- [x] Replit used, with proof of use in `submission/`
- [x] RunPod used, with proof of use in `submission/`
- [ ] Preliminary submission (`SDC2026_SparkSurge_Preliminary.pdf`) added to `submission/`
- [x] Technology declaration in `submission/`
- [x] Submission files renamed with the team name
- [ ] "How to Run" steps verified on a clean machine
- [x] No API keys or secrets committed to the repository

## License

This project is licensed under the Apache License 2.0. See [LICENSE](LICENSE).
