#!/usr/bin/env bash
# Reproduce Replit's automatic Python installer environment, then run the custom
# frontend build so both stages of the publishing build are checked together.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

mapfile -t publish_pip_settings < <(python - <<'PY'
import tomllib

with open(".replit", "rb") as config_file:
    config = tomllib.load(config_file)

env = config.get("env", {})
for key in ("PIP_USER", "PIP_PREFIX"):
    value = env.get(key)
    if value is None:
        raise SystemExit(f".replit [env] is missing {key}")
    print(value)
PY
)

if [[ "${#publish_pip_settings[@]}" -ne 2 ]]; then
  echo "Could not read publishing PIP_USER and PIP_PREFIX from .replit [env]." >&2
  exit 1
fi

PIP_USER="${publish_pip_settings[0]}"
PIP_PREFIX="${publish_pip_settings[1]}"
EXPECTED_PREFIX="$ROOT/.pythonlibs"
RESOLVED_PREFIX="$(realpath -m "$PIP_PREFIX")"

if [[ "$PIP_USER" != "0" ]]; then
  echo "Publishing PIP_USER must be 0; found '$PIP_USER'." >&2
  exit 1
fi
if [[ "$RESOLVED_PREFIX" != "$EXPECTED_PREFIX" ]]; then
  echo "Publishing PIP_PREFIX must resolve to $EXPECTED_PREFIX; found '$RESOLVED_PREFIX'." >&2
  exit 1
fi

echo "Installing Python requirements with .replit publishing values: PIP_USER=$PIP_USER PIP_PREFIX=$PIP_PREFIX"
env -u PIP_CONFIG_FILE PIP_USER="$PIP_USER" PIP_PREFIX="$PIP_PREFIX" \
  pip install -r requirements.txt

PYTHON_VERSION="$(python -c 'import sys; print(f"{sys.version_info.major}.{sys.version_info.minor}")')"
SITE_PACKAGES="$EXPECTED_PREFIX/lib/python$PYTHON_VERSION/site-packages"

PYTHONPATH="$SITE_PACKAGES${PYTHONPATH:+:$PYTHONPATH}" python - "$SITE_PACKAGES" requirements.txt <<'PY'
import importlib.metadata
import importlib.util
import pathlib
import re
import sys

site_packages = pathlib.Path(sys.argv[1]).resolve()
requirements_file = pathlib.Path(sys.argv[2])

def normalize(name):
    return re.sub(r"[-_.]+", "-", name).lower()

required = set()
for line in requirements_file.read_text(encoding="utf-8").splitlines():
    match = re.match(r"\s*([A-Za-z0-9_.-]+)", line)
    if match:
        required.add(normalize(match.group(1)))

installed = {
    normalize(distribution.metadata["Name"])
    for distribution in importlib.metadata.distributions(path=[str(site_packages)])
    if distribution.metadata.get("Name")
}
missing = sorted(required - installed)
if missing:
    raise SystemExit(f"Requirements missing from {site_packages}: {', '.join(missing)}")

modules = (
    "fastapi", "uvicorn", "httpx", "anyio", "certifi", "idna", "yaml",
    "pypdf", "PIL", "pytesseract", "reportlab", "psycopg", "openpyxl",
    "apscheduler", "multipart",
)
for name in modules:
    spec = importlib.util.find_spec(name)
    if spec is None or spec.origin is None:
        raise SystemExit(f"Could not resolve Python module {name} from {site_packages}")
    origin = pathlib.Path(spec.origin).resolve()
    if not origin.is_relative_to(site_packages):
        raise SystemExit(f"Python module {name} resolved outside the publishing prefix: {origin}")

print(f"Verified {len(required)} requirements and {len(modules)} imports resolve from {site_packages}")
PY

echo "Building frontend with the publishing commands."
npm ci --prefix web
npm run build --prefix web
