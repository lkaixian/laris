# Deploy LARIS on Replit (Reserved VM)

Status: written from the repo files, not yet run on Replit. Every Replit step marked **UNVERIFIED** must be checked in the Replit UI on first use and this file corrected if the UI differs.

Deadline reference: Sun 25 Oct 2026, 7:59:59 AM (handbook). The FAQ says 11:59 PM; follow the handbook.

## 0. What runs where

| Piece | Where | Why |
|---|---|---|
| FastAPI app (`src/app.py`), webhooks, APScheduler | Replit Reserved VM | Always on. Autoscale can sleep and would drop webhooks and the scheduler. |
| React build (`web/dist`) | Same process (`src/app.py` serves it) | One URL, no CORS. |
| PostgreSQL | Replit PostgreSQL (`DATABASE_URL`) | Hackathon rule: Replit is compulsory. |
| GPU calls (STT fallback, optional LLM) | RunPod serverless endpoint | Hackathon rule: any GPU work on RunPod. |
| Speech and extraction | ILMU API (`ilmu-asr-v4.2`, `ilmu-mini-v3.3`) | Primary path. Endpoint path not yet verified. |

Config files in the repo: `.replit` (run and deployment), `replit.nix` (Python 3.11, Node 20, PostgreSQL 16 client, Tesseract), `run.sh` (install, one-time DB bootstrap, start uvicorn on `$PORT`).

## Pre-flight (all in the repo now; verify once on Replit)

- The React build is served by `src/app.py` (SPA fallback, mounted after every router). `web/dist` is built by the `.replit` build command.
- `/api/*` and `/webhooks/whatsapp|telegram` exist. The Telegram route returns 403 until `TELEGRAM_WEBHOOK_SECRET` is set.
- APScheduler starts only when `SCHEDULER=1` (set in `.replit`). Keep one worker (`run.sh` does).
- `psycopg`, `APScheduler` and `python-multipart` are in `requirements.txt`. `pytest` and `pip-audit` live in `requirements-dev.txt`.
- `.gitignore` ignores only the root `/package*.json`, so `web/package.json` and `web/package-lock.json` are committed.
- On any public URL, create a password account (below) and do not set `DEMO_MODE`. Header-only demo mode (anyone can send `X-Role: owner`) is acceptable only for synthetic demo data, and is off by default on a Replit deployment and whenever `APP_TOKEN` is set.

## First sign-in accounts

Header-only demo mode (the `X-Role` and `X-User` headers decide who you are, no sign-in) is allowed only while no account has a password, `REQUIRE_USER_TOKEN` is not `1`, and either `DEMO_MODE=1` is set or this is a plain local run (no `APP_TOKEN`, not a Replit deployment). Otherwise every `/api` call without a valid session or token gets 401. To switch to real sign-in: `python scripts/create_token.py list`, then `python scripts/create_token.py account "<owner name>" <username>` (asks for the password). The moment one account has a password, demo mode is off for good, even if `DEMO_MODE=1`, and the login screen is shown; the owner adds everyone else on the Team page. `REQUIRE_USER_TOKEN=1` also forces it off before any account exists. `APP_TOKEN` only works in demo mode, and then only for users of the first tenant. Sessions last `SESSION_HOURS` (default 12).

## Credentials: tokens, lockout, sessions

- **API tokens expire.** `python scripts/create_token.py issue <user> [--days N]` prints the expiry (default 90 days); an expired token gets the same 401 as an unknown one. Tokens that existed before this change were given 90 days from the first start after the upgrade. `revoke` removes the token and every session of that user.
- A password change, and an owner changing a user's role, active flag or password, also removes that user's API token and sessions (a self-service password change keeps only the current session). `create_token.py account` refuses a deactivated user unless you pass `--reactivate`.
- **Sign-in lockout (in memory, one process):** 5 failed sign-ins for a username lock it for 1 minute, then 2, 4, 8 and at most 15 minutes for each further 5 failures; a success, or 15 minutes with no failures, resets it. A lapsed lock needs 5 new failures to lock again. Separately, one client address may make 30 failed sign-ins per 15 minutes across all usernames, then gets 429. The current-password check in `POST /api/me/password` is throttled per user the same way. A restart clears the counters. Set `TRUST_PROXY=1` on Replit so the address is the real client, not the proxy.
- Passwords are scrypt N=2^16 (64 MiB per sign-in; size the instance accordingly). Older hashes keep working and are upgraded on the next successful sign-in. Very common passwords and a password equal to the username are refused.
- Each user keeps at most 10 sessions (the oldest is dropped at sign-in); expired sessions are purged at sign-in. `db/auth.sql` (new columns) is applied on every start.

## Transport hardening

Every response carries `X-Content-Type-Options: nosniff`, `Referrer-Policy: no-referrer`, `X-Frame-Options: DENY`, `Permissions-Policy` (camera for this origin only; the Ask page uses it) and a `Content-Security-Policy` (same-origin only, no CDNs, no frames). The CSP allows the one inline theme script in `web/dist/index.html` by SHA-256 hash, computed at startup from the built file; if you add another inline script, rebuild and restart. `Strict-Transport-Security` (1 year) is added only on https requests: the request scheme, or `X-Forwarded-Proto` when `TRUST_PROXY=1`. `/api/*` responses are `Cache-Control: no-store`.

- `/docs`, `/redoc` and `/openapi.json` are off. Set `ENABLE_DOCS=1` for a developer machine only.
- Upload caps: 10 MB for `/api/documents/ingest`, 8 MB for the Ask photo, 1 MB for webhooks, 20 MB for downloaded WhatsApp/Telegram media. POST/PUT/PATCH under `/api` and `/webhooks` must send `Content-Length`; chunked bodies get 411, oversized ones 413, and uploads are also cut off while being read. A reverse proxy in front must not re-chunk request bodies.
- Images over 25 megapixels are refused (422) before OCR.
- `CORS_ORIGINS` entries are trimmed; the app serves the UI itself, so leave it unset in production.

## Health check and backups

`GET /health` answers if the process is up; `GET /ready` also checks the database (503 if it is not reachable): point an uptime monitor at `/ready`. `scripts/backup.sh` writes a compressed `pg_dump`; run it on a schedule from somewhere other than the app server and keep the files private (they hold customer names, numbers and supplier prices). Restore command is in the script header. Not yet tried against Replit's Postgres.

## Least-privilege database role (recommended before real customers)

`db/roles.sql` creates `laris_app`: it can read and write the tables but owns nothing, so it cannot disable the audit or transition triggers, alter tables, or edit or delete audit rows (checked in CI by `tests/roles_check.mjs` on PGlite). Set a password for it, then give the running app that role's URL as `DATABASE_URL` and keep the owner's URL as `DATABASE_URL_OWNER`: only startup (`apply_schema`) uses the owner URL, and it re-applies the grants. UNVERIFIED on Replit's Postgres: confirm the Replit user is allowed to `CREATE ROLE`; if not, use a separate Postgres (Neon, Supabase) for production. `db/rls.sql` (applied on start) then limits that role to its own tenant's rows: a request sets `laris.tenant`, system work (login lookup, webhooks, scheduler) sets `*`. Tables are also set to `FORCE ROW LEVEL SECURITY`, so even the table owner is held to the tenant rules, as long as that database user is a plain user. A superuser (or a role with `BYPASSRLS`) skips row level security no matter what. **Replit's database user may be a superuser (UNVERIFIED):** if so, tenant isolation is OFF with a single `DATABASE_URL`. At startup the app checks this and logs `tenant isolation OFF: connected as a role that bypasses row level security`; it also warns when the connected user owns the audit log (an owner can switch off the audit triggers). Set `REQUIRE_RLS=1` to make the app refuse to start in that case. The fix is a `laris_app` role (`DATABASE_URL`) with the owner URL kept in `DATABASE_URL_OWNER`, or a separate Postgres (Neon, Supabase) where you create that role. Checked in CI by `tests/roles_check.mjs` and `tests/test_rls_force.py`.

## 1. Push the repo to GitHub

1. Commit and push with your normal git flow.
2. Confirm these files are in the GitHub repo: `web/package.json`, `web/package-lock.json`, `.replit`, `replit.nix`, `run.sh`, `requirements.txt`, `config/`, `db/`.
   - Earlier the root `.gitignore` line `package*.json` hid `web/package.json` and `web/package-lock.json`. Already fixed; confirm `git ls-files web` lists both.
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
| `TRUST_PROXY` = `1` | behind Replit's proxy: the client address for sign-in throttling is the LAST `X-Forwarded-For` entry (the one the proxy appended). Leave unset anywhere else, or anyone can spoof their address | yes on Replit |
| `DEMO_MODE` = `1` | allow header-only demo mode (no sign-in) on a Replit deployment or with `APP_TOKEN` set; ignored once any account has a password | demo only, then delete |
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
3. Build command (from `.replit`): `PIP_USER=0 python -m pip install -q -r requirements.txt && cd web && npm ci && npm run build`.
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

**Status:** `/webhooks/whatsapp` is implemented (HMAC on the raw body, fail closed). Not yet exercised against Meta.

## 9. Set the Telegram webhook (or polling)

Use the setup script (it sends the secret token, so the route accepts only Telegram):

```bash
python scripts/setup_channels.py check                      # which keys are set (never prints values)
python scripts/setup_channels.py telegram-webhook https://<deployment-domain>/webhooks/telegram
python scripts/setup_channels.py telegram-info              # last_error_message must be empty
python scripts/setup_channels.py telegram-poll              # local only: long-poll and forward to localhost:5000
```

**Ask suppliers over Telegram (demo without WhatsApp).** Put `tg:<chat id>` (or `telegram:<chat id>`; a group id is negative, e.g. `tg:-1001234567`) in the supplier party's contact. That supplier gets the photo from the bot and their replies are read like WhatsApp ones (reply to the photo, or the newest open ask). The supplier must open the bot and press Start first, or the send fails with "supplier must open the bot and press Start first". To find a chat id: message the bot from that Telegram account, run `python scripts/setup_channels.py telegram-poll` and read the number after `chat` on each line it prints (webhook mode: the same id is in the update). Any other contact is sent on WhatsApp as before.

`/webhooks/telegram` returns 403 until `TELEGRAM_WEBHOOK_SECRET` is set. WhatsApp: callback `https://<deployment-domain>/webhooks/whatsapp`, verify token = `WHATSAPP_VERIFY_TOKEN`, subscribe to `messages`. Several shops on one deployment: set `tenants.wa_phone_number_id` for each (the id shown in Meta's WhatsApp setup); inbound messages route by the number they arrived on and messages to an unmapped number are ignored once any is mapped. Replies and sent quotes go out from that tenant's own number (a tenant with no number uses `WHATSAPP_PHONE_NUMBER_ID`). All numbers share the one `WHATSAPP_TOKEN`, so they must sit under the same Meta business; separate tokens per tenant are not built. After 24h of customer silence only a template can be sent: create a utility template with one `{{1}}` body parameter and set `WHATSAPP_FOLLOWUP_TEMPLATE` to its name. On a public URL prefer per-user tokens: `python scripts/create_token.py issue "<user name>"` prints a token once (only its SHA-256 is stored); the UI asks for it once per tab and role and tenant then come from the user row, not from headers. Set `REQUIRE_USER_TOKEN=1` to switch the header-only demo mode off. `APP_TOKEN` (one shared secret, headers still pick the user) remains for demos.

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

# Static UI. Expect 200:
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
| `npm ci` fails in build | `web/package.json` or lock file not in GitHub | Confirm `git ls-files web` lists both. |
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
