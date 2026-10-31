"""Weekly AI allowance per plan (src/ai_quota.py): counted from ai_calls and listings, enforced only on a licensed installation."""
import pytest

from src import ai_quota, db
from src import license as lic
from src.errors import ApiError
from support.fixtures import env, pg_url  # noqa: F401


def licensed(monkeypatch, plan):
    monkeypatch.setattr(lic, "configured", lambda: True)
    monkeypatch.setattr(lic, "status", lambda conn, tid: {"enforced": True, "plan": plan})


def tid(e):
    return e.sql("select id from tenants limit 1")[0]["id"]


def calls(e, n):
    for _ in range(n):
        e.sql("insert into ai_calls (tenant_id, kind, provider, ok, ms) values (%s, 'enquiry', 'ilmu', true, 10)", (tid(e),))


def test_plans_rise_with_the_tier():
    p = lic.PLANS
    assert p["starter"]["ai_week"] < p["standard"]["ai_week"] < p["pro"]["ai_week"]
    assert p["starter"]["photos_week"] < p["standard"]["photos_week"] < p["pro"]["photos_week"]


def test_unlicensed_installation_is_not_limited(env):
    calls(env, 3)
    t = tid(env)  # PGlite serves one connection at a time: look this up before opening another
    with db.tx(tenant=db.ALL_TENANTS) as c:
        u = ai_quota.usage(c, t)
        assert u["limited"] is False and u["ai"] == {"used": 3, "limit": None}
        ai_quota.check(c, t, "ai")  # no raise


def test_over_the_limit_blocks_and_a_higher_plan_does_not(env, monkeypatch):
    e = env
    calls(e, lic.PLANS["starter"]["ai_week"])
    t = tid(e)
    licensed(monkeypatch, "starter")
    with db.tx(tenant=db.ALL_TENANTS) as c, pytest.raises(ApiError) as x:
        ai_quota.check(c, t, "ai")
    assert x.value.status == 429 and x.value.code == "ai_limit"
    licensed(monkeypatch, "standard")
    with db.tx(tenant=db.ALL_TENANTS) as c:
        ai_quota.check(c, t, "ai")  # the same usage is well inside the next tier


def test_usage_route_and_old_calls_do_not_count(env, monkeypatch):
    e = env
    calls(e, 2)
    e.sql("insert into ai_calls (tenant_id, kind, provider, ok, ms, at) values (%s, 'enquiry', 'ilmu', true, 10, now() - interval '15 days')", (tid(e),))
    licensed(monkeypatch, "pro")
    r = e.c.get("/api/ai/usage", headers=e.O).json()
    assert r["limited"] and r["ai"]["used"] == 2 and r["ai"]["limit"] == lic.PLANS["pro"]["ai_week"] and r["photos"]["limit"] == lic.PLANS["pro"]["photos_week"]
