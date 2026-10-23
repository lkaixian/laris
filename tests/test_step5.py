"""Security step 5: staff write limits, webhook channel matching and replay, last-owner lock, create_token tenant guard."""
import hashlib
import hmac
import importlib.util
import json
import pathlib

import psycopg
import pytest

from src import db
from src.api import webhooks
from support.fixtures import env, pg_url  # noqa: F401

WA_SECRET, TG_SECRET = "wa-secret", "tg-secret"
JPEG = b"\xff\xd8\xff\xe0jpeg"


def wa_post(e, payload):
    raw = json.dumps(payload).encode()
    h = "sha256=" + hmac.new(WA_SECRET.encode(), raw, hashlib.sha256).hexdigest()
    return e.c.post("/webhooks/whatsapp", content=raw, headers={"X-Hub-Signature-256": h, "Content-Type": "application/json"})


def tg_post(e, chat, text="need 10 small parts", mid=5):
    upd = {"update_id": mid, "message": {"message_id": mid, "date": 1700000000, "chat": {"id": chat}, "text": text}}
    return e.c.post("/webhooks/telegram", json=upd, headers={"X-Telegram-Bot-Api-Secret-Token": TG_SECRET})


# ---------------------------------------------------------------- 1a. supplier contact details
def test_staff_cannot_edit_supplier_name_or_number_and_contact_changes_are_audited(env):
    e = env
    sup = e.sql("select id, contact from parties where role='supplier' limit 1")[0]
    cust = e.sql("select id from parties where role='customer' limit 1")[0]["id"]
    for body in ({"contact": "60100000000"}, {"name": "Renamed"}):
        r = e.c.post(f"/api/contacts/{sup['id']}", json=body, headers=e.S)
        assert r.status_code == 403 and r.json()["error"]["code"] == "owner_only"
    assert e.c.post(f"/api/contacts/{sup['id']}", json={"notes": "pays late"}, headers=e.S).status_code == 200  # other fields stay open
    assert e.sql("select contact from parties where id=%s", (sup["id"],))[0]["contact"] == sup["contact"]
    assert e.c.post(f"/api/contacts/{sup['id']}", json={"contact": "60100000000"}, headers=e.O).status_code == 200
    old = e.sql("select contact from parties where id=%s", (cust,))[0]["contact"]
    assert e.c.post(f"/api/contacts/{cust}", json={"contact": "60199999999"}, headers=e.S).status_code == 200
    row = e.sql("select before, after from audit_log where entity='parties' and entity_id=%s order by id desc limit 1", (cust,))[0]
    assert row["before"] == {"contact": old} and row["after"] == {"contact": "60199999999"}


# ---------------------------------------------------------------- 1b. per-user limits
def test_rfq_is_limited_per_user(env):
    e = env
    ask = lambda who: e.c.post("/api/rfq", headers=who, files={"image": ("i.jpg", JPEG, "image/jpeg")},
                               data={"description": "x", "supplier_ids": ["00000000-0000-0000-0000-000000000001"]})
    codes = [ask(e.S).status_code for _ in range(11)]
    assert 429 not in codes[:10] and codes[10] == 429
    assert ask(e.O).status_code != 429  # another user has their own allowance
    assert ask(e.S).json()["error"]["code"] == "slow_down"


def test_simulate_and_ingest_share_one_allowance(env):
    e = env
    for i in range(15):
        assert e.c.post("/api/enquiries/simulate", json={"channel": "web", "text": f"t{i}"}, headers=e.S).status_code != 429
        assert e.c.post("/api/documents/ingest", data={"text": f"doc {i}"}, headers=e.S).status_code != 429
    r = e.c.post("/api/documents/ingest", data={"text": "one more"}, headers=e.S)
    assert r.status_code == 429 and r.json()["error"]["code"] == "slow_down"
    assert e.c.post("/api/enquiries/simulate", json={"channel": "web", "text": "x"}, headers=e.S).status_code == 429
    assert e.c.post("/api/documents/ingest", data={"text": "owner doc"}, headers=e.O).status_code != 429


# ---------------------------------------------------------------- 1c. supplier price edits
def test_staff_price_edit_is_audited_with_old_and_new_and_only_the_owner_sees_it(env):
    e = env
    e.ai.payload = {"doc_no": "P-1", "issued_on": "2026-01-02", "lines": [{"description": "pla", "qty": 1, "uom": "kg", "unit_price": 40, "amount": 40}]}
    doc = e.c.post("/api/documents/ingest", data={"text": "p1", "supplier": "Acme"}, headers=e.S).json()["id"]
    ln = e.c.get(f"/api/documents/{doc}", headers=e.S).json()["lines"][0]
    last = e.c.get("/api/audit", headers=e.O).json()[-1]["id"]
    url = f"/api/documents/{doc}/lines/{ln['id']}"
    assert e.c.post(url, json={"unit_price": "45.50"}, headers=e.S).status_code == 403  # step 105: a price edit needs view_costs; the owner has it
    assert e.c.post(url, json={"unit_price": "45.50"}, headers=e.O).status_code == 200
    ev = [x["event"] for x in e.c.get(f"/api/audit?after={last}", headers=e.O).json() if x["entity"] == "document_lines"]
    assert len(ev) == 1 and "unit_price" in ev[0] and "40" in ev[0] and "45.5" in ev[0]
    row = e.sql("select before, after from audit_log where entity='document_lines' and entity_id=%s", (ln["id"],))[0]
    assert (row["before"]["unit_price"], row["after"]["unit_price"]) == ("40.0000", "45.5000")
    sv = [x["event"] for x in e.c.get(f"/api/audit?after={last}", headers=e.S).json() if x["entity"] == "document_lines"]
    assert sv == ["review edit: unit_price"]  # staff feed: no supplier prices


# ---------------------------------------------------------------- 2. webhooks
def test_whatsapp_verify_refuses_when_token_unset(env, monkeypatch):
    e = env
    monkeypatch.delenv("WHATSAPP_VERIFY_TOKEN", raising=False)
    for tok in ("\0unset", "", "x"):
        r = e.c.get("/webhooks/whatsapp", params={"hub.mode": "subscribe", "hub.verify_token": tok, "hub.challenge": "1"})
        assert r.status_code == 403
    monkeypatch.setenv("WHATSAPP_VERIFY_TOKEN", "")
    assert e.c.get("/webhooks/whatsapp", params={"hub.mode": "subscribe", "hub.verify_token": "", "hub.challenge": "1"}).status_code == 403


def test_staff_handle_matches_only_its_own_channel(env, monkeypatch):
    e = env
    monkeypatch.setenv("TELEGRAM_WEBHOOK_SECRET", TG_SECRET)
    e.stock_costs()
    e.ai.payload = {"items": [{"item_key": "print_part_small", "qty": 10}]}
    e.sql("update users set channel_handle='+60 12-999 0001' where role='staff'")
    assert tg_post(e, 60129990001).status_code == 200  # a Telegram chat id that looks like the staff phone
    assert e.sql("select count(*) n from enquiries")[0]["n"] == 1  # a customer enquiry, not a staff supplier document
    e.sql("update users set channel_handle='tg:777' where role='staff'")
    e.ai.payload = {"supplier_name": "Fwd Co", "doc_no": "TG-1", "issued_on": "2026-01-02",
                    "lines": [{"description": "ply", "qty": 1, "uom": "sheet", "unit_price": 40, "amount": 40}]}
    assert tg_post(e, 777, "quote TG-1 ...", mid=6).status_code == 200
    assert e.sql("select count(*) n from documents where doc_no='TG-1'")[0]["n"] == 1  # `tg:<chat id>` is a staff handle on Telegram
    monkeypatch.setenv("WHATSAPP_APP_SECRET", WA_SECRET)
    msg = {"entry": [{"changes": [{"value": {"messages": [{"id": "wamid.x", "from": "777", "timestamp": "1", "type": "text", "text": {"body": "hi"}}]}}]}]}
    assert wa_post(e, msg).status_code == 200
    assert e.sql("select count(*) n from documents where doc_no='TG-1'")[0]["n"] == 1  # a tg: handle is no phone number on WhatsApp


def test_messages_unique_index_is_dedupe_safe_and_a_raced_replay_is_a_duplicate(env, pg_url, monkeypatch):
    e = env
    ins = "insert into messages(document_id, direction, channel, body, external_id) select id, 'in', 'telegram', 'x', 'dup-1' from documents limit 1"
    e.sql(ins)
    with pytest.raises(psycopg.errors.UniqueViolation):
        e.sql(ins)
    # old data with duplicates: startup must not abort; the index waits (NOTICE) until they are removed
    with psycopg.connect(pg_url, autocommit=True) as c:  # DDL needs the schema owner, not laris_app
        c.execute("drop index messages_channel_external_uq")
    e.sql(ins)
    db.apply_schema(seed=False)
    assert not e.sql("select 1 from pg_indexes where indexname='messages_channel_external_uq'")
    e.sql("delete from messages where id = (select id from messages where external_id='dup-1' limit 1)")
    db.apply_schema(seed=False)
    assert e.sql("select 1 from pg_indexes where indexname='messages_channel_external_uq'")

    # a replay that passes the pre-check and then hits the index is dropped quietly (no reply, no error)
    def raced(*a, **k):
        raise psycopg.errors.UniqueViolation("duplicate key")
    monkeypatch.setenv("TELEGRAM_WEBHOOK_SECRET", TG_SECRET)
    monkeypatch.setattr(webhooks, "_handle", raced)
    assert tg_post(e, 4242).status_code == 200 and e.svc.sent == []


# ---------------------------------------------------------------- 3. last owner
def test_last_owner_check_runs_after_owner_rows_are_locked(env, monkeypatch):
    """Sequential: PGlite has one session, so this asserts the order of statements (lock, then check), not a true race."""
    e = env
    seen = []
    real = psycopg.Connection.execute

    def spy(self, q, *a, **k):
        seen.append(q if isinstance(q, str) else str(q))
        return real(self, q, *a, **k)
    monkeypatch.setattr(psycopg.Connection, "execute", spy)
    r = e.c.post(f"/api/users/{e.owner}", json={"role": "staff"}, headers=e.O)
    assert r.status_code == 409 and r.json()["error"]["code"] == "last_owner"
    lock = [i for i, q in enumerate(seen) if "role='owner'" in q and "for update" in q]
    assert lock and not any("update users set" in q for q in seen)
    assert all(lock[0] < i for i, q in enumerate(seen) if "from users where id=%s and tenant_id=%s for update" in q)  # locks first, then the target
    # with a second owner the same demotion goes through, and then the new last owner is protected
    other = e.sql("insert into users(tenant_id,name,role) select tenant_id,'Second','owner' from users where id=%s returning id", (e.owner,))[0]["id"]
    assert e.c.post(f"/api/users/{e.owner}", json={"active": False}, headers=e.O).status_code == 200
    O2 = {"X-Role": "owner", "X-User": str(other)}
    assert e.c.post(f"/api/users/{other}", json={"role": "staff"}, headers=O2).json()["error"]["code"] == "last_owner"


# ---------------------------------------------------------------- 4. create_token
def test_account_refuses_a_user_of_another_tenant_when_several_exist(env, monkeypatch):
    e = env
    spec = importlib.util.spec_from_file_location("create_token", pathlib.Path(__file__).resolve().parent.parent / "scripts" / "create_token.py")
    ct = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(ct)
    monkeypatch.setattr(ct.getpass, "getpass", lambda _: "new account pw 1")
    mine = str(e.sql("select tenant_id from users where id=%s", (e.staff,))[0]["tenant_id"])
    e.sql("insert into tenants(name, trade_template, min_margin_pct) values ('Other Shop','made_to_order',20)")
    for args in (["account", e.staff, "aisyah9"], ["account", e.staff, "aisyah9", "--tenant", "00000000-0000-0000-0000-000000000000"]):
        with pytest.raises(SystemExit) as x:
            ct.main(args)
        assert "--tenant" in str(x.value)
    assert e.sql("select username from users where id=%s", (e.staff,))[0]["username"] != "aisyah9"
    ct.main(["account", e.staff, "aisyah9", "--tenant", mine])
    assert e.sql("select username from users where id=%s", (e.staff,))[0]["username"] == "aisyah9"
