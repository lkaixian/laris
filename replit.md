# Running LARIS on Replit

This is the imported Python/FastAPI backend and React/Vite frontend. Keep the existing structure and stack.

## Run

Use the **Start application** workflow (or Run), which executes `bash run.sh`.
The script installs the Python requirements, builds the frontend, initializes an empty
database, and starts one Uvicorn worker on `0.0.0.0:5000`. FastAPI serves the built
frontend and API from the same origin. After editing frontend files, restart the
workflow to rebuild them.

Use `python -m pip` and `python -m uvicorn`, not the standalone `pip` or `uvicorn`
commands, so installation and execution use the same Python runtime.
The Run script explicitly installs with `--no-user --prefix` into the workspace
`.pythonlibs` directory. This leaves the immutable Nix interpreter untouched.

## Publishing build

Shared environment variables `PIP_USER=false` and `PIP_PREFIX=.pythonlibs`
make the automatic publishing installer use a writable prefix instead of
user-install mode. The Nix standalone `pip` wrapper disables user site-packages,
so `--user` installation fails even before the custom build runs.
These are non-secret build settings, managed through Replit's environment tools.
The custom build also uses an explicit prefix, followed by `npm ci` and the
frontend build in `web/`. Do not rely on
`[packager.features].enabledForHosting = false`: a publishing attempt still ran
automatic installation with that flag present.
Python comes from the Python 3.12 module; do not add another Python interpreter
to `replit.nix`.

## Database and demo

The app uses the workspace PostgreSQL database through `DATABASE_URL`; do not put
the connection string in source code. The initial development database contains
the repository's synthetic made-to-order seed data.

The existing demo identity mode is enabled because the seed users do not have
passwords. It is not secure authentication: keep this workspace synthetic-only.
Do not publish this configuration for real users or store real customer records.
Real accounts, enforced authentication, and a least-privilege database role need
to be configured before real use.

Do not set `SEED=1` permanently. The demo data was loaded once; normal restarts
preserve data. The API's existing startup routine applies the remaining schema
files and initializes trade-template fields.

## Pulling and publishing

1. `git status --short --branch`; commit or stash first. Never `reset --hard` to clear changes.
2. `git pull --ff-only origin master`. If it reports diverged (Replit's empty "Published your App" commit causes this), `git fetch origin && git merge origin/master`. No rebase, no force push.
3. `bash scripts/post-merge.sh` (installs packages, builds the frontend; it does not touch the database), then restart **Start application** from the Run controls.
4. If the pull changed anything under `db/`, press Run before publishing so `src/db.py apply_schema` brings the development database up to date. Publish compares development with production and makes production match.
5. Never approve a publish plan with an unexpected `DROP TABLE`, `DROP COLUMN` or data-overwrite warning. That means development is behind production: cancel, back up production, run the app, publish again.

## Optional services

The tracker and rules-based pricing work without external service credentials.
AI extraction/transcription, WhatsApp, Telegram, and RunPod require their own
service setup and credentials. They were not connected during import setup.
See `.env.example` for the variable names; add actual credentials only through
Replit Secrets. Never invent credentials or commit a populated `.env`.

## Checks

- `python -m pytest`
- `node tests/schema_check.mjs`
- `node tests/db_check.mjs`
- `node tests/roles_check.mjs`
- `npm run build --prefix web`
- `GET /health` checks the server; `GET /ready` also checks the database.

The Python API tests start their own isolated PGlite database; do not point tests
at the workspace database.
