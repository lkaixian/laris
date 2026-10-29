"""Availability questions are answered from CONFIRMED catalog items; the model only picks search terms."""
import pytest

from src import availability, db, pipeline
from src.ilmu import IlmuError
from support.fixtures import env, pg_url  # noqa: F401


def model(monkeypatch, out):
    def fake(text, schema, few_shot=(), *, client=None):
        if isinstance(out, Exception):
            raise out
        return out
    monkeypatch.setattr(availability.ilmu, "extract_json", fake)


def ask(e, text, tid=None, who=None):
    with db.tx("owner", e.owner, tenant=db.ALL_TENANTS) as c:
        who = who or cust(e, c)
        return availability.answer(c, tid or e.tid, who, text)


def cust(e, c, name="Cust"):
    return pipeline.party(c, e.tid, "customer", name, name)


def item(e, desc, status="confirmed", tid=None, **kw):
    t = tid or e.tid
    lid = e.sql("insert into listings(tenant_id,image,image_mime) values (%s,decode('00','hex'),'image/png') returning id", (t,))[0]["id"]
    e.sql("insert into listing_items(listing_id,tenant_id,position,description,sku,price,currency,sizes,bbox,crop,status,price_tiers,stock_qty) "
          "values (%s,%s,0,%s,%s,%s,%s,%s::jsonb,'[0,0,1,1]','\x03',%s,%s::jsonb,%s)",
          (lid, t, desc, kw.get("sku"), kw.get("price"), kw.get("currency"), kw.get("sizes", "[]"), status, kw.get("tiers", "[]"), kw.get("stock")))


@pytest.fixture
def e(env):
    availability._LAST.clear()
    env.tid = str(env.sql("select id from tenants")[0]["id"])
    return env


def test_order_intent_is_left_to_the_order_path(e, monkeypatch):
    model(monkeypatch, {"intent": "order", "search_terms": ["esun"]})
    item(e, "eSUN PLA filament")
    assert ask(e, "10 kg esun please") is None


def test_confirmed_match_listed_with_price_and_sizes_review_and_other_tenant_hidden(e, monkeypatch):
    model(monkeypatch, {"intent": "availability", "search_terms": ["esun", "filament"]})
    other = str(e.sql("insert into tenants(name, trade_template, min_margin_pct) values ('Other','made_to_order',20) returning id")[0]["id"])
    item(e, "eSUN PLA filament white", price=45, currency="RM", sizes='["1kg","3kg"]')
    item(e, "eSUN review filament", status="needs_review")
    item(e, "eSUN other filament", tid=other)
    r = ask(e, "is there any esun filament available")
    assert "We list: eSUN PLA filament white (sizes: 1kg, 3kg) - RM 45.00" in r
    assert "review" not in r and "other" not in r and "not that it is in stock" in r


def test_any_term_fallback_wildcard_escaped_and_no_match(e, monkeypatch):
    item(e, "eSUN PLA filament")
    model(monkeypatch, {"intent": "availability", "search_terms": ["esun", "nylon"]})
    assert "eSUN PLA filament" in ask(e, "esun nylon?")  # all-terms empty, any-term hits
    model(monkeypatch, {"intent": "availability", "search_terms": ["%"]})
    assert ask(e, "got %?").startswith("We could not find that in our list.")


def test_model_down_uses_keyword_fallback(e, monkeypatch):
    model(monkeypatch, IlmuError("down"))
    item(e, "eSUN PLA filament")
    assert "eSUN PLA filament" in ask(e, "ada filament esun tak?")
    assert ask(e, "10 esun filament please") is None
    assert ask(e, "got 5 esun filament?") is None  # a quantity is an order


def quote_model(monkeypatch, qty=None, terms=(), uom="kg"):
    model(monkeypatch, {"intent": "quote_request", "search_terms": list(terms), "qty": qty, "uom": uom})


def shown(e, monkeypatch, who):
    model(monkeypatch, {"intent": "availability", "search_terms": ["esun"]})
    with db.tx("owner", e.owner, tenant=db.ALL_TENANTS) as c:
        return availability.answer(c, e.tid, who, "any esun available")


def test_quote_follow_up_uses_memory_and_drafts_a_quote_for_review(e, monkeypatch):
    item(e, "eSUN PLA white", price=45, currency="RM")
    with db.tx("owner", e.owner, tenant=db.ALL_TENANTS) as c:
        who = cust(e, c)
    shown(e, monkeypatch, who)
    quote_model(monkeypatch, 50)
    with db.tx("owner", e.owner, tenant=db.ALL_TENANTS) as c:
        r = availability.answer(c, e.tid, who, "Ok, nak sebut harga. Quote kalau ambil bulk 50kg")
    assert "50 kg eSUN PLA white" in r and "Price at this quantity RM 45.00 per unit" in r and "confirm it" in r
    l = e.sql("select l.*, d.status, d.direction, d.kind from document_lines l join documents d on d.id=l.document_id where l.review_reason like 'catalog%%'")[0]
    assert (l["qty"], l["unit_price"], l["needs_review"], l["item_key"], l["price_source"]) == (50, 45, True, None, None)
    assert (l["status"], l["direction"], l["kind"]) == ("draft", "out", "quotation")
    assert e.sql("select count(*) n from messages where body like 'Ok, nak%%'")[0]["n"] == 1
    assert (e.tid, str(who)) not in availability._LAST
    d = str(l["document_id"])  # staff can open it, preview it and export it
    assert e.c.get(f"/api/documents/{d}", headers=e.O).status_code == 200
    assert e.c.get(f"/api/documents/{d}/preview", headers=e.O).json()["lines"][0]["description"] == "eSUN PLA white"
    for fmt in ("pdf", "xlsx", "csv"):
        assert e.c.get(f"/api/documents/{d}/export?format={fmt}", headers=e.O).status_code == 200
    e.sql("update document_lines set unit_price=null where review_reason like 'catalog%%'")  # a catalog item with no price stays NULL for staff to fill
    assert e.c.get(f"/api/documents/{d}/preview", headers=e.O).status_code == 200


def test_quote_asks_quantity_and_which_one(e, monkeypatch):
    item(e, "eSUN PLA white", price=45)
    with db.tx("owner", e.owner, tenant=db.ALL_TENANTS) as c:
        who = cust(e, c)
    shown(e, monkeypatch, who)
    n = e.sql("select count(*) n from documents")[0]["n"]
    quote_model(monkeypatch, None)
    with db.tx("owner", e.owner, tenant=db.ALL_TENANTS) as c:
        assert availability.answer(c, e.tid, who, "quote please") == "How many eSUN PLA white do you need?"
    assert e.sql("select count(*) n from documents")[0]["n"] == n
    item(e, "eSUN PETG black")
    shown(e, monkeypatch, who)
    quote_model(monkeypatch, 5)
    with db.tx("owner", e.owner, tenant=db.ALL_TENANTS) as c:
        assert availability.answer(c, e.tid, who, "quote 5").startswith("Which one: 1)")
        quote_model(monkeypatch, 5, ["petg"])
        assert "5 kg eSUN PETG black" in availability.answer(c, e.tid, who, "petg 5kg")  # picking narrows what was shown


def test_quote_without_memory_or_match_is_left_to_the_order_path(e, monkeypatch):
    item(e, "eSUN PLA white")
    quote_model(monkeypatch, 50)
    assert ask(e, "quote 50kg") is None
    quote_model(monkeypatch, 50, ["nothing"])
    assert ask(e, "quote 50 nothing") is None


def test_memory_expires_is_per_party_and_tenant_scoped(e, monkeypatch):
    item(e, "eSUN PLA white", price=45)
    other = str(e.sql("insert into tenants(name, trade_template, min_margin_pct) values ('Other','made_to_order',20) returning id")[0]["id"])
    with db.tx("owner", e.owner, tenant=db.ALL_TENANTS) as c:
        a, b = cust(e, c, "A"), cust(e, c, "B")
    shown(e, monkeypatch, a)
    quote_model(monkeypatch, 50)
    assert ask(e, "quote 50kg", who=b) is None  # B saw nothing
    assert ask(e, "quote 50kg", tid=other, who=a) is None  # nor does the same customer id under another business
    t = availability.time.monotonic()
    monkeypatch.setattr(availability.time, "monotonic", lambda: t + availability.TTL + 1)
    assert ask(e, "quote 50kg", who=a) is None  # expired
    monkeypatch.undo()


def test_unconfirmed_item_is_never_quoted(e, monkeypatch):
    item(e, "eSUN review", status="needs_review")
    with db.tx("owner", e.owner, tenant=db.ALL_TENANTS) as c:
        who = cust(e, c)
    availability._LAST[(e.tid, str(who))] = (availability.time.monotonic(), [{"id": e.sql("select id from listing_items")[0]["id"]}])
    quote_model(monkeypatch, 50)
    with db.tx("owner", e.owner, tenant=db.ALL_TENANTS) as c:
        assert availability.answer(c, e.tid, who, "quote 50kg") is None
    quote_model(monkeypatch, 50, ["esun"])
    assert ask(e, "quote 50 esun") is None


SPOOL = ('[{"size": null, "min_qty": "10", "price": "40"}, {"size": null, "min_qty": "50", "price": "36"},'
         ' {"size": "3kg", "min_qty": "1", "price": "120"}]')


def quote_line(e, monkeypatch, text, qty, terms=(), uom="spool"):
    with db.tx("owner", e.owner, tenant=db.ALL_TENANTS) as c:
        who = cust(e, c)
    shown(e, monkeypatch, who)
    quote_model(monkeypatch, qty, terms, uom)
    with db.tx("owner", e.owner, tenant=db.ALL_TENANTS) as c:
        r = availability.answer(c, e.tid, who, text)
    return r, e.sql("select l.description, l.unit_price, l.needs_review, l.review_reason, l.price_source from document_lines l "
                    "join documents d on d.id = l.document_id where l.review_reason like 'catalog%%' order by d.doc_no desc limit 1")[0]


@pytest.mark.parametrize("text,qty,want", [("quote 1 spool", 1, 45), ("quote 20 spool", 20, 40), ("quote 60 spool", 60, 36),
                                           ("quote 2 spool 3kg", 2, 120)])
def test_quote_is_priced_by_size_and_quantity_tier_from_the_rules(e, monkeypatch, text, qty, want):
    item(e, "eSUN PLA white", price=45, currency="RM", sizes='["1kg","3kg"]', tiers=SPOOL)
    r, l = quote_line(e, monkeypatch, text, qty)
    assert l["unit_price"] == want and l["needs_review"] and l["price_source"] is None  # staff still confirm before sending
    assert f"Price at this quantity RM {want:.2f} per unit" in r and l["review_reason"].startswith("catalog price from the price list")
    assert ("(3kg)" in l["description"]) == ("3kg" in text)


def test_quote_without_a_size_rule_or_below_the_minimum_is_flagged_not_guessed(e, monkeypatch):
    item(e, "Shirt", sizes='["S","L"]', tiers='[{"size": "S", "min_qty": "1", "price": "10"}, {"size": "L", "min_qty": "5", "price": "14"}]')
    r, l = quote_line(e, monkeypatch, "quote 3 shirt", 3, ["shirt"], uom="pc")
    assert l["unit_price"] is None and "size not given" in l["review_reason"] and "Sizes: S, L" in r and "Price" not in r
    availability._LAST.clear()
    r, l = quote_line(e, monkeypatch, "quote 2 shirt size L", 2, ["shirt"], uom="pc")
    assert l["unit_price"] == 14 and "below the minimum of 5" in l["review_reason"] and l["description"] == "Shirt (L)"


def test_in_stock_only_when_a_count_is_set(e, monkeypatch):
    model(monkeypatch, {"intent": "availability", "search_terms": ["esun"]})
    item(e, "eSUN none")
    r = ask(e, "esun?")
    assert "in stock" not in r.replace("not that it is in stock", "") and "Listed means we carry it" in r
    e.sql("update listing_items set stock_qty = 0")
    assert "We list: eSUN none - out of stock" in ask(e, "esun?")
    e.sql("update listing_items set stock_qty = 12")
    r = ask(e, "esun?")
    assert "We list: eSUN none - in stock" in r and "Listed means" not in r and "12" not in r  # the count itself is not told
    item(e, "eSUN uncounted")
    r = ask(e, "esun?")
    assert "eSUN uncounted\n" in r + "\n" and "- in stock" in r and "Listed means we carry it, not that it is in stock" in r


def test_bulk_prices_are_mentioned_and_stock_short_is_flagged(e, monkeypatch):
    item(e, "eSUN PLA white", price=45, currency="RM", tiers=SPOOL, sizes='["1kg","3kg"]', stock=5)
    model(monkeypatch, {"intent": "availability", "search_terms": ["esun"]})
    assert "RM 45.00, bulk prices available - in stock" in ask(e, "esun?")
    availability._LAST.clear()
    _, l = quote_line(e, monkeypatch, "quote 20 spool", 20)
    assert "stock count 5 is below the 20 asked" in l["review_reason"]
