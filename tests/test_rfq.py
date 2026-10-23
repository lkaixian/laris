"""Ask suppliers: photo out on WhatsApp, price replies in, accept into the cost book. WhatsApp and ILMU are mocked (nothing ran against Meta)."""
import json
from decimal import Decimal as D

import httpx
import psycopg

from src import db
from src.api import deps
from src.api.deps import Services
from src.channels import whatsapp
from support.fixtures import env, pg_url  # noqa: F401
from test_api import WA_SECRET, wa_msg, wa_post
from test_channels import wa_payload

JPEG = b"\xff\xd8\xff\xe0jpeg"
SA, SB = "600000000001", "600000000002"  # seeded suppliers A and B (digits of their contact)


class Meta:
    """Mock Graph API: /media -> media id, /messages -> wamid. `fail` maps a recipient to an HTTP error body."""

    def __init__(self, fail=None):
        self.calls, self.fail = [], fail or {}
        self.client = httpx.Client(transport=httpx.MockTransport(self))

    def __call__(self, req):
        if req.url.path.endswith("/media"):
            self.calls.append(("media", req.url.path, req.content))
            return httpx.Response(200, json={"id": "MEDIA1"})
        b = json.loads(req.content)
        self.calls.append((b["type"], req.url.path, b))
        if b["to"] in self.fail and b["type"] in self.fail[b["to"]][0]:
            return httpx.Response(400, json={"error": {"code": self.fail[b["to"]][1]}})
        return httpx.Response(200, json={"messages": [{"id": f"wamid.out.{len(self.calls)}.{b['to']}.{b['type']}"}]})


def setup(e, monkeypatch, **kw):
    monkeypatch.setenv("WHATSAPP_TOKEN", "t")
    monkeypatch.setenv("WHATSAPP_PHONE_NUMBER_ID", "SHARED")
    monkeypatch.setenv("WHATSAPP_APP_SECRET", WA_SECRET)
    monkeypatch.delenv("WHATSAPP_RFQ_TEMPLATE", raising=False)
    e.meta = Meta(**kw)
    e.svc.http = e.meta.client
    return {s["name"][16]: str(s["id"]) for s in e.sql("select id, name from parties where role='supplier'")}  # A, B, C


def ask(e, ids, headers=None, **form):
    return e.c.post("/api/rfq", headers=headers or e.S, files={"image": ("i.jpg", JPEG, "image/jpeg")},
                    data={"description": "ballet flat", "supplier_ids": ids, **form})


def reply_in(e, text, sender=SA, mid="wamid.r1", **m):
    return wa_post(e, wa_msg(id=mid, **{"from": sender}, **({"type": "text", "text": {"body": text}} | m)))


def listing(e, who=None):
    return e.c.get("/api/rfq", headers=who or e.O).json()


def other_tenant(e):
    t = e.sql("insert into tenants(name, trade_template, min_margin_pct) values ('Other Shop','made_to_order',20) returning id")[0]["id"]
    u = e.sql("insert into users(tenant_id,name,role) values (%s,'Other Owner','owner') returning id", (t,))[0]["id"]
    return {"X-Role": "owner", "X-User": str(u)}


# ---------------------------------------------------------------- channel layer
def test_upload_media_and_send_image_payloads():
    m = Meta()
    kw = dict(client=m.client, token="tok", phone_id="PID")
    assert whatsapp.upload_media(JPEG, "image/jpeg", **kw) == "MEDIA1"
    kind, path, body = m.calls[0]
    assert path.endswith("/PID/media") and b'name="messaging_product"' in body and b"whatsapp" in body and JPEG in body
    assert whatsapp.send_image("6012", "MEDIA1", "how much?", **kw).startswith("wamid.out")
    assert m.calls[1][2]["image"] == {"id": "MEDIA1", "caption": "how much?"} and m.calls[1][2]["messaging_product"] == "whatsapp"
    whatsapp.send_template("6012", "rfq", "en", ["how much?"], header_image="MEDIA1", **kw)
    comps = m.calls[2][2]["template"]["components"]
    assert comps[0] == {"type": "header", "parameters": [{"type": "image", "image": {"id": "MEDIA1"}}]}
    assert comps[1]["parameters"] == [{"type": "text", "text": "how much?"}]


def test_parse_inbound_reply_to():
    base = {"id": "w1", "from": "6", "timestamp": "1", "type": "text", "text": {"body": "RM5"}}
    assert whatsapp.parse_inbound(wa_payload({**base, "context": {"id": "wamid.ours", "from": "x"}}))[0].reply_to == "wamid.ours"
    assert whatsapp.parse_inbound(wa_payload(base))[0].reply_to is None


def test_image_falls_back_to_rfq_template_outside_window(monkeypatch):
    monkeypatch.setenv("WHATSAPP_TOKEN", "t")
    monkeypatch.setenv("WHATSAPP_PHONE_NUMBER_ID", "1")
    m = Meta(fail={"6012": (("image",), 131047)})
    s = Services()
    s.http = m.client
    monkeypatch.delenv("WHATSAPP_RFQ_TEMPLATE", raising=False)
    try:
        s.send_image("6012", "MEDIA1", "hi")
        assert False
    except RuntimeError as e:
        assert "WHATSAPP_RFQ_TEMPLATE" in str(e)
    monkeypatch.setenv("WHATSAPP_RFQ_TEMPLATE", "rfq_photo")
    assert s.send_image("6012", "MEDIA1", "hi  there") .endswith(".6012.template")
    tpl = m.calls[-1][2]["template"]
    assert tpl["name"] == "rfq_photo" and tpl["components"][0]["parameters"][0]["image"]["id"] == "MEDIA1"
    assert tpl["components"][1]["parameters"][0]["text"] == "hi there"
    m2 = Meta(fail={"6012": (("image",), 100)})  # any other error is not hidden by the template
    s.http = m2.client
    try:
        s.send_image("6012", "MEDIA1", "hi")
        assert False
    except httpx.HTTPStatusError:
        pass


# ---------------------------------------------------------------- POST /api/rfq
def test_ask_records_sends_and_isolates_a_failure(env, monkeypatch):
    e = env
    sup = setup(e, monkeypatch, fail={SB: (("image", "template"), 131000)})
    e.sql("update tenants set wa_phone_number_id='PN1'")
    r = ask(e, [sup["A"], sup["B"]], circle=json.dumps({"x": 0.5, "y": 0.4, "r": 0.2}))  # staff may ask
    assert r.status_code == 201, r.text
    out = r.json()
    assert out["sends"] == [{"supplier_id": sup["A"], "status": "sent", "error": None},
                            {"supplier_id": sup["B"], "status": "failed", "error": "WhatsApp refused it (HTTP 400)"}]
    assert [c[0] for c in e.meta.calls].count("media") == 1  # uploaded once
    assert all(c[1].startswith("/v21.0/PN1/") for c in e.meta.calls)  # the tenant's own number
    assert e.meta.calls[1][2]["image"]["caption"] == "How much for the circled one? Any MOQ or bulk price?"
    rows = e.sql("select supplier_id::text s, status, wamid from rfq_sends order by status")
    assert [(x["status"], x["wamid"]) for x in rows] == [("failed", None), ("sent", f"wamid.out.2.{SA}.image")]
    assert e.sql("select count(*) n from rfq_replies where status='waiting'")[0]["n"] == 1  # only the sent one waits
    item = e.sql("select * from rfq_items")[0]
    assert item["circle"] == {"x": 0.5, "y": 0.4, "r": 0.2} and bytes(item["image"]) == JPEG
    assert e.sql("select count(*) n from audit_log where entity='rfq_items'")[0]["n"] == 1


def test_ask_rejects_bad_input(env, monkeypatch):
    e = env
    sup = setup(e, monkeypatch)
    cust = str(e.sql("select id from parties where role='customer'")[0]["id"])
    e.sql("update parties set contact=null where id=%s", (sup["C"],))
    foreign = other_tenant(e)
    e.sql("insert into parties(tenant_id,role,name,contact) select tenant_id,'supplier','Foreign','+60-1' from users where id=%s",
          (foreign["X-User"],))
    fid = str(e.sql("select id from parties where name='Foreign'")[0]["id"])
    for bad in (cust, sup["C"], fid, "not-a-uuid"):  # a customer, no phone, another tenant's supplier
        assert ask(e, [sup["A"], bad]).status_code in (422,), bad
    assert ask(e, []).status_code == 422
    assert ask(e, [sup["A"]], circle="{nope").status_code == 422
    assert ask(e, [sup["A"]], circle=json.dumps({"x": 2, "y": 0, "r": 0})).status_code == 422
    assert ask(e, [sup["A"]], description="x" * 201).status_code == 422
    r = e.c.post("/api/rfq", headers=e.S, files={"image": ("i.gif", b"GIF89a", "image/gif")}, data={"description": "d", "supplier_ids": [sup["A"]]})
    assert r.status_code == 415
    assert e.meta.calls == [] and e.sql("select count(*) n from rfq_items")[0]["n"] == 0  # nothing sent, nothing stored


def test_upload_failure_marks_every_send_failed(env, monkeypatch):
    e = env
    sup = setup(e, monkeypatch)
    e.svc.http = httpx.Client(transport=httpx.MockTransport(lambda req: httpx.Response(500)))
    out = ask(e, [sup["A"], sup["B"]]).json()
    assert [s["status"] for s in out["sends"]] == ["failed", "failed"]


# ---------------------------------------------------------------- GET: staff never see supplier prices
def test_listing_hides_prices_from_staff(env, monkeypatch):
    e = env
    sup = setup(e, monkeypatch)
    e.ai.payload = {"unit_price": 4.5, "min_qty": 100, "tiers": [{"min_qty": 500, "unit_price": 4}], "currency": "MYR"}
    rid = ask(e, [sup["A"], sup["B"]]).json()["rfq_id"]
    assert reply_in(e, "RM4.50 each, MOQ 100, 500+ at RM4").status_code == 200
    o = listing(e)[0]
    assert o["id"] == rid and o["image_url"] == f"/api/rfq/{rid}/image" and o["note"].startswith("How much")
    by = {x["supplier_name"][16]: x for x in o["replies"]}
    assert by["A"]["status"] == "ready" and D(by["A"]["unit_price"]) == D("4.5") and D(by["A"]["min_qty"]) == 100
    assert by["A"]["tiers"] == [{"min_qty": "500", "unit_price": "4"}] and "MOQ 100" in by["A"]["text"]
    assert by["B"]["status"] == "waiting" and by["B"]["unit_price"] is None
    s = listing(e, e.S)[0]
    sb = {x["supplier_name"][16]: x for x in s["replies"]}
    assert sb["A"]["unit_price"] is None and sb["A"]["min_qty"] is None and sb["A"]["tiers"] == [] and sb["A"]["text"] == ""
    assert sb["A"]["status"] == "needs_review" and sb["B"]["status"] == "waiting"  # staff: replied or not, nothing more
    assert "4.5000" not in json.dumps(s) and "RM4.50" not in json.dumps(s)
    img = e.c.get(s["image_url"], headers=e.S)
    assert img.status_code == 200 and img.content == JPEG and img.headers["content-type"] == "image/jpeg"


def test_second_tenant_sees_and_accepts_nothing(env, monkeypatch):
    e = env
    sup = setup(e, monkeypatch)
    e.ai.payload = {"unit_price": 4.5}
    rid = ask(e, [sup["A"]]).json()["rfq_id"]
    reply_in(e, "RM4.50")
    rep = listing(e)[0]["replies"][0]["reply_id"]
    other = other_tenant(e)
    assert listing(e, other) == []
    assert e.c.get(f"/api/rfq/{rid}/image", headers=other).status_code == 404
    assert e.c.post(f"/api/rfq/{rid}/replies/{rep}/accept", json={"item_key": "packaging_box"}, headers=other).status_code == 404
    with db.tx("owner", e.owner, str(e.sql("select id from tenants where name='Other Shop'")[0]["id"])) as c:  # RLS, not just WHERE
        assert [c.execute(f"select count(*) n from {t}").fetchone()["n"] for t in ("rfq_items", "rfq_sends", "rfq_replies")] == [0, 0, 0]


# ---------------------------------------------------------------- inbound linking
def test_reply_links_by_reply_to_then_falls_back(env, monkeypatch):
    e = env
    sup = setup(e, monkeypatch)
    e.ai.payload = {"unit_price": 3}
    first = ask(e, [sup["A"]], description="first").json()["rfq_id"]
    second = ask(e, [sup["A"]], description="second").json()["rfq_id"]
    w1 = e.sql("select wamid from rfq_sends where rfq_item_id=%s", (first,))[0]["wamid"]
    assert reply_in(e, "RM3 for the first", context={"id": w1}).status_code == 200  # quotes the OLDER ask
    by = {i["id"]: i["replies"][0] for i in listing(e)}
    assert by[first]["status"] == "ready" and D(by[first]["unit_price"]) == 3 and by[second]["status"] == "waiting"
    assert reply_in(e, "RM3", mid="wamid.r2").status_code == 200  # no quote: the newest still-waiting ask
    by = {i["id"]: i["replies"][0] for i in listing(e)}
    assert by[second]["status"] == "ready"
    assert e.svc.sent[-1][2] == "Thanks, we have your reply."
    ai = e.ai.calls
    assert reply_in(e, "RM3", mid="wamid.r2").status_code == 200  # provider retry
    assert e.ai.calls == ai and e.sql("select count(*) n from rfq_replies")[0]["n"] == 2


def test_reply_to_another_suppliers_message_is_not_linked(env, monkeypatch):
    e = env
    sup = setup(e, monkeypatch)
    rid = ask(e, [sup["A"], sup["B"]]).json()["rfq_id"]
    wa = e.sql("select wamid from rfq_sends where supplier_id=%s", (sup["A"],))[0]["wamid"]
    e.ai.payload = {"unit_price": 9}
    assert reply_in(e, "RM9", sender=SB, context={"id": wa}).status_code == 200  # B quoting A's message lands on B's own ask
    by = {x["supplier_name"][16]: x["status"] for x in listing(e)[0]["replies"]}
    assert by == {"A": "waiting", "B": "ready"} and listing(e)[0]["id"] == rid


def test_old_open_ask_is_not_a_fallback(env, monkeypatch):
    e = env
    sup = setup(e, monkeypatch)
    ask(e, [sup["A"]])
    e.sql("update rfq_sends set created_at = now() - interval '8 days'")
    e.ai.payload = {"doc_no": "A-1", "lines": [{"description": "plywood", "qty": 1, "uom": "sheet", "unit_price": 40, "amount": 40}]}
    assert reply_in(e, "quote A-1 plywood 40").status_code == 200  # today's behaviour: a supplier document
    assert listing(e)[0]["replies"][0]["status"] == "waiting"
    assert e.sql("select count(*) n from documents where doc_no='A-1'")[0]["n"] == 1


def test_price_extraction_ready_vs_needs_review(env, monkeypatch):
    e = env
    sup = setup(e, monkeypatch)
    cases = [  # (what the model said, expected status, unit_price)
        ({"unit_price": 4.5, "min_qty": 100, "tiers": [], "currency": "RM"}, "ready", "4.5"),
        ({"unit_price": None, "tiers": [{"min_qty": 10, "unit_price": 5}, {"min_qty": 100, "unit_price": 4}]}, "ready", "5"),
        ({"unit_price": 0}, "needs_review", None),
        ({"unit_price": -3}, "needs_review", None),
        ({"unit_price": "cheap"}, "needs_review", None),
        ({}, "needs_review", None),
        ({"unit_price": 4, "tiers": [{"min_qty": 10, "unit_price": 3}, {"min_qty": 100, "unit_price": 6}]}, "needs_review", "4"),  # dearer at volume
        ({"unit_price": 4, "tiers": [{"min_qty": 10, "unit_price": 3}, {"min_qty": 10, "unit_price": 2}]}, "needs_review", "4"),
        ({"unit_price": 4, "tiers": [{"min_qty": "x", "unit_price": 3}]}, "needs_review", "4"),
        ({"unit_price": 4, "currency": "USD"}, "needs_review", "4"),
        ({"unit_price": 4, "status": "ready", "tiers": "none"}, "ready", "4"),  # the model cannot set status, and junk tiers are ignored
    ]
    for n, (payload, status, price) in enumerate(cases):
        deps.HITS.clear()  # 11 asks in one test: more than the per-user allowance
        ask(e, [sup["A"]])
        e.ai.payload = payload
        assert reply_in(e, f"price {n}", mid=f"wamid.c{n}").status_code == 200
        got = e.sql("select status, unit_price from rfq_replies where external_id=%s", (f"wamid.c{n}",))[0]
        assert (got["status"], got["unit_price"] and str(got["unit_price"].normalize())) == (status, price), (n, payload)


def test_ilmu_down_keeps_the_raw_text(env, monkeypatch):
    e = env
    sup = setup(e, monkeypatch)
    ask(e, [sup["A"]])
    e.ai.fail = True
    assert reply_in(e, "RM4.50 boss, min 100").status_code == 200
    x = e.sql("select status, message_text, unit_price from rfq_replies")[0]
    assert (x["status"], x["message_text"], x["unit_price"]) == ("needs_review", "RM4.50 boss, min 100", None)


def test_voice_note_and_photo_wait_for_a_person(env, monkeypatch):
    e = env
    sup = setup(e, monkeypatch)
    ask(e, [sup["A"], sup["B"]])
    e.svc.media["M1"] = (b"audio", "audio/ogg")
    calls = e.ai.calls
    assert reply_in(e, "", mid="wamid.v", type="audio", audio={"id": "M1"}).status_code == 200
    assert e.ai.calls == calls  # not transcribed, not read
    x = e.sql("select status, message_text from rfq_replies where external_id='wamid.v'")[0]
    assert x["status"] == "needs_review" and x["message_text"].startswith("[audio]")
    wb = e.sql("select wamid from rfq_sends where supplier_id=%s", (sup["B"],))[0]["wamid"]
    assert reply_in(e, "", sender=SB, mid="wamid.p", type="image", image={"id": "M2", "caption": "this one RM5"},
                    context={"id": wb}).status_code == 200  # a photo quoting our message
    x = e.sql("select status, message_text from rfq_replies where external_id='wamid.p'")[0]
    assert x["status"] == "needs_review" and "this one RM5" in x["message_text"]
    assert e.sql("select count(*) n from documents where direction='in' and source_channel='whatsapp'")[0]["n"] == 0


# ---------------------------------------------------------------- accept
def ready_reply(e, sup, payload, key="A"):
    e.ai.payload = payload
    rid = ask(e, [sup[key]]).json()["rfq_id"]
    reply_in(e, "price", sender=SA if key == "A" else SB, mid=f"wamid.{key}")
    return rid, listing(e)[0]["replies"][0]["reply_id"]


def test_accept_creates_cost_items_with_tiers(env, monkeypatch):
    e = env
    sup = setup(e, monkeypatch)
    rid, rep = ready_reply(e, sup, {"unit_price": 4.5, "min_qty": 100, "tiers": [{"min_qty": 500, "unit_price": 4}]})
    url = f"/api/rfq/{rid}/replies/{rep}/accept"
    assert e.c.post(url, json={"item_key": "packaging_box"}, headers=e.S).status_code == 403  # owner only
    for bad in ({"item_key": ""}, {"item_key": "Has Space"}, {}):
        assert e.c.post(url, json=bad, headers=e.O).status_code == 422
    assert e.sql("select count(*) n from cost_items where item_key='packaging_box'")[0]["n"] == 0
    r = e.c.post(url, json={"item_key": "packaging_box"}, headers=e.O)
    assert r.status_code == 200, r.text
    rows = e.sql("""select c.min_qty, c.unit_cost, c.supplier_id::text s, c.uom from cost_items c where item_key='packaging_box' order by min_qty""")
    assert [(x["min_qty"], x["unit_cost"], x["uom"]) for x in rows] == [(100, D("4.5"), "pcs"), (500, D("4"), "pcs")]
    assert {x["s"] for x in rows} == {sup["A"]}
    doc = e.sql("select status, direction from documents where id=%s", (r.json()["doc_id"],))[0]
    assert (doc["status"], doc["direction"]) == ("in_cost_book", "in")
    got = listing(e)[0]["replies"][0]
    assert got["status"] == "accepted" and e.sql("select doc_id from rfq_replies")[0]["doc_id"] is not None
    assert e.c.post(url, json={"item_key": "packaging_box"}, headers=e.O).status_code == 409  # not twice
    assert e.sql("select count(*) n from audit_log where entity='rfq_replies'")[0]["n"] == 1


def test_accept_single_price_without_moq_is_min_qty_one(env, monkeypatch):
    e = env
    sup = setup(e, monkeypatch)
    rid, rep = ready_reply(e, sup, {"unit_price": 2})
    assert e.c.post(f"/api/rfq/{rid}/replies/{rep}/accept", json={"item_key": "packaging_box"}, headers=e.O).status_code == 200
    assert [(x["min_qty"], x["unit_cost"]) for x in e.sql("select min_qty, unit_cost from cost_items where item_key='packaging_box'")] == [(1, D("2"))]


def test_accept_needs_a_price_and_flags_a_jump(env, monkeypatch):
    e = env
    sup = setup(e, monkeypatch)
    rid, rep = ready_reply(e, sup, {})  # nothing readable: needs_review, no price
    url = f"/api/rfq/{rid}/replies/{rep}/accept"
    assert e.c.post(url, json={"item_key": "packaging_box"}, headers=e.O).status_code == 409
    e.stock_costs()  # packaging_box costs 1.5 at min_qty 1 today
    rid2, rep2 = ready_reply(e, sup, {"unit_price": 9, "min_qty": 1}, key="B")
    rep2 = next(r["reply_id"] for i in listing(e) if i["id"] == rid2 for r in i["replies"])
    assert e.c.post(f"/api/rfq/{rid2}/replies/{rep2}/accept", json={"item_key": "packaging_box"}, headers=e.O).status_code == 200  # owner confirms the jump
    assert e.sql("select unit_cost from cost_items where item_key='packaging_box' and superseded_by is null")[0]["unit_cost"] == D("9")
    ev = e.sql("select after from audit_log where entity='rfq_replies'")[0]["after"]
    assert any(f.startswith("price_jump:packaging_box") for f in ev["doc_flags"])  # the flag is on record


def test_apply_schema_twice_keeps_data(env):
    e = env
    e.sql("insert into rfq_items(tenant_id,description,note,image,image_mime) select id,'d','n','\\x00','image/png' from tenants")
    db.apply_schema(seed=False)
    db.apply_schema(seed=False)
    assert e.sql("select count(*) n from rfq_items")[0]["n"] == 1


# ---------------------------------------------------------------- Telegram suppliers (tg:<chat id> contact)
TG_SECRET = "tgsecret"


class Both:
    """Mock WhatsApp (Meta) and Telegram in one client. `deny` = chat ids Telegram answers 403 for."""

    def __init__(self, meta, deny=()):
        self.meta, self.deny, self.tg = meta, deny, []
        self.client = httpx.Client(transport=httpx.MockTransport(self))

    def __call__(self, req):
        if req.url.host != "api.telegram.org":
            return self.meta(req)
        chat = int(next(l for l in req.content.decode("latin1").split("\r\n") if l.lstrip("-").isdigit()))
        self.tg.append((req.url.path.rsplit("/", 1)[1], chat, req.content))
        if chat in self.deny:
            return httpx.Response(403, json={"ok": False, "description": "Forbidden: bot can't initiate conversation with a user"})
        return httpx.Response(200, json={"result": {"message_id": 70 + len(self.tg), "chat": {"id": chat}}})


def tg_setup(e, monkeypatch, deny=()):
    sup = setup(e, monkeypatch)
    monkeypatch.setenv("TELEGRAM_BOT_TOKEN", "123:SECRETTOKEN")
    monkeypatch.setenv("TELEGRAM_WEBHOOK_SECRET", TG_SECRET)
    e.both = Both(e.meta, deny)
    e.svc.http = e.both.client
    e.sql("update parties set contact='tg:5551' where id=%s", (sup["A"],))
    e.sql("update parties set contact='Telegram:-100777' where id=%s", (sup["B"],))
    return sup


def tg_in(e, text, chat=5551, mid=1, **m):
    upd = {"message": {"message_id": mid, "chat": {"id": chat}, "date": 1700000000, "text": text, **m}}
    return e.c.post("/webhooks/telegram", json=upd, headers={"X-Telegram-Bot-Api-Secret-Token": TG_SECRET})


def test_telegram_send_photo_and_parse_reply_to():
    from src.channels import telegram
    seen = []
    c = httpx.Client(transport=httpx.MockTransport(lambda r: (seen.append(r), httpx.Response(200, json={"result": {"message_id": 9, "chat": {"id": -100}}}))[1]))
    assert telegram.send_photo(-100, JPEG, "image/jpeg", "x" * 2000, client=c, token="T") == "-100:9"
    assert seen[0].url.path == "/botT/sendPhoto" and JPEG in seen[0].content and b'name="chat_id"' in seen[0].content
    assert seen[0].content.count(b"x") == 1024  # caption cap
    base = {"message_id": 5, "chat": {"id": 99}, "date": 1700000000, "text": "RM5"}
    assert telegram.parse_update({"message": {**base, "reply_to_message": {"message_id": 3}}}).reply_to == "99:3"
    assert telegram.parse_update({"message": base}).reply_to is None


def test_telegram_403_says_press_start_without_leaking(env, monkeypatch):
    e = env
    sup = tg_setup(e, monkeypatch, deny=(5551,))
    out = ask(e, [sup["A"]]).json()["sends"][0]
    assert out["status"] == "failed" and out["error"] == "supplier must open the bot and press Start first"
    assert "SECRETTOKEN" not in json.dumps(out) and "api.telegram" not in json.dumps(out)


def test_ask_mixed_whatsapp_and_telegram(env, monkeypatch):
    e = env
    sup = tg_setup(e, monkeypatch)
    out = ask(e, [sup["A"], sup["B"], sup["C"]], note="how much?").json()["sends"]
    assert [s["status"] for s in out] == ["sent"] * 3
    assert [(m, c) for m, c, _ in e.both.tg] == [("sendPhoto", 5551), ("sendPhoto", -100777)]
    assert [c[0] for c in e.meta.calls].count("media") == 1 and e.meta.calls[-1][2]["to"] == "600000000003"
    assert {r["wamid"] for r in e.sql("select wamid from rfq_sends")} >= {"5551:71", "-100777:72"}
    # a Telegram-only request never touches WhatsApp
    n = len(e.meta.calls)
    assert ask(e, [sup["A"]]).status_code == 201 and len(e.meta.calls) == n
    e.sql("update parties set contact='tg:abc' where id=%s", (sup["A"],))
    assert ask(e, [sup["A"]]).status_code == 422


def test_telegram_reply_links_by_reply_to_then_fallback(env, monkeypatch):
    e = env
    sup = tg_setup(e, monkeypatch)
    e.ai.payload = {"unit_price": 3}
    first = ask(e, [sup["A"]], description="first").json()["rfq_id"]
    second = ask(e, [sup["A"]], description="second").json()["rfq_id"]
    w1 = e.sql("select wamid from rfq_sends where rfq_item_id=%s", (first,))[0]["wamid"]
    assert tg_in(e, "RM3 first", reply_to_message={"message_id": int(w1.split(":")[1])}).status_code == 200
    by = {i["id"]: i["replies"][0] for i in listing(e)}
    assert by[first]["status"] == "ready" and D(by[first]["unit_price"]) == 3 and by[second]["status"] == "waiting"
    assert e.svc.sent[-1] == ("telegram", "5551", "Thanks, we have your reply.")  # acknowledged on the same channel
    assert tg_in(e, "RM3", mid=2).status_code == 200  # no quote: newest waiting ask
    assert {i["id"]: i["replies"][0]["status"] for i in listing(e)}[second] == "ready"
    ai = e.ai.calls
    assert tg_in(e, "RM3", mid=2).status_code == 200 and e.ai.calls == ai  # retry
    assert e.sql("select count(*) n from rfq_replies")[0]["n"] == 2


def test_telegram_group_supplier_voice_photo_and_isolation(env, monkeypatch):
    e = env
    sup = tg_setup(e, monkeypatch)
    ask(e, [sup["A"], sup["B"]])
    calls = e.ai.calls
    assert tg_in(e, "", chat=-100777, voice={"file_id": "V"}).status_code == 200  # group supplier, voice: stored, not read
    x = e.sql("select status, message_text from rfq_replies where external_id='-100777:1'")[0]
    assert x["status"] == "needs_review" and x["message_text"].startswith("[audio]") and e.ai.calls == calls
    e.svc.media["P"] = (JPEG, "image/jpeg")
    tg_in(e, "list", mid=2, chat=5551, photo=[{"file_id": "P"}])  # photo without reply_to: a price list, never an ask reply
    assert e.sql("select count(*) n from rfq_replies where status='waiting'")[0]["n"] == 1  # only A still waits
    wa = e.sql("select wamid from rfq_sends where supplier_id=%s", (sup["A"],))[0]["wamid"]
    tg_in(e, "this one", mid=3, photo=[{"file_id": "P"}], reply_to_message={"message_id": int(wa.split(":")[1])})  # quoting our photo
    assert e.sql("select status from rfq_replies where external_id='5551:3'")[0]["status"] == "needs_review"
    # a stranger whose chat id differs, and a WhatsApp sender whose digits equal the chat id, are not the supplier
    n = e.sql("select count(*) n from rfq_replies where message_text is not null")[0]["n"]
    tg_in(e, "RM9", chat=5552, mid=4)
    reply_in(e, "RM9", sender="5551", mid="wamid.x")
    assert e.sql("select count(*) n from rfq_replies where message_text is not null")[0]["n"] == n
    assert listing(e, other_tenant(e)) == []
