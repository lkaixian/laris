"""Step 223: supplier quote comparison, deal margin, three-way match and the supplier document moves (src/buyside.py)."""
import pytest
from support.fixtures import env, pg_url  # noqa: F401

from src import buyside
from src.errors import ApiError

Q = [{"supplier": "Bukit Poultry", "total": "1200", "lead_days": 2, "on_time_pct": 98},
     {"supplier": "Segar Foods", "total": "1160", "lead_days": 3, "on_time_pct": 91},
     {"supplier": "Kota Wholesale", "total": "1240", "lead_days": 1, "on_time_pct": 95}]


def test_cheapest_wins_and_each_row_says_why():
    r = buyside.compare_quotes(Q)
    assert r["best"] == "Segar Foods" and r["fastest"] == "Kota Wholesale"
    assert [x["rank"] for x in r["quotes"]] == [1, 2, 3] and r["quotes"][0]["best"]
    assert "RM 40.00 dearer" in r["quotes"][1]["why"] and "1 day faster" in r["quotes"][1]["why"]


def test_tie_on_price_goes_to_the_faster_supplier():
    r = buyside.compare_quotes([{"supplier": "A", "total": 10, "lead_days": 5}, {"supplier": "B", "total": 10, "lead_days": 2}])
    assert r["best"] == "B"


@pytest.mark.parametrize("n", [0, 1, 5])
def test_needs_two_to_four_quotes(n):
    with pytest.raises(ApiError):
        buyside.compare_quotes([{"supplier": f"S{i}", "total": 1} for i in range(n)])


@pytest.mark.parametrize("bad", [{"total": -1}, {"total": "abc"}, {"total": "NaN"}, {"total": 1, "on_time_pct": 101}, {"total": 1, "supplier": " "}])
def test_bad_quote_is_refused(bad):
    q = [{"supplier": "A", "total": 1}, {"supplier": "B", **{k: v for k, v in bad.items()}}]
    if "supplier" not in bad:
        q[1]["supplier"] = "B"
    with pytest.raises(ApiError):
        buyside.compare_quotes(q)


def test_vs_last_paid():
    r = buyside.compare_quotes(Q, {"Segar Foods": "1100"})
    assert r["quotes"][0]["vs_last_paid"] == "+60.00"


def test_margin_states_at_the_boundary():
    assert buyside.margin(1000, 800, 20)["state"] == "ok"            # exactly 20%
    assert buyside.margin(1000, 801, 20)["state"] == "below_target"
    assert buyside.margin(1000, 1001, 20)["state"] == "loss"
    assert buyside.margin(0, 0)["margin_pct"] == "0.0"


def test_three_way_match():
    assert buyside.three_way(10, 10, 10)["match"]
    assert buyside.three_way(10, 8, 8)["issues"] == ["short_delivery"]
    assert "billed_for_more_than_received" in buyside.three_way(10, 10, 12)["issues"]
    assert "price_differs" in buyside.three_way(10, 10, 10, price_ok=False)["issues"]


def test_supplier_document_moves():
    buyside.check_buy_move("spo", "pending_approval", "sent")
    buyside.check_buy_move("sinv", "matched", "approved")
    with pytest.raises(ApiError):
        buyside.check_buy_move("sinv", "received", "paid")      # cannot pay an unmatched invoice
    with pytest.raises(ApiError):
        buyside.check_buy_move("grn", "matched", "received")


def test_api_compare_and_margin(env):
    r = env.c.post("/api/chain/buy/compare", json={"quotes": [{"supplier": "A", "total": "10", "lead_days": 2}, {"supplier": "B", "total": "9", "lead_days": 4}]}, headers=env.O)
    assert r.status_code == 200 and r.json()["best"] == "B"
    assert env.c.post("/api/chain/buy/compare", json={"quotes": [{"supplier": "A", "total": "10"}]}, headers=env.O).status_code == 422
    m = env.c.post("/api/chain/buy/margin", json={"sell_total": "100", "cost_total": "70"}, headers=env.O).json()
    assert m["state"] == "ok" and m["profit"] == "30.00"
    assert env.c.post("/api/chain/buy/margin", json={"sell_total": "1", "cost_total": "-5"}, headers=env.O).status_code == 422


def test_supplier_po_can_serve_a_customer_order_and_shares_its_trail(env):
    from test_chain import customer, mk
    so = mk(env).json()
    sup = env.c.post("/api/contacts", json={"role": "supplier", "name": "Bukit Poultry"}, headers=env.O).json()["id"]
    body = {"kind": "spo", "customer_id": sup, "serves": so["id"], "lines": [{"description": "Chicken", "qty": 5, "unit_price": "20"}]}
    r = env.c.post("/api/chain", json=body, headers=env.O)
    assert r.status_code == 201, r.text
    assert r.json()["deal_id"] == so["deal_id"] and r.json()["parent_id"] == so["id"]
    trail = env.c.get(f"/api/chain/{so['id']}", headers=env.O).json()["trail"]
    assert {x["kind"] for x in trail} == {"so", "spo"}
    # only a supplier PO may serve an order, and not a document of the wrong kind
    assert env.c.post("/api/chain", json={**body, "kind": "so", "customer_id": customer(env)}, headers=env.O).status_code == 422
    assert env.c.post("/api/chain", json={**body, "serves": r.json()["id"]}, headers=env.O).status_code == 409
