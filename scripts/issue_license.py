"""The ISSUER's tool (runs on the issuer's machine, never on the customer's server). The private key never leaves this machine.
  python scripts/issue_license.py keygen [--out ~/.laris/license_private.pem]          # once; prints the PUBLIC key and how to configure it
  python scripts/issue_license.py issue --email you@x.com [--plan standard] [--days 365] [--seats 10] [--org "Name"] [--key path] [--send]
  python scripts/issue_license.py issue --request <id> [--days 365] [--key path] [--send]   # email / plan / seats / org come from the request
  python scripts/issue_license.py inspect <token>                                      # needs LICENSE_PUBLIC_KEY (or src/license_public.key)
  python scripts/issue_license.py requests                                             # pending requests (needs DATABASE_URL)
Private key: --key or env LICENSE_PRIVATE_KEY_FILE. Nothing is ever read from the repo."""
import argparse
import base64
import os
import sys
from datetime import datetime, timezone
from pathlib import Path
from uuid import uuid4

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from cryptography.hazmat.primitives import serialization  # noqa: E402
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey  # noqa: E402

from src import license as lic  # noqa: E402

DEFAULT_KEY = Path.home() / ".laris" / "license_private.pem"
log = print


def keygen(out: Path) -> str:
    """Create the private key file (refuses to overwrite) and return the public key as base64. The private key is never printed."""
    out = Path(out).expanduser()
    out.parent.mkdir(parents=True, exist_ok=True)
    key = Ed25519PrivateKey.generate()
    pem = key.private_bytes(serialization.Encoding.PEM, serialization.PrivateFormat.PKCS8, serialization.NoEncryption())
    try:
        fd = os.open(out, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)  # exclusive: an existing key is never replaced
    except FileExistsError:
        sys.exit(f"{out} already exists; refusing to overwrite a private key. Choose another --out.")
    with os.fdopen(fd, "wb") as f:
        f.write(pem)
    try:
        os.chmod(out, 0o600)  # no effect for other users on Windows: keep the file in your own profile folder
    except OSError:
        pass
    pub = key.public_key().public_bytes(serialization.Encoding.Raw, serialization.PublicFormat.Raw)
    return base64.b64encode(pub).decode()


def load_private(path) -> Ed25519PrivateKey:
    p = Path(path or os.environ.get("LICENSE_PRIVATE_KEY_FILE") or DEFAULT_KEY).expanduser()
    try:
        key = serialization.load_pem_private_key(p.read_bytes(), password=None)
    except (OSError, ValueError) as e:
        sys.exit(f"cannot read a private key from {p} ({type(e).__name__}); use --key or LICENSE_PRIVATE_KEY_FILE")
    if not isinstance(key, Ed25519PrivateKey):
        sys.exit(f"{p} is not an Ed25519 key")
    return key


def show(p: dict) -> str:
    when = lambda t: datetime.fromtimestamp(t, timezone.utc).strftime("%Y-%m-%d")
    return (f"licence {p['lid']}\n  email   {p['email']}\n  org     {p['org'] or '-'}\n  plan    {p['plan']}, {p['seats']} seats\n"
            f"  issued  {when(p['issued_at'])}\n  expires {when(p['expires_at'])}")


def mail_token(to: str, token: str, plan: str, seats: int) -> bool:
    from src import mailer
    if not mailer.enabled():
        log("email is OFF (MAILTRAP_API_TOKEN not set): the key was NOT sent. Send it yourself.")
        return False
    ok = mailer.send(to, *mailer.license_mail(plan, seats, token), category="license")
    log("emailed the key." if ok else "email FAILED: the key was NOT sent. Send it yourself.")
    return ok


def pending(c) -> list[dict]:
    return c.execute("""select q.id, coalesce(t.display_name, t.name) org, q.email, q.plan, q.seats, q.note, q.created_at
                        from license_requests q join tenants t on t.id = q.tenant_id where q.status = 'new' order by q.created_at""").fetchall()


def issue(a) -> str:
    """Sign and (with --request) mark the request issued. Returns the token."""
    email, plan, seats, org, req = a.email, a.plan, a.seats, a.org or "", None
    if a.request:
        from src import db
        with db.tx() as c:
            req = c.execute("""select q.id, q.email, q.plan, q.seats, coalesce(t.display_name, t.name) org from license_requests q
                               join tenants t on t.id = q.tenant_id where q.id::text = %s and q.status = 'new'""", (a.request,)).fetchone()
            if not req:
                sys.exit("no pending request with that id")
            email, plan, seats, org = req["email"], req["plan"], req["seats"], a.org or req["org"]
            lid = str(uuid4())
            token = lic.sign(load_private(a.key), email, plan, seats, a.days, org, lid=lid)
            c.execute("update license_requests set status='issued', issued_license_id=%s where id=%s", (lid, req["id"]))
    else:
        if not email:
            sys.exit("--email is required (or use --request <id>)")
        seats = seats or lic.PLANS.get(plan, {}).get("seats") or sys.exit("--seats is required for a custom plan")
        token = lic.sign(load_private(a.key), email, plan, seats, a.days, org)
    log(f"Licence key for {email} ({plan}, {seats} seats, {a.days} days). It is shown ONCE, keep a copy:\n\n{token}\n")
    if a.send:
        mail_token(email, token, plan, seats)
    return token


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    sub = ap.add_subparsers(dest="cmd", required=True)
    k = sub.add_parser("keygen")
    k.add_argument("--out", default=str(DEFAULT_KEY))
    i = sub.add_parser("issue")
    i.add_argument("--email")
    i.add_argument("--plan", default="standard")
    i.add_argument("--days", type=int, default=365)
    i.add_argument("--seats", type=int)
    i.add_argument("--org")
    i.add_argument("--key")
    i.add_argument("--request")
    i.add_argument("--send", action="store_true")
    n = sub.add_parser("inspect")
    n.add_argument("token")
    sub.add_parser("requests")
    a = ap.parse_args(argv)
    if a.cmd == "keygen":
        pub = keygen(a.out)
        log(f"Private key written to {a.out} (back it up; never share it, never commit it).\nPublic key: {pub}\n"
            f"Set this on the server that runs LARIS:\n  LICENSE_PUBLIC_KEY={pub}\n(or put the same text in src/license_public.key)")
    elif a.cmd == "issue":
        if a.days < 1 or (a.seats is not None and a.seats < 1):
            sys.exit("--days and --seats must be positive")
        issue(a)
    elif a.cmd == "inspect":
        p, why = lic.inspect(a.token)
        if not p:
            sys.exit(f"NOT VALID ({why}); the public key is LICENSE_PUBLIC_KEY / src/license_public.key")
        log(show(p) + ("\n  EXPIRED" if p["expires_at"] <= datetime.now(timezone.utc).timestamp() else ""))
    else:
        from src import db
        with db.tx() as c:
            rows = pending(c)
        for q in rows:
            log(f"{q['id']}  {q['org']}  {q['email']}  {q['plan']} x{q['seats']}  {q['note'] or ''}")
        if not rows:
            log("no pending requests")


if __name__ == "__main__":
    main()
