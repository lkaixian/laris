from fastapi.testclient import TestClient

from src.app import app


def test_health():
    r = TestClient(app).get("/health")
    assert r.status_code == 200 and r.json() == {"status": "ok"}


def test_spa_fallback(tmp_path):
    from fastapi import FastAPI
    from fastapi.testclient import TestClient
    from src.app import SPA
    (tmp_path / "index.html").write_text("<html>app</html>")
    (tmp_path / "a.js").write_text("x=1")
    a = FastAPI()
    a.mount("/", SPA(directory=tmp_path, html=True))
    c = TestClient(a)
    assert c.get("/a.js").text == "x=1"
    assert c.get("/doc/123").text == "<html>app</html>"  # client-side route
    assert c.get("/api/nope").status_code == 404 and c.get("/webhooks/nope").status_code == 404
