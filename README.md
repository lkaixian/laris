# LARIS: Quotation Tracker for Malaysian SMEs

LARIS keeps the supplier prices behind each customer quote up to date, so a quote is not sent on an old cost without the owner knowing.

**Team:** [TEAM NAME]
**Hackathon:** SDC Hackathon 2026
**Track:** [TRACK]
**Demo video:** [VIDEO LINK]
**Live demo (Replit):** [REPLIT URL]
**Status:** prototype in progress. See [What works today](#what-works-today) before relying on anything here.

---

## Problem

Small businesses that quote per job (contractors, printing and signage, custom fabrication, catering, service jobs) receive supplier quotes in WhatsApp chats, photos and PDFs. Those supplier prices are not linked to the customer quotes the owner sends later. When a supplier raises a price, quotes already out or about to go out can be priced on the old cost, and the owner may not notice until the margin is gone. How often this happens is not yet measured (see below).

Numbers, with source status:

- MSMEs contribute **39.7%** of GDP in 2025 (DOSM, verified).
- MSMEs provide **48.7%** of national employment in 2025 (DOSM, verified).
- DOSM counts **1,069,831** MSME establishments in the Economic Census 2023 profile (verified; the page does not state the reference year). Other series give different counts, for example "almost 1.3 million" in a 2025 ministerial statement (medium confidence). The sources differ and are kept separate in `knowledge/03-stats/`.
- **67%** of SMEs cite rising costs as a key pressure (Airwallex 2026 outlook, reported by The Star; medium confidence; survey sample not checked).
- Average business payment delay is **61 days** (Experian 2025, via secondary reports; medium confidence). This is cash-flow evidence, not quote evidence.
- Share of Malaysian SMEs that price per job: **REAL DATA needed**. No published figure found.
- Margin lost to stale-cost quotes: **REAL DATA needed**. To be measured with owners (interview and timing sessions).
- Minutes per quote, manual versus LARIS: **REAL DATA needed**. Not yet timed.

Sources and status notes live in `knowledge/03-stats/`.

## Solution

LARIS follows one journey for each supplier quote and each customer enquiry:

1. **Supplier quote in.** A staff member sends a supplier quote as a photo or PDF. LARIS reads the lines and asks the owner to confirm the items that matter.
2. **Cost book.** Confirmed lines become cost items. Each cost item records its supplier document, line, and date.
3. **Customer enquiry in.** A customer sends a text or a voice note. An LLM extracts the requested items. The LLM never sets prices.
4. **Priced by rule.** A rules engine prices the quote from the cost book, applies the owner's margin floor and discount limit, and flags any line whose cost has moved past the alert threshold.
5. **Owner approves.** Only the owner can approve a quote. Staff do not see margins or supplier costs (design goal, see limitations).
6. **Track and log.** Sent quotes are tracked. Every status change goes to an audit log. When a newer supplier price affects an open quote, LARIS raises a stale-cost alert.

The idea is margin protection. The tracker is the plumbing.

## Features

| Feature | Status |
|---|---|
| Health check endpoint | In repo (`GET /health`) |
| Pricing engine: cost-based pricing, margin guard, discount guard, stale-cost check, STL weight to grams | In repo, unit tests in `tests/test_pricing.py` |
| AI output validation: confidence gate, item matching to the catalog, date parsing | In repo, tests in `tests/test_validate.py` |
| LLM rule that blocks price fields from AI output | In repo (`src/pricing.py`) |
| Trade templates as YAML (`made_to_order`, `fnb_catering`) | In repo (`config/templates/`) |
| Database schema with status transitions, audit trigger, promote-to-cost-book function, synthetic seed | In repo (`db/`) |
| WhatsApp Cloud API helpers: verify challenge, signature check, parse inbound, send text and template | In repo (`src/channels/whatsapp.py`). Routes not yet wired |
| Telegram Bot API helpers: parse update, send, fetch file, long-poll helper | In repo (`src/channels/telegram.py`). Routes not yet wired |
| OCR wrapper: PaddleOCR first, Tesseract fallback | In repo (`src/ocr.py`). Not tested on real quotes |
| ILMU client: speech-to-text, JSON extraction, RunPod fallback | In repo (`src/ilmu.py`). Endpoints not verified |
| React frontend: tracker, document view, theme toggle, mock mode | In repo (`web/`). Real API wiring pending |
| Owner approval and staff view without margins | Designed in `docs/api-contract.md`. Not yet enforced end to end |
| Quote PDF, BOM and PO exports (xlsx and csv) | Planned |
| 48-hour follow-up job with APScheduler | Planned |

## Tech Stack

| Layer | Technology | Status |
|---|---|---|
| Backend | Python 3.11, FastAPI 0.115, uvicorn, httpx | In repo |
| Database | PostgreSQL (Replit PostgreSQL when deployed). PGlite used for schema checks only | Schema in repo. No DB driver code yet |
| Frontend | React 19, Vite 8, TypeScript, Tailwind CSS 4 | In repo |
| Channels | WhatsApp Business Cloud API (Graph v21.0), Telegram Bot API | Client code in repo. Routes pending |
| Speech to text | ILMU `ilmu-asr-v4.2` (primary). RunPod-hosted Whisper as fallback | Client code in repo. Endpoint path unverified |
| Extraction LLM | ILMU `ilmu-mini-v3.3`, JSON output with few-shot examples | Client code in repo. Quality unmeasured |
| OCR | PaddleOCR (optional, not in `requirements.txt`), Tesseract via pytesseract (English only for now) | Code in repo. Accuracy unmeasured |
| Pricing and validation | Python rules, YAML templates | In repo, tested |
| Scheduler | APScheduler | Planned |
| Exports and PDF | openpyxl, WeasyPrint | Planned |
| Hosting | Replit Reserved VM (single process, always on) | Config in repo. Not yet deployed |
| GPU work | RunPod serverless endpoint | Planned for the sponsor proof |

## Architecture

Text sketch of the quotation flow. Arrows show data direction. The AI boxes produce items and text only.

```
IN
  Supplier quote (photo, PDF)  --+
  via WhatsApp or Telegram       |
                                 v
                     OCR (PaddleOCR | Tesseract)
                                 |
                                 v
                     validate_extraction
                       - confidence < 0.80 --> needs_review (owner confirms)
                       - item match to catalog
                                 |
                  owner confirms |
                                 v
                     cost_items (supplier doc, line, date)

  Customer enquiry (text, voice note)
                                 |
  voice note --> ILMU ASR (RunPod Whisper fallback)
                                 |
                                 v
                     ILMU LLM extract_json (items only, no prices)
                                 |
                                 v
  price_quote  <-- cost_items + trade template (rules, no AI)
       |
       +--> margin_guard, discount_guard
       |
       v
  draft quote  --> owner approves (owner role only, audit row)
                                 |
                                 v
  send to customer (WhatsApp or Telegram) --> tracker (sent, accepted) --> job

  stale_check: a newer supplier cost beyond drift_alert_pct --> alert on open quotes

OUT
  quote PDF, BOM/PO xlsx and csv (planned)
```

Core rule: no AI output sets a price. `src/pricing.py` rejects price-like keys in extraction output.

## What works today

- `GET /health` returns `{"status": "ok"}`. This is the only HTTP route in `src/app.py`.
- The pricing, validation, template, and channel-parsing modules have unit tests in `tests/`.
- The database schema, transition rules, and seed can be loaded into PostgreSQL (`db/`).
- The React app runs in mock mode without a backend.

Nothing else in the sketch above is wired end to end yet. The demo flow depends on work still in progress.

## Getting Started

### Prerequisites

- Python 3.11 or newer
- Node.js 20 or newer
- PostgreSQL 16 for the full local setup (optional for schema checks, see below)
- Tesseract OCR, if you want the OCR tests to run (`eng` language)

### 1. Backend

```bash
# macOS / Linux
python3.11 -m venv .venv
source .venv/bin/activate

# Windows (PowerShell or cmd)
py -3.11 -m venv .venv
.venv\Scripts\activate

pip install -r requirements.txt
cp .env.example .env            # Windows: copy .env.example .env
```

The app reads environment variables with `os.environ`. No `.env` loader is installed, so export the variables in your shell or your IDE run configuration. Leave the keys empty for mock and offline work. Never commit `.env`.

Run the API:

```bash
uvicorn src.app:app --reload --port 8000
curl http://localhost:8000/health
```

Run the tests:

```bash
python -m pytest tests
```

### 2. Database (optional locally)

With a local PostgreSQL 16 server:

```bash
createdb laris
export DATABASE_URL=postgresql://localhost/laris
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -1 \
  -f db/schema.sql -f db/transitions.sql -f db/functions.sql
# Optional synthetic demo data (run after the three files above):
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -1 -f db/seed_made_to_order.sql
```

Without a server, `tests/schema_check.mjs` runs the same SQL in PGlite (Postgres compiled to WebAssembly, in-process). It checks the schema only. It is not a running database for the API.

```bash
npm install
node tests/schema_check.mjs
```

### 3. Frontend

```bash
cd web
npm ci
npm run dev:mock     # mock mode: no backend needed, sample data
npm run dev          # real mode: proxies /api to http://localhost:8000
```

Real mode will show errors for any `/api` route that does not exist yet.

### 4. Replit

See `docs/deploy.md` for the Replit Reserved VM setup, Secrets list, webhook setup, and smoke tests. The `.replit` file runs `run.sh`, which installs requirements, bootstraps the database once, and starts uvicorn on port 5000.

## Project Structure

```
.
├── src/
│   ├── app.py            FastAPI app (currently /health only)
│   ├── pricing.py        Rules pricing, margin and discount guards, stale-cost check
│   ├── validate.py       Extraction validation and catalog matching
│   ├── ocr.py            OCR wrapper (PaddleOCR, then Tesseract)
│   ├── ilmu.py           ILMU ASR and LLM client, RunPod fallback
│   ├── templates.py      Trade template loader
│   └── channels/         WhatsApp and Telegram helpers
├── config/templates/     Trade templates (YAML)
├── db/                   Schema, transitions, functions, synthetic seed
├── web/                  React + Vite + Tailwind frontend
├── tests/                pytest tests and PGlite schema checks
├── docs/                 API contract and deployment guide
├── knowledge/            Research notes, sources, decisions
├── submission/           Hackathon proof templates
├── .replit               Replit run and deployment config
├── replit.nix            Replit system packages
├── run.sh                Replit entrypoint (install, bootstrap, start)
├── requirements.txt
└── .env.example
```

## Honest Limitations

- **No real customer or supplier data has been tested.** All demo data is synthetic and invented.
- **OCR accuracy is unmeasured** on real supplier quotes, especially thermal receipts and phone photos.
- **Speech-to-text is unverified.** The ILMU transcription path is not confirmed, and Manglish accuracy has not been measured.
- **Authentication is simulated.** The API design uses `X-Role` and `X-User` headers. This is not secure and must not be used with real data.
- **Role rules are not enforced end to end yet.** The design keeps margins and supplier costs out of staff responses. Verify this with tests once the routes exist. Database row-level security is not enabled.
- **Channels are not wired.** WhatsApp and Telegram helpers exist, but the webhook routes do not. The Telegram webhook does not check a secret token yet.
- **One trade template is meant to be end to end.** The second template is configuration only.
- **No PDF, export, scheduler, or follow-up job yet.** These are planned.
- **Pricing is a model, not a validated method.** The margin rules and templates have not been tested with a real SME.
- **Not a tax or e-Invoice tool.** SST and e-Invoice (MyInvois) are out of scope.
- **Single process on Replit.** No failover. The scheduler and webhooks depend on that one process being up.
- **Money** is stored as strings with 2 to 4 decimals. Currency is MYR only.
- **Replit and RunPod costs** are not yet measured for the demo period.

## Privacy and PDPA Note

- The hackathon build uses **synthetic data only**. No real customer records, phone numbers, voice notes, or supplier documents are in the repo or the demo.
- In real use, chats, voice notes, customer names and phone numbers are personal data under the Personal Data Protection Act 2010 as amended in 2024. The SME would be the controller. LARIS would act as a processor, which the amended Act makes directly liable for security. This is our reading of secondary sources, not legal advice.
- Vendors that would receive personal data: Meta (WhatsApp Cloud API), Telegram (Bot API), ILMU (speech-to-text and extraction), RunPod (fallback speech-to-text), and Replit (hosting; data region not confirmed). Each needs a processing agreement and a cross-border review before real use.
- Secondary sources say the amended Act requires a data protection officer for controllers and processors, and a breach notice to the Commissioner within 72 hours. Neither is set up for this prototype. [DPO NAME TBD]
- Planned minimisation: keep the transcript and the structured quote, not the raw audio, and set a retention period. Not built yet.
- A PDP public consultation paper on AI and personal data (No. 1/2026, dated 5 Oct 2026) is not law yet. Track it before any pilot.

## Team

| Name | Role | GitHub |
|---|---|---|
| [TEAM MEMBER 1] | [ROLE] | [@handle] |
| [TEAM MEMBER 2] | [ROLE] | [@handle] |
| [TEAM MEMBER 3] | [ROLE] | [@handle] |

## License

Apache License 2.0. See [LICENSE](LICENSE).
