"""Weekly AI allowance per plan: chat calls (ai_calls rows) and photo reads (listings rows). The week runs Monday 00:00 to Monday 00:00,
Kuala Lumpur. Only a licensed installation is limited: no licence key configured (demo, development) means no limit."""
from . import license as lic
from .errors import ApiError

WEEK = "date_trunc('week', now() at time zone 'Asia/Kuala_Lumpur') at time zone 'Asia/Kuala_Lumpur'"
LABEL = {"ai": "AI messages", "photos": "photo reads"}


def usage(conn, tid) -> dict:
    """{plan, limited, resets_at, ai: {used, limit}, photos: {used, limit}}; limit is None when nothing limits this business."""
    s = lic.status(conn, tid) if lic.configured() else {"plan": None}  # no licence key set: nothing to look up (and nothing cached early)
    plan = lic.PLANS.get(s["plan"] or "")
    q = lambda sql: conn.execute(sql.format(w=WEEK), (tid,)).fetchone()  # noqa: E731
    used = {"ai": q("select count(*) n from ai_calls where tenant_id=%s and at >= {w}")["n"],
            "photos": q("select count(*) n from listings where tenant_id=%s and created_at >= {w}")["n"]}
    resets = conn.execute(f"select (({WEEK}) + interval '7 days') t").fetchone()["t"]
    return {"plan": s["plan"], "limited": plan is not None, "resets_at": resets.isoformat(),
            "ai": {"used": used["ai"], "limit": plan["ai_week"] if plan else None},
            "photos": {"used": used["photos"], "limit": plan["photos_week"] if plan else None}}


def check(conn, tid, meter: str) -> None:
    """429 ai_limit when this week's allowance for `meter` ("ai" or "photos") is used up."""
    m = usage(conn, tid)[meter]
    if m["limit"] is not None and m["used"] >= m["limit"]:
        raise ApiError(429, "ai_limit", f"This week's {LABEL[meter]} allowance on your plan ({m['limit']}) is used up. It resets on Monday; a higher plan has more.")
