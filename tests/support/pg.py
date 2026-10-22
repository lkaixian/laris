"""Real Postgres semantics for tests: PGlite over a socket (node), or DATABASE_URL_TEST if set.
Skips (never fakes SQL) when neither is available."""
import os
import shutil
import socket
import subprocess
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[2]


@pytest.fixture(scope="session")
def pg_url():
    if os.environ.get("DATABASE_URL_TEST"):
        yield os.environ["DATABASE_URL_TEST"]
        return
    node = shutil.which("node")
    if not node or not (ROOT / "node_modules" / "@electric-sql" / "pglite-socket").exists():
        (pytest.fail if os.environ.get("CI") else pytest.skip)("need node + `npm i @electric-sql/pglite @electric-sql/pglite-socket` (or set DATABASE_URL_TEST)")
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        port = s.getsockname()[1]
    p = subprocess.Popen([node, str(Path(__file__).with_name("pglite_server.mjs")), str(port)],
                         cwd=ROOT, stdout=subprocess.PIPE, text=True)
    try:
        if "READY" not in p.stdout.readline():
            (pytest.fail if os.environ.get("CI") else pytest.skip)("pglite server failed to start")
        yield f"postgresql://postgres:postgres@127.0.0.1:{port}/postgres?sslmode=disable"
    finally:
        p.terminate()
