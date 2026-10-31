"""psycopg access. One transaction per request; laris.role / laris.actor feed the DB guard and audit."""
import logging
import os
import secrets
from contextlib import contextmanager
from pathlib import Path

import psycopg
from psycopg.rows import dict_row

DB_DIR = Path(__file__).resolve().parent.parent / "db"
MIGRATIONS_DIR = DB_DIR / "migrations"  # NNNN_name.sql, each applied once and recorded in schema_migrations; for changes the idempotent files cannot make


def url() -> str:
    return os.environ["DATABASE_URL"]


ALL_TENANTS = "*"


@contextmanager
def tx(role="staff", actor="", tenant="", timeout=15):
    """Commit on clean exit, roll back on exception. prepare_threshold=None keeps PGlite/pgbouncer happy.
    A call that names no tenant sees no tenant rows (db/rls.sql); work that crosses tenants on purpose passes ALL_TENANTS,
    and request code narrows it once the user is known."""
    with psycopg.connect(url(), row_factory=dict_row, prepare_threshold=None, connect_timeout=timeout) as conn:
        conn.execute("select set_config('laris.role', %s, true), set_config('laris.actor', %s, true), set_config('laris.tenant', %s, true)",
                     (role, str(actor or ""), str(tenant)))
        yield conn


SCHEMA_LOCK = 7412340001  # pg_advisory_lock key: two instances starting together apply the schema one after the other


def apply_schema(seed: bool | None = None) -> None:
    """Idempotent: schema/transitions/functions only on an empty DB (one transaction: all or nothing), tiers/views/rls/rfq/rbac always (CREATE OR REPLACE)."""
    # DATABASE_URL_OWNER (the schema owner) is only for this; the running app uses the least-privilege DATABASE_URL
    owner = os.environ.get("DATABASE_URL_OWNER")
    with psycopg.connect(owner or url(), autocommit=True, prepare_threshold=None, connect_timeout=15) as c:
        c.execute("select pg_advisory_lock(%s)", (SCHEMA_LOCK,))  # held until this connection closes; the check below runs after the wait
        c.execute("select set_config('laris.tenant', '*', false)")  # FORCE RLS applies to the owner: seeding crosses tenants on purpose

        def run(*files):
            for f in files:
                try:
                    c.execute((DB_DIR / f).read_text(encoding="utf-8"))
                except psycopg.Error as e:
                    raise RuntimeError(f"applying {f} failed: {e.diag.message_primary or e}") from e

        if not c.execute("select to_regclass('public.tenants')").fetchone()[0]:
            with c.transaction():  # a failure in the second or third file must not leave the first one installed
                run("schema.sql", "transitions.sql", "functions.sql")
        run("tiers.sql", "views.sql", "auth.sql", "rls.sql", "rfq.sql", "listings.sql", "catalog_tiers.sql", "rbac.sql", "license.sql", "signup.sql", "multi.sql",
            "invites.sql", "channels.sql", "quotes.sql", "jobs.sql", "jobs_manual.sql", "track.sql", "privacy.sql", "onboarding.sql", "accept.sql", "chain.sql", "delivery.sql", "apiaccess.sql", "aiguide.sql", "aicalls.sql", "consent.sql")
        c.execute("create table if not exists schema_migrations (file text primary key, applied_at timestamptz not null default now())")
        done = {r[0] for r in c.execute("select file from schema_migrations").fetchall()}
        for f in sorted(MIGRATIONS_DIR.glob("*.sql")) if MIGRATIONS_DIR.is_dir() else []:
            if f.name in done:
                continue
            try:
                with c.transaction():  # a failed migration leaves nothing half applied and stops the start
                    c.execute(f.read_text(encoding="utf-8"))
                    c.execute("insert into schema_migrations(file) values (%s)", (f.name,))
            except psycopg.Error as e:
                raise RuntimeError(f"migration {f.name} failed: {e.diag.message_primary or e}") from e
        if (os.environ.get("SEED") == "1" if seed is None else seed) and                 not c.execute("select 1 from tenants limit 1").fetchone():
            run("seed_made_to_order.sql")
        if owner:  # new tables and views need their grants for laris_app
            run("roles.sql")
        # trade-template fields become the tenant's starting registry (owner can still add via proposals)
        for t in c.execute("select id, trade_template from tenants").fetchall():
            seed_tenant_fields(c, t[0], t[1])
        from . import license as lic  # local: license imports clock, which imports db
        lic.refresh(c)  # a key set from the admin page enforces from the first webhook after a restart, not only after the first signed-in request


def seed_tenant_fields(c, tenant_id, trade_template: str) -> None:
    from .templates import load_template  # local: keeps db.py importable without yaml
    for f in load_template(trade_template)["fields"]:
        c.execute("""insert into tenant_fields(tenant_id,key,label,type,unit,options,applies_to,sort_order)
                     values (%s,%s,%s,%s,%s,%s,%s::doc_direction[],%s) on conflict (tenant_id,key) do nothing""",
                  (tenant_id, f["key"], f["label"], f["type"], f.get("unit"),
                   psycopg.types.json.Jsonb(f["options"]) if f.get("options") else None,
                   f["applies_to"], f.get("sort_order", 100)))


def create_tenant(c, name: str, trade_template: str, currency: str = "MYR"):
    """New tenant (needs laris.tenant='*') with its trade-template fields; the owner/staff roles come from a trigger.
    `name` is the stable key and made unique with a short suffix; the display name stays as typed. Raises TemplateError for a bad template.
    `c` must be a dict_row connection (tx())."""
    from .templates import load_template  # local: keeps db.py importable without yaml
    t = load_template(trade_template)
    key = name
    while c.execute("select 1 from tenants where lower(name)=lower(%s)", (key,)).fetchone():
        key = f"{name}-{secrets.token_hex(2)}"
    tid = c.execute("insert into tenants(name, display_name, trade_template, currency, min_margin_pct) values (%s,%s,%s,%s,%s) returning id",
                    (key, name, trade_template, currency, t["min_margin_pct"])).fetchone()["id"]
    seed_tenant_fields(c, tid, trade_template)
    return tid


def rls_status(conn) -> tuple[bool, bool]:
    """(role bypasses row level security, role owns audit_log). Superuser/BYPASSRLS skip RLS even with FORCE; the owner can disable triggers."""
    row = conn.execute(
        "select (select rolsuper or rolbypassrls from pg_roles where rolname = current_user) bypass,"
        " (select pg_get_userbyid(relowner) = current_user from pg_class where oid = 'public.audit_log'::regclass) owns").fetchone()
    bypass, owns = row.values() if isinstance(row, dict) else row  # tx() rows are dicts
    return bool(bypass), bool(owns)


def check_rls(conn) -> None:
    """Startup check: warn when tenant isolation is off; refuse to start if REQUIRE_RLS=1, or on a Replit deployment / with more than one
    tenant unless ALLOW_RLS_BYPASS=1 (explicit opt-out)."""
    log, (bypass, owns) = logging.getLogger("laris"), rls_status(conn)
    if bypass:
        msg = "tenant isolation OFF: connected as a role that bypasses row level security; use db/roles.sql laris_app"
        if os.environ.get("REQUIRE_RLS") == "1":
            raise RuntimeError(msg + " (REQUIRE_RLS=1)")
        n = conn.execute("select count(*) n from (select 1 from tenants limit 2) t").fetchone()
        if (os.environ.get("REPLIT_DEPLOYMENT") or os.environ.get("REPL_DEPLOYMENT")) or (n["n"] if isinstance(n, dict) else n[0]) > 1:
            if os.environ.get("ALLOW_RLS_BYPASS") != "1":
                raise RuntimeError(msg + ". Refusing to start a deployment or a multi-tenant database like this: connect as laris_app, "
                                   "or set ALLOW_RLS_BYPASS=1 to accept the risk")
            log.error("ALLOW_RLS_BYPASS=1: running WITHOUT tenant isolation on a deployment or multi-tenant database; one bug leaks across businesses")
        else:
            log.warning(msg)
    if owns:
        log.warning("connected role owns audit_log, so it can disable the audit and guard triggers; use db/roles.sql laris_app")


def bootstrap_owner(conn) -> str:
    """First sign-in without a shell: BOOTSTRAP_OWNER_USERNAME + BOOTSTRAP_OWNER_PASSWORD (Replit Secrets) give the first
    owner a password, once, and only while nobody has one yet. Remove both secrets afterwards. Returns what happened."""
    from . import auth  # local: auth imports db
    user, pw = os.environ.get("BOOTSTRAP_OWNER_USERNAME", "").strip(), os.environ.get("BOOTSTRAP_OWNER_PASSWORD", "")
    if not user or not pw:
        return "off"
    if conn.execute("select 1 from users where password_hash is not null limit 1").fetchone():
        return "skipped: an account already has a password (remove the BOOTSTRAP_OWNER_* secrets)"
    if len(pw) < auth.MIN_PASSWORD or (why := auth.weak_password(pw, user)):
        return "refused: the bootstrap password is too short or too common"
    o = conn.execute("select id from users where role='owner' and active order by created_at, id limit 1").fetchone()
    if not o:
        return "refused: no active owner exists"
    conn.execute("update users set username=%s, password_hash=%s where id=%s", (user, auth.hash_password(pw), o["id"]))
    auth.revoke_credentials(conn, o["id"])
    return f"owner can now sign in as {user} (remove the BOOTSTRAP_OWNER_* secrets)"
