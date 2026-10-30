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
def health_status(live: bool = False, force: bool = False, ctx: Ctx = Depends(read_ctx)):
    """Owner-only list of things that need attention (setup gaps, risks), worst first, and the state of every service.
    live=1 also calls the outside services (Telegram, WhatsApp, ILMU, RunPod, Mailtrap); force=1 asks for a fresh check (at most one per 10 s)."""
    require_owner(ctx)
    return reply(ctx, health.report(ctx, live, force))
