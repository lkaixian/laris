import base64
import hashlib
import os
import re
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from starlette.exceptions import HTTPException as StarletteHTTPException

from . import db, scheduler
from .api import assistant, auth_routes, contacts, listings, rfq, roles, routes, webhooks
from .api.deps import JR, Services
from .errors import ApiError


@asynccontextmanager
async def lifespan(app):
    if os.environ.get("DATABASE_URL"):
        db.apply_schema()  # idempotent; SEED=1 loads the synthetic made-to-order demo
        with db.tx() as c:
            db.check_rls(c)
    sch = scheduler.start() if os.environ.get("SCHEDULER") == "1" else None
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
app.include_router(routes.r)
app.include_router(contacts.r)
app.include_router(rfq.r)
app.include_router(listings.r)
app.include_router(roles.r)
app.include_router(assistant.r)
app.include_router(webhooks.r)


def _err(status, code, msg):
    return JR({"error": {"code": code, "message": msg}}, status_code=status)


@app.middleware("http")
async def _cap_body(request, call_next):
    """Refuse oversized or unsized bodies up front (multipart is spooled to disk before any endpoint code runs)."""
    p = request.url.path
    if request.method in ("POST", "PUT", "PATCH") and p.startswith(("/api/", "/webhooks/")):
        cl = request.headers.get("content-length")
        if "chunked" in request.headers.get("transfer-encoding", "").lower() or cl is None:
            return _err(411, "length_required", "send a Content-Length (chunked bodies are not accepted)")
        if not cl.isdigit() or int(cl) > (routes.MAX_UPLOAD + 100_000 if p.startswith("/api/") else webhooks.MAX_BODY):
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
    resp = await call_next(request)
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


@app.exception_handler(ApiError)
async def _api_error(_, e: ApiError):
    return _err(e.status, e.code, e.message)


@app.exception_handler(StarletteHTTPException)
async def _http_error(_, e):
    return _err(e.status_code, "http_error", str(e.detail))


@app.exception_handler(RequestValidationError)
async def _validation(_, e):
    return _err(422, "invalid_request", "; ".join(f"{'.'.join(map(str, x['loc']))}: {x['msg']}" for x in e.errors()))


@app.get("/health")
def health():
    return {"status": "ok"}


@app.get("/ready")
def ready():
    """Liveness plus the database: for a deploy check or an uptime monitor."""
    try:
        with db.tx("staff", "") as c:
            c.execute("select 1")
    except Exception:
        return _err(503, "db_down", "database not reachable")
    return {"status": "ready"}


class SPA(StaticFiles):
    """Built frontend; unknown non-API paths fall back to index.html so client-side routes survive a reload."""

    async def get_response(self, path, scope):
        try:
            return await super().get_response(path, scope)
        except StarletteHTTPException as e:
            if e.status_code == 404 and not path.replace("\\", "/").startswith(("api/", "webhooks/", "docs", "redoc", "openapi.json")):
                return await super().get_response("index.html", scope)
            raise


if (DIST / "index.html").is_file():  # after every router so it never shadows /api, /webhooks, /health
    app.mount("/", SPA(directory=DIST, html=True), name="web")
