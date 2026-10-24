"""Trusted time for the licence: SNTP (stdlib) cached for 6 hours, plus a database watermark that only moves forward.
A deterrent against setting the clock back, not DRM (docs/licensing.md). Tests replace ntp_time() and system_time()."""
import logging
import os
import socket
import struct
import threading
import time
from datetime import datetime, timezone

import psycopg

from . import db

log = logging.getLogger("laris")
HOSTS = ("pool.ntp.org", "time.google.com")
TIMEOUT = 2.0  # per host, and the longest a request ever waits for a refresh
TTL = 6 * 3600  # a good answer is reused this long
RETRY = 300  # after a failed attempt, wait this long before the next one
MAX_SKEW = 2 * 86400  # an NTP answer further than this from the system clock is treated as forged or broken, not as the time
WRITE_EVERY = 60  # the watermark row is written at most once a minute
ROLLBACK_SLACK = 300  # seconds the system clock may sit below the watermark before it counts as a rollback
EPOCH = 2208988800  # seconds between 1900 (NTP) and 1970 (unix)
_S = {"ntp": None, "mono": 0.0, "tried": None, "thread": None}
_LOCK = threading.Lock()


def system_time() -> float:
    return time.time()


def grace_days() -> int:
    try:
        return max(0, int(os.environ.get("LICENSE_OFFLINE_GRACE_DAYS", "7")))
    except ValueError:
        return 7


def _parse(reply: bytes, sent: bytes) -> float | None:
    """Unix time from a server reply, or None when it is not a sane answer to OUR request (mode, leap, stratum, echoed timestamp)."""
    if len(reply) < 48 or reply[24:32] != sent[40:48]:  # the server must echo our transmit stamp: an off-path forger does not know it
        return None
    li, mode, stratum = reply[0] >> 6, reply[0] & 7, reply[1]
    sec, frac = struct.unpack("!II", reply[40:48])
    if mode != 4 or li == 3 or not 1 <= stratum <= 15 or sec == 0:  # not a server reply, clock unsynchronised, kiss-of-death / unspecified
        return None
    return sec - EPOCH + frac / 2 ** 32


def ntp_time() -> float | None:
    """Unix time from the first host that answers sanely, else None. Network I/O: callers never wait on it for long (see _ntp_now)."""
    for host in HOSTS:
        try:
            with socket.socket(socket.AF_INET, socket.SOCK_DGRAM) as s:
                s.settimeout(TIMEOUT)
                sent = bytes([0x1B]) + bytes(39) + struct.pack("!II", int(system_time()) + EPOCH, int((system_time() % 1) * 2 ** 32))
                s.sendto(sent, (host, 123))
                if (t := _parse(s.recvfrom(512)[0], sent)) is not None:
                    return t
        except OSError:
            continue
    return None


def _fetch():
    try:
        t = ntp_time()
    except Exception as e:  # a broken fetch must never take the thread (or a request) down
        log.warning("ntp lookup failed: %s", type(e).__name__)
        t = None
    if t is not None and abs(t - system_time()) > MAX_SKEW:  # otherwise one forged reply would ratchet the watermark, and every licence, into expiry
        log.warning("ntp time ignored: it is %.1f days away from the system clock", (t - system_time()) / 86400)
        t = None
    with _LOCK:
        _S["tried"] = time.monotonic()
        if t is not None:
            _S["ntp"], _S["mono"] = t, time.monotonic()
        _S["thread"] = None


def _ntp_now() -> float | None:
    """The cached NTP time moved forward by the monotonic clock, or None. At most one refresh is running; a request waits for it at most TIMEOUT seconds."""
    now, th = time.monotonic(), None
    with _LOCK:
        fresh = _S["ntp"] is not None and now - _S["mono"] < TTL
        if not fresh and _S["thread"] is None and (_S["tried"] is None or now - _S["tried"] >= RETRY):
            th = _S["thread"] = threading.Thread(target=_fetch, daemon=True)
    if th:
        th.start()
        th.join(TIMEOUT)  # DNS can outlast the socket timeout, so the lookup lives in a thread and the request stops waiting
    with _LOCK:
        age = time.monotonic() - _S["mono"]
        return _S["ntp"] + age if _S["ntp"] is not None and age < TTL else None


def reset():
    """Forget the cached answer (tests)."""
    with _LOCK:
        _S.update(ntp=None, mono=0.0, tried=None, thread=None)


def _upsert(c, now, ntp, behind):
    c.execute("""insert into license_clock(watermark, last_ntp_ok, rollback_flag) values (to_timestamp(%(now)s), to_timestamp(%(ntp)s::float8), %(back)s)
                 on conflict (id) do update set watermark = greatest(license_clock.watermark, excluded.watermark),
                     last_ntp_ok = coalesce(excluded.last_ntp_ok, license_clock.last_ntp_ok),
                     rollback_flag = license_clock.rollback_flag or excluded.rollback_flag""", {"now": now, "ntp": ntp, "back": behind})


def _store(conn, now, ntp, behind):
    """Write the watermark in its OWN connection and transaction: it commits at once and holds no lock, whatever the request's `conn` is doing.
    (`conn` is unused here; tests replace this with an in-transaction write because PGlite serves one connection at a time.)"""
    with db.tx("staff", "system:clock", timeout=5) as c:
        _upsert(c, now, ntp, behind)


def trusted_now(conn) -> dict:
    """{now (unix), source 'ntp'|'system', unverified, behind, rollback, trusted_at}. NTP ok: its time. Otherwise the system clock.
    Either way never below the stored watermark (the highest time ever seen, which only moves forward: db/license.sql guards it).
    unverified: NTP unreachable longer than LICENSE_OFFLINE_GRACE_DAYS, or the system clock is currently behind the watermark with no NTP.
    behind: the system clock is below the watermark (a rollback), as opposed to merely being offline for long.
    `conn` only READS (no lock: a slow request must not block the licence check of other tenants); the watermark is written in its
    own short transaction, and only when the time moved on by WRITE_EVERY seconds or a rollback is seen for the first time."""
    ntp = _ntp_now()
    seen = ntp if ntp is not None else system_time()
    row = conn.execute("""select extract(epoch from watermark)::float8 wm, extract(epoch from coalesce(last_ntp_ok, first_seen))::float8 ref, rollback_flag
                          from license_clock""").fetchone()
    wm = row["wm"] if row else None
    behind = wm is not None and seen < wm - ROLLBACK_SLACK
    now = max(seen, wm) if wm is not None else seen
    ref = ntp if ntp is not None else row["ref"] if row else now
    flag = bool(row and row["rollback_flag"]) or behind
    if not row or now - wm >= WRITE_EVERY or (ntp is not None and ntp - row["ref"] >= WRITE_EVERY) or (flag and not row["rollback_flag"]):
        try:
            _store(conn, now, ntp, behind)
        except psycopg.Error as e:  # the answer below does not depend on it; the next call tries again
            log.warning("licence clock write failed: %s", type(e).__name__)
    unverified = now - ref > grace_days() * 86400 or (behind and ntp is None)
    return {"now": now, "source": "ntp" if ntp is not None else "system", "unverified": unverified, "behind": behind, "rollback": flag,
            "trusted_at": datetime.fromtimestamp(now, timezone.utc).isoformat()}
