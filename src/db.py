"""psycopg access. One transaction per request; laris.role / laris.actor feed the DB guard and audit."""
import logging
import os
from contextlib import contextmanager
from pathlib import Path

import psycopg
from psycopg.rows import dict_row

DB_DIR = Path(__file__).resolve().parent.parent / "db"


def url() -> str:
    return os.environ["DATABASE_URL"]


@contextmanager
def tx(role="staff", actor="", tenant="*"):
    """Commit on clean exit, roll back on exception. prepare_threshold=None keeps PGlite/pgbouncer happy.
    tenant '*' is for work that crosses tenants on purpose; request code narrows it once the user is known (db/rls.sql)."""
    with psycopg.connect(url(), row_factory=dict_row, prepare_threshold=None, connect_timeout=15) as conn:
        conn.execute("select set_config('laris.role', %s, true), set_config('laris.actor', %s, true), set_config('laris.tenant', %s, true)",
                     (role, str(actor or ""), str(tenant)))
        yield conn


def apply_schema(seed: bool | None = None) -> None:
    """Idempotent: schema/transitions/functions only on an empty DB, tiers/views/rls/rfq/rbac always (CREATE OR REPLACE)."""
    from .templates import load_template  # local: keeps db.py importable without yaml
    # DATABASE_URL_OWNER (the schema owner) is only for this; the running app uses the least-privilege DATABASE_URL
    owner = os.environ.get("DATABASE_URL_OWNER")
    with psycopg.connect(owner or url(), autocommit=True, prepare_threshold=None, connect_timeout=15) as c:
        c.execute("select set_config('laris.tenant', '*', false)")  # FORCE RLS applies to the owner: seeding crosses tenants on purpose
        if not c.execute("select to_regclass('public.tenants')").fetchone()[0]:
            for f in ("schema.sql", "transitions.sql", "functions.sql"):
                c.execute((DB_DIR / f).read_text(encoding="utf-8"))
        c.execute((DB_DIR / "tiers.sql").read_text(encoding="utf-8"))
        c.execute((DB_DIR / "views.sql").read_text(encoding="utf-8"))
        c.execute((DB_DIR / "auth.sql").read_text(encoding="utf-8"))
        c.execute((DB_DIR / "rls.sql").read_text(encoding="utf-8"))
        c.execute((DB_DIR / "rfq.sql").read_text(encoding="utf-8"))
        c.execute((DB_DIR / "listings.sql").read_text(encoding="utf-8"))
        c.execute((DB_DIR / "rbac.sql").read_text(encoding="utf-8"))
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


def rls_status(conn) -> tuple[bool, bool]:
    """(role bypasses row level security, role owns audit_log). Superuser/BYPASSRLS skip RLS even with FORCE; the owner can disable triggers."""
    row = conn.execute(
        "select (select rolsuper or rolbypassrls from pg_roles where rolname = current_user) bypass,"
        " (select pg_get_userbyid(relowner) = current_user from pg_class where oid = 'public.audit_log'::regclass) owns").fetchone()
    bypass, owns = row.values() if isinstance(row, dict) else row  # tx() rows are dicts
    return bool(bypass), bool(owns)


def check_rls(conn) -> None:
    """Startup check: warn when tenant isolation is off; refuse to start if REQUIRE_RLS=1."""
    log, (bypass, owns) = logging.getLogger("laris"), rls_status(conn)
    if bypass:
        msg = "tenant isolation OFF: connected as a role that bypasses row level security; use db/roles.sql laris_app"
        if os.environ.get("REQUIRE_RLS") == "1":
            raise RuntimeError(msg + " (REQUIRE_RLS=1)")
        log.warning(msg)
    if owns:
        log.warning("connected role owns audit_log, so it can disable the audit and guard triggers; use db/roles.sql laris_app")
