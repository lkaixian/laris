import csv
import hashlib
import hmac
import io
import json
import uuid
from decimal import Decimal

from openpyxl import load_workbook

from src import scheduler
from src.api.deps import STAFF_HIDE
from support.fixtures import env, pg_url  # noqa: F401

PNG = b"\x89PNG\r\n\x1a\nimg"
PART = {"item_key": "print_part_small", "qty": 10}
WA_SECRET, WA_VERIFY, TG_SECRET = "wa-secret", "wa-verify", "tg-secret"


def keys(x, acc=None):
    acc = set() if acc is None else acc
    if isinstance(x, dict):
        for k, v in x.items():
            acc.add(k)
            keys(v, acc)
    elif isinstance(x, list):
        for v in x:
            keys(v, acc)
    return acc


def seed_quote(e):
    return e.sql("select id from documents where direction='out'")[0]["id"]


def make_draft(e, **kw):
    e.stock_costs()
    r = e.enquire([PART], **kw)
    assert r.status_code == 201, r.text
    return r.json()["id"]


def tr(e, doc, to, who=None, **kw):
    return e.c.post(f"/api/documents/{doc}/transition", json={"to": to, **kw}, headers=who or e.O)


# ---------------------------------------------------------------- secrecy
def test_staff_never_sees_cost_or_margin(env):
    e = env
    e.shock()
    qid = seed_quote(e)
    e.sql("insert into tenant_fields(tenant_id,key,label,type,owner_only) select tenant_id,'internal_note','Note','text',true from users limit 1")
    e.sql("update document_lines set attrs = '{\"internal_note\":\"secret\"}' where document_id=%s", (qid,))
    pages = [e.c.get(u, headers=e.S).json() for u in ("/api/tracker", f"/api/documents/{qid}", "/api/fields", "/api/audit", "/api/me")]
    in_doc = e.sql("select id from documents where direction='in' limit 1")[0]["id"]
    pages.append(e.c.get(f"/api/documents/{in_doc}", headers=e.S).json())
    for p in pages:
        assert not (keys(p) & STAFF_HIDE), keys(p) & STAFF_HIDE
    assert "internal_note" not in json.dumps(pages)
    d = e.c.get(f"/api/documents/{qid}", headers=e.S).json()
    assert "provenance" not in d and d["doc"]["flags"] == {"needs_review": False}
    assert d["lines"][0]["unit_price"] == "60.0000"  # selling price is fine for staff
    old = e.c.get(f"/api/documents/{in_doc}", headers=e.S).json()  # supplier prices hidden once past review
    assert old["doc"]["total"] is None and all(l["unit_price"] is None for l in old["lines"])
    assert "cost_item" not in json.dumps(e.c.get("/api/audit", headers=e.S).json())
    for u in ("/api/alerts/stale-costs", "/api/cost-items", "/api/field-proposals",
              f"/api/export/bom.xlsx?quote_id={qid}", f"/api/export/po.csv?quote_id={qid}"):
        assert e.c.get(u, headers=e.S).status_code == 403, u
    # owner does see all of it
    o = e.c.get(f"/api/documents/{qid}", headers=e.O).json()
    assert {"provenance"} <= keys(o) and o["doc"]["flags"]["cost_is_stale"] is True
    assert "internal_note" in o["lines"][0]["attrs"]
    assert any(f["key"] == "internal_note" for f in e.c.get("/api/fields", headers=e.O).json())


def test_me_auth_and_errors(env):
    e = env
    me = e.c.get("/api/me", headers=e.O).json()
    assert me["role"] == "owner" and me["org"] == {"name": "SAMPLE Signage Works (synthetic)", "logo_url": None}
    assert e.c.get("/api/me").json()["role"] == "staff"  # default role
    r = e.c.post("/api/enquiries/simulate", json={"channel": "web", "text": "x"})
    assert r.status_code == 401 and r.json()["error"]["code"] == "no_user"
    assert e.c.get("/api/me", headers={"X-Role": "owner", "X-User": e.staff}).status_code == 403  # staff cannot claim owner
    assert e.c.get("/api/documents/00000000-0000-0000-0000-000000000000", headers=e.O).status_code == 404


def test_views_one_row_per_line(env):
    rows = env.sql("select * from v_quote_margin")  # 40 x (29 materials + 8.50 labour/machine) = 1500 of 2400
    assert len(rows) == 1 and rows[0]["line_cost"] == 1500 and rows[0]["line_margin"] == 900 and rows[0]["margin_pct"] == Decimal("37.50")


# ---------------------------------------------------------------- transitions + flow
def test_staff_cannot_approve_and_illegal_is_409(env):
    e = env
    d = make_draft(e)
    r = tr(e, d, "approved", e.S)
    assert r.status_code == 403
    assert tr(e, d, "sent", e.O).status_code == 409  # draft -> sent not allowed
    assert tr(e, d, "approved", e.O).status_code == 200
    assert e.sql("select status from documents where id=%s", (d,))[0]["status"] == "approved"


def test_owner_flow_with_audit_and_send(env, monkeypatch):
    e = env
    e.stock_costs()
    # customer enquiry arrives on telegram (customer = unknown chat id), draft is created by the pipeline
    monkeypatch.setenv("TELEGRAM_WEBHOOK_SECRET", TG_SECRET)
    e.ai.payload = {"items": [PART]}
    upd = {"update_id": 1, "message": {"message_id": 5, "date": 1700000000, "chat": {"id": 4242}, "text": "need 10 small parts"}}
    assert e.c.post("/webhooks/telegram", json=upd, headers={"X-Telegram-Bot-Api-Secret-Token": TG_SECRET}).status_code == 200
    assert e.svc.sent[0][:2] == ("telegram", "4242")
    draft = e.c.get("/api/tracker", headers=e.O).json()["sent"]
    d = next(x for x in draft if x["status"] == "draft")
    last = e.c.get("/api/audit", headers=e.O).json()[-1]["id"]
    assert tr(e, d["id"], "approved").status_code == 200
    assert tr(e, d["id"], "sent").json()["status"] == "sent"
    ev = e.c.get(f"/api/audit?after={last}", headers=e.O).json()
    assert [x["event"] for x in ev if x["entity"] == "documents"] == ["status draft->approved", "status approved->sent"]
    assert all(x["actor"] == "SAMPLE Owner" for x in ev)
    ch, to, body = e.svc.sent[-1]
    assert (ch, to) == ("telegram", "4242") and "Total: MYR 320.00" in body and "cost" not in body.lower()
    det = e.c.get(f"/api/documents/{d['id']}", headers=e.O).json()
    assert {m["direction"] for m in det["messages"]} == {"in", "out"}
    assert det["lines"][0]["unit_price"] == "32.0000" and det["provenance"][0]["supplier"].startswith("SAMPLE Supplier B")
    assert e.c.post(f"/api/documents/{d['id']}/transition", json={"to": "sent"}, headers=e.O).status_code == 409


def test_inbound_review_flow_and_line_rules(env):
    e = env
    e.ai.payload = {"supplier_name": "S", "doc_no": "X1", "issued_on": "2026-01-01",
                    "lines": [{"description": "mystery thing", "qty": 2, "uom": "pcs", "unit_price": 3, "amount": 6}]}
    doc = e.c.post("/api/documents/ingest", data={"text": "t"}, headers=e.S).json()
    assert doc["status"] == "parsed" and doc["flags"]["needs_review"] is True
    ln = e.c.get(f"/api/documents/{doc['id']}", headers=e.S).json()["lines"][0]
    assert ln["needs_review"] and ln["item_key"] is None
    url = f"/api/documents/{doc['id']}/lines/{ln['id']}"
    r = e.c.post(url, json={"item_key": "screw_m4", "unit_price": "3.5", "needs_review": False}, headers=e.S)
    assert r.status_code == 200 and r.json()["unit_price"] == "3.5000" and r.json()["item_key"] == "screw_m4"
    assert e.c.post(url, json={"price_source": "owner_override"}, headers=e.S).status_code == 422  # unknown key
    assert e.c.post(url, json={"qty": -1}, headers=e.S).status_code == 422
    assert tr(e, doc["id"], "reviewed", e.S).status_code == 200
    assert e.c.post(url, json={"qty": 3}, headers=e.S).status_code == 409  # locked after review
    assert tr(e, doc["id"], "accepted", e.S).status_code == 403
    assert tr(e, doc["id"], "accepted", e.O).status_code == 200
    # out line price is rules-only
    q = seed_quote(e)
    ql = e.sql("select id from document_lines where document_id=%s", (q,))[0]["id"]
    for who in (e.S, e.O):
        assert e.c.post(f"/api/documents/{q}/lines/{ql}", json={"unit_price": 1}, headers=who).status_code == 403


# ---------------------------------------------------------------- stale alerts
def test_stale_alert_shows_400_delta(env):
    e = env
    assert e.c.get("/api/alerts/stale-costs", headers=e.O).json() == []  # seed alone: nothing stale
    e.shock()
    a = e.c.get("/api/alerts/stale-costs", headers=e.O).json()
    assert len(a) == 1
    assert (a[0]["item_key"], a[0]["old_cost"], a[0]["current_cost"], a[0]["margin_delta"], a[0]["status"]) == \
        ("acrylic_3mm_sheet", "100.0000", "140.0000", "-400.0000", "sent")
    assert a[0]["quote_no"] == "SAMPLE-QT-0001" and a[0]["customer"].startswith("SAMPLE Customer")
    cost = e.c.get("/api/cost-items", headers=e.O).json()
    assert {c["item_key"]: c["unit_cost"] for c in cost}["acrylic_3mm_sheet"] == "140.0000"
    assert e.c.get("/api/tracker", headers=e.O).json()["sent"][0]["flags"]["cost_is_stale"] is True


# ---------------------------------------------------------------- pricing safety
def test_price_key_injection_and_ai_failure_create_nothing(env):
    e = env
    e.stock_costs()
    n = lambda: e.sql("select count(*) n from documents")[0]["n"]  # noqa: E731
    before = n()
    for bad in ({**PART, "unit_price": 1}, {**PART, "attrs": {"discount": 90}}, {**PART, "Price": 1}):
        r = e.enquire([bad])
        assert r.status_code == 422 and r.json()["error"]["code"] == "price_injection", r.text
    assert e.enquire([{"item_key": "no_such_recipe", "qty": 1}]).status_code == 422
    assert e.enquire([{"item_key": "plywood_shelf", "qty": 1}]).json()["error"]["code"] == "missing_cost"
    e.ai.fail = True
    r = e.enquire([PART])
    assert r.status_code == 502 and r.json()["error"]["code"] == "ilmu_unavailable"
    assert n() == before and e.sql("select count(*) n from enquiries")[0]["n"] == 0


def test_margin_guard_flags_line_and_basis_is_stored(env):
    e = env
    e.sql("update tenants set min_margin_pct = 60")
    d = make_draft(e)
    det = e.c.get(f"/api/documents/{d}", headers=e.O).json()
    assert det["lines"][0]["needs_review"] is True and det["doc"]["flags"]["needs_review"] is True
    assert len(det["provenance"]) == 2  # pla + box (machine hours have no cost_item)
    assert e.c.post(f"/api/documents/{d}/lines/{det['lines'][0]['id']}", json={"needs_review": False}, headers=e.S).status_code == 403
    assert e.c.post(f"/api/documents/{d}/lines/{det['lines'][0]['id']}", json={"needs_review": False}, headers=e.O).status_code == 200


# ---------------------------------------------------------------- webhooks
def wa_post(e, payload, secret=WA_SECRET, sig=None):
    raw = json.dumps(payload).encode()
    h = sig if sig is not None else "sha256=" + hmac.new(secret.encode(), raw, hashlib.sha256).hexdigest()
    return e.c.post("/webhooks/whatsapp", content=raw, headers={"X-Hub-Signature-256": h, "Content-Type": "application/json"})


def wa_msg(**m):
    return {"entry": [{"changes": [{"value": {"messages": [{"id": "wamid.in1", "from": "60111222333", "timestamp": "1700000000", **m}]}}]}]}


def test_whatsapp_signature_and_verify(env, monkeypatch):
    e = env
    e.ai.payload = {"items": [PART]}
    p = wa_msg(type="text", text={"body": "hi"})
    monkeypatch.setenv("WHATSAPP_APP_SECRET", WA_SECRET)
    monkeypatch.setenv("WHATSAPP_VERIFY_TOKEN", WA_VERIFY)
    before = e.sql("select count(*) n from messages")[0]["n"]
    assert wa_post(e, p, sig="sha256=" + "0" * 64).status_code == 403
    assert wa_post(e, p, secret="wrong").status_code == 403
    assert e.c.post("/webhooks/whatsapp", json=p).status_code == 403  # no header
    assert e.ai.calls == 0 and e.sql("select count(*) n from messages")[0]["n"] == before  # nothing parsed or stored
    monkeypatch.delenv("WHATSAPP_APP_SECRET")
    assert wa_post(e, p).status_code == 403  # fail closed when no secret configured
    ok = e.c.get("/webhooks/whatsapp", params={"hub.mode": "subscribe", "hub.verify_token": WA_VERIFY, "hub.challenge": "777"})
    assert ok.status_code == 200 and ok.text == "777"
    assert e.c.get("/webhooks/whatsapp", params={"hub.mode": "subscribe", "hub.verify_token": "x", "hub.challenge": "1"}).status_code == 403
    monkeypatch.delenv("TELEGRAM_WEBHOOK_SECRET", raising=False)
    assert e.c.post("/webhooks/telegram", json={}, headers={"X-Telegram-Bot-Api-Secret-Token": ""}).status_code == 403
    monkeypatch.setenv("TELEGRAM_WEBHOOK_SECRET", TG_SECRET)
    assert e.c.post("/webhooks/telegram", json={}, headers={"X-Telegram-Bot-Api-Secret-Token": "nope"}).status_code == 403


def test_whatsapp_routing_dedupe_and_read_receipt(env, monkeypatch):
    e = env
    monkeypatch.setenv("WHATSAPP_APP_SECRET", WA_SECRET)
    e.stock_costs()
    e.sql("update parties set contact='+60 11-1222 333' where role='customer'")  # known customer by digits
    # voice note from the customer -> transcript -> draft
    e.svc.media["M1"] = (b"audio", "audio/ogg")
    monkeypatch.setattr("src.pipeline.ilmu.transcribe", lambda *a, **k: "ten small parts please")
    e.ai.payload = {"items": [PART]}
    assert wa_post(e, wa_msg(type="audio", audio={"id": "M1"})).status_code == 200
    assert wa_post(e, wa_msg(type="audio", audio={"id": "M1"})).status_code == 200  # provider retry
    drafts = [d for d in e.c.get("/api/tracker", headers=e.O).json()["sent"] if d["status"] == "draft"]
    assert len(drafts) == 1 and drafts[0]["party"]["name"].startswith("SAMPLE Customer")
    # send it, then the read receipt marks it read
    d = drafts[0]["id"]
    tr(e, d, "approved")
    tr(e, d, "sent")
    wamid = e.sql("select external_id from messages where document_id=%s and direction='out'", (d,))[0]["external_id"]
    st = {"entry": [{"changes": [{"value": {"statuses": [{"id": wamid, "status": "read", "timestamp": "1700000100"}]}}]}]}
    assert wa_post(e, st).status_code == 200
    row = e.sql("select status, read_at from documents where id=%s", (d,))[0]
    assert row["status"] == "read" and row["read_at"] is not None
    # supplier text -> inbound document in the received lane
    e.sql("update parties set contact='+60-000-0000001' where name like 'SAMPLE Supplier A%%'")
    e.ai.payload = {"doc_no": "A-9", "issued_on": "2026-01-02", "lines": [
        {"description": "plywood 12mm", "qty": 1, "uom": "sheet", "unit_price": 40, "amount": 40}]}
    assert wa_post(e, {"entry": [{"changes": [{"value": {"messages": [
        {"id": "wamid.in2", "from": "600000000001", "timestamp": "1", "type": "text", "text": {"body": "quote A-9 ..."}}]}}]}]}).status_code == 200
    rec = e.c.get("/api/tracker", headers=e.O).json()["received"]
    assert any(x["doc_no"] == "A-9" and x["status"] == "parsed" for x in rec)


# ---------------------------------------------------------------- dynamic fields
def test_field_proposal_approve_flow(env):
    e = env
    e.ai.payload = {"doc_no": "F-1", "issued_on": "2026-01-02", "lines": [
        {"description": "pla black", "qty": 1, "uom": "kg", "unit_price": 5, "amount": 5, "Colour Code": "RAL 9005"}]}
    doc = e.c.post("/api/documents/ingest", data={"text": "t", "supplier": "Acme"}, headers=e.S).json()["id"]
    line = e.c.get(f"/api/documents/{doc}", headers=e.O).json()["lines"][0]
    assert line["attrs_unmapped"] == {"colour_code": "RAL 9005"} and line["attrs"] == {}
    assert e.c.get(f"/api/documents/{doc}", headers=e.S).json()["lines"][0]["attrs_unmapped"] == {}  # staff: owner-only
    assert e.c.get("/api/field-proposals", headers=e.S).status_code == 403
    props = e.c.get("/api/field-proposals", headers=e.O).json()
    assert [(p["key"], p["status"], p["sample_values"]) for p in props] == [("colour_code", "pending", ["RAL 9005"])]
    assert e.c.post(f"/api/field-proposals/{props[0]['id']}/decide", json={"decision": "approve"}, headers=e.S).status_code == 403
    last = e.c.get("/api/audit", headers=e.O).json()[-1]["id"]
    r = e.c.post(f"/api/field-proposals/{props[0]['id']}/decide", json={"decision": "approve", "type": "text", "label": "Colour code"}, headers=e.O)
    assert r.status_code == 200 and r.json()["status"] == "approved"
    assert any(f["key"] == "colour_code" and f["label"] == "Colour code" for f in e.c.get("/api/fields", headers=e.S).json())
    line = e.c.get(f"/api/documents/{doc}", headers=e.S).json()["lines"][0]
    assert line["attrs"] == {"colour_code": "RAL 9005"} and line["attrs_unmapped"] == {}
    assert any("field approve" in x["event"] for x in e.c.get(f"/api/audit?after={last}", headers=e.O).json())
    assert e.c.post(f"/api/field-proposals/{props[0]['id']}/decide", json={"decision": "ignore"}, headers=e.O).status_code == 409


# ---------------------------------------------------------------- extraction edge cases
def test_ingest_ocr_confidence_and_failures(env):
    e = env

    class Ocr:
        def ocr_image(self, b):
            return [{"text": "x", "conf": 0.5, "bbox": [0, 0, 5, 5]}, {"text": "y", "conf": 0.6, "bbox": [9, 0, 12, 5]}]

        def pdf_text(self, b):
            return ""
    e.svc.ocr = Ocr()
    e.ai.payload = {"doc_no": "O-1", "issued_on": "2026-01-02", "lines": [
        {"description": "pla black", "qty": 1, "uom": "kg", "unit_price": 5, "amount": 5}]}
    r = e.c.post("/api/documents/ingest", files={"file": ("a.png", PNG, "image/png")}, headers=e.S)
    assert r.status_code == 201
    ln = e.c.get(f"/api/documents/{r.json()['id']}", headers=e.O).json()["lines"][0]
    assert ln["needs_review"] and ln["ocr_confidence"] == "0.550"
    n = e.sql("select count(*) n from documents")[0]["n"]
    assert e.c.post("/api/documents/ingest", files={"file": ("a.pdf", b"%PDF", "application/pdf")}, headers=e.S).json()["error"]["code"] == "scanned_pdf"
    e.ai.fail = True
    assert e.c.post("/api/documents/ingest", data={"text": "t"}, headers=e.S).status_code == 502
    assert e.sql("select count(*) n from documents")[0]["n"] == n


# ---------------------------------------------------------------- exports
def test_exports(env):
    e = env
    q = seed_quote(e)
    r = e.c.get(f"/api/export/bom.xlsx?quote_id={q}", headers=e.O)
    assert r.status_code == 200 and r.content[:2] == b"PK"
    ws = load_workbook(io.BytesIO(r.content)).active
    rows = list(ws.iter_rows(values_only=True))
    assert rows[0][3] == "Material"
    ac = next(x for x in rows if x[3] == "acrylic_3mm_sheet")
    assert (ac[4], ac[8], ac[9]) == (10, 100, 1000)  # 40 boards x 0.25 sheet at the frozen RM100
    assert rows[-1][-1] == 1160
    po = list(csv.DictReader(io.StringIO(e.c.get(f"/api/export/po.csv?quote_id={q}", headers=e.O).text)))
    assert {(x["item_key"], x["qty"], x["amount"]) for x in po} == {("acrylic_3mm_sheet", "10.000", "1000.0000"), ("vinyl_roll", "20.000", "160.0000")}
    d = make_draft(e)
    assert e.c.get(f"/api/export/bom.xlsx?quote_id={d}", headers=e.O).status_code == 409  # not sent yet


# ---------------------------------------------------------------- scheduler
def test_scheduler_followup_then_expiry(env):
    e = env
    q = seed_quote(e)
    assert scheduler.run_once() == {"expired": 0, "followups": 0}  # just sent
    e.sql("update documents set sent_at = now() - interval '3 days' where id=%s", (q,))
    assert scheduler.run_once() == {"expired": 0, "followups": 1}
    assert scheduler.run_once()["followups"] == 0  # once per quote
    e.sql("update documents set valid_until = current_date - 1 where id=%s", (q,))
    assert scheduler.run_once()["expired"] == 1
    assert e.sql("select status from documents where id=%s", (q,))[0]["status"] == "expired"
    assert any(x["event"] == "status sent->expired" and x["actor"] == "system:scheduler" for x in e.c.get("/api/audit", headers=e.O).json())


# ---------------------------------------------------------------- margin includes labour/machine (code-review H1)
def test_margin_includes_machine_cost(env):
    e = env
    d = make_draft(e)  # print_part_small x10 @ RM32: materials 3.50 + 16 machine = 20/unit
    row = e.sql("select * from v_quote_margin where quote_id=%s", (d,))[0]
    assert (row["line_total"], row["line_cost"], row["line_margin"], row["margin_pct"]) == (320, 200, 120, Decimal("37.50"))
    assert e.sql("select other_cost_per_unit o from document_lines where document_id=%s", (d,))[0]["o"] == 16
    prov = e.c.get(f"/api/documents/{d}", headers=e.O).json()["provenance"]
    assert {p["line_margin"] for p in prov} == {"120.0000"}


def test_signboard_recipe_prices_like_the_seed(env):
    e = env
    r = e.enquire([{"item_key": "signboard_60x30", "qty": 40}])
    assert r.status_code == 201, r.text
    ln = e.c.get(f"/api/documents/{r.json()['id']}", headers=e.O).json()["lines"][0]
    assert ln["unit_price"] == "60.0000"


# ---------------------------------------------------------------- stale alerts: real margin loss only
def test_stale_alerts_ignore_cost_drops_and_drafts(env):
    e = env
    e.enquire([{"item_key": "signboard_60x30", "qty": 40}])  # draft priced on RM100 acrylic
    e.shock(price=60)  # cost DROP: no alert at all
    assert e.c.get("/api/alerts/stale-costs", headers=e.O).json() == []
    e.shock(price=140, doc_no="QA-2026-0162")  # rise: only the sent QT-0001 alerts, never the draft
    assert [a["quote_no"] for a in e.c.get("/api/alerts/stale-costs", headers=e.O).json()] == ["SAMPLE-QT-0001"]


# ---------------------------------------------------------------- webhook routing (fix 6)
def test_staff_handle_routes_to_supplier_pipeline(env, monkeypatch):
    e = env
    monkeypatch.setenv("WHATSAPP_APP_SECRET", WA_SECRET)
    e.sql("update users set channel_handle='+60 12-999 0001' where role='staff'")
    parties = e.sql("select count(*) n from parties")[0]["n"]
    e.ai.payload = {"supplier_name": "Forwarded Co", "doc_no": "FW-1", "issued_on": "2026-01-02", "lines": [
        {"description": "plywood 12mm", "qty": 1, "uom": "sheet", "unit_price": 40, "amount": 40}]}
    msg = {"entry": [{"changes": [{"value": {"messages": [
        {"id": "wamid.s1", "from": "60129990001", "timestamp": "1", "type": "text", "text": {"body": "quote FW-1 ..."}}]}}]}]}
    assert wa_post(e, msg).status_code == 200
    rec = e.c.get("/api/tracker", headers=e.O).json()["received"]
    assert any(x["doc_no"] == "FW-1" and x["status"] == "parsed" for x in rec)
    assert e.sql("select count(*) n from enquiries")[0]["n"] == 0  # not treated as a customer enquiry
    assert e.sql("select count(*) n from parties where role='customer'")[0]["n"] == 1  # only the seeded customer
    assert e.sql("select count(*) n from parties")[0]["n"] == parties + 1  # the supplier party from the document
    assert e.sql("select created_by from documents where doc_no='FW-1'")[0]["created_by"] == uuid.UUID(e.staff)


def test_unknown_sender_is_rate_limited(env, monkeypatch):
    e = env
    monkeypatch.setenv("WHATSAPP_APP_SECRET", WA_SECRET)
    monkeypatch.setenv("WHATSAPP_TENANT_ID", e.sql("select id from tenants")[0]["id"].__str__())
    e.stock_costs()
    e.ai.payload = {"items": [PART]}
    before = e.ai.calls
    for i in range(12):
        assert wa_post(e, {"entry": [{"changes": [{"value": {"messages": [{"id": f"wamid.spam{i}", "from": "60188887777", "timestamp": "1",
                                                                       "type": "text", "text": {"body": "10 small parts"}}]}}]}]}).status_code == 200
    assert e.ai.calls - before == 10  # the other two never reached ILMU
    assert e.sql("select count(*) n from enquiries")[0]["n"] == 10


# ---------------------------------------------------------------- hardening
def test_bearer_token_gates_api(env, monkeypatch):
    e = env
    monkeypatch.setenv("APP_TOKEN", "s3cret")
    assert e.c.get("/api/tracker", headers=e.O).json()["error"]["code"] == "bad_token"
    assert e.c.get("/api/tracker", headers={**e.O, "Authorization": "Bearer wrong"}).status_code == 401
    assert e.c.get("/api/tracker", headers={**e.O, "Authorization": b"Bearer s\xe9cret"}).status_code == 401  # non-ASCII: 401, not 500
    assert e.c.get("/api/tracker", headers={**e.O, "Authorization": "Bearer s3cret"}).status_code == 200
    assert e.c.get("/health").status_code == 200 and e.c.get("/api/me", headers={"X-Role": "owner"}).status_code == 401


def test_reads_need_a_user_except_me(env):
    e = env
    assert e.c.get("/api/tracker", headers={"X-Role": "owner"}).json()["error"]["code"] == "no_user"
    assert e.c.get("/api/me", headers={"X-Role": "owner"}).status_code == 200


def test_staff_cannot_read_supplier_chat_text(env):
    e = env
    e.ai.payload = {"doc_no": "M-1", "issued_on": "2026-01-02", "lines": [
        {"description": "pla black", "qty": 1, "uom": "kg", "unit_price": 5, "amount": 5}]}
    doc = e.c.post("/api/documents/ingest", data={"text": "PLA black RM5 secret price"}, headers=e.S).json()["id"]
    assert e.c.get(f"/api/documents/{doc}", headers=e.S).json()["messages"] == []
    assert "secret price" in json.dumps(e.c.get(f"/api/documents/{doc}", headers=e.O).json()["messages"])
    assert "tax_total" not in e.c.get(f"/api/documents/{doc}", headers=e.S).json()["doc"]


def test_upload_limits_and_content_hash(env):
    e = env
    e.ai.payload = {"doc_no": "H-1", "issued_on": "2026-01-02", "lines": [
        {"description": "pla black", "qty": 1, "uom": "kg", "unit_price": 5, "amount": 5}]}
    assert e.c.post("/api/documents/ingest", files={"file": ("x.pdf", b"MZ not a pdf", "application/pdf")}, headers=e.S).status_code == 415
    assert e.c.post("/api/documents/ingest", data={"text": "x"}, headers={**e.S, "Content-Length": "99999999"}).status_code == 413
    assert e.c.post("/api/documents/ingest", data={"text": "same bytes"}, headers=e.S).status_code == 201
    e.ai.payload["doc_no"] = "H-2"  # a different number does not hide an identical source
    r = e.c.post("/api/documents/ingest", data={"text": "same bytes"}, headers=e.S)
    assert r.status_code == 409 and r.json()["error"]["code"] == "duplicate"
    sha = hashlib.sha256(b"same bytes").hexdigest()
    assert e.sql("select count(*) n from documents where extraction->>'source_sha256'=%s", (sha,))[0]["n"] == 1


def test_webhook_body_cap_and_non_ascii_secret(env, monkeypatch):
    e = env
    monkeypatch.setenv("WHATSAPP_APP_SECRET", WA_SECRET)
    monkeypatch.setenv("TELEGRAM_WEBHOOK_SECRET", TG_SECRET)
    r = e.c.post("/webhooks/whatsapp", content=b"x" * 1_000_001, headers={"X-Hub-Signature-256": "sha256=00"})
    assert r.status_code == 413
    r = e.c.post("/webhooks/telegram", json={}, headers={"X-Telegram-Bot-Api-Secret-Token": b"caf\xe9"})
    assert r.status_code == 403


# ---------------------------------------------------------------- correctness (fix list 13-17)
def test_quote_numbers_are_sequential_and_unique(env):
    e = env
    e.stock_costs()
    nos = [e.enquire([PART]).json()["doc_no"] for _ in range(3)]
    assert len(set(nos)) == 3 and nos == sorted(nos)
    assert nos[2].endswith(f"{int(nos[0][-4:]) + 2:04d}")


def test_enquiry_bounds(env):
    e = env
    e.stock_costs()
    for bad in ({"item_key": "print_part_small", "qty": 10 ** 9}, {"item_key": "print_part_small", "qty": "lots"}):
        e.ai.payload = {"items": [bad]}
        assert e.c.post("/api/enquiries/simulate", json={"channel": "web", "text": "x"}, headers=e.S).status_code == 422
    e.ai.payload = {"items": [{"item_key": "print_part_small", "qty": 2, "attrs": {"note": "x" * 500, "nested": {"a": 1}}}]}
    r = e.c.post("/api/enquiries/simulate", json={"channel": "web", "text": "x"}, headers=e.S)
    assert r.status_code == 201


def test_junk_extraction_line_does_not_sink_document(env):
    e = env
    e.ai.payload = {"doc_no": "J-1", "lines": ["???", {"description": "pla black", "qty": 1, "uom": "kg", "unit_price": 5,
                                                         "amount": 5, "ocr_confidence": "high"}]}
    r = e.c.post("/api/documents/ingest", data={"text": "junk"}, headers=e.S)
    assert r.status_code == 201
    assert e.sql("select issued_on from documents where doc_no='J-1'")[0]["issued_on"] is not None  # defaults to today


def test_send_failure_is_reported(env):
    e = env
    d = make_draft(e, headers=e.S)
    tr(e, d, "reviewed", e.S)
    tr(e, d, "approved")
    e.sql("update enquiries set channel='telegram' where id=(select enquiry_id from documents where id=%s)", (d,))
    e.sql("update parties set contact='4242' where id=(select party_id from documents where id=%s)", (d,))
    e.svc.send = lambda *a: (_ for _ in ()).throw(RuntimeError("down"))
    r = tr(e, d, "sent")
    assert r.status_code == 200 and r.json()["status"] == "sent" and r.json()["delivery"] == "failed"


def test_big_supplier_price_jump_is_flagged_for_review(env):
    e = env
    doc = e.shock(price=140)  # RM100 -> RM140 on the seeded acrylic
    flags = e.sql("select extraction->'doc_flags' f from documents where id=%s", (doc,))[0]["f"]
    assert any(f.startswith("price_jump:acrylic_3mm_sheet:+40%") for f in flags)
    e.ai.payload["doc_no"] = "J-2"
    e.ai.payload["lines"][0]["unit_price"] = 142
    e.ai.payload["lines"][0]["amount"] = 1420
    d2 = e.c.post("/api/documents/ingest", data={"text": "small change"}, headers=e.S).json()["id"]
    f2 = e.sql("select extraction->'doc_flags' f from documents where id=%s", (d2,))[0]["f"]
    assert not any(x.startswith("price_jump") for x in f2)


def test_quote_pdf_has_selling_price_and_no_cost(env):
    e = env
    q = seed_quote(e)
    for who in (e.S, e.O):
        r = e.c.get(f"/api/documents/{q}/pdf", headers=who)
        assert r.status_code == 200 and r.content[:5] == b"%PDF-" and "SAMPLE-QT-0001" in r.headers["content-disposition"]
    in_doc = e.sql("select id from documents where direction='in' limit 1")[0]["id"]
    assert e.c.get(f"/api/documents/{in_doc}/pdf", headers=e.O).status_code == 404


def test_pii_is_redacted_before_the_llm_but_prices_survive():
    from src.pipeline import redact
    t = "Call 012-345 6789 or +60123456789, a@b.my, IC 900101-14-5678. 10 pcs @ RM 12.50, quote Q-0123-4567-89"
    r = redact(t)
    assert "345 6789" not in r and "a@b.my" not in r and "900101" not in r and "123456789" not in r
    assert "10 pcs @ RM 12.50" in r and "Q-0123-4567-89" in r


def test_owner_can_erase_a_customer(env):
    e = env
    d = make_draft(e)
    cust = e.sql("select party_id from documents where id=%s", (d,))[0]["party_id"]
    e.sql("update parties set contact='+60123456789', address='1 Jalan Test' where id=%s", (cust,))
    assert e.c.post(f"/api/parties/{cust}/erase", headers=e.S).status_code == 403
    r = e.c.post(f"/api/parties/{cust}/erase", headers=e.O)
    assert r.status_code == 200 and r.json()["messages_erased"] >= 1
    row = e.sql("select name, contact, address from parties where id=%s", (cust,))[0]
    assert row["name"].startswith("Erased customer") and row["contact"] is None and row["address"] is None
    assert e.sql("select count(*) n from messages where body <> '[erased]' and enquiry_id in (select id from enquiries where party_id=%s)", (cust,))[0]["n"] == 0
    assert e.sql("select count(*) n from documents where id=%s", (d,))[0]["n"] == 1  # the quote record stays
    sup = e.sql("select id from parties where role='supplier' limit 1")[0]["id"]
    assert e.c.post(f"/api/parties/{sup}/erase", headers=e.O).status_code == 409


def test_model_calls_are_logged_without_prices(env):
    e = env
    make_draft(e)
    e.ai.payload = {"doc_no": "L-1", "lines": [{"description": "pla black", "qty": 1, "uom": "kg", "unit_price": 5, "amount": 5}]}
    e.c.post("/api/documents/ingest", data={"text": "log me"}, headers=e.S)
    rows = e.sql("select action, payload from ai_actions order by created_at")
    assert {"extract_items", "parse_receipt_lines"} <= {r["action"] for r in rows}
    assert "unit_price" not in json.dumps(rows)


# ---------------------------------------------------------------- follow-ups (owner approves the chase)
def sent_quote_on_telegram(e):
    d = make_draft(e, channel="telegram")
    e.sql("update parties set contact='4242' where id=(select party_id from documents where id=%s)", (d,))
    tr(e, d, "reviewed", e.S)
    tr(e, d, "approved")
    assert tr(e, d, "sent").json()["delivery"] == "delivered"
    e.sql("update documents set sent_at = now() - interval '3 days' where id=%s", (d,))
    return d


def test_followup_is_suggested_then_owner_sends(env):
    e = env
    d = sent_quote_on_telegram(e)
    assert scheduler.run_once()["followups"] >= 1
    fu = [x for x in e.c.get("/api/followups", headers=e.S).json() if x["document_id"] == d][0]
    assert fu["suggested_text"].startswith("Hi ") and "RM" not in fu["suggested_text"] and "MYR" in fu["suggested_text"]
    assert "cost" not in json.dumps(fu).lower()
    act = lambda who, a: e.c.post(f"/api/followups/{fu['id']}", json={"action": a}, headers=who)
    assert act(e.S, "send").status_code == 403
    n = len(e.svc.sent)
    assert act(e.O, "send").json()["state"] == "sent" and len(e.svc.sent) == n + 1
    assert e.svc.sent[-1][:2] == ("telegram", "4242") and e.svc.sent[-1][2] == fu["suggested_text"]
    assert act(e.O, "send").status_code == 404  # already handled, never twice
    assert not [x for x in e.c.get("/api/followups", headers=e.O).json() if x["id"] == fu["id"]]


def test_followup_skip_and_failed_send_stays_pending(env):
    e = env
    d = sent_quote_on_telegram(e)
    scheduler.run_once()
    fid = [x for x in e.c.get("/api/followups", headers=e.O).json() if x["document_id"] == d][0]["id"]
    e.svc.send = lambda *a: (_ for _ in ()).throw(RuntimeError("down"))
    assert e.c.post(f"/api/followups/{fid}", json={"action": "send"}, headers=e.O).status_code == 502
    assert e.sql("select state from followups where id=%s", (fid,))[0]["state"] == "pending"
    assert e.c.post(f"/api/followups/{fid}", json={"action": "skip"}, headers=e.O).json()["state"] == "skipped"


def test_margin_report_owner_only_and_adds_up(env):
    e = env
    e.shock()  # sent seed quote now has stale cost
    d = make_draft(e)
    assert e.c.get("/api/reports/margin", headers=e.S).status_code == 403
    rep = e.c.get("/api/reports/margin?days=30", headers=e.O).json()
    rows = e.sql("select sum(line_total) rev, sum(line_cost) cost from v_quote_margin where quote_id=%s", (d,))[0]
    assert Decimal(rep["revenue"]) >= rows["rev"] and Decimal(rep["margin"]) == Decimal(rep["revenue"]) - Decimal(rep["cost"])
    assert rep["outcomes"].get("draft", 0) >= 1 and rep["stale_quotes"] >= 1 and Decimal(rep["stale_margin_lost"]) < 0
    assert rep["lowest_margin"] and e.c.get("/api/reports/margin?days=0", headers=e.O).status_code == 422
