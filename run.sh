#!/usr/bin/env bash
# Replit Run and deployment entrypoint. One process: FastAPI serves /api and /webhooks.
set -euo pipefail
cd "$(dirname "$0")"

: "${DATABASE_URL:?DATABASE_URL not set: add Replit PostgreSQL (Database tool) first}"

log() { echo "[run.sh $(date -u +%H:%M:%S)] $*"; }

# Install into a writable workspace prefix instead of the immutable Nix store.
export PYTHONUSERBASE="${PYTHONUSERBASE:-$PWD/.pythonlibs}"
for d in "$PWD"/.pythonlibs/lib/python*/site-packages; do [ -d "$d" ] && export PYTHONPATH="$d:${PYTHONPATH:-}"; done  # packages the build step installed

# A deployment already ran the build command: repeating pip and npm here would keep the port closed for minutes
# and the readiness check would give up. The workspace Run still installs and rebuilds every time.
if [ -n "${REPLIT_DEPLOYMENT:-}" ] && python -c "import fastapi, psycopg, uvicorn" 2>/dev/null && [ -f web/dist/index.html ]; then
  log "deployment: packages and web build already present, skipping install"
else
  log "installing python packages"
  PIP_USER=0 pip install --prefix="$PYTHONUSERBASE" -q -r requirements.txt
  # FastAPI serves the built React app from web/dist.
  log "building the web app"
  npm ci --prefix web --no-audit --no-fund
  npm run build --prefix web
fi

# Bootstrap schema once. db/*.sql are not idempotent (CREATE TYPE, CREATE TABLE), so only run on an empty DB.
# SEED=1 adds the synthetic demo seed on that first bootstrap. Remove SEED after the demo.
if [ "$(psql "$DATABASE_URL" -tAc "select to_regclass('public.documents') is not null")" != "t" ]; then
  echo "bootstrap: applying db/*.sql (SEED=${SEED:-0})"
  files=(db/schema.sql db/transitions.sql db/functions.sql)
  [ "${SEED:-0}" = "1" ] && files+=(db/seed_made_to_order.sql)
  args=()
  for f in "${files[@]}"; do args+=(-f "$f"); done
  psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -1 -q "${args[@]}"
fi

# --workers 1 is required: APScheduler (SCHEDULER=1) would start once per worker.
log "starting the server on port ${PORT:-5000}"
exec python -m uvicorn src.app:app --host 0.0.0.0 --port "${PORT:-5000}" --workers 1
