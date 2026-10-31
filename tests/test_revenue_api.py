"""Revenue over the API against a real (PGlite) database: the figures worked out from orders, the cost book and payments, running costs and their
void, the day boundary in Malaysia time, who may see or record what, tenant isolation, and the database's own refusal to edit or delete a cost."""
from datetime import date, timedelta
from decimal import ROUND_HALF_UP, Decimal as D

import pytest

from src import pipeline
from support.fixtures import env, pg_url  # noqa: F401
from test_chain_api import err, hand_job, pay, quote_job
from test_rfq import other_tenant
from test_roles import member, role

TODAY = pipeline.today_my()
WIN = (TODAY - timedelta(days=29), TODAY)


def report(e, start, end, who=None):
    return e.c.get("/api/revenue", params={"from": str(start), "to": str(end)}, headers=who or e.O)


def spend(e, amount="600.00", category="rent", on=None, who=None, **kw):
    return e.c.post("/api/expenses", json={"spent_on": str(on or TODAY), "category": category, "amount": amount, **kw}, headers=who or e.O)


def cents(x):
    return D(str(x)).quantize(D("0.01"), ROUND_HALF_UP)


def test_the_report_adds_up_from_orders_payments_and_the_cost_book(env):
    e = env
    hj = hand_job(e, "1000.00")                                         # made by hand: a sale with no cost on record
    qj = quote_job(e)                                                   # an accepted quote: cost comes from the cost book
    q = e.sql("select quote_id from jobs where id=%s", (qj,))[0]["quote_id"]
    sales_q = e.sql("select sum(qty*unit_price*(1-coalesce(discount_pct,0)/100)) s from document_lines where document_id=%s and not is_header", (q,))[0]["s"]
    cost_q = e.sql("select coalesce(sum(line_cost),0) c from v_quote_margin where quote_id=%s", (q,))[0]["c"]
    lines = e.sql("select count(*) n from document_lines where document_id=%s and not is_header", (q,))[0]["n"]
    costed = e.sql("select count(*) n from v_quote_margin where quote_id=%s", (q,))[0]["n"]
    assert cost_q > 0 and sales_q > 0                                   # the fixture quote really has cost data to check against
    assert pay(e, hj, "400.00", paid_on=str(TODAY)).status_code == 201
    r = report(e, *WIN)
    assert r.status_code == 200, r.text
    r = r.json()
    assert D(r["sales"]) == D("1000.00") + cents(sales_q)
    assert D(r["goods"]) == cents(cost_q)
    assert D(r["gross"]) == D(r["sales"]) - D(r["goods"])
    assert D(r["running"]) == 0 and D(r["net"]) == D(r["gross"])        # no running costs recorded yet
    assert D(r["money_in"]) == D("400.00") and D(r["money_out"]) == D(r["goods"])
    assert D(r["left_over"]) == D("400.00") - D(r["goods"])
    assert r["orders_counted"] == 2 and r["orders_without_cost"] == 1 + (0 if lines == costed else 1)
    refs = {o["ref"]: o for o in r["orders"]}
    assert len(refs) == 2 and any(o["cost_known"] is False and o["cost"] is None for o in r["orders"])     # the hand-made one says it has no cost
    assert D(r["to_collect"]) > 0 and r["granularity"] == "day" and r["days"] == 30
    assert r["categories"] == ["rent", "wages", "utilities", "transport", "marketing", "tax", "other"]
    assert r["previous"]["sales"] == "0.00" and r["change_pct"]["sales"] is None            # nothing in the month before: no percentage


def test_a_running_cost_lowers_net_but_not_gross_and_a_void_takes_it_back(env):
    e = env
    hand_job(e, "1000.00")
    before = report(e, *WIN).json()
    x = spend(e, "600.00", "rent", note="  October shop  ")
    assert x.status_code == 201 and x.json()["amount"] == "600.00" and x.json()["note"] == "October shop"
    after = report(e, *WIN).json()
    assert D(after["running"]) == D("600.00") and D(after["net"]) == D(before["net"]) - D("600.00") and after["gross"] == before["gross"]
    assert after["expenses_by_category"] == [{"category": "rent", "amount": "600.00"}] and len(after["expense_rows"]) == 1
    xid = x.json()["id"]
    err(e.c.post(f"/api/expenses/{xid}/void", json={"reason": "x"}, headers=e.O), 422, "invalid_request")       # a reason of a few words is required
    assert e.c.post(f"/api/expenses/{xid}/void", json={"reason": "typed twice"}, headers=e.O).status_code == 200
    back = report(e, *WIN).json()
    assert D(back["running"]) == 0 and back["net"] == before["net"] and back["expense_rows"] == []
    err(e.c.post(f"/api/expenses/{xid}/void", json={"reason": "again"}, headers=e.O), 409, "already_void")
    assert e.sql("select count(*) n, count(voided_at) v from expenses")[0] == {"n": 1, "v": 1}               # the row stays, marked void
    ev = [a["event"] for a in e.c.get("/api/audit", headers=e.O).json()]
    assert any(s.startswith("running cost of RM600.00 recorded") for s in ev) and any("voided: typed twice" in s for s in ev)


def test_money_in_is_what_was_paid_minus_what_was_reversed(env):
    e = env
    j = hand_job(e, "500.00")
    p = pay(e, j, "200.00", paid_on=str(TODAY)).json()
    assert D(report(e, *WIN).json()["money_in"]) == D("200.00")
    assert e.c.post(f"/api/payments/{p['payment']['id']}/reverse", json={"reason": "cheque bounced"}, headers=e.O).status_code in (200, 201)
    r = report(e, *WIN).json()
    assert D(r["money_in"]) == 0 and sum(D(b["money_in"]) for b in r["series"]) == 0


def test_cash_counts_on_the_day_it_was_paid_and_sales_on_the_day_it_was_won(env):
    e = env
    j = hand_job(e, "800.00")
    assert pay(e, j, "300.00").status_code == 201                       # the helper pays on 2026-01-02, long before the order was won
    jan = report(e, date(2026, 1, 1), date(2026, 1, 31)).json()
    assert D(jan["money_in"]) == D("300.00") and D(jan["sales"]) == 0 and jan["orders_counted"] == 0
    now = report(e, *WIN).json()
    assert D(now["money_in"]) == 0 and D(now["sales"]) == D("800.00")


def test_an_order_belongs_to_the_day_it_was_accepted_in_malaysia_time(env):
    e = env
    a, b = hand_job(e, "100.00", "Late night"), hand_job(e, "200.00", "Just after midnight")
    e.sql("update jobs set created_at='2026-10-31T15:59:00Z' where id=%s", (a,))        # 23:59 on 31 October in Kuala Lumpur
    e.sql("update jobs set created_at='2026-10-31T16:01:00Z' where id=%s", (b,))        # 00:01 on 1 November in Kuala Lumpur
    d31, d1 = date(2026, 10, 31), date(2026, 11, 1)
    r31, r1 = report(e, d31, d31).json(), report(e, d1, d1).json()
    assert (D(r31["sales"]), r31["orders_counted"]) == (D("100.00"), 1)
    assert (D(r1["sales"]), r1["orders_counted"]) == (D("200.00"), 1)


@pytest.mark.parametrize("params,status,code", [
    ({"from": "2026-10-05", "to": "2026-10-04"}, 422, "end_before_start"),
    ({"from": "2024-01-01", "to": "2026-10-31"}, 422, "too_long"),
    ({"from": "2026-10-01"}, 422, None), ({"to": "2026-10-31"}, 422, None), ({"from": "yesterday", "to": "today"}, 422, None), ({}, 422, None),
])
def test_a_bad_period_is_refused(env, params, status, code):
    r = env.c.get("/api/revenue", params=params, headers=env.O)
    assert r.status_code == status
    if code:
        assert r.json()["error"]["code"] == code


@pytest.mark.parametrize("body", [
    {"amount": "0"}, {"amount": "-5.00"}, {"amount": "abc"}, {"amount": "1.234"}, {"amount": "12345678901234.00"},
    {"category": "gold"}, {"note": "x" * 201}, {"spent_on": "not a date"}, {"extra": 1},
])
def test_a_bad_running_cost_is_refused(env, body):
    good = {"spent_on": str(TODAY), "category": "rent", "amount": "10.00"}
    r = env.c.post("/api/expenses", json=good | body, headers=env.O)
    assert r.status_code == 422, r.text
    assert env.sql("select count(*) n from expenses")[0]["n"] == 0


def test_a_running_cost_cannot_be_in_the_future(env):
    err(spend(env, on=TODAY + timedelta(days=1)), 422, "future_date")
    assert spend(env, on=TODAY).status_code == 201 and spend(env, on=TODAY - timedelta(days=400)).status_code == 201     # past dates are fine


def test_who_may_see_and_record(env):
    e = env
    j = hand_job(e, "1000.00")
    owner_sees = report(e, *WIN).json()
    assert owner_sees["can_record"] is True and owner_sees["can_void"] is True
    nothing = member(e, role(e, "Nothing", []))
    only_rev = member(e, role(e, "RevenueOnly", ["view_revenue"]))                  # it shows costs, so view_costs is needed as well
    both = member(e, role(e, "Reader", ["view_revenue", "view_costs"]))
    recorder = member(e, role(e, "Recorder", ["record_expenses"]))
    for who in (e.S, nothing, only_rev, recorder):
        r = report(e, *WIN, who)
        err(r, 403, "permission_required")
        assert "1000.00" not in r.text and "sales" not in r.text
    r = report(e, *WIN, both)
    assert r.status_code == 200 and r.json()["can_record"] is False and r.json()["can_void"] is False
    err(spend(e, who=both), 403, "permission_required")
    err(spend(e, who=e.S), 403, "permission_required")
    x = spend(e, who=recorder)
    assert x.status_code == 201
    err(e.c.post(f"/api/expenses/{x.json()['id']}/void", json={"reason": "my mistake"}, headers=recorder), 403, "owner_only")      # only the owner voids
    assert D(report(e, *WIN).json()["running"]) == D("600.00")
    assert j


def test_another_business_never_sees_or_voids_these_costs(env):
    e = env
    hand_job(e, "1000.00")
    x = spend(e, "750.00")
    other = other_tenant(e)
    r = report(e, *WIN, other).json()
    assert D(r["sales"]) == 0 and D(r["running"]) == 0 and r["orders"] == [] and r["expense_rows"] == []
    err(e.c.post(f"/api/expenses/{x.json()['id']}/void", json={"reason": "not yours"}, headers=other), 404, "not_found")
    assert D(report(e, *WIN).json()["running"]) == D("750.00")


def test_the_database_will_not_edit_or_delete_a_recorded_cost(env):
    e = env
    xid = spend(e, "300.00").json()["id"]
    with pytest.raises(Exception, match="cannot be edited"):
        e.sql("update expenses set amount=1 where id=%s", (xid,))
    with pytest.raises(Exception, match="permission denied|cannot be deleted"):          # the privilege is revoked, and the trigger is the second wall
        e.sql("delete from expenses where id=%s", (xid,))
    with pytest.raises(Exception, match="permission denied|append-only"):
        e.sql("truncate expenses")
    assert e.c.post(f"/api/expenses/{xid}/void", json={"reason": "typed twice"}, headers=e.O).status_code == 200
    with pytest.raises(Exception, match="already voided"):
        e.sql("update expenses set void_reason='changed my mind' where id=%s", (xid,))
    with pytest.raises(Exception):                                                                              # a void needs its reason (the CHECK)
        e.sql("update expenses set voided_at=now() where id=%s", (spend(e, "1.00").json()["id"],))
    assert e.sql("select amount from expenses where id=%s", (xid,))[0]["amount"] == D("300.00")


def test_a_year_is_cut_into_months_and_adds_up(env):
    e = env
    for month in (1, 4, 9):
        spend(e, "100.00", "utilities", on=date(2026, month, 15))
    r = report(e, date(2026, 1, 1), date(2026, 12, 31)).json()
    assert r["granularity"] == "month" and len(r["series"]) == 12
    assert D(r["running"]) == D("300.00") and sum(D(b["running"]) for b in r["series"]) == D("300.00")
    assert [D(b["running"]) for b in r["series"]] == [D("100.00"), 0, 0, D("100.00"), 0, 0, 0, 0, D("100.00"), 0, 0, 0]
