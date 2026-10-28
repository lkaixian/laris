"""Guided-tour progress, one row per person (never another user's), so it follows them to another phone."""
from typing import Literal

from fastapi import APIRouter, Depends
from pydantic import BaseModel, Field

from .deps import Ctx, read_ctx, reply, write_ctx

r = APIRouter(prefix="/api")


class OnboardingIn(BaseModel, extra="forbid"):
    state: Literal["in_progress", "done", "skipped", "later"]
    step: int | None = Field(None, ge=0, le=50)
    tour: Literal["owner", "staff"] | None = None


def _view(ctx: Ctx) -> dict:
    row = ctx.conn.execute("select tour, state, step, later_count from user_onboarding where user_id=%s", (ctx.user_id,)).fetchone() \
        or {"tour": None, "state": "new", "step": 0, "later_count": 0}
    return {**row, "tour": row["tour"] or ("owner" if ctx.owner else "staff")}


@r.get("/me/onboarding")
def get_onboarding(ctx: Ctx = Depends(read_ctx)):
    return reply(ctx, _view(ctx))


@r.post("/me/onboarding")
def set_onboarding(b: OnboardingIn, ctx: Ctx = Depends(write_ctx)):
    cur = _view(ctx)
    if cur["state"] in ("done", "skipped") and b.state != "in_progress":
        return reply(ctx, cur)  # final until the person restarts the tour
    restart = cur["state"] in ("done", "skipped")
    later = 0 if restart else cur["later_count"] + (b.state == "later")
    state = "skipped" if b.state == "later" and later >= 2 else b.state  # the server decides
    ctx.conn.execute("""insert into user_onboarding(user_id, tenant_id, tour, state, step, later_count) values (%s,%s,%s,%s,%s,%s)
                        on conflict (user_id) do update set tour=excluded.tour, state=excluded.state, step=excluded.step,
                        later_count=excluded.later_count, updated_at=now()""",
                     (ctx.user_id, ctx.tenant_id, b.tour or cur["tour"], state, cur["step"] if b.step is None else b.step, later))
    return reply(ctx, _view(ctx))
