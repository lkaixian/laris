"""Supplier price tiers and MOQ: ingest -> promote -> the quote picks the tier by quantity (rules, never the LLM)."""
from decimal import Decimal as D

import psycopg

from src import db
from src.pricing import pick_tier
from src.validate import validate_extraction

from support.fixtures import env, pg_url  # noqa: F401


def supplier_doc(e, doc_no, boxes, days_ago=1, pla=True):
    """boxes = [(min_qty, price)] as tier lines (no qty on the paper). Runs the real flow through to the cost book."""
    lines = [{"description": "box", "min_qty": m, "uom": "pcs", "unit_price": p, "sku": f"BX-{m}"} for m, p in boxes]
    if pla:
        lines.append({"description": "pla black", "qty": 10, "uom": "kg", "unit_price": 50, "amount": 500})
    e.ai.payload = {"supplier_name": "Tier Supplier", "doc_no": doc_no, "lines": lines,
                    "issued_on": e.sql("select (current_date - %s)::text d", (days_ago,))[0]["d"]}
    r = e.c.post("/api/documents/ingest", data={"text": f"tiers {doc_no}"}, headers=e.S)
    assert r.status_code == 201, r.text
    doc = r.json()["id"]
    for who, to in ((e.S, "reviewed"), (e.O, "accepted"), (e.O, "in_cost_book")):
        assert e.c.post(f"/api/documents/{doc}/transition", json={"to": to}, headers=who).status_code == 200
    return doc


def quote_line(e, qty):
    r = e.enquire([{"item_key": "print_part_small", "qty": qty}])
    assert r.status_code == 201, r.text
    return e.sql("select * from document_lines where document_id=%s", (r.json()["id"],))[0]


def test_tier_lines_validate_without_qty():
    v = validate_extraction({"lines": [{"description": "box", "min_qty": 100, "uom": "pcs", "unit_price": 1.5}]})
    assert "null_qty" not in v["lines"][0]["failed"]
    assert "null_qty" in validate_extraction({"lines": [{"description": "box", "uom": "pcs", "unit_price": 1.5}]})["lines"][0]["failed"]
    assert "min_qty_invalid" in validate_extraction({"lines": [{"description": "box", "min_qty": -1, "qty": 1}]})["lines"][0]["failed"]


def test_pick_tier_rule():
    t = [(D(100), D("1.5"), "b"), (D(1), D("2"), "a"), (D(500), D("1"), "c")]
    assert pick_tier(t, D(99)) == (D("2"), "a", None)
    assert pick_tier(t, D(100)) == (D("1.5"), "b", None)
    assert pick_tier(t, D(9999)) == (D(1), "c", None)
    assert pick_tier([(D(100), D("1.5"), "b")], D(10)) == (D("1.5"), "b", D(100))  # below the MOQ: lowest tier, flagged
    assert pick_tier([(D("0.5"), D("1.5"), "b")], D("0.1")) == (D("1.5"), "b", None)  # min_qty 1 or less is no MOQ
    assert pick_tier((D(3), "x"), D(1)) == (D(3), "x", None)


def test_ingest_promote_and_quote_picks_tier(env):
    e = env
    supplier_doc(e, "T-1", [(1, 2), (100, "1.5"), (500, 1)])
    rows = e.sql("select min_qty, unit_cost from cost_items where item_key='packaging_box' order by min_qty")
    assert [(r["min_qty"], r["unit_cost"]) for r in rows] == [(1, D("2")), (100, D("1.5")), (500, D("1"))]
    sku = e.sql("select supplier_sku from document_lines where min_qty=100")[0]["supplier_sku"]
    assert sku == "BX-100"
    for qty, price in ((10, "32.80"), (100, "32.00"), (600, "31.20")):  # (2.5 pla + box + 16 machine) * 1.6
        l = quote_line(e, qty)
        assert l["unit_price"] == D(price) and not l["needs_review"] and l["review_reason"] is None


def test_below_moq_prices_lowest_tier_and_flags(env):
    e = env
    supplier_doc(e, "T-2", [(100, "1.5"), (500, 1)])
    l = quote_line(e, 10)
    assert l["unit_price"] == D("32.00") and l["needs_review"]
    assert "below supplier MOQ for packaging_box" in l["review_reason"] and "minimum 100" in l["review_reason"]
    assert not quote_line(e, 100)["needs_review"]


def test_supersede_only_same_min_qty(env):
    e = env
    supplier_doc(e, "T-3", [(1, 2), (100, "1.5")], days_ago=3)
    supplier_doc(e, "T-4", [(100, "1.4")], days_ago=1, pla=False)
    cur = e.sql("select min_qty, unit_cost from cost_items where item_key='packaging_box' and superseded_by is null order by min_qty")
    assert [(r["min_qty"], r["unit_cost"]) for r in cur] == [(1, D("2")), (100, D("1.4"))]
    assert e.sql("select count(*) n from cost_items where item_key='packaging_box'")[0]["n"] == 3
    assert quote_line(e, 100)["unit_price"] == D("31.84")  # (2.5 + 1.4 + 16) * 1.6


def test_owner_sees_tier_fields_staff_does_not(env):
    e = env
    doc = supplier_doc(e, "T-5", [(100, "1.5")])
    for who, seen in ((e.O, True), (e.S, False)):
        ls = e.c.get(f"/api/documents/{doc}", headers=who).json()["lines"]
        box = next(l for l in ls if l["supplier_sku"] == "BX-100") if seen else ls[0]
        assert (box["min_qty"] is not None) == seen and (box["supplier_sku"] is not None) == seen


def test_apply_schema_on_old_and_repeated_db(pg_url, monkeypatch):
    monkeypatch.setenv("DATABASE_URL", pg_url)
    with psycopg.connect(pg_url, autocommit=True) as c:
        c.execute("drop schema public cascade; create schema public")
        for f in ("schema.sql", "transitions.sql", "functions.sql"):  # a database bootstrapped before tiers existed
            c.execute((db.DB_DIR / f).read_text(encoding="utf-8"))
        assert not c.execute("select 1 from information_schema.columns where table_name='cost_items' and column_name='min_qty'").fetchone()
    db.apply_schema(seed=False)
    db.apply_schema(seed=False)
    with psycopg.connect(pg_url, autocommit=True) as c:
        assert c.execute("""select count(*) from information_schema.columns where column_name in ('min_qty','supplier_sku','review_reason')
                            and table_name in ('cost_items','document_lines')""").fetchone()[0] == 4
        assert "min_qty" in c.execute("select prosrc from pg_proc where proname='promote_document'").fetchone()[0]
