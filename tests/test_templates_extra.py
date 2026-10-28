"""SAMPLE trade templates: tailoring and aircon_service."""
from decimal import Decimal as D

import pytest

from src.pricing import margin_guard, price_quote
from src.templates import load_template
from support.fixtures import env, pg_url, same  # noqa: F401

KEYS = ["tailoring", "aircon_service"]


def costs(t):  # synthetic cost book: every catalog item RM10 per uom
    return {i["item_key"]: (D("10"), 1) for i in t["item_catalog"]}


@pytest.mark.parametrize("key", KEYS)
def test_loads_prices_and_respects_margin_floor(key):
    t = load_template(key)
    assert t["key"] == key
    for name in t["recipes"]:
        q = price_quote([{"item_key": name, "qty": 1}], costs(t), t, {})
        assert q["lines"][0]["unit_price"] > 0, name
        assert margin_guard(q, t["min_margin_pct"]) == [], name


@pytest.mark.parametrize("key", KEYS)
def test_aliases_unique(key):
    al = [a.lower() for i in load_template(key)["item_catalog"] for a in i["aliases"]]
    assert len(al) == len(set(al))


@pytest.mark.parametrize("key", KEYS)
def test_signup_creates_tenant_with_fields(env, key):
    e = env
    body = {"business_name": f"Sample {key}", "owner_name": "Ann Lee", "email": "ann@example.com",
            "password": "correct horse 1", "trade_template": key}
    assert e.c.post("/api/signup", json=body).status_code == 202
    t = e.sql("select id, trade_template from tenants where display_name=%s", (body["business_name"],))[0]
    assert t["trade_template"] == key
    n = e.sql("select count(*) n from tenant_fields where tenant_id=%s", (t["id"],))[0]["n"]
    assert n == len(load_template(key)["fields"])
