"""Signed software licence: `LARIS1.<b64url(payload json)>.<b64url(ed25519 signature over those payload bytes)>`.
The app only ever holds the PUBLIC key: env LICENSE_PUBLIC_KEY (base64 of the raw 32 bytes), the file src/license_public.key, or the license_config row set from the admin page
(same text; no key is committed). No key configured = licensing is off and the app behaves as before. A deterrent, not DRM (docs/licensing.md)."""
import base64
import binascii
import hashlib
import json
import logging
import os
import re
import time
from datetime import datetime, timezone
from pathlib import Path
from uuid import UUID, uuid4

from cryptography.exceptions import InvalidSignature
from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey, Ed25519PublicKey

from psycopg.rows import dict_row

from . import clock
from .errors import ApiError

log = logging.getLogger("laris")
PREFIX, KEYFILE = "LARIS1", Path(__file__).resolve().parent / "license_public.key"
FIELDS = {"v", "lid", "email", "org", "plan", "seats", "issued_at", "expires_at"}
MAX_TOKEN, MAX_TS, MAX_SEATS, EXPIRING_DAYS, CACHE_SECONDS = 4096, 4102444800, 10_000, 14, 60  # MAX_TS = year 2100
B64 = re.compile(r"^[A-Za-z0-9_-]+$")
# ponytail: static catalog in code. REAL DATA needed: prices (shown as "contact us" until the owner of the product sets them).
# ai_month: model calls (customer chat, assistant, document reading) per calendar month; photos_month: catalog photos read by the vision model per month.
# Both are the owner's: ai_month 800 / 3,000 / 10,000 and photos_month 30 / 150 / 500. The Pricing page (web/src/Pricing.tsx) repeats them.
PLANS = {"starter": {"name": "Starter", "seats": 3, "ai_month": 800, "photos_month": 30},
         "standard": {"name": "Standard", "seats": 10, "ai_month": 3000, "photos_month": 150},
         "pro": {"name": "Pro", "seats": 25, "ai_month": 10000, "photos_month": 500}}
BLOCKING = ("missing", "expired", "invalid", "clock_unverified")  # statuses that put an enforced installation into read-only mode
ALLOWED = ("/api/license", "/api/me/sessions", "/api/me/password")  # writes that stay open: licensing itself, own sessions, own password
_CACHE: dict = {}


def _b64(b: bytes) -> str:
    return base64.urlsafe_b64encode(b).rstrip(b"=").decode()


def _unb64(s: str) -> bytes:
    return base64.urlsafe_b64decode(s + "=" * (-len(s) % 4))


# ---- the public key: env / file first, else the one row of license_config (set from the platform admin page; src/api/license_routes.py)
_DB: dict = {"raw": "", "at": None}  # the dashboard key, cached CACHE_SECONDS; set() and invalidate() reset it


def _env_raw() -> str:
    return os.environ.get("LICENSE_PUBLIC_KEY", "").strip() or (KEYFILE.read_text(encoding="utf-8").strip() if KEYFILE.is_file() else "")


def refresh(conn) -> None:
    """Reload the dashboard key when the cached copy is older than CACHE_SECONDS. Cheap: call it wherever a connection is at hand."""
    if _DB["at"] is not None and time.monotonic() - _DB["at"] < CACHE_SECONDS:
        return
    with conn.cursor(row_factory=dict_row) as cur:
        row = cur.execute("select public_key from license_config").fetchone()
    _DB.update(raw=(row["public_key"] or "").strip() if row else "", at=time.monotonic())


def set_key(conn, raw: str, user_id) -> None:
    conn.execute("""insert into license_config(id, public_key, set_by, set_at) values (true, %s, %s, now())
                    on conflict (id) do update set public_key = excluded.public_key, set_by = excluded.set_by, set_at = excluded.set_at""", (raw, user_id))
    invalidate()
    _DB.update(raw=raw, at=time.monotonic())


def raw_key() -> str:
    return _env_raw() or _DB["raw"]


def source() -> str | None:
    return "environment" if _env_raw() else "dashboard" if _DB["raw"] else None


def parse_key(raw: str) -> Ed25519PublicKey | None:
    try:
        return Ed25519PublicKey.from_public_bytes(base64.b64decode(raw, validate=True)) if raw else None
    except (ValueError, binascii.Error):
        return None


def fingerprint(key: Ed25519PublicKey) -> str:
    return hashlib.sha256(key.public_bytes(serialization.Encoding.Raw, serialization.PublicFormat.Raw)).hexdigest()[:12]


def configured() -> bool:
    """Enforcement is on exactly when a public key is configured (even a broken one: that fails closed)."""
    return bool(raw_key())


def public_key() -> Ed25519PublicKey | None:
    raw = raw_key()
    key = parse_key(raw)
    if raw and key is None:
        log.error("the licence public key (env / src/license_public.key / dashboard) is not a base64 Ed25519 public key (32 bytes): no licence can verify")
    return key


# ---- issue (the issuer's tool and tests; the app itself never signs)
def sign(private: Ed25519PrivateKey, email: str, plan: str, seats: int, days: int, org: str = "", now: int | None = None, lid: str | None = None) -> str:
    now = int(time.time()) if now is None else now
    payload = {"v": 1, "lid": lid or str(uuid4()), "email": email.strip().lower(), "org": org, "plan": plan, "seats": seats,
               "issued_at": now, "expires_at": now + days * 86400}
    body = json.dumps(payload, separators=(",", ":"), sort_keys=True).encode()
    return f"{PREFIX}.{_b64(body)}.{_b64(private.sign(body))}"


# ---- verify
def _int(v, lo, hi) -> bool:
    return type(v) is int and lo <= v <= hi


def _valid(p) -> bool:
    """Strict shape: exactly these fields, these types and ranges."""
    try:
        return (isinstance(p, dict) and p.keys() == FIELDS and p["v"] == 1 and type(p["v"]) is int
                and isinstance(p["lid"], str) and (u := UUID(p["lid"])).version == 4 and str(u) == p["lid"]
                and isinstance(p["email"], str) and p["email"] == p["email"].lower() and len(p["email"]) <= 254 and "@" in p["email"]
                and isinstance(p["org"], str) and len(p["org"]) <= 200
                and isinstance(p["plan"], str) and re.fullmatch(r"[a-z0-9_-]{1,30}", p["plan"]) is not None
                and _int(p["seats"], 1, MAX_SEATS) and _int(p["issued_at"], 0, MAX_TS) and _int(p["expires_at"], 1, MAX_TS)
                and p["expires_at"] > p["issued_at"])
    except (ValueError, KeyError, AttributeError):
        return False


def inspect(token, key: Ed25519PublicKey | None = None) -> tuple[dict | None, str | None]:
    """(payload, None) for a token whose signature and fields verify, else (None, reason): no_key | malformed | signature | fields.
    Expiry is NOT judged here (status() does, with trusted time). `key`: verify under this key instead of the configured one."""
    if key is None and not configured():
        return None, "no_key"
    key = key or public_key()
    if key is None:
        return None, "no_key"
    if not isinstance(token, str) or len(token) > MAX_TOKEN:
        return None, "malformed"
    parts = token.strip().split(".")
    if len(parts) != 3 or parts[0] != PREFIX or not all(B64.match(x) for x in parts[1:]):
        return None, "malformed"
    try:
        body, sig = _unb64(parts[1]), _unb64(parts[2])
        key.verify(sig, body)
        payload = json.loads(body)
    except InvalidSignature:
        return None, "signature"
    except (ValueError, binascii.Error):  # bad base64 / json / utf-8 (a signed body that is not json is also refused)
        return None, "malformed"
    return (payload, None) if _valid(payload) else (None, "fields")


# ---- status
def invalidate(tenant_id=None):
    if tenant_id:
        _CACHE.pop(tenant_id, None)
    else:
        _CACHE.clear()
        _DB.update(raw="", at=None)


def _iso(ts: int) -> str:
    return datetime.fromtimestamp(ts, timezone.utc).isoformat()


def status(conn, tenant_id) -> dict:
    """missing | active | expiring (<=14 days) | expired | invalid | clock_unverified, with plan, seats, seats_used, expires_at, days_left,
    enforced and the clock. Cached 60 s per tenant; activation invalidates it. conn must see the tenant (RLS)."""
    refresh(conn)
    hit = _CACHE.get(tenant_id)
    if hit and time.monotonic() - hit[0] < CACHE_SECONDS:
        return hit[1]
    enforced = configured()
    out = {"status": "missing", "plan": None, "seats": None, "seats_used": conn.execute("select count(*) n from users where tenant_id=%s and active", (tenant_id,)).fetchone()["n"],
           "expires_at": None, "days_left": None, "enforced": enforced, "clock": None, "read_only": False}
    if enforced:
        clk = clock.trusted_now(conn)
        out["clock"] = {"source": clk["source"], "trusted_at": clk["trusted_at"], "rollback": clk["rollback"]}
        tok = conn.execute("select license_token from tenants where id=%s", (tenant_id,)).fetchone()
        if tok and tok["license_token"]:
            p, _ = inspect(tok["license_token"])  # re-verified each time: a row edited by hand falls to 'invalid'
            if not p:
                out["status"] = "invalid"
            else:
                left = (p["expires_at"] - clk["now"]) / 86400
                out.update(plan=p["plan"], seats=p["seats"], expires_at=_iso(p["expires_at"]), days_left=int(left // 1))
                out["status"] = ("expired" if left <= 0 else "clock_unverified" if clk["unverified"]
                                 else "expiring" if left <= EXPIRING_DAYS else "active")
        out["read_only"] = out["status"] in BLOCKING
    _CACHE[tenant_id] = (time.monotonic(), out)
    return out


def gate(path: str, ctx):
    """Called for every write that goes through write_ctx: 402 while an enforced installation has no usable licence."""
    refresh(ctx.conn)
    if not configured() or path.startswith(ALLOWED):
        return
    s = status(ctx.conn, ctx.tenant_id)
    if s["read_only"]:
        raise ApiError(402, "license_required", f"Licence {s['status'].replace('_', ' ')}: changes are paused and the app is read-only. "
                       "The owner can activate or request a licence under Licence.")


def check_seat(ctx):
    """409 seat_limit when adding one more active user would pass the licensed seats (enforced and licensed only)."""
    s = status(ctx.conn, ctx.tenant_id)
    if s["enforced"] and s["seats"] is not None:
        used = ctx.conn.execute("select count(*) n from users where tenant_id=%s and active", (ctx.tenant_id,)).fetchone()["n"]  # live, not cached
        if used >= s["seats"]:
            raise ApiError(409, "seat_limit", f"Your licence covers {s['seats']} users and all of them are in use.")
