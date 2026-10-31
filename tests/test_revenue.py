from datetime import date, timedelta
from decimal import Decimal as D

import pytest

from src.revenue import MAX_DAYS, PeriodError, buckets, check_period, compare, granularity, pct, previous_period, summarise

OCT = (date(2026, 10, 1), date(2026, 10, 31))


def order(id, on, sales, cost, owed=None, paid="0", ref=None, customer="Cust", complete=True):
    return {"id": id, "ref": ref or id, "customer": customer, "on": on, "sales": D(sales), "cost": None if cost is None else D(cost),
            "cost_complete": complete, "owed": D(owed if owed is not None else sales), "paid": D(paid)}


def pay(on, amount):
    return {"on": on, "amount": D(amount)}


def spend(id, on, category, amount, note=None):
    return {"id": id, "on": on, "category": category, "amount": D(amount), "note": note}


ORDERS = [
    order("o1", date(2026, 10, 3), "1000.00", "600.00", owed="1060.00", paid="500.00"),
    order("o2", date(2026, 10, 10), "2000.00", "1250.505", owed="2120.00", paid="2120.00"),     # cost 1250.505 rounds half up to 1250.51
    order("o3", date(2026, 10, 20), "500.00", None, owed="500.00"),                             # made by hand: no cost known
    order("o6", date(2026, 10, 1), "100.00", "40.00", paid="100.00"),                           # first day of the period: counted
    order("o7", date(2026, 10, 31), "50.00", "20.00"),                                          # last day of the period: counted
    order("o4", date(2026, 9, 30), "9999.00", "1.00"),                                          # the day before: ignored
    order("o5", date(2026, 11, 1), "9999.00", "1.00"),                                          # the day after: ignored
]
PAYMENTS = [pay(date(2026, 10, 1), "100.00"), pay(date(2026, 10, 3), "500.00"), pay(date(2026, 10, 10), "2120.00"),
            pay(date(2026, 10, 12), "-100.00"),                                                  # a payment that was reversed
            pay(date(2026, 10, 31), "50.00"), pay(date(2026, 11, 1), "700.00"), pay(date(2026, 9, 30), "300.00")]
EXPENSES = [spend("e1", date(2026, 10, 1), "rent", "800.00"), spend("e2", date(2026, 10, 15), "wages", "600.00"),
            spend("e3", date(2026, 10, 15), "utilities", "150.50"), spend("e4", date(2026, 11, 1), "rent", "800.00"), spend("e5", date(2026, 9, 30), "rent", "800.00")]


def test_the_worked_month():
    r = summarise(ORDERS, PAYMENTS, EXPENSES, *OCT)
    # sales      1000 + 2000 + 500 + 100 + 50                      = 3650.00   (the two orders outside October are left out)
    # goods      600 + 1250.51 + 0 (unknown) + 40 + 20             = 1910.51
    # gross      3650.00 - 1910.51                                 = 1739.49   = 47.7% of sales (47.657)
    # running    800 + 600 + 150.50                                = 1550.50
    # net        1739.49 - 1550.50                                 = 188.99    = 5.2% of sales (5.178)
    # money in   100 + 500 + 2120 - 100 + 50                       = 2670.00
    # money out  1910.51 + 1550.50                                 = 3461.01   left over 2670.00 - 3461.01 = -791.01
    # to collect (1060-500) + 0 + 500 + 0 + 50                     = 1110.00
    assert (r["sales"], r["goods"], r["gross"], r["gross_pct"]) == (D("3650.00"), D("1910.51"), D("1739.49"), D("47.7"))
    assert (r["running"], r["net"], r["net_pct"]) == (D("1550.50"), D("188.99"), D("5.2"))
    assert (r["money_in"], r["money_out"], r["left_over"]) == (D("2670.00"), D("3461.01"), D("-791.01"))
    assert r["to_collect"] == D("1110.00")
    assert (r["orders_counted"], r["orders_without_cost"]) == (5, 1)
    assert r["days"] == 31 and r["granularity"] == "day"


def test_the_graph_adds_up_to_the_totals():
    r = summarise(ORDERS, PAYMENTS, EXPENSES, *OCT)
    s = r["series"]
    assert len(s) == 31 and s[0]["from"] == OCT[0] and s[-1]["to"] == OCT[1]
    assert sum(b["money_in"] for b in s) == r["money_in"] and sum(b["goods"] for b in s) == r["goods"]
    assert sum(b["running"] for b in s) == r["running"] and sum(b["money_out"] for b in s) == r["money_out"]
    assert sum(b["left_over"] for b in s) == r["left_over"]
    day = {b["from"].day: b for b in s}
    assert (day[3]["money_in"], day[3]["goods"]) == (D("500.00"), D("600.00"))
    assert (day[10]["money_in"], day[10]["goods"]) == (D("2120.00"), D("1250.51"))
    assert day[12]["money_in"] == D("-100.00")                      # the reversal shows on its own day
    assert (day[15]["running"], day[15]["money_out"], day[15]["left_over"]) == (D("750.50"), D("750.50"), D("-750.50"))
    assert day[20]["goods"] == D("0.00")                            # the hand-made order has no cost to count


def test_which_orders_and_costs_were_counted():
    r = summarise(ORDERS, PAYMENTS, EXPENSES, *OCT)
    assert [o["id"] for o in r["orders"]] == ["o2", "o1", "o3", "o6", "o7"]          # biggest sale first
    o3 = r["orders"][2]
    assert (o3["cost"], o3["gross"], o3["cost_known"]) == (None, D("500.00"), False)
    assert r["orders"][0]["cost"] == D("1250.51") and r["orders"][0]["gross"] == D("749.49")
    assert r["expenses_by_category"] == [{"category": "rent", "amount": D("800.00")}, {"category": "wages", "amount": D("600.00")},
                                         {"category": "utilities", "amount": D("150.50")}]
    assert [e["id"] for e in r["expense_rows"]] == ["e3", "e2", "e1"]                                  # newest day first; same day, higher id first
    assert all(e["on"].month == 10 for e in r["expense_rows"])


def test_a_loss_is_negative_and_says_so():
    r = summarise(ORDERS, PAYMENTS, EXPENSES + [spend("e9", date(2026, 10, 5), "other", "5000.00")], *OCT)
    assert r["net"] == D("188.99") - D("5000.00") == D("-4811.01")
    assert r["net_pct"] < 0 and r["gross"] > 0


def test_an_empty_period_is_all_zero_and_has_no_percentages():
    r = summarise([], [], [], *OCT)
    assert all(r[k] == D("0.00") for k in ("sales", "goods", "gross", "running", "net", "money_in", "money_out", "left_over", "to_collect"))
    assert r["gross_pct"] is None and r["net_pct"] is None and r["orders_counted"] == 0
    assert len(r["series"]) == 31 and all(b["money_in"] == 0 for b in r["series"]) and r["orders"] == [] and r["expenses_by_category"] == []


def test_without_running_costs_net_equals_gross():
    r = summarise(ORDERS, PAYMENTS, [], *OCT)
    assert r["net"] == r["gross"] and r["running"] == D("0.00")


def test_this_period_against_the_one_before():
    a, b = previous_period(*OCT)
    assert (a, b) == (date(2026, 8, 31), date(2026, 9, 30)) and (b - a).days + 1 == 31
    now = summarise(ORDERS, PAYMENTS, EXPENSES, *OCT)
    before = summarise(ORDERS, PAYMENTS, EXPENSES, a, b)
    assert before["sales"] == D("9999.00") and before["money_in"] == D("300.00") and before["running"] == D("800.00")
    c = compare(now, before)
    assert c["previous"]["sales"] == D("9999.00") and c["previous"]["from"] == a
    assert c["change_pct"]["sales"] == ((D("3650.00") - D("9999.00")) / D("9999.00") * 100).quantize(D("0.1"))
    assert compare(now, summarise([], [], [], a, b))["change_pct"]["sales"] is None          # nothing before: no percentage, not a divide by zero


@pytest.mark.parametrize("days,want", [(1, "day"), (31, "day"), (32, "week"), (140, "week"), (141, "month"), (731, "month")])
def test_how_finely_the_graph_is_cut(days, want):
    assert granularity(days) == want


def covers(start, end, g):
    b = buckets(start, end, g)
    assert b[0][0] == start and b[-1][1] == end
    assert all(x[1] >= x[0] for x in b)
    assert all(b[i][1] + timedelta(days=1) == b[i + 1][0] for i in range(len(b) - 1))           # no gaps, no overlaps
    return b


def test_day_week_and_month_buckets_cover_the_period_exactly():
    assert len(covers(*OCT, "day")) == 31
    w = covers(date(2026, 10, 1), date(2026, 12, 31), "week")                                    # starts on a Thursday, ends on a Thursday
    assert w[0] == (date(2026, 10, 1), date(2026, 10, 4)) and w[-1] == (date(2026, 12, 28), date(2026, 12, 31))
    assert all(a.weekday() == 0 for a, _ in w[1:]) and all(b.weekday() == 6 for _, b in w[:-1])  # Monday to Sunday inside
    m = covers(date(2026, 1, 15), date(2026, 6, 10), "month")
    assert [(a.month, a.day, b.day) for a, b in m] == [(1, 15, 31), (2, 1, 28), (3, 1, 31), (4, 1, 30), (5, 1, 31), (6, 1, 10)]


def test_month_buckets_cross_a_year_and_a_leap_day():
    m = covers(date(2026, 11, 1), date(2027, 4, 30), "month")
    assert [(a.year, a.month) for a, _ in m] == [(2026, 11), (2026, 12), (2027, 1), (2027, 2), (2027, 3), (2027, 4)]
    leap = covers(date(2028, 1, 1), date(2028, 12, 31), "month")
    assert leap[1] == (date(2028, 2, 1), date(2028, 2, 29)) and len(leap) == 12


def test_buckets_add_up_for_any_cut_of_the_same_data():
    for start, end in [(date(2026, 10, 1), date(2026, 10, 31)), (date(2026, 8, 3), date(2026, 11, 20)), (date(2026, 1, 1), date(2026, 12, 31))]:
        n = (end - start).days + 1
        orders = [order(f"o{i}", start + timedelta(days=(i * 7) % n), str(100 + i), str(40 + i)) for i in range(40)]
        pays = [pay(start + timedelta(days=(i * 5) % n), str(10 + i)) for i in range(40)]
        costs = [spend(f"e{i}", start + timedelta(days=(i * 11) % n), "rent", str(5 + i)) for i in range(25)]
        r = summarise(orders, pays, costs, start, end)
        for k, total in (("money_in", "money_in"), ("goods", "goods"), ("running", "running"), ("money_out", "money_out"), ("left_over", "left_over")):
            assert sum(b[k] for b in r["series"]) == r[total], (start, end, k)


def test_bad_periods_are_refused_with_a_code():
    for a, b, code in [(date(2026, 10, 5), date(2026, 10, 4), "end_before_start"), (date(2024, 1, 1), date(2026, 10, 31), "too_long"),
                       ("2026-10-01", date(2026, 10, 31), "bad_period"), (date(2026, 10, 1), None, "bad_period")]:
        with pytest.raises(PeriodError) as e:
            summarise([], [], [], a, b)
        assert e.value.code == code
    assert check_period(date(2026, 1, 1), date(2026, 1, 1)) == 1                                  # one day is fine
    assert check_period(date(2026, 1, 1), date(2026, 1, 1) + timedelta(days=MAX_DAYS - 1)) == MAX_DAYS
    with pytest.raises(PeriodError):
        check_period(date(2026, 1, 1), date(2026, 1, 1) + timedelta(days=MAX_DAYS))


def test_percentages_round_half_up_to_one_decimal():
    assert pct(D("1"), D("8")) == D("12.5") and pct(D("1"), D("3")) == D("33.3") and pct(D("2"), D("3")) == D("66.7")
    assert pct(D("0.05"), D("100")) == D("0.1") and pct(D("5"), D("0")) is None and pct(D("-1"), D("8")) == D("-12.5")


def test_an_order_with_only_part_of_its_cost_is_counted_but_flagged():
    part = [order("p1", date(2026, 10, 5), "400.00", "100.00", complete=False)]                      # one line had no cost-book price
    r = summarise(part, [], [], *OCT)
    assert r["goods"] == D("100.00") and r["gross"] == D("300.00")                                    # the cost we do know is still counted
    assert r["orders_without_cost"] == 1 and r["orders"][0]["cost_known"] is False and r["orders"][0]["cost"] == D("100.00")
    assert summarise(ORDERS[:2], [], [], *OCT)["orders_without_cost"] == 0                           # fully costed orders are not flagged
