"""Monthly AI allowance per plan: chat calls (ai_calls rows) and photo reads (listings rows). The month is the calendar month (1st 00:00 to the 1st of
the next month), Kuala Lumpur. Only a licensed installation is limited: no licence key configured (demo, development) means no limit."""
from . import license as lic
from .errors import ApiError

MONTH = "date_trunc('month', now() at time zone 'Asia/Kuala_Lumpur') at time zone 'Asia/Kuala_Lumpur'"
LABEL = {"ai": "AI messages", "photos": "photo reads"}


def usage(conn, tid) -> dict:
    """{plan, limited, resets_at, ai: {used, limit}, photos: {used, limit}}; limit is None when nothing limits this business."""
    s = lic.status(conn, tid) if lic.configured() else {"plan": None}  # no licence key set: nothing to look up (and nothing cached early)
    plan = lic.PLANS.get(s["plan"] or "")
    q = lambda sql: conn.execute(sql.format(w=MONTH), (tid,)).fetchone()  # noqa: E731
    used = {"ai": q("select count(*) n from ai_calls where tenant_id=%s and at >= {w}")["n"],
            "photos": q("select count(*) n from listings where tenant_id=%s and created_at >= {w}")["n"]}
    resets = conn.execute(f"select (({MONTH}) + interval '1 month') t").fetchone()["t"]
    return {"plan": s["plan"], "limited": plan is not None, "resets_at": resets.isoformat(),
            "ai": {"used": used["ai"], "limit": plan["ai_month"] if plan else None},
            "photos": {"used": used["photos"], "limit": plan["photos_month"] if plan else None}}


def check(conn, tid, meter: str) -> None:
    """429 ai_limit when this month's allowance for `meter` ("ai" or "photos") is used up."""
    m = usage(conn, tid)[meter]
    if m["limit"] is not None and m["used"] >= m["limit"]:
        raise ApiError(429, "ai_limit", f"This month's {LABEL[meter]} allowance on your plan ({m['limit']}) is used up. It resets on the 1st; a higher plan has more.")
