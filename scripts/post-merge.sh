#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."

# Install into the writable project prefix; never target the Nix store.
PIP_USER=0 pip install --prefix="$PWD/.pythonlibs" -q -r requirements.txt

# Keep frontend dependencies and generated assets in sync after merges.
npm ci --prefix web --no-audit --no-fund
npm run build --prefix web
