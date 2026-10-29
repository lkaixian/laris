"""What the AI did, for the AI tab. The owner sees every call in the business; anyone else sees only their own. Counts and timings only:
the question, the answer and the hidden values are never stored (src/ai_log.py)."""
from fastapi import APIRouter, Depends, Query

from .. import rag
from .deps import Ctx, read_ctx, reply

r = APIRouter(prefix="/api")


@r.get("/ai/activity")
def activity(days: int = Query(30, ge=1, le=90), ctx: Ctx = Depends(read_ctx)):
    own = None if ctx.owner else ctx.user_id
    w = "tenant_id=%(t)s and at > now() - %(d)s * interval '1 day' and (%(u)s::uuid is null or user_id = %(u)s)"
    p = {"t": ctx.tenant_id, "d": days, "u": own}
    c = ctx.conn
    tot = c.execute(f"select count(*) n, count(*) filter (where not ok) failed, coalesce(percentile_cont(0.5) within group (order by ms), 0)::int median_ms from ai_calls where {w}", p).fetchone()
    by_kind = {x["kind"]: x["n"] for x in c.execute(f"select kind, count(*) n from ai_calls where {w} group by kind", p).fetchall()}
    masked = {x["k"]: int(x["n"]) for x in c.execute(f"select e.key k, sum(e.value::int) n from ai_calls, jsonb_each_text(masked) e where {w} group by e.key", p).fetchall()}
    recent = c.execute("""select a.at, a.kind, a.provider, a.ok, a.ms, a.masked, u.name as person from ai_calls a left join users u on u.id = a.user_id
                          where a.tenant_id=%(t)s and a.at > now() - %(d)s * interval '1 day' and (%(u)s::uuid is null or a.user_id = %(u)s)
                          order by a.at desc limit 100""", p).fetchall()
    return reply(ctx, {"scope": "own" if own else "all", "days": days,
                       "totals": {"calls": tot["n"], "failed": tot["failed"], "median_ms": tot["median_ms"], "masked": masked},
                       "by_kind": by_kind, "recent": [dict(x) for x in recent]})


@r.get("/ai/passages")
def passages(q: str = Query(min_length=1, max_length=200), ctx: Ctx = Depends(read_ctx)):
    """What the AI may read for this question, for THIS caller: their business only, and only the sources their role may see."""
    return reply(ctx, rag.retrieve(ctx, q))
