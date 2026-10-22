import hashlib
import hmac
import json

import httpx

from src.channels import telegram, whatsapp


def wa_payload(msg=None, status=None):
    v = {"messages": [msg]} if msg else {"statuses": [status]}
    return {"entry": [{"changes": [{"value": v}]}]}


def test_verify_challenge():
    p = {"hub.mode": "subscribe", "hub.verify_token": "t", "hub.challenge": "123"}
    assert whatsapp.verify_challenge(p, "t") == "123"
    assert whatsapp.verify_challenge(p, "x") is None


def test_verify_signature():
    body = b'{"a":1}'
    good = "sha256=" + hmac.new(b"sec", body, hashlib.sha256).hexdigest()
    assert whatsapp.verify_signature(body, good, "sec")
    assert not whatsapp.verify_signature(body + b" ", good, "sec")
    assert not whatsapp.verify_signature(body, None, "sec")


def test_parse_inbound_kinds():
    t = whatsapp.parse_inbound(wa_payload({"id": "w1", "from": "60123", "timestamp": "1700000000", "type": "text", "text": {"body": "hi"}}))[0]
    assert (t.channel, t.external_id, t.sender, t.text) == ("whatsapp", "w1", "60123", "hi")
    assert t.at.year == 2023
    a = whatsapp.parse_inbound(wa_payload({"id": "w2", "from": "6", "timestamp": "1", "type": "audio", "audio": {"id": "M1"}}))[0]
    assert (a.media_kind, a.media_ref) == ("audio", "M1")
    i = whatsapp.parse_inbound(wa_payload({"id": "w3", "from": "6", "timestamp": "1", "type": "image", "image": {"id": "M2", "caption": "quote"}}))[0]
    assert i.media_kind == "image" and i.text == "quote"
    d = whatsapp.parse_inbound(wa_payload({"id": "w4", "from": "6", "timestamp": "1", "type": "document", "document": {"id": "M3"}}))[0]
    assert d.media_kind == "document"
    assert whatsapp.parse_inbound(wa_payload({"id": "w5", "type": "sticker"})) == []
    assert whatsapp.parse_inbound({}) == []


def test_parse_status():
    pl = wa_payload(status={"id": "w1", "status": "read", "timestamp": "1700000000"})
    assert whatsapp.parse_status(pl)[0][:2] == ("w1", "read")
    assert whatsapp.parse_status(wa_payload(status={"id": "w1", "status": "sent", "timestamp": "1"})) == []


def test_send_and_download():
    seen = []

    def h(req):
        seen.append(req)
        if req.method == "POST":
            return httpx.Response(200, json={"messages": [{"id": "wamid.X"}]})
        if req.url.path.endswith("/M1"):
            return httpx.Response(200, json={"url": "https://lookaside.fbsbx.com/f", "mime_type": "audio/ogg"})
        return httpx.Response(200, content=b"BYTES")

    c = httpx.Client(transport=httpx.MockTransport(h))
    kw = dict(client=c, token="tok", phone_id="PID")
    assert whatsapp.send_text("60123", "hello", **kw) == "wamid.X"
    assert json.loads(seen[0].content)["text"]["body"] == "hello"
    assert seen[0].headers["authorization"] == "Bearer tok"
    whatsapp.send_template("60123", "quote_ready", "en", ["Ali"], **kw)
    tpl = json.loads(seen[1].content)["template"]
    assert tpl["components"][0]["parameters"][0]["text"] == "Ali"
    assert whatsapp.download_media("M1", client=c, token="tok") == (b"BYTES", "audio/ogg")


def test_telegram_parse():
    base = {"message_id": 5, "chat": {"id": 99}, "date": 1700000000}
    m = telegram.parse_update({"message": {**base, "text": "hi"}})
    assert (m.channel, m.external_id, m.sender, m.text) == ("telegram", "99:5", "99", "hi")
    v = telegram.parse_update({"message": {**base, "voice": {"file_id": "F1"}}})
    assert (v.media_kind, v.media_ref) == ("audio", "F1")
    p = telegram.parse_update({"message": {**base, "photo": [{"file_id": "s"}, {"file_id": "big"}], "caption": "c"}})
    assert (p.media_kind, p.media_ref, p.text) == ("image", "big", "c")
    d = telegram.parse_update({"message": {**base, "document": {"file_id": "D"}}})
    assert d.media_kind == "document"
    assert telegram.parse_update({"edited_message": {}}) is None


def test_telegram_calls():
    def h(req):
        p = req.url.path
        if p.endswith("/sendMessage"):
            return httpx.Response(200, json={"result": {"message_id": 7, "chat": {"id": 99}}})
        if p.endswith("/getFile"):
            return httpx.Response(200, json={"result": {"file_path": "voice/a.oga"}})
        if p.endswith("/getUpdates"):
            return httpx.Response(200, json={"result": [{"update_id": 1}]})
        return httpx.Response(200, content=b"AUDIO")

    c = httpx.Client(transport=httpx.MockTransport(h))
    assert telegram.send_message(99, "x", client=c, token="T") == "99:7"
    assert telegram.get_file("F1", client=c, token="T") == b"AUDIO"
    assert telegram.get_updates(client=c, token="T")[0]["update_id"] == 1


def test_media_host_allowlist_and_token_redaction():
    def h(req):
        return httpx.Response(200, json={"url": "https://evil.example/f", "mime_type": "audio/ogg"})
    c = httpx.Client(transport=httpx.MockTransport(h))
    try:
        whatsapp.download_media("M1", client=c, token="tok")
        assert False, "must refuse a non-Meta host"
    except ValueError as e:
        assert "not allowed" in str(e)
    bad = httpx.Client(transport=httpx.MockTransport(lambda r: httpx.Response(500)))
    try:
        telegram.send_message(1, "x", client=bad, token="123:SECRET")
    except RuntimeError as e:
        assert "SECRET" not in str(e)


def test_telegram_set_webhook_sends_secret():
    seen = []
    def h(req):
        seen.append(json.loads(req.content))
        return httpx.Response(200, json={"ok": True, "result": True})
    telegram.set_webhook("https://x.test/webhooks/telegram", "sec", client=httpx.Client(transport=httpx.MockTransport(h)), token="1:T")
    assert seen[0]["secret_token"] == "sec" and seen[0]["allowed_updates"] == ["message"]


def test_whatsapp_falls_back_to_template_outside_window(monkeypatch):
    from src.api.deps import Services
    calls = []
    def h(req):
        b = json.loads(req.content)
        calls.append(b["type"])
        if b["type"] == "text":
            return httpx.Response(400, json={"error": {"code": 131047}})
        return httpx.Response(200, json={"messages": [{"id": "wamid.T"}]})
    monkeypatch.setenv("WHATSAPP_TOKEN", "t"); monkeypatch.setenv("WHATSAPP_PHONE_NUMBER_ID", "1")
    s = Services(); s.http = httpx.Client(transport=httpx.MockTransport(h))
    monkeypatch.delenv("WHATSAPP_FOLLOWUP_TEMPLATE", raising=False)
    try:
        s.send("whatsapp", "6012", "hi")
        assert False
    except httpx.HTTPStatusError:
        pass
    monkeypatch.setenv("WHATSAPP_FOLLOWUP_TEMPLATE", "quote_followup")
    assert s.send("whatsapp", "6012", "hi there") == "wamid.T" and calls[-1] == "template"


def test_whatsapp_send_uses_the_tenants_own_number(monkeypatch):
    from src.api.deps import Services
    urls = []
    def h(req):
        urls.append(req.url.path)
        return httpx.Response(200, json={"messages": [{"id": "wamid.X"}]})
    monkeypatch.setenv("WHATSAPP_TOKEN", "t"); monkeypatch.setenv("WHATSAPP_PHONE_NUMBER_ID", "SHARED")
    s = Services(); s.http = httpx.Client(transport=httpx.MockTransport(h))
    s.send("whatsapp", "6012", "a", "TENANT1"); s.send("whatsapp", "6012", "b")
    assert urls[0].endswith("/TENANT1/messages") and urls[1].endswith("/SHARED/messages")
