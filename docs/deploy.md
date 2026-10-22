# Deploy LARIS on Replit (Reserved VM)

Status: written from the repo files, not yet run on Replit. Every Replit step marked **UNVERIFIED** must be checked in the Replit UI on first use and this file corrected if the UI differs.

Deadline reference: Sun 25 Oct 2026, 7:59:59 AM (handbook). The FAQ says 11:59 PM; follow the handbook.

## 0. What runs where

| Piece | Where | Why |
|---|---|---|
| FastAPI app (`src/app.py`), webhooks, APScheduler | Replit Reserved VM | Always on. Autoscale can sleep and would drop webhooks and the scheduler. |
| React build (`web/dist`) | Same process, once `src/app.py` serves it (see Pending changes) | One URL, no CORS. |
| PostgreSQL | Replit PostgreSQL (`DATABASE_URL`) | Hackathon rule: Replit is compulsory. |
| GPU calls (STT fallback, optional LLM) | RunPod serverless endpoint | Hackathon rule: any GPU work on RunPod. |
| Speech and extraction | ILMU API (`ilmu-asr-v4.2`, `ilmu-mini-v3.3`) | Primary path. Endpoint path not yet verified. |

Config files in the repo: `.replit` (run and deployment), `replit.nix` (Python 3.11, Node 20, PostgreSQL 16 client, Tesseract), `run.sh` (install, one-time DB bootstrap, start uvicorn on `$PORT`).

## Pending changes in src/ and root (for the lead, before the first deploy)

These are not made by this file. The deploy config assumes them.

1. **Serve the React build from FastAPI.** Add to the end of `src/app.py`, after every router and webhook route is included (a mount on `/` shadows routes added after it):

   ```python
   from pathlib import Path
   from fastapi.staticfiles import StaticFiles

   _DIST = Path(__file__).resolve().parent.parent / "web" / "dist"
   if _DIST.is_dir():
       app.mount("/", StaticFiles(directory=_DIST, html=True), name="web")
   ```

   Deep links (for example `/documents/123` on refresh) return 404 with this. Add a fallback to `index.html` only if the UI uses client routes.
2. **Add the routes this file tests:** `GET`/`POST /webhooks/whatsapp`, `POST /webhooks/telegram`, and the `/api/*` endpoints in `docs/api-contract.md`. Only `/health` exists today.
3. **Scheduler:** start APScheduler only when `os.environ.get("SCHEDULER") == "1"`. Keep one worker (`run.sh` already does this). Add `APScheduler` to `requirements.txt`.
4. **Database driver:** no DB code exists yet. Add the driver you choose (for example `psycopg[binary]`) to `requirements.txt`. `run.sh` uses `psql` for bootstrap only.
5. **Telegram webhook secret:** no check exists. Recommended: verify the `X-Telegram-Bot-Api-Secret-Token` header against a new env var (add it to `.env.example` and Secrets).
6. **`.gitignore`:** the line `package*.json` in the repo root also matches `web/package.json` and `web/package-lock.json`. Neither is in the git index, so a fresh push omits them and `npm ci` fails on Replit. Change it to `/package*.json` (root only), or delete the line. Then re-check that `web/package.json` shows up as a new file.
7. **Form uploads:** if the app accepts uploaded photos or PDFs through FastAPI `UploadFile`, add `python-multipart` to `requirements.txt`.

## 1. Push the repo to GitHub

1. Commit and push with your normal git flow.
2. Confirm these files are in the GitHub repo: `web/package.json`, `web/package-lock.json`, `.replit`, `replit.nix`, `run.sh`, `requirements.txt`, `config/`, `db/`.
   - Known issue: the root `.gitignore` line `package*.json` hides `web/package.json` and `web/package-lock.json`. Fix it first (Pending changes, item 6).
3. Never commit `.env`. It is in `.gitignore`. Run the key scan in section 13 before pushing.

## 2. Create the Repl from GitHub

1. Replit: Create Repl, then Import from GitHub, and pick the LARIS repo.
2. Let Replit read `.replit` and `replit.nix`. If it asks for a language template, any Python template is fine; the `.replit` run command overrides it.
3. **UNVERIFIED:** whether the Nix environment reloads after `replit.nix` is added. If `psql` or `tesseract` is missing in the Shell, open the Repl again or rebuild the environment.

## 3. Provision PostgreSQL

1. Open the Database tool (sidebar) and add PostgreSQL to the Repl.
2. Replit sets `DATABASE_URL` in the workspace. Check it appears under Secrets or Environment.
3. **UNVERIFIED:** deployments may use a separate production database with its own `DATABASE_URL`. In the Deployments pane, confirm the deployed app has `DATABASE_URL`. If it does not, `run.sh` stops with "DATABASE_URL not set" in the deployment logs.

## 4. Add Secrets

Open Tools > Secrets (or the lock icon). Add each key below. Values come from the provider consoles. Do not paste them into `.replit`, `.env.example`, or any file in the repo.

| Secret | Needed for | Required for demo |
|---|---|---|
| `ILMU_API_KEY` | ILMU ASR and extraction | yes |
| `ILMU_BASE_URL` | override base URL (default `https://api.ilmu.ai/v1`) | no |
| `ILMU_ASR_PATH` | override ASR path (default `/audio/transcriptions`, unverified) | only if the default fails |
| `WHATSAPP_TOKEN` | WhatsApp Cloud API bearer token | yes if WhatsApp is shown |
| `WHATSAPP_PHONE_NUMBER_ID` | WhatsApp sender | yes if WhatsApp is shown |
| `WHATSAPP_VERIFY_TOKEN` | Meta webhook verify. Make up a long random string. | yes if WhatsApp is shown |
| `WHATSAPP_APP_SECRET` | checks `X-Hub-Signature-256` on inbound webhooks | yes if WhatsApp is shown |
| `TELEGRAM_BOT_TOKEN` | Telegram bot | yes if Telegram is shown |
| `RUNPOD_ENDPOINT_URL` | RunPod fallback STT endpoint | yes (sponsor proof) |
| `RUNPOD_API_KEY` | RunPod auth | yes (sponsor proof) |
| `SEED` = `1` | synthetic demo data, first bootstrap only | demo only, then delete |

Not secrets, already in `.replit` `[env]`: `SCHEDULER=1`.

Do not set `SEED` permanently. `run.sh` only applies the seed when the database is empty (first bootstrap). To seed a database that already has tables, run `psql "$DATABASE_URL" -f db/seed_made_to_order.sql` from the Shell, once.

## 5. First run in the workspace

1. Click Run. Expected log: `bootstrap: applying db/*.sql (SEED=0)` on the first run, then uvicorn startup on port 5000.
2. In the Shell, check: `psql "$DATABASE_URL" -c "\dt"` lists `documents`, `document_lines`, `cost_items` and the rest.
3. Open the Webview and check `/health` (section 11).

Note: `run.sh` applies the schema only when the `documents` table is missing. If a bootstrap fails halfway, `-1` (single transaction) rolls it back. Fix the cause and run again.

## 6. Get the public URL

1. **UNVERIFIED:** the URL format. Expect `https://<app-name>.<user>.replit.app` for a deployment, and a dev URL for the workspace.
2. Record the deployment URL in the README `Live Demo` line and in the proof documents (section 12).

## 7. Deploy as a Reserved VM

1. Click Deploy. Choose **Reserved VM**. Do not choose Autoscale. Autoscale sleeps when idle, and that would break Telegram and WhatsApp webhooks and APScheduler.
2. **UNVERIFIED:** the deployment type label and the `deploymentTarget = "vm"` value in `.replit`. If the UI shows a different target name, set it to Reserved VM in the UI and keep the build and run commands from `.replit`.
3. Build command (from `.replit`): `pip install -q -r requirements.txt && cd web && npm ci && npm run build`.
4. Run command (from `.replit`): `bash run.sh`.
5. Wait for "Deployment is live". Then check `/health` on the deployment URL.
6. Reserved VM bills while it is on. Check the price in the Replit console. The ADR figures are from a Feb 2025 table and may be stale (see `knowledge/06-tech-stack/adr-replit-hosting.md`).

## 8. Set the WhatsApp webhook

Prerequisite: a Meta app with the WhatsApp Cloud API and a test number. Free-form replies only work inside the 24-hour customer service window. Outside it, Meta needs approved templates. **UNVERIFIED:** current Meta template and pricing rules (the owner notes say the billing changed from 1 Oct 2026).

1. Meta Developer console > your app > WhatsApp > Configuration.
2. Callback URL: `https://<deployment-domain>/webhooks/whatsapp`
3. Verify token: the exact value of `WHATSAPP_VERIFY_TOKEN`.
4. Click Verify and save. Meta sends a GET with `hub.mode`, `hub.verify_token`, `hub.challenge`. The app must echo `hub.challenge`.
5. Subscribe to the `messages` field.
6. Copy the test number's Phone number ID to `WHATSAPP_PHONE_NUMBER_ID`. Create a permanent system user token for `WHATSAPP_TOKEN` (the temporary token expires in 24 h). **UNVERIFIED:** current Meta token options.
7. Copy the app secret (App settings > Basic) to `WHATSAPP_APP_SECRET`.

**Status:** the parsing and signature helpers exist in `src/channels/whatsapp.py`. The `/webhooks/whatsapp` route is not in `src/app.py` yet (Pending changes, item 2). Verification returns 404 until it is added.

## 9. Set the Telegram webhook (or polling)

Use the setup script (it sends the secret token, so the route accepts only Telegram):

```bash
python scripts/setup_channels.py check                      # which keys are set (never prints values)
python scripts/setup_channels.py telegram-webhook https://<deployment-domain>/webhooks/telegram
python scripts/setup_channels.py telegram-info              # last_error_message must be empty
python scripts/setup_channels.py telegram-poll              # local only: long-poll and forward to localhost:5000
```

`/webhooks/telegram` returns 403 until `TELEGRAM_WEBHOOK_SECRET` is set. WhatsApp: callback `https://<deployment-domain>/webhooks/whatsapp`, verify token = `WHATSAPP_VERIFY_TOKEN`, subscribe to `messages`. After 24h of customer silence only a template can be sent: create a utility template with one `{{1}}` body parameter and set `WHATSAPP_FOLLOWUP_TEMPLATE` to its name. On a public URL set `APP_TOKEN`; the UI asks for it once per tab.

## 10. RunPod endpoint (sponsor proof)

1. RunPod console > Serverless > New Endpoint. Pick one model: Mesolitica Whisper for STT (fallback path), or Qwen3 for extraction if the ILMU path fails. Note the GPU type (for example 16 GB or 24 GB class, from `knowledge/03-stats/pricing-numbers.md`; verify the current price in the console).
2. Copy the Endpoint ID. Set `RUNPOD_ENDPOINT_URL` to `https://api.runpod.ai/v2/<ENDPOINT_ID>` and `RUNPOD_API_KEY` to a RunPod API key.
3. Warm it about 10 minutes before the demo. Cold start can take minutes. Scale-to-zero is the default for serverless.
4. Run one real job so the runtime appears in the logs. `src/ilmu.py` calls `/runsync` with `{"input": {"audio_base64": ..., "mime": ...}}`. **UNVERIFIED:** the input shape of the deployed worker.
5. Keep the console page with the Endpoint ID, GPU type, and job runtime for the proof.

## 11. Smoke tests

Replace `$BASE` with the deployment URL, for example `export BASE=https://<deployment-domain>`.

```bash
# Works today: the only route in src/app.py.
curl -s "$BASE/health"                      # expect {"status":"ok"}

# Static UI after the static-serving change (Pending changes, item 1). Expect 200:
curl -s -o /dev/null -w "%{http_code}\n" "$BASE/"

# Planned in docs/api-contract.md. Expect 404 until the routes exist.
curl -s "$BASE/api/me" -H "X-Role: owner" -H "X-User: <uuid-from-seed>"
curl -s "$BASE/api/tracker" -H "X-Role: owner" -H "X-User: <uuid-from-seed>"
curl -s -X POST "$BASE/api/enquiries/simulate" -H "X-Role: owner" -H "X-User: <uuid-from-seed>" \
  -H "Content-Type: application/json" -d '{"channel":"telegram","text":"Need 20 acrylic signboards"}'

# WhatsApp verify (expect the challenge echoed back, 403 if the token is wrong):
curl -s "$BASE/webhooks/whatsapp?hub.mode=subscribe&hub.verify_token=$WHATSAPP_VERIFY_TOKEN&hub.challenge=12345"

# WhatsApp signed POST (expect 200; wrong secret must give 403):
BODY='{"entry":[]}'
SIG="sha256=$(printf '%s' "$BODY" | openssl dgst -sha256 -hmac "$WHATSAPP_APP_SECRET" | awk '{print $2}')"
curl -s -o /dev/null -w "%{http_code}\n" -X POST "$BASE/webhooks/whatsapp" \
  -H "Content-Type: application/json" -H "X-Hub-Signature-256: $SIG" -d "$BODY"

# Export (planned): expect a file download.
curl -s -o bom.xlsx "$BASE/api/export/bom.xlsx?quote_id=<quote-uuid>" -H "X-Role: owner" -H "X-User: <uuid>"
```

The `/api/*` and export lines are expected to fail until the routes exist. Do not record them as passing.

## 12. Hackathon proof

Replit proof (compulsory, with declaration):
1. Screenshot of the Repl page showing the project name and the URL (the Repl link).
2. Screenshot of the Deployments page showing type Reserved VM, status Live, and the deployment URL.
3. Screenshot of `/health` returning `{"status":"ok"}` on the deployment URL, with the address bar visible.
4. Fill in `submission/REPLIT PROOF OF USE.pdf` (currently an example-only template).

RunPod proof (any GPU work):
1. Screenshot of the endpoint page showing the Endpoint ID, GPU type, and the job list.
2. Screenshot of one completed job showing its runtime or execution time.
3. Fill in `submission/RUNPOD PROOF OF USE.pdf`.

Keep the screenshots out of the repo if they show keys or personal data. Use a `docs/` path only if they are clean.

## 13. Pre-submission link checklist

- [ ] Open the Replit deployment URL in an incognito window. It loads without login, and `/health` returns ok.
- [ ] The GitHub repo is public at submission time. Open it in incognito too.
- [ ] No keys in the repo (run the key scan below).
- [ ] `.env` is not in the repo; `.env.example` has only placeholders.
- [ ] `SEED` removed from Secrets after the demo data is loaded, if the demo no longer needs a fresh bootstrap.
- [ ] Deployment is Live and stays on until judging ends.
- [ ] RunPod endpoint warm, one job run recently, runtime visible in logs.
- [ ] Proof PDFs filled in (Replit and RunPod).
- [ ] Demo video 5 to 7 minutes. Per the rules, running over 7:00 deducts 1 mark per 30 s.
- [ ] Demo data is synthetic. No real customer records or phone numbers in the demo.
- [ ] Declaration lists every AI tool, model, and dataset (ILMU, Mesolitica Whisper, Qwen3 if used, PaddleOCR or Tesseract).
- [ ] Deadline: Sun 25 Oct 2026, 7:59:59 AM (handbook). Submit Saturday night.

Key scan (run from the repo root; no output means no match for these patterns):

```bash
grep -rInE "(sk-[A-Za-z0-9]{10,}|AKIA[0-9A-Z]{12,}|[0-9]{8,10}:[A-Za-z0-9_-]{30,})" \
  --exclude-dir=node_modules --exclude-dir=.venv --exclude-dir=.git --exclude-dir=dist . 
```

This does not catch every secret format. Also check the Secrets pane is the only place values live.

## 14. Troubleshooting

| Symptom | Likely cause | Fix |
|---|---|---|
| "DATABASE_URL not set" in deployment logs | Database not linked to the deployment | Section 3 step 3. |
| `psql: command not found` | `replit.nix` not applied | Reopen the Repl or rebuild the Nix environment. |
| Bootstrap error on `CREATE TYPE` | Half-applied schema from an older run | Drop the schema in the Shell (`DROP SCHEMA public CASCADE; CREATE SCHEMA public;`) then run again. Only on the demo DB. |
| `npm ci` fails in build | `web/package.json` or lock file not in GitHub | Pending changes, item 6. |
| Port error or 502 | App not bound to `$PORT` or 5000 | `run.sh` uses `${PORT:-5000}`; check `.replit` `localPort` matches. |
| Scheduler jobs run twice | More than one uvicorn worker | Keep `--workers 1` in `run.sh`. |
| WhatsApp verify fails | Route missing, or token mismatch | Section 8. |
| `tesseract` not found in OCR tests | Nix package not applied | Section 2 step 3. |

## 15. Rollback

Redeploy the previous version from the Deployments history. **UNVERIFIED:** Replit deployment rollback UI. If unavailable, push a revert to GitHub and redeploy.

## 16. Things this file does not cover

- No Docker, Kubernetes, or CI pipeline. The ponytail rule is one `.replit` and one `run.sh`.
- No ILMU endpoint check. Verify with one real call before the demo (`ILMU_ASR_PATH` is unverified).
- No legal review of PDPA. See the README privacy note.
