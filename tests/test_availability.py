"""Availability questions are answered from CONFIRMED catalog items; the model only picks search terms."""
import pytest

from src import availability, db
from src.ilmu import IlmuError
from support.fixtures import env, pg_url  # noqa: F401


def model(monkeypatch, out):
    def fake(text, schema, few_shot=(), *, client=None):
        if isinstance(out, Exception):
            raise out
        return out
    monkeypatch.setattr(availability.ilmu, "extract_json", fake)


def ask(e, text, tid=None):
    with db.tx("owner", e.owner) as c:
        return availability.answer(c, tid or e.tid, text)


def item(e, desc, status="confirmed", tid=None, **kw):
    t = tid or e.tid
    lid = e.sql("insert into listings(tenant_id,image,image_mime) values (%s,decode('00','hex'),'image/png') returning id", (t,))[0]["id"]
    e.sql("insert into listing_items(listing_id,tenant_id,position,description,sku,price,currency,sizes,bbox,crop,status) "
          "values (%s,%s,0,%s,%s,%s,%s,%s::jsonb,'[0,0,1,1]','\x03',%s)",
          (lid, t, desc, kw.get("sku"), kw.get("price"), kw.get("currency"), kw.get("sizes", "[]"), status))


@pytest.fixture
def e(env):
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


