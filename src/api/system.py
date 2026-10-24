"""Owner-only operational readout."""
import os

from fastapi import APIRouter, Depends

from .. import health, scheduler
from .deps import Ctx, read_ctx, reply, require_owner

r = APIRouter(prefix="/api")


@r.get("/system/scheduler")
def scheduler_status(ctx: Ctx = Depends(read_ctx)):
    """Is the background job runner on, and how did its last run go (follow-ups, expiry, retention, job reminders)?"""
    require_owner(ctx)
    st = scheduler.status()
    return reply(ctx, {"enabled": os.environ.get("SCHEDULER") == "1", "last_run": st["at"], "ok": st["ok"], "errors": st["errors"], "last_error": st["last_error"]})


@r.get("/system/health")
def health_status(ctx: Ctx = Depends(read_ctx)):
    """Owner-only list of things that need attention (setup gaps, risks), worst first."""
    require_owner(ctx)
    return reply(ctx, health.report(ctx))
