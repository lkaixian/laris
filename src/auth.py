"""Passwords (scrypt, stdlib), login sessions (random token, only its SHA-256 stored) and a login rate limit."""
import hashlib
import hmac
import os
import secrets
import time
from collections import deque

N, R, P = 2 ** 16, 8, 1  # stored in each hash string ("scrypt$N$R$P$salt$hash"), so older, weaker hashes keep verifying
MAXMEM = 128 * 1024 * 1024  # scrypt at N=2**16, r=8 needs 64 MiB; OpenSSL's default cap is 32 MiB
MIN_PASSWORD = 10
COMMON = {"password", "password1", "password12", "password123", "password1234", "passw0rd123", "1234567890", "12345678910",
          "123456789012", "0123456789", "qwertyuiop", "qwerty1234", "qwerty12345", "qwerty123456", "1q2w3e4r5t", "1qaz2wsx3e",
          "abcdefghij", "abcd123456", "iloveyou12", "iloveyou123", "letmein123", "welcome123", "welcome1234", "admin12345",
          "administrator", "changeme123", "changeme12", "trustno1234", "monkey12345", "dragon12345", "football123", "baseball123",
          "superman123", "sunshine123", "princess123", "master12345", "login12345", "p@ssw0rd123", "p@ssword123", "p@ssw0rd1234",
          "11111111111", "00000000000", "aaaaaaaaaa", "laris12345", "laris123456"}
LIMIT, WINDOW = 5, 900  # failures before the first lock; quiet time after which a lock level and partial counts are forgotten
MAX_SESSIONS = 10  # per user
LOCK_MIN, LOCK_MAX = 60, 900 # lock seconds: 60, 120, 240, 480, 900, 900 ...
IP_LIMIT = 30  # failed logins per client address per WINDOW, across all usernames
# ponytail: in-memory per process (run.sh forces 1 worker); move to the DB if the app ever runs more than one
_ACCT: dict[str, list] = {}  # key -> [failures since last lock, lock level, locked until, last failure]
_IPS: dict[str, deque] = {}


def _now() -> float:
    return time.monotonic()


def hash_password(password: str) -> str:
    salt = secrets.token_bytes(16)
    h = hashlib.scrypt(password.encode(), salt=salt, n=N, r=R, p=P, dklen=32, maxmem=MAXMEM)
    return f"scrypt${N}${R}${P}${salt.hex()}${h.hex()}"


def verify_password(password: str, stored: str | None) -> bool:
    """Always spends one scrypt, also for unknown users (stored=None), so timing does not reveal which usernames exist."""
    try:
        _, n, r, p, salt, h = (stored or DUMMY).split("$")
        calc = hashlib.scrypt(password.encode(), salt=bytes.fromhex(salt), n=int(n), r=int(r), p=int(p), dklen=32, maxmem=MAXMEM)
        return bool(stored) and hmac.compare_digest(calc, bytes.fromhex(h))
    except (ValueError, TypeError):
        return False


DUMMY = hash_password("not a real password")


def needs_rehash(stored: str | None) -> bool:
    """True when the stored hash was made with weaker scrypt parameters than today's."""
    try:
        _, n, r, p, _, _ = stored.split("$")
        return int(n) < N or int(r) < R or int(p) < P
    except (ValueError, AttributeError):
        return False


def weak_password(password: str, username: str | None) -> str | None:
    """Reason a password is refused (beyond the length rule), else None."""
    if password.lower() in COMMON:
        return "That password is too common. Choose another."
    if username and password.lower() == username.lower():
        return "The password cannot be the same as the username."
    return None


def client_ip(request) -> str:
    """The LAST X-Forwarded-For entry (the one our own proxy appended) only when TRUST_PROXY=1; never the first, which the caller controls."""
    if os.environ.get("TRUST_PROXY") == "1":
        last = request.headers.get("x-forwarded-for", "").split(",")[-1].strip()
        if last:
            return last
    return request.client.host if request.client else ""


def revoke_credentials(conn, user_id, keep: str = ""):
    """Null the user's API token and delete their sessions (except the one whose token hash is `keep`)."""
    conn.execute("update users set token_sha256=null, token_expires_at=null where id=%s", (user_id,))
    conn.execute("delete from sessions where user_id=%s and token_sha256 <> %s", (user_id, keep))


def token_hash(token: str) -> str:
    return hashlib.sha256(token.encode()).hexdigest()


def session_hours() -> int:
    return int(os.environ.get("SESSION_HOURS", "12"))


def new_session(conn, user_id, agent: str = "") -> tuple[str, object]:
    tok = secrets.token_urlsafe(32)
    exp = conn.execute("insert into sessions(token_sha256, user_id, expires_at, user_agent) values (%s, %s, now() + %s * interval '1 hour', %s) returning expires_at",
                       (token_hash(tok), user_id, session_hours(), agent[:200])).fetchone()["expires_at"]
    conn.execute("delete from sessions where expires_at < now()")
    conn.execute("""delete from sessions where user_id=%(u)s and token_sha256 not in
                    (select token_sha256 from sessions where user_id=%(u)s order by created_at desc, id desc limit %(n)s)""",
                 {"u": user_id, "n": MAX_SESSIONS})  # oldest devices drop off
    return tok, exp


def _prune(now: float):
    """Forget what has been quiet for WINDOW, so the dicts cannot grow without bound."""
    for k, (_, _, until, last) in list(_ACCT.items()):
        if until <= now and now - max(until, last) > WINDOW:
            del _ACCT[k]
    for k, q in list(_IPS.items()):
        while q and now - q[0] > WINDOW:
            q.popleft()
        if not q:
            del _IPS[k]


def throttled(key: str, ip: str | None = None) -> bool:
    """True while `key` (an account, or "pw:<user id>") is locked, or `ip` has had IP_LIMIT failures in WINDOW."""
    now = _now()
    _prune(now)
    return (key in _ACCT and _ACCT[key][2] > now) or (ip is not None and len(_IPS.get(ip, ())) >= IP_LIMIT)


def failed(key: str, ip: str | None = None):
    """LIMIT failures lock the account for LOCK_MIN seconds, then 2x each time up to LOCK_MAX. A lapsed lock starts a fresh count of LIMIT
    (one try cannot re-lock it) but remembers the level until WINDOW of quiet or a success."""
    now = _now()
    s = _ACCT.setdefault(key, [0, 0, 0.0, now])
    s[0], s[3] = s[0] + 1, now
    if s[0] >= LIMIT:
        s[0], s[2], s[1] = 0, now + min(LOCK_MIN * 2 ** s[1], LOCK_MAX), min(s[1] + 1, 10)
    if ip is not None:
        _IPS.setdefault(ip, deque()).append(now)


def cleared(key: str):
    _ACCT.pop(key, None)


def header_mode_allowed(conn) -> bool:
    """Header-only demo mode (X-Role / X-User, no sign-in): the single decision for /api/auth/config and every /api call.
    Never once any account has a password or REQUIRE_USER_TOKEN=1. Otherwise only when DEMO_MODE=1, or on a plain local run
    (no APP_TOKEN, not a Replit deployment)."""
    if os.environ.get("REQUIRE_USER_TOKEN") == "1" or conn.execute("select 1 from users where password_hash is not null limit 1").fetchone():
        return False
    return os.environ.get("DEMO_MODE") == "1" or not (os.environ.get("APP_TOKEN") or os.environ.get("REPL_DEPLOYMENT"))
