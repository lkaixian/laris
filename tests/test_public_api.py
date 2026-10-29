"""Usage counter, API keys and the key-protected price API (src/api/public_api.py)."""
import hashlib
import json
from datetime import timedelta

from src.api import deps, public_api
from support.fixtures import env, pg_url  # noqa: F401
from test_api import keys

SIGN = {"recipe_key": "signboard_60x30", "qty": 2}
DESIGN = {"recipe_key": "design_service", "qty": 1.5}
BAD = {"error", "cost", "unit_cost", "margin", "margin_pct", "line_cost", "supplier", "cost_item_id", "basis"}


def mk(e, who=None, name="ERP"):
    r = e.c.post("/api/settings/api-keys", json={"name": name}, headers=who or e.O)
    assert r.status_code == 201, r.text
    return r.json()


def price(e, key, items, hdr="X-API-Key", **kw):
    h = {hdr: key} if hdr == "X-API-Key" else {"Authorization": f"Bearer {key}"}
    return e.c.post("/api/v1/quote-price", json={"items": items, **kw}, headers=h)


def other_tenant_owner(e):
    t = e.sql("insert into tenants(name, trade_template, min_margin_pct) values ('Other Shop','made_to_order',20) returning id")[0]["id"]
    u = e.sql("insert into users(tenant_id, name, role) values (%s,'Zed','owner') returning id", (t,))[0]["id"]
    return {"X-Role": "owner", "X-User": str(u)}


def test_key_shown_once_and_only_hash_stored(env):
    e = env
    k = mk(e)
    assert k["key"].startswith("lar_") and len(k["key"]) == 36 and k["note"] == "Copy it now, it is shown once."
    row = e.sql("select * from api_keys where id=%s", (k["id"],))[0]
    assert row["key_hash"] == hashlib.sha256(k["key"].encode()).hexdigest() and row["key_prefix"] == k["key"][:8]
    assert k["key"] not in json.dumps(row, default=str)
    lst = e.c.get("/api/settings/api-keys", headers=e.O)
    assert lst.status_code == 200 and k["key"] not in lst.text
    assert lst.json()[0].keys() == {"id", "name", "key_prefix", "created_at", "last_used_at", "revoked"}
    assert e.sql("select count(*) n from audit_log where entity='api_keys' and event='api key created'")[0]["n"] == 1
    assert k["key"] not in json.dumps(e.sql("select after from audit_log where entity='api_keys'"), default=str)


def test_key_management_is_owner_only(env):
    e = env
    k = mk(e)
    assert e.c.get("/api/settings/api-keys", headers=e.S).status_code == 403
    assert e.c.post("/api/settings/api-keys", json={"name": "x"}, headers=e.S).status_code == 403
    assert e.c.delete(f"/api/settings/api-keys/{k['id']}", headers=e.S).status_code == 403
    assert e.c.post("/api/settings/api-keys", json={"name": ""}, headers=e.O).status_code == 422
    assert e.c.post("/api/settings/api-keys", json={"name": "x" * 61}, headers=e.O).status_code == 422
    assert e.c.get("/api/usage", headers=e.S).status_code == 403


def test_revoked_and_unknown_keys_get_401_and_the_row_is_kept(env):
    e = env
    k = mk(e)
    assert price(e, k["key"], [SIGN]).status_code == 200
    assert e.c.delete(f"/api/settings/api-keys/{k['id']}", headers=e.O).status_code == 200
    a, b = price(e, k["key"], [SIGN]), price(e, "lar_" + "x" * 32, [SIGN])
    assert a.status_code == b.status_code == 401 and a.json()["error"]["code"] == b.json()["error"]["code"] == "bad_key"
    assert e.c.get("/api/v1/recipes").status_code == 401
    assert e.c.get("/api/v1/recipes", headers=e.O).status_code == 401  # a user session is not an API key
    assert e.c.get("/api/settings/api-keys", headers=e.O).json()[0]["revoked"] is True
    assert e.c.delete(f"/api/settings/api-keys/{k['id']}x", headers=e.O).status_code == 422


def test_price_equals_the_dashboard_and_bearer_works(env):
    e = env
    e.stock_costs()
    qid = e.enquire([{"item_key": "print_part_small", "qty": 10}]).json()["id"]
    line = e.sql("select unit_price, qty from document_lines where document_id=%s", (qid,))[0]
    total = e.sql("select sum(unit_price * qty) s from document_lines where document_id=%s", (qid,))[0]["s"]
    k = mk(e)["key"]
    r = price(e, k, [{"recipe_key": "print_part_small", "qty": 10}], hdr="Bearer")
    assert r.status_code == 200, r.text
    j = r.json()
    assert j["lines"][0]["unit_price"] == f"{line['unit_price']:.2f}" and j["total"] == f"{total:.2f}"
    assert j["ai_used"] is False and j["currency"] == "RM" and j["needs_review"] == []
    with public_api.db.tx(tenant=db.ALL_TENANTS) as c:  # the internal function, same cost book
        tid = c.execute("select tenant_id from users where id=%s", (e.owner,)).fetchone()["tenant_id"]
        inner = public_api.price_items(c, tid, [("print_part_small", 10)])
    assert inner["total"] == total and inner["lines"][0]["unit_price"] == line["unit_price"]
    assert not keys(j) & (BAD | {"basis", "line_no", "price_source"})


def test_responses_carry_no_cost_or_margin_and_unknown_recipe_is_422(env):
    e = env
    k = mk(e)["key"]
    r = price(e, k, [SIGN, DESIGN], customer="Ah Meng")
    assert r.status_code == 200 and r.json()["lines"][0]["recipe_key"] == "signboard_60x30"
    assert not keys(r.json()) & BAD and isinstance(r.json()["below_margin_floor"], bool)
    rec = e.c.get("/api/v1/recipes", headers={"X-API-Key": k})
    assert rec.status_code == 200 and {"recipe_key": "design_service", "description": "Design work (per hour)", "uom": "hour", "fixed_rate": True} in rec.json()
    assert not keys(rec.json()) & BAD
    u = price(e, k, [SIGN, {"recipe_key": "nope", "qty": 1}, {"recipe_key": "zzz", "qty": 1}])
    assert u.status_code == 422 and u.json()["error"]["unknown"] == ["nope", "zzz"]
    n = e.sql("select count(*) n from documents")[0]["n"]
    assert price(e, k, [SIGN]).status_code == 200 and e.sql("select count(*) n from documents")[0]["n"] == n  # read-only: no quote is created


def test_missing_cost_goes_to_needs_review_and_other_tenant_cannot_use_our_cost_book(env):
    e = env
    ka = mk(e)["key"]
    assert price(e, ka, [SIGN]).json()["needs_review"] == [] and price(e, ka, [SIGN]).json()["lines"][0]["unit_price"] == "60.00"
    kb = mk(e, other_tenant_owner(e))["key"]
    r = price(e, kb, [SIGN, DESIGN]).json()
    assert r["needs_review"] == ["signboard_60x30"] and [l["recipe_key"] for l in r["lines"]] == ["design_service"]
    assert e.c.get("/api/settings/api-keys", headers=e.O).json()[0]["name"] == "ERP"
    assert len(e.c.get("/api/settings/api-keys", headers=e.O).json()) == 1  # B's key is not in A's list


def test_validation_rate_limit_and_usage_count(env):
    e = env
    k = mk(e)["key"]
    for bad in ([], [{"recipe_key": "design_service", "qty": 0}], [{"recipe_key": "design_service", "qty": -1}],
                [{"recipe_key": "design_service", "qty": 10_000_001}], [{"recipe_key": "design_service", "qty": 1, "unit_price": 1}],
                [DESIGN] * 51):
        assert price(e, k, bad).status_code == 422, bad
    assert price(e, k, [DESIGN], customer="x" * 81).status_code == 422
    assert e.c.post("/api/v1/quote-price", content=b"{" + b" " * 20000 + b"}", headers={"X-API-Key": k, "Content-Type": "application/json"}).status_code == 413
    assert e.sql("select count(*) n from usage_events")[0]["n"] == 0  # refused calls are not counted
    assert price(e, k, [DESIGN]).status_code == 200
    assert e.sql("select count(*) n from usage_events where kind='price'")[0]["n"] == 1
    assert e.sql("select last_used_at from api_keys")[0]["last_used_at"] is not None
    deps.HITS.clear()  # every authenticated attempt counts, refused ones too
    for _ in range(60):
        assert e.c.get("/api/v1/recipes", headers={"X-API-Key": k}).status_code == 200
    assert e.c.get("/api/v1/recipes", headers={"X-API-Key": k}).status_code == 429
    assert price(e, k, [DESIGN]).status_code == 429


def test_usage_counts_approved_and_sent_in_the_month(env, monkeypatch):
    e = env
    monkeypatch.setenv("USAGE_FREE_QUOTES", "1")
    k = mk(e)["key"]
    price(e, k, [DESIGN])
    u0 = e.c.get("/api/usage", headers=e.O).json()
    base = public_api.now()
    assert u0["period"] == f"{base.year}-{base.month:02d}" and u0.keys() == {"period", "approved_quotes", "quotes_sent", "api_calls", "free_allowance", "over_allowance", "note"}
    assert u0["api_calls"] == 1 and u0["free_allowance"] == 1 and u0["note"].startswith("Shown for planning")
    e.stock_costs()
    qid = e.enquire([{"item_key": "print_part_small", "qty": 1}]).json()["id"]
    assert e.c.post(f"/api/documents/{qid}/transition", json={"to": "approved"}, headers=e.O).status_code == 200
    u1 = e.c.get("/api/usage", headers=e.O).json()
    assert u1["approved_quotes"] == u0["approved_quotes"] + 1 and u1["quotes_sent"] == u0["quotes_sent"]
    assert u1["over_allowance"] is (u1["approved_quotes"] > 1)
    assert e.c.post(f"/api/documents/{qid}/send", json={"channel": "email"}, headers=e.O).status_code in (200, 409, 422)
    later = base + timedelta(days=62)
    monkeypatch.setattr(public_api, "now", lambda: later)  # a later month: nothing counted yet
    u2 = e.c.get("/api/usage", headers=e.O).json()
    assert u2["period"] != u0["period"] and (u2["approved_quotes"], u2["quotes_sent"], u2["api_calls"]) == (0, 0, 0)
