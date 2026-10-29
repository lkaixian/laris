import base64
import hashlib
import logging
import os
import re
from contextlib import asynccontextmanager
from pathlib import Path

from uuid import uuid4

import psycopg
from fastapi import FastAPI
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from starlette.exceptions import HTTPException as StarletteHTTPException
from starlette.routing import Match

from . import logsetup

logsetup.setup()  # before the modules below log anything

from . import db, scheduler
from .api import accept, ai_activity, ai_guide, assistant, audit, auth_routes, channel_settings, contacts, invites, jobs, license_routes, listings, mcp, onboarding, privacy, public_api, rfq, roles, routes, signup, system, telegram_bots, track, webhooks
from .api.deps import JR, Services
from .errors import ApiError


log = logging.getLogger("laris")
RID = re.compile(r"[A-Za-z0-9._-]{8,64}")


@asynccontextmanager
async def lifespan(app):
    if (os.environ.get("WEB_CONCURRENCY") or "1").strip() not in ("", "1"):
        log.warning("WEB_CONCURRENCY is above 1: sign-in lockout and rate limits are kept per process, so each worker counts on its own")
    if os.environ.get("DATABASE_URL"):
        db.apply_schema()  # idempotent; SEED=1 loads the synthetic made-to-order demo
        with db.tx(tenant=db.ALL_TENANTS) as c:
            db.check_rls(c)
        with db.tx("owner", "bootstrap", tenant=db.ALL_TENANTS) as c:
            if (note := db.bootstrap_owner(c)) != "off":
                log.warning("bootstrap owner: %s", note)  # never logs the password
    else:
        log.error("DATABASE_URL is not set: the API cannot serve database requests")
    if (os.environ.get("REPLIT_DEPLOYMENT") or os.environ.get("REPL_DEPLOYMENT")) and os.environ.get("TRUST_PROXY") != "1":
        log.warning("TRUST_PROXY is not 1 on a deployment: every client shares the proxy's address, so login and signup throttles lock everyone out together")
    sch = scheduler.start() if os.environ.get("SCHEDULER") == "1" else None
    if not sch:
        log.warning("SCHEDULER is not 1: follow-ups, expiry, retention and job reminders will not run")
    yield
    if sch:
        sch.shutdown(wait=False)


_DOCS = os.environ.get("ENABLE_DOCS") == "1"  # the API map is for developers, not the public internet
app = FastAPI(title="LARIS", lifespan=lifespan, docs_url="/docs" if _DOCS else None, redoc_url="/redoc" if _DOCS else None,
              openapi_url="/openapi.json" if _DOCS else None)
app.state.svc = Services()
app.add_middleware(CORSMiddleware, allow_origins=[o.strip() for o in os.environ.get("CORS_ORIGINS", "http://localhost:5173").split(",") if o.strip()],
                   allow_methods=["*"], allow_headers=["*"])
app.include_router(auth_routes.r)
app.include_router(signup.r)
app.include_router(invites.r)
app.include_router(license_routes.r)
app.include_router(routes.r)
app.include_router(audit.r)
app.include_router(ai_activity.r)
app.include_router(mcp.r)
app.include_router(jobs.r)
app.include_router(track.r)
app.include_router(system.r)
app.include_router(contacts.r)
app.include_router(rfq.r)
app.include_router(listings.r)
app.include_router(privacy.r)
app.include_router(onboarding.r)
app.include_router(accept.r)
app.include_router(public_api.r)
app.include_router(ai_guide.r)
app.include_router(roles.r)
app.include_router(assistant.r)
app.include_router(channel_settings.r)
app.include_router(telegram_bots.r)
app.include_router(webhooks.r)


def _err(status, code, msg, headers=None, **extra):
    return JR({"error": {"code": code, "message": msg, "request_id": logsetup.request_id.get(), **extra}}, status_code=status, headers=headers)


def _log_err(request, status, code, cause=None):
    """One line per ApiError / 5xx: never the query string, the body or the cause's text."""
    log.log(logging.ERROR if status >= 500 else logging.WARNING, "%s %s -> %s %s cause=%s", request.method, request.url.path, status, code,
            type(cause).__name__ if cause else "-")


@app.middleware("http")
async def _cap_body(request, call_next):
    """Refuse oversized or unsized bodies up front (multipart is spooled to disk before any endpoint code runs)."""
    p = request.url.path
    if request.method in ("POST", "PUT", "PATCH") and p.startswith(("/api/", "/webhooks/")):
        cl = request.headers.get("content-length")
        if "chunked" in request.headers.get("transfer-encoding", "").lower() or cl is None:
            return _err(411, "length_required", "send a Content-Length (chunked bodies are not accepted)")
        if not (cl.isascii() and cl.isdigit()) or len(cl) > 12 or int(cl) > (routes.MAX_UPLOAD + 100_000 if p.startswith("/api/") else webhooks.MAX_BODY):
            return _err(413, "too_large", "request body too large")
    return await call_next(request)


DIST = Path(__file__).resolve().parent.parent / "web" / "dist"


def _inline_hashes() -> str:
    """CSP hashes for the inline scripts in the built index.html (the theme bootstrap), so script-src can stay 'self' only."""
    try:
        html = (DIST / "index.html").read_text(encoding="utf-8")
    except OSError:
        return ""
    return "".join(f" 'sha256-{base64.b64encode(hashlib.sha256(m.encode()).digest()).decode()}'"
                   for m in re.findall(r"<script>(.*?)</script>", html, re.S))


CSP = ("default-src 'self'; img-src 'self' data: blob:; style-src 'self' 'unsafe-inline'; script-src 'self'" + _inline_hashes()
       + "; connect-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'; object-src 'none'")


@app.middleware("http")  # defined last = outermost, so it also decorates the 411 / 413 above
async def _secure_headers(request, call_next):
    try:
        resp = await call_next(request)
    except Exception as e:  # ServerErrorMiddleware sits outside this one, so build the 500 here to keep the headers
        s = request.state
        log.error("unhandled error: %s %s tenant=%s user=%s", request.method, request.url.path,
                  getattr(s, "tenant_id", "-"), getattr(s, "user_id", "-"), exc_info=e)
        resp = _err(500, "internal", "Something went wrong on our side. Quote this reference if you contact support.")
    h = resp.headers
    h["X-Content-Type-Options"] = "nosniff"
    h["Referrer-Policy"] = "no-referrer"
    h["Permissions-Policy"] = "camera=(self), microphone=(), geolocation=()"
    h["Content-Security-Policy"] = CSP
    h["X-Frame-Options"] = "DENY"
    proto = request.url.scheme
    if os.environ.get("TRUST_PROXY") == "1":
        proto = request.headers.get("x-forwarded-proto", proto).split(",")[-1].strip().lower()
    if proto == "https":
        h["Strict-Transport-Security"] = "max-age=31536000"
    if request.url.path.startswith("/api/"):
        h["Cache-Control"] = "no-store"
    return resp


@app.middleware("http")  # defined last = outermost: every response, even Starlette's own errors, carries the id
async def _request_id(request, call_next):
    rid = request.headers.get("x-request-id", "")
    rid = rid if RID.fullmatch(rid) else uuid4().hex[:12]
    logsetup.request_id.set(rid)
    request.state.request_id = rid
    resp = await call_next(request)
    resp.headers["X-Request-Id"] = rid
    return resp


@app.exception_handler(ApiError)
async def _api_error(request, e: ApiError):
    _log_err(request, e.status, e.code, e.__cause__)
    return _err(e.status, e.code, e.message, **e.extra)


@app.exception_handler(StarletteHTTPException)
async def _http_error(request, e):
    if e.status_code >= 500:
        _log_err(request, e.status_code, "http_error", e.__cause__)
    return _err(e.status_code, "not_found" if e.status_code == 404 else "http_error", str(e.detail), headers=getattr(e, "headers", None))


_JARGON = re.compile(r"^(Value error|Assertion failed), ")


@app.exception_handler(RequestValidationError)
async def _validation(_, e):
    fields = []
    for x in e.errors():
        loc = [str(p) for p in x["loc"]]
        fields.append({"field": ".".join(loc[1:] if loc[0] in ("body", "query", "path", "header", "cookie") else loc),
                       "message": _JARGON.sub("", x["msg"])})
    f = fields[0]
    return _err(422, "invalid_request", f"{f['field']}: {f['message']}" if f["field"] else f["message"], fields=fields)


@app.exception_handler(psycopg.errors.IntegrityError)
async def _conflict(request, e):
    log.warning("constraint violation (%s %s): %s [%s]", request.method, request.url.path, e.diag.message_primary, e.diag.constraint_name)
    return _err(409, "conflict", "That conflicts with something that already exists.")


@app.exception_handler(psycopg.OperationalError)
@app.exception_handler(psycopg.InterfaceError)
async def _db_down(request, e):
    _log_err(request, 503, "db_unavailable", e)
    return _err(503, "db_unavailable", "The database is not reachable. Try again in a moment.")


@app.get("/health")
def health():
    return {"status": "ok"}


@app.get("/ready")
def ready():
    """Liveness plus the database: for a deploy check or an uptime monitor."""
    why = ""
    reason = "db_url_missing" if not os.environ.get("DATABASE_URL") else None
    if not reason:
        try:
            with db.tx("staff", "", timeout=3, tenant=db.ALL_TENANTS) as c:
                c.execute("set local statement_timeout = '3s'")
                if c.execute("select to_regclass('public.tenants') t").fetchone()["t"] is None:
                    reason = "schema_missing"
        except Exception as e:
            reason, why = "db_unreachable", f" ({type(e).__name__})"
    if reason:
        log.warning("not ready: %s%s", reason, why)
        return JR({"status": "not_ready", "reason": reason}, status_code=503)
    return {"status": "ready"}


class SPA(StaticFiles):
    """Built frontend; unknown non-API paths fall back to index.html so client-side routes survive a reload."""

    async def __call__(self, scope, receive, send):
        p = scope["path"]
        if scope["type"] == "http" and p.startswith(("/api/", "/webhooks/")):  # no route took it: 405 if one matches the path, else 404
            partial = any(r.matches(scope)[0] == Match.PARTIAL for r in scope["app"].router.routes)
            raise StarletteHTTPException(405 if partial else 404, "Method Not Allowed" if partial else "Not Found")
        await super().__call__(scope, receive, send)

    async def get_response(self, path, scope):
        try:
            return await super().get_response(path, scope)
        except StarletteHTTPException as e:
            if e.status_code == 404 and not path.replace("\\", "/").startswith(("api/", "webhooks/", "docs", "redoc", "openapi.json")):
                return await super().get_response("index.html", scope)
            raise


if (DIST / "index.html").is_file():  # after every router so it never shadows /api, /webhooks, /health
    app.mount("/", SPA(directory=DIST, html=True), name="web")
