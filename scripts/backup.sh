#!/bin/bash
# Compressed dump of the whole database. Needs pg_dump (replit.nix has the Postgres client) and DATABASE_URL.
# Keep dumps off the app server: they contain customer names, numbers and supplier prices.
#   ./scripts/backup.sh [dir]        restore with:  gunzip -c laris-<time>.sql.gz | psql "$DATABASE_URL"
set -euo pipefail
dir="${1:-backups}"
mkdir -p "$dir"
out="$dir/laris-$(date +%Y%m%d-%H%M%S).sql.gz"
pg_dump --no-owner --no-privileges "${DATABASE_URL_OWNER:-$DATABASE_URL}" | gzip > "$out"
echo "$out"
