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
- APScheduler starts only when `SCHEDULER=1` (set in `.replit`). Keep one worker (`run.sh` does). If `SCHEDULER` is not `1` the app logs a startup warning (follow-ups, expiry, retention and job reminders will not run); the owner can see the state at `GET /api/system/scheduler` (`enabled`, `last_run`, `ok`, `errors`, `last_error`).
- Schema install is one transaction under `pg_advisory_lock`: two instances starting together apply it one after the other, a failing file (`applying transitions.sql failed: ...`) leaves nothing half-installed, and the next start installs cleanly.
- `psycopg`, `APScheduler` and `python-multipart` are in `requirements.txt`. `pytest` and `pip-audit` live in `requirements-dev.txt`.
- `.gitignore` ignores only the root `/package*.json`, so `web/package.json` and `web/package-lock.json` are committed.
- On any public URL, create a password account (below) and do not set `DEMO_MODE`. Header-only demo mode (anyone can send `X-Role: owner`) is acceptable only for synthetic demo data, and is off by default on a Replit deployment and whenever `APP_TOKEN` is set.

## First sign-in accounts

**Deployed on Replit with its own database (no Shell access to it):** add two Secrets, `BOOTSTRAP_OWNER_USERNAME` and `BOOTSTRAP_OWNER_PASSWORD` (10+ characters, not a common password), then publish. At startup the first active owner gets that login, but only while nobody has a password yet; the log says `bootstrap owner: ...` and never prints the password. Then **delete both Secrets**. This also switches header-only demo mode off, because an account now has a password.

Header-only demo mode (the `X-Role` and `X-User` headers decide who you are, no sign-in) is allowed only while no account has a password, `REQUIRE_USER_TOKEN` is not `1`, and either `DEMO_MODE=1` is set or this is a clearly local run: `DATABASE_URL` host is `localhost`, `127.0.0.1`, `::1` or empty (a socket), no `APP_TOKEN`, and not a Replit deployment. A remote database therefore needs `DEMO_MODE=1` for header mode: a fresh install on a shared host is not open to the first caller before the first signup. Otherwise every `/api` call without a valid session or token gets 401. To switch to real sign-in: `python scripts/create_token.py list`, then `python scripts/create_token.py account "<owner name>" <username>` (asks for the password). The moment one account has a password, demo mode is off for good, even if `DEMO_MODE=1`, and the login screen is shown; the owner adds everyone else on the Team page. `REQUIRE_USER_TOKEN=1` also forces it off before any account exists. `APP_TOKEN` only works in demo mode, and then only for users of the first tenant. Sessions last `SESSION_HOURS` (default 12).

## Self-service signup and password reset (email codes)

`POST /api/signup` creates a business and its owner; the owner confirms with a 6-digit code emailed through Mailtrap's HTTP API, then signs in with the email (or a username, if one is set) and the password. So the first owner on a fresh deployment can simply sign up; `BOOTSTRAP_OWNER_*` is only needed for an existing database. `POST /api/password/forgot` and `/api/password/reset` do the same for a forgotten password. Codes live 10 minutes, die after 5 wrong tries, and are stored only as an HMAC-SHA256 keyed with `SECRET_KEY` (if unset, a key derived from `DATABASE_URL`; set `SECRET_KEY` to a long random string if the database URL ever changes).

| Secret | Meaning |
|---|---|
| `MAILTRAP_API_TOKEN` | Mailtrap API token. **Unset = email is off**: signups are still created but nobody receives the code (the log says `email is off` once) |
| `MAILTRAP_INBOX_ID` | Set = **sandbox** (Email Testing: `https://sandbox.api.mailtrap.io/api/send/<inbox>`, nothing is delivered, mails land in that Mailtrap inbox). Unset = **live** sending (`https://send.api.mailtrap.io/api/send`, needs a sender on a domain verified in Mailtrap) |
| `MAILTRAP_SENDER_EMAIL`, `MAILTRAP_SENDER_NAME` | the From address (must be on the verified domain for live sending) and name |
| `SIGNUP_DEV_ECHO` = `1` | **Local demos only, never on a real deployment.** While email is off, signup/resend/forgot also return the code as `dev_code`. Ignored when `MAILTRAP_API_TOKEN` is set |
| `SECRET_KEY` | optional key for the code HMAC (see above) |

Limits: per email 3 signups an hour, 3 resends or 3 reset requests per 15 minutes and 10 codes a day in all (in memory, a restart clears them). Wrong guesses are counted per account over the last hour across all its codes, so asking for a new code does not give 5 fresh tries; after 5 the account waits for the hour. Mails use a fixed greeting ("Hello,"), never a name typed by the user. `SIGNUP_DEV_ECHO` is ignored whenever `REPLIT_DEPLOYMENT` or `REPL_DEPLOYMENT` is set.

Retention (the scheduler, every run, all businesses; needs `SCHEDULER=1`): `email_codes` used or expired more than 1 day ago are deleted; `invites` accepted, revoked or expired more than 30 days ago are deleted; signups never verified after 7 days are deleted with their otherwise empty business; `rfq_replies.message_text` is set to null after 180 days (the row and its price stay); `listings.image` and `listing_items.crop` are emptied after 90 days (the rows stay; the photo URLs then answer 404). Chat text still follows `RETENTION_DAYS`. `users.created_at` (added in `db/signup.sql`) dates a signup; existing users count from the first start after the upgrade. `laris_app` already holds the needed grants (`db/roles.sql` grants all tables).

CI runs `pip-audit -r requirements.txt` and fails on any known vulnerability. There is no hash-pinned `requirements.lock` yet: `pip-tools` was not available when this was written; generate one with `pip-compile --generate-hashes requirements.txt -o requirements.lock`.

Notes: one email may have an account in several businesses (`db/multi.sql` replaces the old global unique index on the email with one per tenant; applied on every start, safe to repeat). Sign-in with such an email asks which business (409 `choose_business`) when the password fits several; a password reset by emailed code changes the password of ALL accounts with that email. Signing up never says whether an email is taken. Signup and code limits are in memory like the sign-in lockout (a restart clears them). Any signup stores a password, so header-only demo mode (see above) switches off once somebody has signed up, as it does for any account with a password.

## Invite people by email
Job reminders: the scheduler (`SCHEDULER=1`, every `SCHEDULER_MINUTES`, default 15) emails people about jobs through Mailtrap (settings above; email off = nothing is sent and the log says so once). Set `APP_PUBLIC_URL` so the email links to the job board; unset, there is no link. The rule:
1. A job that is not done and has a due date of today or earlier (Malaysia date) is reminded at most once per calendar day.
2. It goes to the assignee when they have an email and it is verified; an unassigned job goes to the active owners with a verified email; anyone else is skipped (nothing is sent, nothing recorded).
3. One email per person per run lists their jobs (quote number, customer, due today or days overdue); no prices, cost or margin.
4. `remind_sent_at` is set only after Mailtrap accepts the email, so a failed send is retried on the next run.
5. A business whose licence pauses changes gets no reminders. Every step runs per business in its own transaction: one failing business is logged (`scheduler: tenant <id> failed: <error type>`) and the others carry on. `scheduler.status()` holds the last run (`at`, `ok`, `errors`, `last_error`).

Quotation defaults: under Settings the owner sets the validity (days, default 30), payment terms, terms text, number prefix (default `QT`; numbering stays one counter per business and year), and the issuer email and phone printed on the PDF; they apply to quotes created afterwards. Sending a quote (`POST /api/documents/{id}/send`) attaches the customer PDF: by email through Mailtrap (base64 attachment, at most 8 MB; with `MAILTRAP_INBOX_ID` set the sandbox inbox shows the attachment and nothing is delivered), on WhatsApp as a document (outside the 24h window it needs `WHATSAPP_FOLLOWUP_TEMPLATE`, which sends the text only) or on Telegram (the customer must have pressed Start). At most 20 sends per hour per business. Re-applying `db/quotes.sql` on every start is harmless; it adds `email` to the `channel_t` enum.

The owner invites a person under Users; they get a link `<APP_PUBLIC_URL>/#/invite?token=...` (valid 7 days, one use; the token sits in the URL fragment, so servers and logs never see it, and only its SHA-256 is stored). Set `APP_PUBLIC_URL` (for example `https://your-app.replit.app`, no trailing slash needed) so the link never depends on the request's Host header. Unset, the Host header is used only when it is a plain `host[:port]` (letters, digits, dots, hyphens; a one-time warning asks you to set `APP_PUBLIC_URL`); anything else makes the invite fail with `409 public_url_missing` and nothing is created. Email needs the Mailtrap settings above (email off = the invite is created but nobody receives the link; the log says so). Accepting needs a free licence seat. Limits (20 invites per hour per business, 3 resends per hour per invite, 30 previews and 20 accepts per 15 minutes per client address) are in memory like the other throttles.

## Software licence (optional; off until a public key is set)

The app checks an Ed25519-signed key per organisation. It holds only the PUBLIC key, so nothing on the server can mint keys. Design and limits: `docs/licensing.md`. **This is a deterrent, not DRM**: whoever controls the server and the code can remove the check.

Issuer, once, on the issuer's own machine (not the server):

1. `python scripts/issue_license.py keygen` writes the private key to `~/.laris/license_private.pem` (refuses to overwrite; back it up, never commit or share it) and prints the public key.
2. On the server set the Secret `LICENSE_PUBLIC_KEY=<that base64>` (or put the same text in `src/license_public.key`). From the next start licensing is enforced. This is now optional: the platform admin (owner whose verified email is `LICENSE_ISSUER_EMAIL`) can set the public key from the web issuer page instead (docs/licensing.md); a key in the environment always wins and cannot be changed from the page.
3. Per customer: `python scripts/issue_license.py issue --email owner@shop.com --plan standard --days 365 --seats 10 --org "Shop" [--send]`. The key is printed once; `--send` emails it (needs `MAILTRAP_API_TOKEN` on the issuer machine, else it says email is off). The customer's owner activates it under Licence while signed in with that verified email.
4. Requests: `DATABASE_URL=... python scripts/issue_license.py requests` lists pending ones; `issue --request <id>` fills email, plan and seats and marks it issued.

Server settings: `LICENSE_ISSUER_EMAIL` (where "request a licence" mails go) and `LICENSE_OFFLINE_GRACE_DAYS` (default 7: days the server may be unable to reach NTP before the status becomes `clock_unverified`; outbound UDP port 123 must be allowed). Set the public key on an existing deployment only after issuing its customers' keys, otherwise their writes stop (402) until they activate one.

## Credentials: tokens, lockout, sessions

- **API tokens expire.** `python scripts/create_token.py issue <user> [--days N]` prints the expiry (default 90 days); an expired token gets the same 401 as an unknown one. Tokens that existed before this change were given 90 days from the first start after the upgrade. `revoke` removes the token and every session of that user.
- A password change, and an owner changing a user's role, active flag or password, also removes that user's API token and sessions (a self-service password change keeps only the current session). `create_token.py account` refuses a deactivated user unless you pass `--reactivate`. With more than one tenant it also needs `--tenant <tenant id>` and refuses a user who belongs to a different tenant.
- **Sign-in lockout (in memory, one process):** 5 failed sign-ins for a username lock it for 1 minute, then 2, 4, 8 and at most 15 minutes for each further 5 failures; a success, or 15 minutes with no failures, resets it. A lapsed lock needs 5 new failures to lock again. Separately, one client address may make 30 failed sign-ins per 15 minutes across all usernames, then gets 429. The current-password check in `POST /api/me/password` is throttled per user the same way. A restart clears the counters. Write limits per user and 10 minutes, same in-memory counters: 10 supplier price requests (`POST /api/rfq`) and 30 `POST /api/enquiries/simulate` plus `POST /api/documents/ingest` together; over that is 429 `slow_down`. `.replit` sets `TRUST_PROXY=1` (non-secret) so the address is the real client, not the proxy; on a deployment without it the app logs one startup warning, because every client then shares the proxy's address and one attacker's failures lock everyone out. Do not set it anywhere without a proxy that appends to `X-Forwarded-For`.
- Passwords are scrypt N=2^16 (64 MiB per sign-in; size the instance accordingly). Older hashes keep working and are upgraded on the next successful sign-in. Very common passwords and a password equal to the username are refused.
- Each user keeps at most 10 sessions (the oldest is dropped at sign-in); expired sessions are purged at sign-in. `db/auth.sql` (new columns) is applied on every start.

## Transport hardening

Every response carries `X-Content-Type-Options: nosniff`, `Referrer-Policy: no-referrer`, `X-Frame-Options: DENY`, `Permissions-Policy` (camera for this origin only; the Ask page uses it) and a `Content-Security-Policy` (same-origin only, no CDNs, no frames). The CSP allows the one inline theme script in `web/dist/index.html` by SHA-256 hash, computed at startup from the built file; if you add another inline script, rebuild and restart. `Strict-Transport-Security` (1 year) is added only on https requests: the request scheme, or `X-Forwarded-Proto` when `TRUST_PROXY=1`. `/api/*` responses are `Cache-Control: no-store`.

- `/docs`, `/redoc` and `/openapi.json` are off. Set `ENABLE_DOCS=1` for a developer machine only.
- Upload caps: 10 MB for `/api/documents/ingest`, 8 MB for the Ask photo, 1 MB for webhooks, 20 MB for downloaded WhatsApp/Telegram media. POST/PUT/PATCH under `/api` and `/webhooks` must send `Content-Length`; chunked bodies get 411, oversized ones 413, and uploads are also cut off while being read. A reverse proxy in front must not re-chunk request bodies.
- Images over 25 megapixels are refused (422) before OCR.
- `CORS_ORIGINS` entries are trimmed; the app serves the UI itself, so leave it unset in production.

## Logs and request ids

`LOG_LEVEL` (default `INFO`) sets verbosity. Every line reads `time LEVEL logger [request_id] message`; `[-]` means outside a request. Every response carries `X-Request-Id`, and every error body has the same `request_id`: when a user quotes it, search the logs for it (Replit: Deployments > Logs, search `[<id>]`). Unhandled errors log once at ERROR with method, path, tenant and user ids and the traceback, never the query string or body. Webhook secrets (`hub.verify_token`, `token`, `secret`, `signature` in a `/webhooks/*` query string) are replaced by `***` in uvicorn's access log. A missing `DATABASE_URL` logs `DATABASE_URL is not set: the API cannot serve database requests` at startup.

## Health check and backups

`GET /health` answers if the process is up; `GET /ready` also checks the database (503 `{status:"not_ready", reason}`: `db_url_missing`, `db_unreachable` or `schema_missing`; the reason is also in the log): point an uptime monitor at `/ready`. `scripts/backup.sh` writes a compressed `pg_dump`; run it on a schedule from somewhere other than the app server and keep the files private (they hold customer names, numbers and supplier prices). Restore command is in the script header. Not yet tried against Replit's Postgres.

## Roles and branding migration

`db/rbac.sql` runs on every start (idempotent, after `rls.sql`, before the seed): it adds `tenants.display_name`, `brand_color`, `logo_data_url`, the tenant-scoped `roles` table (forced RLS, same policy as the rest) and `users.role_id`, creates the `owner` and `staff` system roles for every tenant, and moves each existing user onto the system role matching their old `users.role`. Nothing to run by hand; existing staff keep exactly today's permissions (the staff role stores no list, so it means the built-in defaults in `src/perms.py` until an owner edits it). `users.role` stays the owner|staff class the database guards read. With `DATABASE_URL_OWNER` set, startup re-applies `db/roles.sql`, which gives `laris_app` its grants on the new table. See `docs/roles.md`.

## Least-privilege database role (recommended before real customers)

`db/roles.sql` creates `laris_app`: it can read and write the tables but owns nothing, so it cannot disable the audit or transition triggers, alter tables, or edit or delete audit rows (checked in CI by `tests/roles_check.mjs` on PGlite). Set a password for it, then give the running app that role's URL as `DATABASE_URL` and keep the owner's URL as `DATABASE_URL_OWNER`: only startup (`apply_schema`) uses the owner URL, and it re-applies the grants. UNVERIFIED on Replit's Postgres: confirm the Replit user is allowed to `CREATE ROLE`; if not, use a separate Postgres (Neon, Supabase) for production. `db/rls.sql` (applied on start) then limits that role to its own tenant's rows: a request sets `laris.tenant`, system work (login lookup, webhooks, scheduler) sets `*`. Tables are also set to `FORCE ROW LEVEL SECURITY`, so even the table owner is held to the tenant rules, as long as that database user is a plain user. A superuser (or a role with `BYPASSRLS`) skips row level security no matter what. **Replit's database user may be a superuser (UNVERIFIED):** if so, tenant isolation is OFF with a single `DATABASE_URL`. At startup the app checks this and logs `tenant isolation OFF: connected as a role that bypasses row level security`; it also warns when the connected user owns the audit log (an owner can switch off the audit triggers). Set `REQUIRE_RLS=1` to make the app refuse to start in that case. Without it the app still refuses to start when the role bypasses row level security AND either `REPL_DEPLOYMENT` is set or more than one tenant exists, unless you set `ALLOW_RLS_BYPASS=1` (explicit opt-out: it is logged as an ERROR on every start). With one tenant and no deployment it only warns. The fix is a `laris_app` role (`DATABASE_URL`) with the owner URL kept in `DATABASE_URL_OWNER`, or a separate Postgres (Neon, Supabase) where you create that role. Checked in CI by `tests/roles_check.mjs` and `tests/test_rls_force.py`.

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
| `ILMU_MODEL` | chat/extraction model name (default `ilmu-mini-v3.3`) | only if your account uses another |
| `ILMU_ASR_MODEL` | speech model name (default `ilmu-asr-v4.2`) | only if your account uses another |
| `ILMU_ASR_PATH` | override ASR path (default `/audio/transcriptions`, unverified) | only if the default fails |
| `WHATSAPP_TOKEN` | WhatsApp Cloud API bearer token | yes if WhatsApp is shown |
| `WHATSAPP_PHONE_NUMBER_ID` | WhatsApp sender | yes if WhatsApp is shown |
| `WHATSAPP_VERIFY_TOKEN` | Meta webhook verify. Make up a long random string. | yes if WhatsApp is shown |
| `WHATSAPP_APP_SECRET` | checks `X-Hub-Signature-256` on inbound webhooks | yes if WhatsApp is shown |
| `TELEGRAM_BOT_TOKEN` | Telegram bot | yes if Telegram is shown |
| `TELEGRAM_TENANT_ID` | tenant uuid that receives Telegram messages (one bot per deployment); see "Which business gets a chat message" | only with more than one business |
| `WHATSAPP_TENANT_ID` | tenant uuid used when a WhatsApp number is not mapped in Settings > Channels | optional |
| `LARIS_HELPER_BOT_TOKEN` | the platform's LARIS helper bot (made in BotFather): where owners and staff link their Telegram account and send `/catalog` photos and supplier documents | optional (Team: Link Telegram is refused with `helper_not_configured` without it) |
| `LARIS_HELPER_WEBHOOK_SECRET` | secret header of `/webhooks/telegram/helper` (403 until set) | with the helper bot |
| `TELEGRAM_ACK` | `0` turns off the Telegram received/done reactions and typing indicator (default on) | optional |
| `RUNPOD_ENDPOINT_URL` | RunPod fallback STT endpoint | yes (sponsor proof) |
| `RUNPOD_API_KEY` | RunPod auth (STT fallback and vision) | yes (sponsor proof) |
| `RUNPOD_VISION_URL` | catalog photo model: `https://api.runpod.ai/v2/<ENDPOINT_ID>/openai/v1` (section 10b) | only for catalog photos |
| `RUNPOD_VISION_MODEL` | model name served by that endpoint (default `Qwen/Qwen2.5-VL-7B-Instruct`) | no |
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

**LARIS helper bot and each business's own bot.** Make one bot for the whole platform in BotFather, set `LARIS_HELPER_BOT_TOKEN` and `LARIS_HELPER_WEBHOOK_SECRET`, then `python scripts/setup_channels.py helper-webhook https://<deployment-domain>/webhooks/telegram/helper`. Owners and staff open the link from Team (Link Telegram) in the helper bot; that sets their `tg:<chat id>` handle, after which `/catalog` photos and supplier documents sent to the helper bot reach the same pipeline as before. A chat that is not linked gets one reply and nothing is stored. Each business makes its own customer bot in BotFather and pastes the token under Channels: the server registers `{APP_PUBLIC_URL}/webhooks/telegram/b/<key>` itself (needs `SECRET_KEY`, which encrypts the saved token, and `APP_PUBLIC_URL`). Messages on a business's bot are only ever for that business and are answered by that bot; quotes, follow-ups and Ask-suppliers messages to Telegram contacts use the business's bot when it has one, else `TELEGRAM_BOT_TOKEN`. The `TELEGRAM_*` env bot keeps working unchanged. Changing `SECRET_KEY` makes saved bot tokens unreadable: connect the bots again.

**One-tap customer bots (Telegram Managed Bots, Bot API 9.6).** Open the helper bot in BotFather's mini app and switch on Bot Management Mode once (then `getMe` shows `can_manage_bots`; until then the dashboard offers no create link). Re-register the helper webhook so Telegram sends `managed_bot` updates: `python scripts/setup_channels.py helper-webhook https://<deployment-domain>/webhooks/telegram/helper` (it now asks for `message` and `managed_bot`). The owner must have linked Telegram to the helper first; `APP_PUBLIC_URL` and `SECRET_KEY` are needed as for a pasted token.

**Ask suppliers over Telegram (demo without WhatsApp).** Put `tg:<chat id>` (or `telegram:<chat id>`; a group id is negative, e.g. `tg:-1001234567`) in the supplier party's contact. That supplier gets the photo from the bot and their replies are read like WhatsApp ones (reply to the photo, or the newest open ask). The supplier must open the bot and press Start first, or the send fails with "supplier must open the bot and press Start first". To find a chat id: message the bot from that Telegram account, run `python scripts/setup_channels.py telegram-poll` and read the number after `chat` on each line it prints (webhook mode: the same id is in the update). Any other contact is sent on WhatsApp as before.

`/webhooks/telegram` returns 403 until `TELEGRAM_WEBHOOK_SECRET` is set. WhatsApp: callback `https://<deployment-domain>/webhooks/whatsapp`, verify token = `WHATSAPP_VERIFY_TOKEN` (the verify call returns 403 while it is unset), subscribe to `messages`. A person's `users.channel_handle` is their phone number for WhatsApp and `tg:<chat id>` for Telegram; a Telegram chat id never matches a phone number. A unique index on `messages (channel, external_id)` makes a replayed message a no-op; if old data already holds duplicates startup logs a NOTICE and skips the index until you delete them. Several shops on one deployment: set `tenants.wa_phone_number_id` for each (the id shown in Meta's WhatsApp setup); inbound messages route by the number they arrived on and messages to an unmapped number are ignored once any is mapped. Replies and sent quotes go out from that tenant's own number (a tenant with no number uses `WHATSAPP_PHONE_NUMBER_ID`). All numbers share the one `WHATSAPP_TOKEN`, so they must sit under the same Meta business; separate tokens per tenant are not built. After 24h of customer silence only a template can be sent: create a utility template with one `{{1}}` body parameter and set `WHATSAPP_FOLLOWUP_TEMPLATE` to its name. On a public URL prefer per-user tokens: `python scripts/create_token.py issue "<user name>"` prints a token once (only its SHA-256 is stored); the UI asks for it once per tab and role and tenant then come from the user row, not from headers. Set `REQUIRE_USER_TOKEN=1` to switch the header-only demo mode off. `APP_TOKEN` (one shared secret, headers still pick the user) remains for demos.

**Which business gets a chat message.** Every inbound WhatsApp or Telegram message is tied to exactly one business, in this order:
1. WhatsApp: the business whose number matches the number the message arrived on. The owner sets it in **Settings > Channels** (the `phone_number_id` from the Meta dashboard, digits only; one number belongs to one business).
2. Telegram: `TELEGRAM_TENANT_ID` (the business's uuid). WhatsApp without a mapped number: `WHATSAPP_TENANT_ID`.
3. Only one business exists: that one (single-business installs and the demo need no setup).
4. Otherwise the sender must match exactly one business (an active staff `channel_handle` or a contact's number / `tg:<chat id>`).

If none of these gives one business, the message is **dropped**: not stored, not answered, no AI call, and one WARNING line in the log (a short hash of the sender and the reason `unmapped_number`, `unknown_sender` or `ambiguous_sender`, never the number or text). The provider still gets 200 so it does not retry. This is deliberate: guessing a business would hand one business another's customers. Once any WhatsApp number is mapped, a message to an unmapped number is dropped too. Map your number as soon as a second business signs up.

Other rules on this path: a business whose licence blocks writes only has the raw message stored (visible as a new enquiry), with no AI call and no reply; each supplier or staff sender is limited to 30 messages per 10 minutes per business (extra ones are silently dropped); chat photos for `/catalog` must be JPEG, PNG or WebP by their bytes and at most 8 MB.

## 10. RunPod endpoint (sponsor proof)

1. RunPod console > Serverless > New Endpoint. Pick one model: Mesolitica Whisper for STT (fallback path), or Qwen3 for extraction if the ILMU path fails. Note the GPU type (for example 16 GB or 24 GB class, from `knowledge/03-stats/pricing-numbers.md`; verify the current price in the console).
2. Copy the Endpoint ID. Set `RUNPOD_ENDPOINT_URL` to `https://api.runpod.ai/v2/<ENDPOINT_ID>` and `RUNPOD_API_KEY` to a RunPod API key.
3. Warm it about 10 minutes before the demo. Cold start can take minutes. Scale-to-zero is the default for serverless.
4. Run one real job so the runtime appears in the logs. `src/ilmu.py` calls `/runsync` with `{"input": {"audio_base64": ..., "mime": ...}}`. **UNVERIFIED:** the input shape of the deployed worker.
5. Keep the console page with the Endpoint ID, GPU type, and job runtime for the proof.

## 10b. Vision on RunPod (catalog photos)

Reads ONE photo with many labelled products (`POST /api/listings`, or a chat photo captioned `/catalog`). Without the variables below the API answers `503 vision not configured: set <names>` and nothing else changes.

1. RunPod console > Serverless > New Endpoint > vLLM. Model `Qwen/Qwen2.5-VL-7B-Instruct` (or another Qwen2.5-VL), GPU 24 GB class.
2. Max workers 1 and a low idle timeout (for example 5 s to 60 s) so cost stays near zero between uses. Active workers 0.
3. Set `RUNPOD_VISION_URL` to `https://api.runpod.ai/v2/<ENDPOINT_ID>/openai/v1`, `RUNPOD_API_KEY` to a RunPod API key (same name as the STT fallback), and optionally `RUNPOD_VISION_MODEL` (default `Qwen/Qwen2.5-VL-7B-Instruct`; it must equal the model the worker serves).
4. Expect the first call after idle to take minutes (cold start: model load). `src/vision.py` waits up to 150 s per attempt and retries once on a 5xx or timeout, so the first upload after a long idle may return `502 vision_unavailable`; retry once the worker is warm.
5. Staff chat path: a photo captioned `/catalog` (or `catalog`) from a staff handle or a known supplier makes a listing; any other photo is still a supplier document.

**UNVERIFIED:** nothing here ran against a real endpoint. The OpenAI-compatible route, the image data URL, and the quality of the model's JSON, bounding boxes and reading of Chinese size labels. Tesseract is English-only, so Chinese text is never confirmed by OCR; SKUs and prices the model reports are kept only when the digits also appear in the OCR text. Every product is created `needs_review` and a person confirms it.

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

## Privacy tables and retention (PDPA)

`db/privacy.sql` (applied on every start) adds `tenant_privacy` and `breach_incidents` with forced row-level security; a trigger refuses DELETE on `breach_incidents`. The scheduler also empties `rfq_items.image` after 90 days (as for `listings.image`). Raw voice audio is never stored. Owner procedure: `docs/privacy-and-breach-runbook.md`.

## Customer accept links

`db/accept.sql` (applied on every start) adds `quote_accept_links` (forced row-level security; only the SHA-256 of each token is stored) and two SECURITY DEFINER functions, `accept_link_open` and `accept_link_decide`, with EXECUTE for `laris_app` only. They are the one path by which a customer (no account) moves a quote to accepted or rejected; the owner-only guard in `transitions.sql` is unchanged. Set `APP_PUBLIC_URL` or no link is made. Set `TRUST_PROXY=1` behind a proxy so the per-IP limits see real addresses. The token is in the URL path, so make sure your proxy and uvicorn access logs for `/api/public/quote/` are not kept (or mask the path). The signature is a simulation for demonstration, not a legal e-signature.
