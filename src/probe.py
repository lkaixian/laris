"""Live checks of the outside services, run only when the owner asks (GET /api/system/health?live=1).
Each probe calls the service's own auth or status route, never sends customer data and never returns or logs a URL, token or key:
the result is a state (ok / down) plus a fixed reason code (WHY) and the time it took. Services that are not configured are not called.
Tests replace `client` with one on httpx.MockTransport."""
import logging
import os
import time
from concurrent.futures import ThreadPoolExecutor

import httpx

from . import ilmu, mailer, rag, tgbots
from .channels import telegram, whatsapp

log = logging.getLogger("laris")
TIMEOUT, TTL, MIN_GAP = 4, 30, 10  # seconds: per call; a cached answer is reused this long; "check now" can re-run no sooner than this
WHY = ("timeout", "unreachable", "key_rejected", "http_error", "not_found", "webhook_missing", "webhook_error", "rag_failed", "no_consent")
_CACHE: dict = {}  # tenant_id -> (monotonic time, {key: result}, ISO time)


def client() -> httpx.Client:
    return httpx.Client(timeout=TIMEOUT)


def _down(why, ms=None):
    return {"state": "down", "why": why, **({"ms": ms} if ms is not None else {})}


def _call(c, method, url, headers, *, ok_below=400, **kw) -> dict:
    """One HTTP call -> {state, ms} or {state: down, why, ms}. ok_below: statuses under this count as the service answering."""
    t = time.perf_counter()
    try:
        r = c.request(method, url, headers=headers, **kw)
    except httpx.TimeoutException:
        return _down("timeout", int((time.perf_counter() - t) * 1000))
    except Exception as e:  # the type only: the text carries the URL, which carries a bot token
        log.warning("probe call failed: %s", type(e).__name__)
        return _down("unreachable", int((time.perf_counter() - t) * 1000))
    ms, s = int((time.perf_counter() - t) * 1000), r.status_code
    if s in (401, 403):
        return _down("key_rejected", ms)
    if s == 404 and ok_below <= 404:
        return _down("not_found", ms)
    return {"state": "ok", "ms": ms} if s < ok_below else _down("http_error", ms)


def _telegram(c, token):
    me = _call(c, "GET", telegram._api("getMe", token), None)
    if me["state"] != "ok":
        return me
    t = time.perf_counter()
    try:
        info = c.get(telegram._api("getWebhookInfo", token)).json()["result"]
    except Exception:
        return _down("webhook_error")
    ms = me["ms"] + int((time.perf_counter() - t) * 1000)
    if not info.get("url"):
        return _down("webhook_missing", ms)
    if info.get("last_error_message") and time.time() - info.get("last_error_date", 0) < 3600:
        return _down("webhook_error", ms)
    return {"state": "ok", "ms": ms}


def _mailtrap(c):
    # An empty body cannot deliver anything: a good token gets a validation error (400/422), a bad one a 401.
    inbox = (os.environ.get("MAILTRAP_INBOX_ID") or "").strip()
    r = _call(c, "POST", f"{mailer.SANDBOX}/{inbox}" if inbox else mailer.LIVE, {"Authorization": "Bearer " + os.environ["MAILTRAP_API_TOKEN"]}, ok_below=500, json={})
    return {**r, "state": "warn"} if r["state"] == "ok" and inbox else r  # a test inbox works but delivers to nobody


def run(ctx, base: list[dict], force: bool = False) -> tuple[dict, str]:
    """base = the services list from health.services(); -> ({key: {state, why?, ms?}}, ISO time checked). Only services whose
    base state is set or warn (configured) are called."""
    hit = _CACHE.get(ctx.tenant_id)
    if hit and time.monotonic() - hit[0] < (MIN_GAP if force else TTL):
        return hit[1], hit[2]
    live = {s["key"] for s in base if s["state"] in ("set", "warn")}
    env = os.environ.get
    jobs = {}  # key -> function(client); everything read from the database happens here, on this thread, before the pool starts
    if "telegram" in live:
        try:
            tok = tgbots.token_for(ctx.conn, ctx.tenant_id) or env("TELEGRAM_BOT_TOKEN")
            jobs["telegram"] = lambda c, tok=tok: _telegram(c, tok)
        except RuntimeError:  # the stored token cannot be decrypted (SECRET_KEY changed): it cannot be used either
            jobs["telegram"] = lambda c: _down("key_rejected")
    if "telegram_helper" in live:
        jobs["telegram_helper"] = lambda c: _telegram(c, env("LARIS_HELPER_BOT_TOKEN"))
    if "whatsapp" in live:
        jobs["whatsapp"] = lambda c: _call(c, "GET", f"{whatsapp.GRAPH}/{env('WHATSAPP_PHONE_NUMBER_ID')}?fields=id", {"Authorization": "Bearer " + env("WHATSAPP_TOKEN")})
    if "ilmu" in live:  # the API route list is not documented to us: any answer but a rejected key means the service is there
        jobs["ilmu"] = lambda c: _call(c, "GET", ilmu._base() + "/models", {"Authorization": "Bearer " + env("ILMU_API_KEY")}, ok_below=500)
    if "vision" in live:  # a stopped RunPod pod answers 5xx or times out: down is the truth
        jobs["vision"] = lambda c: _call(c, "GET", (env("RUNPOD_VISION_URL") or "").rstrip("/") + "/models", {"Authorization": "Bearer " + env("RUNPOD_API_KEY")})
    if "email" in live:
        jobs["email"] = _mailtrap
    out = {}
    with client() as c, ThreadPoolExecutor(max_workers=6) as pool:  # ponytail: a Telegram probe makes two calls, so up to 2 x TIMEOUT
        futs = {k: pool.submit(f, c) for k, f in jobs.items()}
        out = {k: f.result() for k, f in futs.items()}
    if "rag" in live:
        t = time.perf_counter()
        try:
            rag.retrieve(ctx, "laris", 1)
            out["rag"] = {"state": "ok", "ms": int((time.perf_counter() - t) * 1000)}
        except Exception as e:
            log.warning("probe rag failed: %s", type(e).__name__)
            out["rag"] = _down("rag_failed")
    if "mcp" in live:  # keys exist (base state set) only count while the owner's record-reading consent is on and search works
        out["mcp"] = ({"state": "ok"} if out.get("rag", {}).get("state") == "ok" else _down("rag_failed")) if "rag" in live else {"state": "warn", "why": "no_consent"}
    at = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
    _CACHE[ctx.tenant_id] = (time.monotonic(), out, at)
    return out, at
