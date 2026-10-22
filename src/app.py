import os
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from starlette.exceptions import HTTPException as StarletteHTTPException

from . import db, scheduler
from .api import assistant, auth_routes, contacts, routes, webhooks
from .api.deps import JR, Services
from .errors import ApiError


@asynccontextmanager
async def lifespan(app):
    if os.environ.get("DATABASE_URL"):
        db.apply_schema()  # idempotent; SEED=1 loads the synthetic made-to-order demo
    sch = scheduler.start() if os.environ.get("SCHEDULER") == "1" else None
    yield
    if sch:
        sch.shutdown(wait=False)


app = FastAPI(title="LARIS", lifespan=lifespan)
app.state.svc = Services()
app.add_middleware(CORSMiddleware, allow_origins=os.environ.get("CORS_ORIGINS", "http://localhost:5173").split(","),
                   allow_methods=["*"], allow_headers=["*"])
app.include_router(auth_routes.r)
app.include_router(routes.r)
app.include_router(contacts.r)
app.include_router(assistant.r)
app.include_router(webhooks.r)


def _err(status, code, msg):
    return JR({"error": {"code": code, "message": msg}}, status_code=status)


@app.middleware("http")
async def _cap_body(request, call_next):
    """Refuse oversized bodies up front (multipart is spooled to disk before any endpoint code runs)."""
    if request.method in ("POST", "PUT", "PATCH") and request.url.path.startswith("/api/"):
        cl = request.headers.get("content-length") or "0"
        if not cl.isdigit() or int(cl) > routes.MAX_UPLOAD + 100_000:
            return _err(413, "too_large", "request body over 10 MB")
    return await call_next(request)


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


class SPA(StaticFiles):
    """Built frontend; unknown non-API paths fall back to index.html so client-side routes survive a reload."""

    async def get_response(self, path, scope):
        try:
            return await super().get_response(path, scope)
        except StarletteHTTPException as e:
            if e.status_code == 404 and not path.replace("\\", "/").startswith(("api/", "webhooks/")):
                return await super().get_response("index.html", scope)
            raise


DIST = Path(__file__).resolve().parent.parent / "web" / "dist"
if (DIST / "index.html").is_file():  # after every router so it never shadows /api, /webhooks, /health
    app.mount("/", SPA(directory=DIST, html=True), name="web")
