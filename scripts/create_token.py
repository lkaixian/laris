"""Accounts and API tokens for users. The token is printed once; only its SHA-256 is stored.
  python scripts/create_token.py list
  python scripts/create_token.py issue <user name or id>
  python scripts/create_token.py revoke <user name or id>
  python scripts/create_token.py account <user name or id> <username>   # first sign-in account (asks for the password)
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
    rows = c.execute("select id, name, role from users where id::text = %s or name = %s", (who, who)).fetchall()
    if len(rows) != 1:
        sys.exit(f"{len(rows)} users match {who!r}; use the id")
    return rows[0]


def main(a):
    with db.tx("owner", "script:create_token") as c:
        if a[:1] == ["list"]:
            for u in c.execute("select id, name, role, token_sha256 is not null as has_token from users order by name"):
                print(u["id"], u["role"], u["name"], "token" if u["has_token"] else "-")
        elif len(a) == 2 and a[0] == "issue":
            u = find(c, a[1])
            tok = secrets.token_urlsafe(32)
            c.execute("update users set token_sha256=%s where id=%s", (token_hash(tok), u["id"]))
            print(f"{u['role']} {u['name']}: {tok}\nShown once. Send it as `Authorization: Bearer <token>`.")
        elif len(a) == 3 and a[0] == "account":
            u = find(c, a[1])
            pw = getpass.getpass("Password (10+ characters): ")
            if len(pw) < auth.MIN_PASSWORD or pw != getpass.getpass("Again: "):
                sys.exit("too short or not the same")
            c.execute("update users set username=%s, password_hash=%s, active=true where id=%s", (a[2], auth.hash_password(pw), u["id"]))
            print(f"{u['role']} {u['name']} can now sign in as {a[2]}")
        elif len(a) == 2 and a[0] == "revoke":
            c.execute("update users set token_sha256=null where id=%s", (find(c, a[1])["id"],))
            print("revoked")
        else:
            sys.exit(__doc__)


if __name__ == "__main__":
    main(sys.argv[1:])
