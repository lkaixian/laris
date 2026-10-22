"""psycopg access. One transaction per request; laris.role / laris.actor feed the DB guard and audit."""
import os
from contextlib import contextmanager
from pathlib import Path

import psycopg
from psycopg.rows import dict_row

DB_DIR = Path(__file__).resolve().parent.parent / "db"


def url() -> str:
    return os.environ["DATABASE_URL"]


@contextmanager
def tx(role="staff", actor=""):
    """Commit on clean exit, roll back on exception. prepare_threshold=None keeps PGlite/pgbouncer happy."""
    with psycopg.connect(url(), row_factory=dict_row, prepare_threshold=None) as conn:
        conn.execute("select set_config('laris.role', %s, true), set_config('laris.actor', %s, true)",
                     (role, str(actor or "")))
        yield conn


def apply_schema(seed: bool | None = None) -> None:
    """Idempotent: schema/transitions/functions only on an empty DB, views always (CREATE OR REPLACE)."""
    from .templates import load_template  # local: keeps db.py importable without yaml
    # DATABASE_URL_OWNER (the schema owner) is only for this; the running app uses the least-privilege DATABASE_URL
    owner = os.environ.get("DATABASE_URL_OWNER")
    with psycopg.connect(owner or url(), autocommit=True, prepare_threshold=None) as c:
        if not c.execute("select to_regclass('public.tenants')").fetchone()[0]:
            for f in ("schema.sql", "transitions.sql", "functions.sql"):
                c.execute((DB_DIR / f).read_text(encoding="utf-8"))
        c.execute((DB_DIR / "views.sql").read_text(encoding="utf-8"))
        if (os.environ.get("SEED") == "1" if seed is None else seed) and \
                not c.execute("select 1 from tenants limit 1").fetchone():
            c.execute((DB_DIR / "seed_made_to_order.sql").read_text(encoding="utf-8"))
        if owner:  # new tables and views need their grants for laris_app
            c.execute((DB_DIR / "roles.sql").read_text(encoding="utf-8"))
        # trade-template fields become the tenant's starting registry (owner can still add via proposals)
        for t in c.execute("select id, trade_template from tenants").fetchall():
            for f in load_template(t[1])["fields"]:
                c.execute("""insert into tenant_fields(tenant_id,key,label,type,unit,options,applies_to,sort_order)
                             values (%s,%s,%s,%s,%s,%s,%s::doc_direction[],%s) on conflict (tenant_id,key) do nothing""",
                          (t[0], f["key"], f["label"], f["type"], f.get("unit"),
                           psycopg.types.json.Jsonb(f["options"]) if f.get("options") else None,
                           f["applies_to"], f.get("sort_order", 100)))
