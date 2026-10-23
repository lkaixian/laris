"""Security step 104: an inbound chat message is tied to ONE business or dropped. Never the alphabetically first tenant."""
import logging

import pytest

from src import db
from src.api import listings, webhooks
from src.errors import ApiError
from support.fixtures import env, pg_url  # noqa: F401
from test_api import PART, WA_SECRET, wa_msg, wa_post
from test_listings import lenv, photo  # noqa: F401
from test_rfq import SA, TG_SECRET, tg_in, tg_setup

VICTIM = "60111222333"  # the sender wa_msg() uses


@pytest.fixture
def two(env, monkeypatch):
    """Tenant ATT ('00 Attacker', alphabetically first) beside the seeded business (B, with a cost book and its own number PN_B)."""
    e = env
    monkeypatch.setenv("WHATSAPP_APP_SECRET", WA_SECRET)
    monkeypatch.setenv("TELEGRAM_WEBHOOK_SECRET", TG_SECRET)
    for k in ("WHATSAPP_TENANT_ID", "TELEGRAM_TENANT_ID"):
        monkeypatch.delenv(k, raising=False)
    e.stock_costs()
    e.b = str(e.sql("select id from tenants")[0]["id"])
    e.att = str(e.sql("insert into tenants(name, trade_template, min_margin_pct) values ('00 Attacker','made_to_order',20) returning id")[0]["id"])
    e.sql("update tenants set wa_phone_number_id='PN_B' where id=%s", (e.b,))
    e.ai.payload = {"items": [PART]}
    return e


def wa(e, sender=VICTIM, to=None, mid="wamid.t1", text="10 small parts"):
    m = wa_msg(id=mid, type="text", text={"body": text})
    m["entry"][0]["changes"][0]["value"]["messages"][0]["from"] = sender
    if to:
        m["entry"][0]["changes"][0]["value"]["metadata"] = {"phone_number_id": to}
    return wa_post(e, m)


def counts(e):
    return [e.sql(f"select count(*) n from {t}")[0]["n"] for t in ("messages", "enquiries", "parties", "documents")] + [len(e.svc.sent), e.ai.calls]


def test_unknown_sender_without_mapping_is_dropped_not_given_to_the_first_tenant(two, caplog):
    e = two
    e.sql("update tenants set wa_phone_number_id=null")  # nothing mapped, two businesses, nothing in env
    before = counts(e)
    with caplog.at_level(logging.WARNING, logger="laris"):
        assert wa(e).status_code == 200  # 200 so Meta does not retry
    assert counts(e) == before  # nothing stored, no reply, no model call
    log = [r.getMessage() for r in caplog.records if "dropped" in r.getMessage()]
    assert len(log) == 1 and "unknown_sender" in log[0] and VICTIM not in log[0] and "10 small parts" not in log[0]
    assert webhooks._h(VICTIM) in log[0]


def test_attacker_supplier_contact_does_not_capture_a_message_for_another_business(two):
    e = two
    e.sql("insert into parties(tenant_id,role,name,contact) values (%s,'supplier','Evil Supplier',%s)", (e.att, VICTIM))
    assert wa(e, to="PN_B").status_code == 200
    assert e.sql("select count(*) n from enquiries where tenant_id=%s", (e.b,))[0]["n"] == 1  # a customer enquiry of business B
    assert e.sql("select count(*) n from documents where tenant_id=%s", (e.att,))[0]["n"] == 0
    assert e.sql("select count(*) n from enquiries where tenant_id=%s", (e.att,))[0]["n"] == 0
    assert e.sql("select tenant_id::text t from parties where role='customer' and contact=%s", (VICTIM,)) == [{"t": e.b}]
    assert e.svc.via[-1] == "PN_B"


def test_same_number_in_two_businesses_without_mapping_is_dropped(two):
    e = two
    e.sql("update tenants set wa_phone_number_id=null")
    e.sql("insert into parties(tenant_id,role,name,contact) values (%s,'supplier','Evil Supplier',%s)", (e.att, VICTIM))
    e.sql("insert into parties(tenant_id,role,name,contact) values (%s,'customer','Real Customer',%s)", (e.b, VICTIM))
    before = counts(e)
    assert wa(e).status_code == 200
    assert counts(e) == before


def test_staff_handle_collision_across_businesses_is_dropped(two):
    e = two
    e.sql("update tenants set wa_phone_number_id=null")
    e.sql("insert into users(tenant_id,name,role,channel_handle) values (%s,'Evil Staff','staff',%s)", (e.att, VICTIM))
    e.sql("update users set channel_handle=%s where id=%s", (VICTIM, e.staff))
    before = counts(e)
    assert wa(e).status_code == 200
    assert counts(e) == before


def test_unique_sender_match_still_routes_when_nothing_is_mapped(two):
    e = two
    e.sql("update tenants set wa_phone_number_id=null")
    e.ai.payload = {"supplier_name": "SAMPLE Supplier A Acrylic Sdn Bhd", "doc_no": "QA-1", "issued_on": "2026-01-01",
                    "lines": [{"description": "acrylic", "qty": 1, "uom": "sheet", "unit_price": 10, "amount": 10}]}
    d = e.sql("select count(*) n from documents where tenant_id=%s", (e.b,))[0]["n"]
    assert wa(e, sender=SA, text="quote QA-1 acrylic 1 sheet 10").status_code == 200  # seeded supplier A exists in B only
    assert e.sql("select count(*) n from documents where tenant_id=%s", (e.b,))[0]["n"] == d + 1


def test_unmapped_number_is_dropped_and_resolution_order(two, monkeypatch):
    e = two
    before = counts(e)
    assert wa(e, to="PN_NOBODY").status_code == 200 and counts(e) == before
    # env fallback names the business for an unmapped-number-free install
    e.sql("update tenants set wa_phone_number_id=null")
    monkeypatch.setenv("WHATSAPP_TENANT_ID", e.b)
    assert wa(e, mid="wamid.t2").status_code == 200
    assert e.sql("select count(*) n from enquiries where tenant_id=%s", (e.b,))[0]["n"] == 1


def test_resolve_tenant_unit(two, monkeypatch):
    from src.channels.base import InboundMessage
    e = two
    b = e.sql("select id from tenants where wa_phone_number_id='PN_B'")[0]["id"]
    with db.tx("staff", "t") as c:
        m = InboundMessage("whatsapp", "x", VICTIM, to="PN_B")
        assert webhooks.resolve_tenant(c, m, VICTIM) == (b, None)
        assert webhooks.resolve_tenant(c, InboundMessage("whatsapp", "x", VICTIM, to="PN_X"), VICTIM) == (None, "unmapped_number")
        assert webhooks.resolve_tenant(c, InboundMessage("telegram", "x", "77"), "77") == (None, "unknown_sender")
        monkeypatch.setenv("TELEGRAM_TENANT_ID", e.att)
        assert str(webhooks.resolve_tenant(c, InboundMessage("telegram", "x", "77"), "77")[0]) == e.att


def test_telegram_needs_tenant_env_when_several_businesses(two, monkeypatch):
    e = two
    monkeypatch.setenv("TELEGRAM_BOT_TOKEN", "123:T")
    before = counts(e)
    assert tg_in(e, "10 small parts", chat=4242).status_code == 200
    assert counts(e) == before  # two businesses, no TELEGRAM_TENANT_ID: dropped
    monkeypatch.setenv("TELEGRAM_TENANT_ID", e.b)
    assert tg_in(e, "10 small parts", chat=4242, mid=2).status_code == 200
    assert e.sql("select count(*) n from enquiries where tenant_id=%s", (e.b,))[0]["n"] == 1
    assert e.sql("select count(*) n from enquiries where tenant_id=%s", (e.att,))[0]["n"] == 0


def test_telegram_single_business_needs_no_env(env, monkeypatch):
    e = env
    monkeypatch.setenv("TELEGRAM_WEBHOOK_SECRET", TG_SECRET)
    monkeypatch.delenv("TELEGRAM_TENANT_ID", raising=False)
    e.stock_costs()
    e.ai.payload = {"items": [PART]}
    assert tg_in(e, "10 small parts", chat=4242).status_code == 200
    assert e.sql("select count(*) n from enquiries")[0]["n"] == 1


# ---------------------------------------------------------------- Settings > Channels
def test_channel_settings_owner_only_unique_and_audited(two, monkeypatch):
    e = two
    g = e.c.get("/api/settings/channels", headers=e.O)
    assert g.status_code == 200 and g.json() == {"wa_phone_number_id": "PN_B", "whatsapp_mapped": True, "telegram_mapped": False, "tenants_total_hint": True}
    assert e.c.get("/api/settings/channels", headers=e.S).status_code == 403
    assert e.c.post("/api/settings/channels", json={"wa_phone_number_id": "123456"}, headers=e.S).status_code == 403
    for bad in ("12", "12ab56", "1" * 33, 123456, ""):
        assert e.c.post("/api/settings/channels", json={"wa_phone_number_id": bad}, headers=e.O).status_code == 422, bad
    assert e.c.post("/api/settings/channels", json={}, headers=e.O).status_code == 422
    r = e.c.post("/api/settings/channels", json={"wa_phone_number_id": "123456789"}, headers=e.O)
    assert r.status_code == 200 and r.json()["wa_phone_number_id"] == "123456789"
    a = e.sql("select actor::text a, before, after from audit_log where event='channel settings changed'")
    assert a == [{"a": e.owner, "before": {"wa_phone_number_id": "PN_B"}, "after": {"wa_phone_number_id": "123456789"}}]
    # another business cannot take the same number, and is not told who has it
    att = {"X-Role": "owner", "X-User": str(e.sql("insert into users(tenant_id,name,role) values (%s,'Att Owner','owner') returning id", (e.att,))[0]["id"])}
    d = e.c.post("/api/settings/channels", json={"wa_phone_number_id": "123456789"}, headers=att)
    assert d.status_code == 409 and d.json()["error"]["code"] == "number_in_use" and "Shop" not in d.text and e.b not in d.text
    assert e.c.post("/api/settings/channels", json={"wa_phone_number_id": "987654321"}, headers=att).status_code == 200  # the request survived the refusal
    # clearing, and the env-based flags
    monkeypatch.setenv("TELEGRAM_TENANT_ID", e.b)
    c = e.c.post("/api/settings/channels", json={"wa_phone_number_id": None}, headers=e.O).json()
    assert c == {"wa_phone_number_id": None, "whatsapp_mapped": False, "telegram_mapped": True, "tenants_total_hint": True}
    assert "token" not in e.c.get("/api/settings/channels", headers=e.O).text.lower()


def test_channel_settings_hint_is_false_for_a_single_business(env):
    assert env.c.get("/api/settings/channels", headers=env.O).json()["tenants_total_hint"] is False


def test_apply_schema_twice(env):
    db.apply_schema(seed=False)
    db.apply_schema(seed=False)


# ---------------------------------------------------------------- licence + cost control
def test_licence_blocked_business_only_stores_the_raw_message(two, monkeypatch):
    e = two
    monkeypatch.setattr(webhooks.lic, "configured", lambda: True)
    monkeypatch.setattr(webhooks.lic, "status", lambda conn, tid: {"read_only": True, "status": "missing"})
    calls, sent, docs = e.ai.calls, len(e.svc.sent), e.sql("select count(*) n from documents")[0]["n"]
    assert wa(e, to="PN_B").status_code == 200  # a customer
    e.ai.payload = {"supplier_name": "x", "lines": []}
    assert wa(e, sender=SA, to="PN_B", mid="wamid.t2", text="quote").status_code == 200  # a supplier
    assert e.ai.calls == calls and len(e.svc.sent) == sent
    assert e.sql("select count(*) n from documents")[0]["n"] == docs
    rows = e.sql("select e.status, m.body, m.direction::text d from messages m join enquiries e on e.id = m.enquiry_id order by m.body")
    assert rows == [{"status": "new", "body": "10 small parts", "d": "in"}, {"status": "new", "body": "quote", "d": "in"}]


def test_licence_block_is_logged(two, monkeypatch, caplog):
    e = two
    monkeypatch.setattr(webhooks.lic, "configured", lambda: True)
    monkeypatch.setattr(webhooks.lic, "status", lambda conn, tid: {"read_only": True})
    with caplog.at_level(logging.WARNING, logger="laris"):
        wa(e, to="PN_B")
    assert any("licence blocks inbound processing" in r.getMessage() for r in caplog.records)


def test_supplier_path_is_throttled_silently(env, monkeypatch):
    e = env
    assert webhooks.SENDER_LIMIT == 30
    monkeypatch.setattr(webhooks, "SENDER_LIMIT", 3)
    monkeypatch.setenv("WHATSAPP_APP_SECRET", WA_SECRET)
    e.ai.payload = {"supplier_name": "S", "lines": []}  # no lines: a rejection each time, but each one is counted
    for i in range(3):
        assert wa(e, sender=SA, mid=f"wamid.s{i}", text="quote please").status_code == 200
    assert len(e.svc.sent) == 3
    calls = e.ai.calls
    assert wa(e, sender=SA, mid="wamid.s9", text="quote please").status_code == 200
    assert len(e.svc.sent) == 3 and e.ai.calls == calls  # the 4th is dropped: no reply, no model call
    assert wa(e, sender="60999000111", mid="wamid.c1").status_code == 200  # another sender is not affected (unknown-customer path)


# ---------------------------------------------------------------- catalog photos from chat
def _catalog(e, monkeypatch, data, mime="image/jpeg", mid=7):
    tg_setup(e, monkeypatch)
    e.svc.media["P"] = (data, mime)
    return tg_in(e, "/catalog shoes", mid=mid, chat=5551, photo=[{"file_id": "P"}])


def test_catalog_sniffs_the_bytes_and_stores_the_real_mime(lenv, monkeypatch):
    e = lenv
    assert _catalog(e, monkeypatch, photo(fmt="PNG"), "image/jpeg").status_code == 200  # provider says jpeg, bytes are PNG
    assert e.sql("select image_mime m from listings") == [{"m": "image/png"}]


@pytest.mark.parametrize("data", [b"GIF89a" + b"0" * 100, b"<svg xmlns='http://www.w3.org/2000/svg'><script/></svg>", b"%PDF-1.4 x", b"RIFF1234WAVE"])
def test_catalog_refuses_a_spoofed_mime(lenv, monkeypatch, data):
    e = lenv
    assert _catalog(e, monkeypatch, data, "image/jpeg").status_code == 200
    assert e.sql("select count(*) n from listings")[0]["n"] == 0 and e.vis.calls == 0
    assert "could not process" in e.svc.sent[-1][2]


def test_catalog_caps_the_photo_at_8_mb(lenv, monkeypatch):
    e = lenv
    big = photo() + b"\0" * 8_000_000
    assert _catalog(e, monkeypatch, big).status_code == 200
    assert e.sql("select count(*) n from listings")[0]["n"] == 0 and e.vis.calls == 0
    with pytest.raises(ApiError) as x:
        listings.create_listing(None, None, None, big, "image/jpeg")
    assert (x.value.status, x.value.code) == (413, "too_large")
    with pytest.raises(ApiError):
        listings.create_listing(None, None, None, b"GIF89a", "image/jpeg")
