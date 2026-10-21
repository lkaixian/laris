import os
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from starlette.exceptions import HTTPException as StarletteHTTPException

from . import db, scheduler
from .api import routes, webhooks
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
app.include_router(routes.r)
app.include_router(webhooks.r)


def _err(status, code, msg):
    return JR({"error": {"code": code, "message": msg}}, status_code=status)


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
