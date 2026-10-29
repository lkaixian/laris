"""Retrieval for the AI: one business only, and only the sources the caller's role may see."""
from support.fixtures import env, pg_url  # noqa: F401
from test_public_api import other_tenant_owner
from test_roles import member, role


def found(e, who, q="filament"):
    r = e.c.get("/api/ai/passages", params={"q": q}, headers=who)
    assert r.status_code == 200, r.text
    return r.json()


def sources(j):
    return {p["source"] for p in j["passages"]}


def test_costs_and_supplier_prices_need_view_costs(env):
    e = env
    e.stock_costs()
    owner = found(e, e.O)
    assert {"contacts", "costs", "supplier_docs"} <= sources(owner) and owner["denied"] == []
    assert any("unit cost 50" in p["text"] for p in owner["passages"])
    staff = found(e, e.S)
    assert sources(staff) == {"contacts"} and set(staff["denied"]) == {"costs", "supplier_docs"}
    assert not any("50" in p["text"] for p in staff["passages"]) and "Supplier document" not in str(staff["passages"])  # the text only: ids are random and can contain "50"
    buyer = found(e, member(e, role(e, "Buyer", ["view_costs"])))
    assert {"costs", "supplier_docs"} <= sources(buyer) and buyer["denied"] == []
    nothing = found(e, member(e, role(e, "Nothing", [])))
    assert set(nothing["denied"]) == {"costs", "supplier_docs"}


def test_another_business_gets_nothing(env):
    e = env
    e.stock_costs()
    other = found(e, other_tenant_owner(e))
    assert other["passages"] == [] and other["denied"] == []


def test_a_hostile_query_is_just_text(env):
    e = env
    e.stock_costs()
    for q in ("'; drop table parties; --", "filament | !(", "a" * 200):
        assert e.c.get("/api/ai/passages", params={"q": q}, headers=e.O).status_code == 200
    assert e.c.get("/api/ai/passages", params={"q": "x" * 201}, headers=e.O).status_code == 422
    assert e.sql("select count(*) n from parties")[0]["n"] > 0
