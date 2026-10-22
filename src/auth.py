"""Passwords (scrypt, stdlib), login sessions (random token, only its SHA-256 stored) and a login rate limit."""
import hashlib
import hmac
import os
import secrets
import time
from collections import defaultdict, deque

N, R, P = 2 ** 14, 8, 1
MIN_PASSWORD = 10
LIMIT, WINDOW = 5, 900  # failed logins per (username, address) per 15 minutes
# ponytail: in-memory per process (run.sh forces 1 worker); move to the DB if the app ever runs more than one
_FAILS = defaultdict(deque)


def hash_password(password: str) -> str:
    salt = secrets.token_bytes(16)
    h = hashlib.scrypt(password.encode(), salt=salt, n=N, r=R, p=P, dklen=32)
    return f"scrypt${N}${R}${P}${salt.hex()}${h.hex()}"


def verify_password(password: str, stored: str | None) -> bool:
    """Always spends one scrypt, also for unknown users (stored=None), so timing does not reveal which usernames exist."""
    try:
        _, n, r, p, salt, h = (stored or DUMMY).split("$")
        calc = hashlib.scrypt(password.encode(), salt=bytes.fromhex(salt), n=int(n), r=int(r), p=int(p), dklen=32)
        return bool(stored) and hmac.compare_digest(calc, bytes.fromhex(h))
    except (ValueError, TypeError):
        return False


DUMMY = hash_password("not a real password")


def token_hash(token: str) -> str:
    return hashlib.sha256(token.encode()).hexdigest()


def session_hours() -> int:
    return int(os.environ.get("SESSION_HOURS", "12"))


def new_session(conn, user_id, agent: str = "") -> tuple[str, object]:
    tok = secrets.token_urlsafe(32)
    exp = conn.execute("insert into sessions(token_sha256, user_id, expires_at, user_agent) values (%s, %s, now() + %s * interval '1 hour', %s) returning expires_at",
                       (token_hash(tok), user_id, session_hours(), agent[:200])).fetchone()["expires_at"]
    return tok, exp


def throttled(key: str) -> bool:
    now, q = time.monotonic(), _FAILS[key]
    while q and now - q[0] > WINDOW:
        q.popleft()
    return len(q) >= LIMIT


def failed(key: str):
    _FAILS[key].append(time.monotonic())


def cleared(key: str):
    _FAILS.pop(key, None)
