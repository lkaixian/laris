#!/usr/bin/env bash
# Replit Run and deployment entrypoint. One process: FastAPI serves /api and /webhooks.
set -euo pipefail
cd "$(dirname "$0")"

: "${DATABASE_URL:?DATABASE_URL not set: add Replit PostgreSQL (Database tool) first}"

pip install -q -r requirements.txt

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
exec uvicorn src.app:app --host 0.0.0.0 --port "${PORT:-5000}" --workers 1
