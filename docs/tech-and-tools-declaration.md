# LARIS Tech and Tools Declaration

Status as of 2026-10-22. Status values: **implemented** (code in repo), **planned** (chosen, not yet built), **fallback** (used only if the primary fails). "Verified" means checked in the vault with the confidence stated there. Licenses marked "not verified" come from general knowledge, not from the vault, and must be checked before submission. All data in the app is team-made synthetic data.

## 1. AI models and AI tools

| Tool or model | Purpose | Where in repo | License / terms | Data sent to it | Status |
|---|---|---|---|---|---|
| ILMU `ilmu-asr-v4.2` (YTL AI Labs API) | Speech to text for Manglish and Malay voice notes | `src/ilmu.py` (`transcribe`), `tests/test_ilmu.py` (mocked) | Commercial API terms; no-training and data-residency terms not confirmed. Price RM0.0002 per second before SST (console.ilmu.ai/pricing, confidence medium-high). Audio endpoint path `/audio/transcriptions` is unverified | Voice note audio (synthetic) | implemented as client with mocked tests; live call with a real key not yet confirmed |
| ILMU `ilmu-mini-v3.3` | Extract item keys and quantities (enquiries) and parse supplier-quote text into JSON lines. Never sets prices | `src/ilmu.py` (`extract_json`) | Same as above. RM0.20 in, RM1.20 out per 1M tokens | Transcript or OCR text (synthetic) | implemented as client with mocked tests |
| ILMU `ilmu-v3.1`, `ilmu-vision-v1.3` | Listed in vault as available; not used in code | none | Same terms. `ilmu-v3.1` RM4.00 in, RM16.00 out per 1M tokens; vision price not read | none | planned only if tested (vision as OCR alternative); otherwise not used |
| Mesolitica Malaysian Whisper (for example `malaysian-whisper-small-v3`, `Malaysian-whisper-large-v3-turbo-v3`) on RunPod Serverless | Fallback speech to text and the RunPod model call for the sponsor checkbox | `src/ilmu.py` (`transcribe_runpod`); env `RUNPOD_ENDPOINT_URL`, `RUNPOD_API_KEY` | License NOT confirmed (Hugging Face metadata shows none; base Whisper is MIT). Ask Mesolitica before commercial use | Voice note audio (synthetic) | fallback; client written, RunPod worker input shape unverified, endpoint not yet deployed |
| Qwen3-1.7B (or 4B) with vLLM on RunPod Serverless | Alternative extraction model with constrained JSON, only if `ilmu-mini-v3.3` fails the benchmark | none yet | Qwen3-1.7B apache-2.0 (vault, Hugging Face API). Qwen3-4B license unconfirmed | Text (synthetic) | fallback / planned. Few-shot prompting only; LoRA fine-tune dropped by owner |
| PaddleOCR PP-OCRv5 `latin_PP-OCRv5_mobile_rec` | OCR for supplier quote photos and PDFs. Vault lists accuracy 84.7% on PaddleOCR's own eval set; accuracy on Malaysian quotes untested | `src/ocr.py` (`_paddle`), `tests/test_ocr.py` | Apache-2.0 (not verified in vault) | Supplier-quote images (synthetic) | implemented as first engine; result shape for PaddleOCR 3.x marked unverified in code |
| Tesseract OCR (`eng`; `msa` traineddata exists but not yet wired) via `pytesseract` | Second OCR engine when PaddleOCR is unavailable | `src/ocr.py` (`_tesseract`); `requirements.txt` | Tesseract and pytesseract Apache-2.0 (not verified in vault) | Supplier-quote images (synthetic) | implemented as fallback; accuracy untested |
| `pypdf` 6.21.2 | Text layer from PDFs before OCR | `src/ocr.py` (`pdf_text`) | BSD-3-Clause (not verified in vault) | PDFs (synthetic) | implemented |
| Claude Code (Anthropic) | Development assistant used to write code, tests and documents | whole repo | Anthropic terms | Source code and synthetic data | used in development. Team to confirm exact tools and add any others (for example ChatGPT, Gemini, Copilot) |

Design rule shown to anyone who asks: a model extracts and drafts; prices come from rules in `src/pricing.py`; the database has no AI price source (`price_src` enum) and rejects price keys in `ai_actions` payloads.

## 2. Messaging channels and external APIs

| Service | Purpose | Where in repo | Terms / cost | Data sent | Status |
|---|---|---|---|---|---|
| WhatsApp Business Cloud API (Meta) | Primary customer channel: inbound text, voice, photo; outbound quote; delivery and read status | `src/channels/whatsapp.py`, `tests/test_channels.py` (mocked); env `WHATSAPP_*` | Meta terms. Service messages free up to 1,000 per number per month, utility template about RM0.0564, marketing about RM0.3467 (vendor pages, not Meta's rate card, confidence medium). Template approval and test-number limits unverified | Synthetic chat messages, phone numbers of test accounts | implemented as client with mocked tests; live webhook not confirmed |
| Telegram Bot API | Demo and fallback channel behind the same channel adapter | `src/channels/telegram.py`, `src/channels/base.py`; env `TELEGRAM_BOT_TOKEN` | Free; about 1 message per second per chat; file download max 20 MB, upload 50 MB (vault, confidence high). No read receipts for bots | Synthetic messages | implemented as client with mocked tests; fallback if WhatsApp stalls |
| OpenDOSM PriceCatcher | Optional market price benchmark for sanity checks | none | CC BY 4.0, attribute OpenDOSM / MDTN-DOSM (vault, confidence high). Groceries only; weak for B2B quotes | none (public download) | planned only if time; currently NOT used. Remove from final declaration if still unused |

## 3. Hosting, compute, data stores

| Service | Purpose | Where in repo | Terms / cost | Data sent | Status |
|---|---|---|---|---|---|
| Replit (Reserved VM) | Compulsory host for the app, webhook and scheduler | `.replit` from template repo (not yet verified in tree); env via Replit Secrets | Plan prices in vault are possibly stale (Reserved VM shared 0.5 vCPU / 2 GiB listed at $20 per month in a Feb 2025 table; confidence low-medium). Replit region unknown | App code and synthetic data | planned; not yet deployed |
| RunPod Serverless | GPU work: Whisper fallback, optional Qwen3. At least one live model call for the sponsor checkbox | `src/ilmu.py` (`transcribe_runpod`) | US$25 credit per team (deck). Per-second rates in vault: 16GB $0.00016, 24GB $0.00019, 4090 PRO $0.00031. Cold start not measured | Voice note audio (synthetic) | planned; endpoint not yet created |
| PostgreSQL | Main database: documents, lines, cost items, audit log, transitions | `db/schema.sql`, `db/transitions.sql`, `db/functions.sql`, `db/seed_made_to_order.sql` | PostgreSQL License (not verified in vault). Replit Postgres terms unconfirmed | Synthetic rows | schema implemented and checked locally with PGlite; Replit Postgres not yet connected |
| PGlite (`@electric-sql/pglite`, `pglite-socket`) | Local in-process Postgres for schema and seed checks | `package.json`, `tests/db_check.mjs`, `tests/schema_check.mjs` | Apache-2.0 (not verified in vault) | Synthetic rows | implemented (test tooling only) |
| Replit Object Storage / App Storage | Audio, images, PDFs | none | Terms unconfirmed | Synthetic files | planned; may use plain disk with one helper |

## 4. Backend and web libraries

| Library | Purpose | Where | License (not verified in vault unless noted) | Status |
|---|---|---|---|---|
| FastAPI 0.159.1 (Starlette 1.9.0) | API server, webhooks, static UI | `src/app.py`, `src/api/`, `requirements.txt` | MIT / BSD-3-Clause | implemented |
| uvicorn 0.34.0 | ASGI server | `requirements.txt` | BSD-3-Clause | implemented |
| httpx 0.28.1 | HTTP client for ILMU, RunPod, Telegram, WhatsApp | `src/ilmu.py`, `src/channels/` | BSD-3-Clause | implemented |
| PyYAML 6.0.2 | Load trade templates | `src/templates.py`, `config/templates/` | MIT | implemented |
| Pillow | Image decode for OCR | `src/ocr.py` | HPND (MIT-CMU style) | implemented |
| pytest 9.0.3, pip-audit | Tests and dependency audit (dev only, `requirements-dev.txt`) | `tests/`, `.github/workflows/ci.yml` | MIT / Apache-2.0 | implemented |
| GitHub Actions | CI: pytest on PGlite, SQL and role checks, web build, `pip-audit`, `npm audit` | `.github/workflows/ci.yml` | service terms | implemented |
| psycopg 3, python-multipart | Postgres driver, file uploads | `src/db.py`, `src/api/routes.py` | LGPL-3.0 / Apache-2.0 | implemented |
| React 19, react-dom | Web UI | `web/src/` | MIT | implemented (live API and mock mode) |
| Vite 8, @vitejs/plugin-react, TypeScript | Web build | `web/package.json` | MIT / MIT / Apache-2.0 | implemented |
| Tailwind CSS 4 (`@tailwindcss/vite`) | Styling | `web/package.json`, `web/src/theme.css` | MIT | implemented |
| APScheduler 3.11.3 | Expiry, follow-up queue, chat retention purge | `src/scheduler.py` | MIT | implemented |
| openpyxl 3.1.5 | BOM xlsx export (purchase list is plain csv) | `src/api/routes.py` | MIT | implemented |
| reportlab 5.0.1 | Quote PDF (pure Python, no system libraries) | `src/quote_pdf.py` | BSD | implemented |
| trimesh | STL weight for 3D-printing plugin | none | MIT | planned only as optional plugin; cut from core scope |

## 5. Datasets

| Dataset | Use | License | Status |
|---|---|---|---|
| Team-made synthetic data (`db/seed_made_to_order.sql`, `config/templates/*.yaml`, `web/src/mock.ts`, fixtures to be added) | All app data. Every name is prefixed SAMPLE or SYNTHETIC. No real customer, supplier or company record | Created by the team (repo license Apache-2.0, `LICENSE`) | implemented; OCR fixture images with expected JSON still to be made |
| OpenDOSM PriceCatcher | See section 2 | CC BY 4.0 | not used |
| Government statistics quoted in docs (DOSM, SME Corp, The Star, UN SDG metadata) | Citation only, never loaded as data | Per source | cited in `knowledge/` with retrieval date and confidence |
| Yb's shop | Interviews and timing only, no data enters the app | n/a | planned |

## 6. Data-handling summary

- Real personal data: none. All records are synthetic.
- Keys: stored in Replit Secrets and `.env` (git-ignored). `.env.example` lists names only. No key is committed.
- What leaves our system in a real deployment: audio and text to ILMU, audio to RunPod, chat content to Meta or Telegram. See PDPA section of `docs/PRD.md`.

## 7. Replit proof checklist

The deck rule: proof of a live Replit URL, a Replit project link with history, or finished Replit credit, from our own account.

- [ ] Replit project is under the team's own account; project link copied: `[link needed]`
- [ ] Project created from the official template repo (`.replit` present)
- [ ] Reserved VM deployment (not autoscale) is live; deployed URL opens in an incognito window: `[URL needed]`
- [ ] `GET /health` returns `{"status":"ok"}` on the deployed URL
- [ ] Replit Secrets hold all keys; no key in the repo or in screenshots
- [ ] Postgres connected on Replit and `db/schema.sql`, `transitions.sql`, `functions.sql`, `seed_made_to_order.sql` applied in that order (verify the file order against the tests)
- [ ] Screenshot of the project history (commits or checkpoints) with dates
- [ ] Screenshot of the Deployments page showing status and plan
- [ ] Telegram bot reachable from the deployed URL (polling or webhook)
- [ ] Screenshot saved in `submission/` and referenced from the README

## 8. RunPod proof checklist

The deck rule: screenshot the Pod ID (or endpoint URL), GPU type and runtime. Any GPU work must use RunPod. The sponsor checkbox needs Replit plus at least one RunPod model call.

- [ ] RunPod account is the team's own; US$25 credit visible: `[balance screenshot needed]`
- [ ] Serverless endpoint created for Mesolitica Malaysian Whisper (model name and Hugging Face id recorded): endpoint id `[needed]`
- [ ] Screenshot of endpoint page showing endpoint id or URL, GPU type, worker status
- [ ] One real call from the app (`transcribe_runpod`) returns a transcript of a synthetic Manglish voice note; save request time and latency: `[latency REAL DATA needed]`
- [ ] Screenshot of the job or request log showing the call and its runtime
- [ ] Billing page screenshot showing usage
- [ ] Endpoint warmed 10 minutes before the demo; recorded successful run kept as backup
- [ ] If Qwen3 is used: model id, vLLM version, structured-output mode recorded
- [ ] Mesolitica license question answered or the risk stated in the final declaration
- [ ] Endpoint key is in Replit Secrets only

## 9. Items to resolve before submission

1. ILMU audio endpoint path and a live call with a real key (decides which model is primary).
2. Mesolitica model license.
3. Whether PriceCatcher stays; delete its rows if unused.
4. Confirm the full list of AI tools the team used in development.
5. Replace "not verified" licenses with checked ones.
