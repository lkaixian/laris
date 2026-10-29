"""Accounts and API tokens for users. The token is printed once; only its SHA-256 is stored.
  python scripts/create_token.py list
  python scripts/create_token.py issue <user name or id> [--days N]     # token expires after N days (default 90)
  python scripts/create_token.py revoke <user name or id>               # kills the token and every session
  python scripts/create_token.py account <user name or id> <username> [--reactivate] [--tenant <id>]   # first sign-in account (asks for the password)
With several tenants, `account` needs --tenant and refuses a user from another one.
Needs DATABASE_URL. Then call the API with `Authorization: Bearer <token>`; role and tenant come from the user row."""
import getpass
import os
import secrets
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from src import db  # noqa: E402
from src import auth  # noqa: E402
from src.auth import token_hash  # noqa: E402


def find(c, who):
    rows = c.execute("select id, name, role, active, tenant_id from users where id::text = %s or name = %s", (who, who)).fetchall()
    if len(rows) != 1:
        sys.exit(f"{len(rows)} users match {who!r}; use the id")
    return rows[0]


def main(a):
    a, days, reactivate = list(a), 90, "--reactivate" in a
    a = [x for x in a if x != "--reactivate"]
    tenant = None
    if "--tenant" in a:
        i = a.index("--tenant")
        tenant = a[i + 1] if i + 1 < len(a) else sys.exit("--tenant needs a tenant id")
        del a[i:i + 2]
    if "--days" in a:
        i = a.index("--days")
        try:
            days = int(a[i + 1])
        except (IndexError, ValueError):
            sys.exit("--days needs a whole number")
        if days < 1:
            sys.exit("--days must be at least 1")
        del a[i:i + 2]
    with db.tx("owner", "script:create_token", tenant=db.ALL_TENANTS) as c:
        if a[:1] == ["list"]:
            for u in c.execute("select id, name, role, token_sha256 is not null as has_token, token_expires_at from users order by name"):
                print(u["id"], u["role"], u["name"], f"token until {u['token_expires_at']}" if u["has_token"] else "-")
        elif len(a) == 2 and a[0] == "issue":
            u = find(c, a[1])
            tok = secrets.token_urlsafe(32)
            exp = c.execute("update users set token_sha256=%s, token_expires_at = now() + %s * interval '1 day' where id=%s returning token_expires_at",
                            (token_hash(tok), days, u["id"])).fetchone()["token_expires_at"]
            print(f"{u['role']} {u['name']}: {tok}\nShown once. Expires {exp:%Y-%m-%d %H:%M} UTC. Send it as `Authorization: Bearer <token>`.")
        elif len(a) == 3 and a[0] == "account":
            u = find(c, a[1])
            if c.execute("select count(*) n from tenants").fetchone()["n"] > 1 and (tenant or "") != str(u["tenant_id"]):
                sys.exit("several tenants exist: pass --tenant <id> naming this user's tenant; nothing changed.")
            if not u["active"] and not reactivate:
                sys.exit(f"{u['name']} is deactivated; nothing changed. Run again with --reactivate to turn the account back on.")
            pw = getpass.getpass("Password (10+ characters): ")
            if len(pw) < auth.MIN_PASSWORD or pw != getpass.getpass("Again: "):
                sys.exit("too short or not the same")
            if why := auth.weak_password(pw, a[2]):
                sys.exit(why)
            c.execute("update users set username=%s, password_hash=%s, active=true where id=%s", (a[2], auth.hash_password(pw), u["id"]))
            auth.revoke_credentials(c, u["id"])  # a new password signs everything else out
            print(f"{u['role']} {u['name']} can now sign in as {a[2]}")
        elif len(a) == 2 and a[0] == "revoke":
            auth.revoke_credentials(c, find(c, a[1])["id"])
            print("revoked (API token and sessions)")
        else:
            sys.exit(__doc__)


if __name__ == "__main__":
    main(sys.argv[1:])
