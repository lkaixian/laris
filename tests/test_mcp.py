"""The MCP server: a key bound to one staff role, only while the owner's records-reading consent is on, read-only, masked, counted."""
from support.fixtures import env, pg_url  # noqa: F401
from test_roles import role

RPC = {"jsonrpc": "2.0", "id": 1}


def opt_in(e):
    assert e.c.post("/api/settings/ai", json={"mode": "rag", "accept_disclosure": True}, headers=e.O).status_code == 200


def mcp_key(e, role_id, status=201):
    r = e.c.post("/api/settings/api-keys", json={"name": "AI tool", "mcp_role_id": role_id}, headers=e.O)
    assert r.status_code == status, r.text
    return r.json()


def call(e, key, method, params=None, **kw):
    return e.c.post("/api/mcp", json={**RPC, "method": method, **({"params": params} if params is not None else {}), **kw}, headers={"Authorization": f"Bearer {key}"})


def search(e, key, q="filament"):
    r = call(e, key, "tools/call", {"name": "search", "arguments": {"query": q}})
    assert r.status_code == 200, r.text
    import json
    return json.loads(r.json()["result"]["content"][0]["text"])


def staff_role_id(e):
    return e.sql("select id from roles where key='staff'")[0]["id"]


def test_creating_an_mcp_key_needs_the_consent_and_a_staff_role(env):
    e = env
    assert mcp_key(e, str(staff_role_id(e)), 422)["error"]["code"] == "ai_consent_required"
    opt_in(e)
    owner_role = e.sql("select id from roles where key='owner'")[0]["id"]
    assert mcp_key(e, str(owner_role), 422)["error"]["code"] == "bad_role"
    k = mcp_key(e, str(staff_role_id(e)))
    assert k["key"].startswith("lar_")
    assert e.c.get("/api/settings/api-keys", headers=e.O).json()[0]["mcp_role"] == "Staff"
    assert e.c.post("/api/settings/api-keys", json={"name": "x", "mcp_role_id": str(staff_role_id(e))}, headers=e.S).status_code == 403  # owner only


def test_protocol_basics_and_a_plain_key_is_refused(env):
    e = env
    opt_in(e)
    k = mcp_key(e, str(staff_role_id(e)))["key"]
    j = call(e, k, "initialize", {"protocolVersion": "2025-03-26"}).json()["result"]
    assert j["protocolVersion"] == "2025-03-26" and j["capabilities"] == {"tools": {}} and j["serverInfo"]["name"] == "laris"
    assert call(e, k, "initialize", {"protocolVersion": "1999-01-01"}).json()["result"]["protocolVersion"] == "2025-06-18"
    assert call(e, k, "ping").json()["result"] == {}
    tools = call(e, k, "tools/list").json()["result"]["tools"]
    assert [t["name"] for t in tools] == ["search"] and tools[0]["annotations"]["readOnlyHint"] is True
    assert e.c.post("/api/mcp", json={"jsonrpc": "2.0", "method": "notifications/initialized"}, headers={"Authorization": f"Bearer {k}"}).status_code == 202
    assert call(e, k, "tools/call", {"name": "drop_everything", "arguments": {}}).json()["error"]["code"] == -32602
    assert call(e, k, "tools/call", {"name": "search", "arguments": {"query": ""}}).json()["error"]["code"] == -32602
    assert call(e, k, "resources/list").json()["error"]["code"] == -32601
    plain = e.c.post("/api/settings/api-keys", json={"name": "ERP"}, headers=e.O).json()["key"]
    assert call(e, plain, "ping").status_code == 403 and call(e, plain, "ping").json()["error"]["code"] == "not_an_mcp_key"
    assert call(e, "lar_nope", "ping").status_code == 401
    assert e.c.get("/api/mcp", headers={"Authorization": f"Bearer {k}"}).status_code == 405


def test_the_key_sees_only_what_its_role_sees(env):
    e = env
    e.stock_costs()
    opt_in(e)
    low = mcp_key(e, str(staff_role_id(e)))["key"]
    buyer = mcp_key(e, role(e, "Buyer", ["view_costs"])["id"])["key"]
    a = search(e, low)
    assert {p["source"] for p in a["passages"]} == {"contacts"} and set(a["denied_sources"]) == {"costs", "supplier_docs"}
    assert "unit cost" not in str(a)
    b = search(e, buyer)
    assert {"costs", "supplier_docs"} <= {p["source"] for p in b["passages"]} and any("unit cost 50" in p["text"] for p in b["passages"])


def test_output_is_masked_counted_and_follows_the_consent(env):
    e = env
    e.sql("insert into parties (tenant_id, role, name, attention) select id, 'customer', 'Zainuddin Bakti', 'call 012-345 6789' from tenants limit 1")
    opt_in(e)
    k = mcp_key(e, str(staff_role_id(e)))["key"]
    out = search(e, k, "zainuddin")
    assert out["passages"] and "Zainuddin" not in str(out) and "345 6789" not in str(out) and "[NAME_1]" in str(out)
    a = e.c.get("/api/ai/activity", headers=e.O).json()
    assert a["by_kind"] == {"mcp": 1} and a["totals"]["masked"].get("NAME", 0) >= 1
    assert e.sql("select provider, user_id from ai_calls") == [{"provider": "mcp", "user_id": None}]
    e.c.post("/api/settings/ai", json={"mode": "guide_data", "accept_disclosure": True}, headers=e.O)  # consent withdrawn: every MCP key stops
    r = call(e, k, "ping")
    assert r.status_code == 403 and r.json()["error"]["code"] == "ai_consent_required"
