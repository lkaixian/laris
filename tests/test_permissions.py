"""Step 105: a custom role with NO permissions is read-only, and sees no cost or margin figure (docs/roles.md, route-to-gate table)."""
import json
from uuid import uuid4

import pytest
from fastapi.routing import APIRoute

from src.api.deps import STAFF_HIDE
from src.app import app
from support.fixtures import env, pg_url  # noqa: F401
from test_api import keys, seed_quote
from test_rfq import JPEG, ask, listing, reply_in, setup
from test_roles import member, role

# Write routes a zero-permission user may call: the person's own account, public pages, and the read-only assistant.
# Adding a route here is a security decision; every other write route must answer 403 to a zero-permission role.
OPEN = {
    ("POST", "/api/login"), ("POST", "/api/logout"),
    ("POST", "/api/signup"), ("POST", "/api/signup/verify"), ("POST", "/api/signup/resend"), ("POST", "/api/signup/check"),
    ("POST", "/api/password/forgot"), ("POST", "/api/password/reset"),
    ("POST", "/api/invites/preview"), ("POST", "/api/invites/accept"),
    ("POST", "/api/me/password"), ("POST", "/api/me/sessions/revoke-others"), ("DELETE", "/api/me/sessions/{sid}"),
    ("POST", "/api/me/telegram-link"), ("DELETE", "/api/me/telegram-link"),  # a person links or unlinks their own Telegram
    ("POST", "/api/license/admin/public-key"), ("POST", "/api/license/admin/issue"),  # platform admin only: 404 (not 403) for everyone else, tests/test_license_admin.py
    ("POST", "/api/me/onboarding"),  # a person's own tour progress, tests/test_onboarding.py
    ("POST", "/api/v1/quote-price"),  # no user session at all: an owner-issued API key (X-API-Key) is the credential; read-only pricing, tests/test_public_api.py
    ("POST", "/api/public/quote/{token}/accept"), ("POST", "/api/public/quote/{token}/decline"),  # the customer's own link, tests/test_accept.py
    ("POST", "/api/public/delivery/{token}/sign"),  # the customer's own link, tests/test_chain_delivery.py
    ("POST", "/api/assistant/guide"),  # navigation help for any signed-in user; 403 ai_off unless the owner turned it on, tests/test_ai_guide.py
    ("POST", "/api/mcp"),  # no user session: an owner-issued MCP key bound to a staff role is the credential; read-only search, tests/test_mcp.py
    ("POST", "/api/assistant"),  # answers questions with the caller's own scrubbed read access; changes nothing
}
ID = str(uuid4())
SEND = {"to": "parsed"}
# Minimal VALID request per gated route, so the 403 can only come from the gate and not from a 404 / 422 on the way.
REQ = {
    ("POST", "/api/documents/{doc_id}/transition"): {"json": SEND},
    ("POST", "/api/documents/{doc_id}/send"): {"json": {"channel": "email"}},
    ("POST", "/api/documents/{doc_id}/accept-link"): {},
    ("POST", "/api/documents/import-sent"): {"data": {"customer": "x"}},
    ("POST", "/api/documents/{doc_id}/lines/{line_id}"): {"json": {"qty": 1}},
    ("POST", "/api/settings"): {"json": {"brand_color": "#112233"}},
    ("POST", "/api/jobs"): {"json": {"title": "Fix the shop sign"}},
    ("POST", "/api/jobs/{job_id}"): {"json": {"status": "doing"}},
    ("POST", "/api/followups/{fid}"): {"json": {"action": "skip"}},
    ("POST", "/api/jobs/{job_id}/proforma"): {"json": {}},
    ("POST", "/api/jobs/{job_id}/payments"): {"json": {"amount": "1.00", "method": "cash", "paid_on": "2026-01-01", "purpose": "deposit", "idempotency_key": "k" * 12}},
    ("POST", "/api/jobs/{job_id}/invoice"): {"json": {}},
    ("POST", "/api/jobs/{job_id}/delivery-orders"): {"json": {}},
    ("POST", "/api/deal-docs/{doc_id}/delivery-link"): {},
    ("POST", "/api/payments/propose-from-slip"): {"files": {"image": ("s.jpg", JPEG, "image/jpeg")}},
    ("POST", "/api/payments/{pid}/reverse"): {"json": {"reason": "wrong amount"}},
    ("POST", "/api/deal-docs/{doc_id}/void"): {"json": {"reason": "wrong amount"}},
    ("PUT", "/api/settings/doc-layout/{kind}"): {"json": {}},
    ("POST", "/api/field-proposals/{pid}/decide"): {"json": {"decision": "ignore"}},
    ("POST", "/api/enquiries/simulate"): {"json": {"channel": "web", "text": "x"}},
    ("POST", "/api/documents/ingest"): {"data": {"text": "x"}},
    ("POST", "/api/parties/{party_id}/erase"): {},
    ("POST", "/api/documents/manual"): {"json": {"supplier": "S", "lines": [{"description": "d", "qty": 1, "uom": "pcs", "unit_price": 1}]}},
    ("POST", "/api/contacts"): {"json": {"role": "customer", "name": "x"}},
    ("POST", "/api/contacts/{pid}"): {"json": {"notes": "x"}},
    ("POST", "/api/invites"): {"json": {"email": "a@example.test", "role": "staff"}},
    ("POST", "/api/invites/{iid}/resend"): {},
    ("DELETE", "/api/invites/{iid}"): {},
    ("POST", "/api/listings"): {"files": {"image": ("i.jpg", JPEG, "image/jpeg")}},
    ("PATCH", "/api/listings/{listing_id}/items/{item_id}"): {"json": {"description": "x"}},
    ("POST", "/api/listings/{listing_id}/items/{item_id}/cutout"): {"files": {"file": ("c.png", b"x", "image/png")}},
    ("DELETE", "/api/listings/{listing_id}/items/{item_id}/cutout"): {},
    ("POST", "/api/listings/{listing_id}/items/{item_id}/ask"): {"json": {"supplier_ids": [ID]}},
    ("POST", "/api/rfq"): {"files": {"image": ("i.jpg", JPEG, "image/jpeg")}, "data": {"description": "d", "supplier_ids": ID}},
    ("POST", "/api/rfq/{rfq_id}/replies/{reply_id}/accept"): {"json": {"item_key": "x"}},
    ("POST", "/api/roles"): {"json": {"name": "x", "permissions": []}},
    ("PATCH", "/api/roles/{rid}"): {"json": {"name": "x"}},
    ("DELETE", "/api/roles/{rid}"): {},
    ("POST", "/api/users"): {"json": {"name": "n", "username": "someone", "role": "staff", "password": "correct horse battery 1"}},
    ("POST", "/api/users/{uid}"): {"json": {"name": "n"}},
    ("POST", "/api/settings/channels"): {"json": {"wa_phone_number_id": "12345678"}},
    ("POST", "/api/settings/telegram/connect"): {"json": {"token": "123456:" + "a" * 35}},
    ("POST", "/api/settings/telegram/disconnect"): {},
    ("POST", "/api/settings/telegram/bot-settings"): {"json": {"reactions": True}},
    ("POST", "/api/users/{uid}/telegram-link"): {},
    ("DELETE", "/api/users/{uid}/telegram-link"): {},
    ("POST", "/api/settings/privacy"): {"json": {"dpo_name": "x"}},
    ("POST", "/api/privacy/breaches"): {"json": {"detected_at": "2026-01-01T00:00:00+00:00", "summary": "x"}},
    ("POST", "/api/privacy/breaches/{bid}"): {"json": {"notes": "x"}},
    ("POST", "/api/privacy/requests/{rid}"): {"json": {"action": "dismiss"}},
    ("POST", "/api/settings/api-keys"): {"json": {"name": "ERP"}},
    ("DELETE", "/api/settings/api-keys/{kid}"): {},
    ("POST", "/api/settings/ai"): {"json": {"mode": "off"}},
    ("POST", "/api/settings/ai/test"): {},
    ("POST", "/api/license"): {"json": {"key": "x"}},
    ("POST", "/api/license/accept-offer"): {},
    ("POST", "/api/license/request"): {"json": {"plan": "starter", "seats": 1}},
    ("POST", "/api/license/checkout"): {"json": {"plan": "starter"}},
}


def all_routes():
    """FastAPI >= 0.159 keeps included routers lazy (`_IncludedRouter`): look inside them with their include prefix."""
    for x in app.routes:
        if hasattr(x, "original_router"):
            for y in x.original_router.routes:
                if isinstance(y, APIRoute):
                    yield x.include_context.prefix + y.path, y.methods
        elif isinstance(x, APIRoute):
            yield x.path, x.methods


def write_routes():
    return sorted((m, p) for p, ms in all_routes() if p.startswith("/api/") for m in ms & {"POST", "PUT", "PATCH", "DELETE"})


def test_every_write_route_refuses_a_role_with_no_permissions(env):
    e = env
    who = member(e, role(e, "Nothing", []))
    seen, bad = 0, []
    for m, path in write_routes():
        if (m, path) in OPEN:
            continue
        assert (m, path) in REQ, f"new write route {m} {path}: add a gate (require_perm / require_owner) and an entry in REQ"
        url = path
        for p in {x for x in path.split("/") if x.startswith("{")}:
            url = url.replace(p, ID)
        r = e.c.request(m, url, headers=who, **{k: v for k, v in REQ[(m, path)].items()})
        seen += 1
        if r.status_code != 403 or r.json()["error"]["code"] not in ("permission_required", "owner_only"):
            bad.append((m, path, r.status_code, r.text[:120]))
    assert not bad, bad
    assert seen >= 25


def test_open_and_req_tables_have_no_stale_entries():
    have = set(write_routes())
    assert OPEN <= have and set(REQ) <= have and not OPEN & set(REQ)


def test_step_105_gates_on_the_staff_default_still_work_and_zero_role_is_refused(env):
    """The same actions as default staff (manage_contacts, upload_documents) stay open; a no-permission role gets 403 on each."""
    e = env
    none = member(e, role(e, "Nothing", []))
    e.shock()
    qid = seed_quote(e)
    job = e.sql("insert into jobs(tenant_id, quote_id) select tenant_id, id from documents where id=%s returning id", (qid,))[0]["id"]
    assert e.c.post(f"/api/jobs/{job}", json={"status": "doing"}, headers=none).status_code == 403
    assert e.c.post(f"/api/jobs/{job}", json={"status": "doing"}, headers=e.S).status_code == 200
    assert e.c.post("/api/enquiries/simulate", json={"channel": "web", "text": "x"}, headers=none).status_code == 403
    assert e.c.get("/api/followups", headers=none).status_code == 403
    inbound = e.sql("select id from documents where direction='in' limit 1")[0]["id"]
    assert e.c.post(f"/api/documents/{inbound}/transition", json={"to": "read"}, headers=none).json()["error"]["code"] == "permission_required"
    # supplier contacts: creating one needs edit_supplier_contacts, a customer only manage_contacts
    assert e.c.post("/api/contacts", json={"role": "supplier", "name": "New Sup"}, headers=e.S).json()["error"]["code"] == "permission_required"
    assert e.c.post("/api/contacts", json={"role": "customer", "name": "New Cust"}, headers=e.S).status_code == 201
    sup = role(e, "Suppliers", ["manage_contacts", "edit_supplier_contacts"])
    assert e.c.post("/api/contacts", json={"role": "supplier", "name": "New Sup"}, headers=member(e, sup, "Sup")).status_code == 201


def test_line_price_edit_needs_upload_documents_and_view_costs(env):
    e = env
    e.ai.payload = {"doc_no": "P-1", "issued_on": "2026-01-02", "lines": [{"description": "pla", "qty": 1, "uom": "kg", "unit_price": 40, "amount": 40}]}
    doc = e.c.post("/api/documents/ingest", data={"text": "p1", "supplier": "Acme"}, headers=e.S).json()["id"]
    ln = e.c.get(f"/api/documents/{doc}", headers=e.S).json()["lines"][0]["id"]
    url = f"/api/documents/{doc}/lines/{ln}"
    docs_only = member(e, role(e, "Docs", ["upload_documents"]), "Docs")
    both = member(e, role(e, "Docs costs", ["upload_documents", "view_costs"]), "DocsCosts")
    costs_only = member(e, role(e, "Costs", ["view_costs"]), "Costs")
    assert e.c.post(url, json={"qty": 2}, headers=member(e, role(e, "Nothing", []), "N")).status_code == 403
    assert e.c.post(url, json={"qty": 2}, headers=costs_only).status_code == 403
    assert e.c.post(url, json={"unit_price": 1}, headers=docs_only).status_code == 403
    assert e.c.post(url, json={"qty": 2}, headers=docs_only).status_code == 200
    assert e.c.post(url, json={"unit_price": 41}, headers=both).status_code == 200


def test_margin_report_scrubs_margin_keys_without_view_costs(env):
    e = env
    e.shock()
    report = member(e, role(e, "Reports", ["view_reports"]), "Reports")
    r = e.c.get("/api/reports/margin", headers=report)
    assert r.status_code == 200 and not keys(r.json()) & ({"lowest_margin", "stale_quotes"} | STAFF_HIDE)
    full = e.c.get("/api/reports/margin", headers=member(e, role(e, "Reports costs", ["view_reports", "view_costs"]), "RC")).json()
    assert {"lowest_margin", "stale_quotes", "margin", "cost"} <= full.keys()
    assert e.c.get("/api/reports/margin", headers=member(e, role(e, "Nothing", []), "N")).status_code == 403


def test_a_role_with_no_permissions_sees_no_cost_or_margin_anywhere(env, monkeypatch):
    e = env
    e.shock()
    qid = seed_quote(e)
    inbound = e.sql("select id from documents where direction='in' limit 1")[0]["id"]
    supplier = e.sql("select id from parties where role='supplier' limit 1")[0]["id"]
    sup = setup(e, monkeypatch)
    e.ai.payload = {"unit_price": 4.5, "min_qty": 100, "tiers": [], "currency": "MYR"}
    ask(e, [sup["A"]])
    assert reply_in(e, "RM4.50 each, MOQ 100").status_code == 200
    assert listing(e)[0]["replies"][0]["unit_price"] is not None  # the owner does see it
    who = member(e, role(e, "Nothing", []))
    pages = {}
    for u in ("/api/tracker", f"/api/documents/{qid}", f"/api/documents/{inbound}", "/api/contacts", f"/api/contacts/{supplier}",
              "/api/dashboard", "/api/search?q=acrylic", "/api/search?q=SAMPLE", "/api/rfq", "/api/jobs", "/api/fields", "/api/me"):
        r = e.c.get(u, headers=who)
        assert r.status_code == 200, (u, r.status_code)
        pages[u] = r.json()
    for u, p in pages.items():
        assert not keys(p) & (STAFF_HIDE | {"lowest_margin", "cost_items", "current_costs", "provenance"}), (u, keys(p) & STAFF_HIDE)
    assert all(x["unit_price"] is None and x["text"] == "" for i in pages["/api/rfq"] for x in i["replies"])
    def numbers(o):  # every standalone numeric value, plus numeric strings, anywhere in the JSON
        if isinstance(o, dict):
            o = list(o.values())
        if isinstance(o, list):
            return [n for v in o for n in numbers(v)]
        try:
            return [float(o)] if o is not None and not isinstance(o, bool) else []
        except ValueError:
            return []
    assert 4.5 not in numbers(pages["/api/rfq"]) and pages[f"/api/documents/{inbound}"]["doc"]["total"] is None
    assert "stale_quotes" not in pages["/api/dashboard"] and "followups_pending" not in pages["/api/dashboard"]
    for u in ("/api/audit", "/api/followups", "/api/reports/margin", "/api/cost-items", "/api/alerts/stale-costs",
              "/api/export/contacts.csv", f"/api/export/po.csv?quote_id={qid}", "/api/roles", "/api/users", "/api/invites"):
        assert e.c.get(u, headers=who).status_code == 403, u
    e.ai.fail = True  # the model is "down": the keyword fallback picks the intent
    a = e.c.post("/api/assistant", json={"message": "what is the margin report for the last week"}, headers=who).json()
    assert a["items"] == [] and "only the owner" in a["reply"]
    f = e.c.post("/api/assistant", json={"message": "which quotes need a follow up"}, headers=who).json()
    assert f["items"] == []


def test_scheduler_status_is_a_read_route_for_owners_only(env, monkeypatch):
    e = env
    monkeypatch.delenv("SCHEDULER", raising=False)
    r = e.c.get("/api/system/scheduler", headers=e.O)
    assert r.status_code == 200 and r.json().keys() == {"enabled", "last_run", "ok", "errors", "last_error"} and r.json()["enabled"] is False
    monkeypatch.setenv("SCHEDULER", "1")
    assert e.c.get("/api/system/scheduler", headers=e.O).json()["enabled"] is True
    for who in (e.S, member(e, role(e, "Nothing", []))):
        r = e.c.get("/api/system/scheduler", headers=who)
        assert r.status_code == 403 and r.json()["error"]["code"] == "owner_only"
