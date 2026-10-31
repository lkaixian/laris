"""Business report (GET /api/reports): numbers worked out from orders, payments, running costs and the cost book; targets and cash set by the owner;
nothing guessed when a target or cash figure is missing; owner only."""
from datetime import date, timedelta
from decimal import Decimal as D

from src import pipeline
from src.api.reports import periods, status
from support.fixtures import env, pg_url  # noqa: F401
from test_chain_api import hand_job, pay, quote_job
from test_revenue_api import spend

TODAY = pipeline.today_my()


def get(e, period="month", who=None):
    r = e.c.get("/api/reports", params={"period": period}, headers=who or e.O)
    assert r.status_code == 200, r.text
    return r.json()


def kpi(r, key):
    return next(k for k in r["kpis"] if k["key"] == key)


def test_periods_are_monday_to_sunday_weeks_and_calendar_months():
    d = date(2026, 3, 11)  # a Wednesday
    assert periods("week", d) == (date(2026, 3, 9), date(2026, 3, 15), date(2026, 3, 2), date(2026, 3, 8))
    assert periods("last_week", d)[:2] == (date(2026, 3, 2), date(2026, 3, 8))
    assert periods("month", d) == (date(2026, 3, 1), date(2026, 3, 31), date(2026, 2, 1), date(2026, 2, 28))
    assert periods("month", date(2026, 12, 5))[1] == date(2026, 12, 31)


def test_status_rules():
    assert status(None, 10) == (None, "no_data") and status(5, None) == (None, "no_target")
    assert status(100, 100) == (0.0, "on_track") and status(96, 100)[1] == "monitor" and status(90, 100)[1] == "at_risk"
    assert status(44, 45, kind="pts")[1] == "monitor" and status(40, 45, kind="pts")[1] == "at_risk"        # margin: within 2 points
    assert status(30, 35, higher_is_better=False)[1] == "on_track" and status(38, 35, higher_is_better=False)[1] == "monitor" and status(50, 35, higher_is_better=False)[1] == "at_risk"
    assert status(5.5, 6, kind="mo")[1] == "monitor" and status(4, 6, kind="mo")[1] == "at_risk"


def test_the_report_matches_the_revenue_figures_and_guesses_nothing(env):
    e = env
    hj = hand_job(e, "1000.00")
    quote_job(e)
    assert pay(e, hj, "400.00", paid_on=str(TODAY)).status_code == 201
    assert spend(e, "600.00", "marketing").status_code == 201
    rev = e.c.get("/api/revenue", params={"from": str(TODAY.replace(day=1)), "to": str(TODAY)}, headers=e.O).json()
    r = get(e, "month")
    assert D(str(kpi(r, "revenue")["actual"])).quantize(D("0.01")) == D(rev["sales"]) and D(str(kpi(r, "profit")["actual"])).quantize(D("0.01")) == D(rev["net"])
    assert kpi(r, "margin")["actual"] == float(rev["gross_pct"])
    for k in ("revenue", "margin", "profit", "cac", "runway"):
        assert kpi(r, k)["target"] is None and kpi(r, k)["variance"] is None            # no targets set: no variance
    assert {kpi(r, k)["status"] for k in ("revenue", "margin", "profit")} == {"no_target"}
    assert kpi(r, "runway")["status"] == "no_data"                                       # no cash on hand recorded: nothing guessed
    assert r["ops"]["sales"] == float(rev["sales"]) and r["org"]["prepared_by"]
    assert r["notes"]["marketing"] == 600.0 and r["notes"]["new_customers"] >= 1
    assert kpi(r, "cac")["actual"] == 600.0 / r["notes"]["new_customers"]                # marketing spend / new customers
    assert r["analytics"]["funnel"][0]["k"] == "sent" and len(r["analytics"]["sales"]) == len(r["analytics"]["labels"]) == len(r["analytics"]["margin"])
    assert sum(r["analytics"]["sales"]) == float(rev["sales"]) and {x["k"] for x in r["analytics"]["aging"]} == {"current", "1-30", "31-60", "60+"}


def test_targets_give_variance_status_and_runway(env):
    e = env
    hand_job(e, "1000.00")
    spend(e, "300.00", "rent")
    put = e.c.put("/api/reports/targets", json={"revenue_month": "1000.00", "margin_pct": "50", "profit_month": "500.00", "cac": "100", "runway_months": "6", "cash_on_hand": "2000.00"}, headers=e.O)
    assert put.status_code == 200 and put.json()["cash_as_of"] == str(TODAY)
    r = get(e, "month")
    assert kpi(r, "revenue")["target"] == 1000.0 and kpi(r, "revenue")["status"] in ("on_track", "monitor", "at_risk") and kpi(r, "revenue")["variance"] is not None
    assert kpi(r, "profit")["actual"] == 700.0 and kpi(r, "profit")["variance"] == 40.0 and kpi(r, "profit")["status"] == "on_track"
    days = (periods("month", TODAY)[1] - periods("month", TODAY)[0]).days + 1
    assert kpi(r, "runway")["actual"] == float(D("2000") / (D("300") / D(days) * D("30.4")))      # cash on hand / running costs per month
    w = get(e, "week")
    assert round(kpi(w, "revenue")["target"], 2) == round(1000 * 12 / 52, 2)                      # a week is 12/52 of the monthly target
    assert e.c.put("/api/reports/targets", json={}, headers=e.O).json()["revenue_month"] is None  # a field left out is cleared
    assert get(e, "month")["kpis"][0]["status"] == "no_target"


def test_owner_only_and_validated(env):
    e = env
    assert e.c.get("/api/reports", headers=e.S).status_code == 403
    assert e.c.get("/api/reports/targets", headers=e.S).status_code == 403
    assert e.c.put("/api/reports/targets", json={}, headers=e.S).status_code == 403
    assert e.c.put("/api/reports/targets", json={"margin_pct": "120"}, headers=e.O).status_code == 422
    assert e.c.put("/api/reports/targets", json={"surprise": 1}, headers=e.O).status_code == 422
    assert e.c.get("/api/reports", params={"period": "year"}, headers=e.O).status_code == 422
