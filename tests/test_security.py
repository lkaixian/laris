"""Transport hardening: response headers, docs off by default, body caps, streamed media caps, pixel cap, no constraint-name leaks."""
import importlib
import io

import httpx
import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from src import app as app_mod
from src.app import SPA, _secure_headers, app
from src.channels import telegram, whatsapp
from support.fixtures import env, pg_url  # noqa: F401

HEADERS = ("x-content-type-options", "referrer-policy", "permissions-policy", "content-security-policy", "x-frame-options")


def test_headers_on_health_and_static(tmp_path):
    r = TestClient(app).get("/health")
    assert r.headers["x-content-type-options"] == "nosniff" and r.headers["x-frame-options"] == "DENY"
    assert r.headers["referrer-policy"] == "no-referrer" and "camera=(self)" in r.headers["permissions-policy"]
    csp = r.headers["content-security-policy"]
    assert "script-src 'self'" in csp and "frame-ancestors 'none'" in csp and "object-src 'none'" in csp
    assert "cache-control" not in r.headers and "strict-transport-security" not in r.headers
    (tmp_path / "index.html").write_text("<html>app</html>")
    a = FastAPI()
    a.middleware("http")(_secure_headers)
    a.mount("/", SPA(directory=tmp_path, html=True))
    r = TestClient(a).get("/doc/1")
    assert all(h in r.headers for h in HEADERS) and r.text == "<html>app</html>"


def test_api_headers_and_no_store(env):
    r = env.c.get("/api/me", headers=env.O)
    assert r.status_code == 200 and r.headers["cache-control"] == "no-store"
    assert all(h in r.headers for h in HEADERS)


def test_hsts_only_on_https(monkeypatch):
    c = TestClient(app)
    assert "strict-transport-security" not in c.get("/health").headers
    assert c.get("/health", headers={"X-Forwarded-Proto": "https"}).headers.get("strict-transport-security") is None  # not trusted
    assert TestClient(app, base_url="https://testserver").get("/health").headers["strict-transport-security"] == "max-age=31536000"
    monkeypatch.setenv("TRUST_PROXY", "1")
    assert c.get("/health", headers={"X-Forwarded-Proto": "https"}).headers["strict-transport-security"] == "max-age=31536000"
    assert "strict-transport-security" not in c.get("/health", headers={"X-Forwarded-Proto": "http"}).headers


def test_docs_off_by_default_and_on_with_flag(monkeypatch):
    c = TestClient(app)
    assert [c.get(p).status_code for p in ("/docs", "/redoc", "/openapi.json")] == [404, 404, 404]
    monkeypatch.setenv("ENABLE_DOCS", "1")
    try:
        on = TestClient(importlib.reload(app_mod).app)
        assert [on.get(p).status_code for p in ("/docs", "/redoc", "/openapi.json")] == [200, 200, 200]
    finally:
        monkeypatch.delenv("ENABLE_DOCS")
        importlib.reload(app_mod)


def test_chunked_and_unsized_bodies_rejected():
    c = TestClient(app)
    r = c.post("/api/enquiries/simulate", content=iter([b'{"a":', b"1}"]))  # httpx sends Transfer-Encoding: chunked
    assert r.status_code == 411 and r.json()["error"]["code"] == "length_required" and "x-frame-options" in r.headers
    assert c.post("/webhooks/telegram", content=iter([b"{}"])).status_code == 411
    assert c.post("/webhooks/telegram", content=b"x" * 1_100_000).status_code == 413


def test_multipart_cap_enforced_while_reading(env):
    e = env
    big = b"%PDF" + b"0" * 10_050_000  # passes the Content-Length gate (cap + 100 kB), so the read loop must stop it
    r = e.c.post("/api/documents/ingest", files={"file": ("a.pdf", big, "application/pdf")}, headers=e.S)
    assert r.status_code == 413 and r.json()["error"]["message"] == "file over 10 MB"
    r = e.c.post("/api/documents/ingest", files={"file": ("a.pdf", big + b"0" * 200_000, "application/pdf")}, headers=e.S)
    assert r.status_code == 413  # Content-Length gate
    sup = e.sql("select id from parties where role='supplier' limit 1")[0]["id"]
    r = e.c.post("/api/rfq", data={"description": "x", "supplier_ids": str(sup)},
                 files={"image": ("a.png", b"\x89PNG\r\n\x1a\n" + b"0" * 8_100_000, "image/png")}, headers=e.O)
    assert r.status_code == 413 and r.json()["error"]["message"] == "photo over 8 MB"


def test_oversized_media_aborted():
    def wa(req):
        if req.url.path.endswith("/M1"):
            return httpx.Response(200, json={"url": "https://lookaside.fbsbx.com/f", "mime_type": "image/jpeg"})
        return httpx.Response(200, content=b"0" * 20_000_001)

    with pytest.raises(ValueError, match="over 20 MB"):
        whatsapp.download_media("M1", client=httpx.Client(transport=httpx.MockTransport(wa)), token="t")

    def tg(req):
        if req.url.path.endswith("/getFile"):
            return httpx.Response(200, json={"result": {"file_path": "a/b.jpg"}})
        return httpx.Response(200, content=b"0" * 20_000_001)

    with pytest.raises(ValueError, match="over 20 MB"):
        telegram.get_file("F", client=httpx.Client(transport=httpx.MockTransport(tg)), token="T")


def test_image_over_pixel_cap_is_422_not_500(env):
    from PIL import Image
    buf = io.BytesIO()
    Image.new("1", (7000, 7000)).save(buf, "PNG")  # 49 Mpx, a few KB
    r = env.c.post("/api/documents/ingest", files={"file": ("a.png", buf.getvalue(), "image/png")}, headers=env.S)
    assert r.status_code == 422 and r.json()["error"]["code"] == "ocr_failed"


def test_constraint_violation_does_not_leak_names(env):
    e = env
    a, b = [x["id"] for x in e.sql("select id from parties where role='supplier' order by name limit 2")]
    name = e.sql("select name from parties where id=%s", (b,))[0]["name"]
    r = e.c.post(f"/api/contacts/{a}", json={"name": name}, headers=e.O)
    assert r.status_code == 409, r.text
    msg = r.json()["error"]["message"]
    assert "constraint" not in msg and "parties" not in msg and "key" not in msg
