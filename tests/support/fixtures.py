"""Shared fixtures for API tests: fresh seeded PGlite DB per test, mocked ILMU / channels (no network)."""
import json
from contextlib import contextmanager

import httpx
import psycopg
import pytest
from fastapi.testclient import TestClient

from src import clock, db
from src.api import deps, webhooks
from src.api.deps import Services
from src.app import app

from .pg import pg_url  # noqa: F401  (re-exported fixture)


def same(*rs):
    """Equal JSON bodies, ignoring the per-response error.request_id."""
    bodies = [{**r.json(), "error": {k: v for k, v in r.json()["error"].items() if k != "request_id"}} if "error" in r.json() else r.json() for r in rs]
    return all(b == bodies[0] for b in bodies)


class AI:
    """What the mocked ILMU chat endpoint answers next. `fail` = HTTP 500."""
    payload: dict = {}
    fail = False
    calls = 0


class FakeSvc(Services):
    def __init__(self, ai):
        super().__init__()
        self.sent, self.media = [], {}
        self.outbox = []  # emails: (to, subject, text, html, category)
        self.attached = []  # the attachments of each email, parallel to outbox ([] when none)
        self.docs = []  # PDFs sent on a chat channel: (channel, to, filename, caption, bytes, phone_id)
        self.mail = lambda to, subject, text, html=None, category=None, attachments=None: (
            self.outbox.append((to, subject, text, html, category)), self.attached.append(attachments or []), True)[-1]

        def handler(req: httpx.Request):
            ai.calls += 1
            if ai.fail:
                return httpx.Response(500, text="boom")
            return httpx.Response(200, json={"choices": [{"message": {"content": json.dumps(ai.payload)}}]})
        self.ilmu = httpx.Client(transport=httpx.MockTransport(handler))

    def send(self, channel, to, text, phone_id=None):
        self.sent.append((channel, to, text))
        self.via = getattr(self, "via", []) + [phone_id]
        return f"wamid.{len(self.sent)}"

    def send_document(self, channel, to, data, filename, caption, phone_id=None):
        self.docs.append((channel, to, filename, caption, data, phone_id))
        return f"doc.{len(self.docs)}"

    def download(self, channel, ref, kind, token=None):
        self.dl_tokens = getattr(self, "dl_tokens", []) + [token]
        return self.media[ref]


class Env:
    def __init__(self, client, ai, svc):
        self.c, self.ai, self.svc = client, ai, svc
        with db.tx(tenant=db.ALL_TENANTS) as c:
            self.owner = str(c.execute("select id from users where role='owner'").fetchone()["id"])
            self.staff = str(c.execute("select id from users where role='staff'").fetchone()["id"])
        self.O = {"X-Role": "owner", "X-User": self.owner}
        self.S = {"X-Role": "staff", "X-User": self.staff}

    def sql(self, q, p=(), role="owner"):
        with db.tx(role, self.owner, tenant=db.ALL_TENANTS) as c:
            cur = c.execute(q, p)
            return cur.fetchall() if cur.description else None

    def enquire(self, items, text="10 small parts", headers=None, channel="web"):
        self.ai.payload = {"items": items}
        return self.c.post("/api/enquiries/simulate", json={"channel": channel, "text": text}, headers=headers or self.S)

    def stock_costs(self):
        """Real flow: supplier text -> ingest -> staff review -> owner accept -> promote. Returns the doc id."""
        self.ai.payload = {"supplier_name": "SAMPLE Supplier B Filament Sdn Bhd", "doc_no": "SB-777",
                           "issued_on": self.sql("select (current_date - 1)::text d")[0]["d"],
                           "lines": [{"description": "pla black", "qty": 10, "uom": "kg", "unit_price": 50, "amount": 500},
                                     {"description": "box", "qty": 100, "uom": "pcs", "unit_price": 1.5, "amount": 150}],
                           "totals": {"subtotal": 650}}
        r = self.c.post("/api/documents/ingest", data={"text": "supplier quote text"}, headers=self.S)
        assert r.status_code == 201, r.text
        doc = r.json()["id"]
        for who, to in ((self.S, "reviewed"), (self.O, "accepted"), (self.O, "in_cost_book")):
            assert self.c.post(f"/api/documents/{doc}/transition", json={"to": to}, headers=who).status_code == 200
        return doc

    def shock(self, price=140, desc="SAMPLE acrylic 3mm sheet", doc_no="QA-2026-0161"):
        """The live demo: the newer acrylic quote (fixture 06b) arrives, staff confirm the fuzzy item match, owner accepts."""
        self.ai.payload = {"supplier_name": "SAMPLE Supplier A Acrylic Sdn Bhd", "doc_no": doc_no,
                           "issued_on": self.sql("select (current_date - 1)::text d")[0]["d"],
                           "lines": [{"description": desc, "qty": 10, "uom": "sheet", "unit_price": price, "amount": 10 * price}]}
        r = self.c.post("/api/documents/ingest", data={"text": f"supplier quote text {doc_no} {price}"}, headers=self.S)
        assert r.status_code == 201, r.text
        doc = r.json()["id"]
        ln = self.c.get(f"/api/documents/{doc}", headers=self.S).json()["lines"][0]
        assert self.c.post(f"/api/documents/{doc}/lines/{ln['id']}", json={"item_key": "acrylic_3mm_sheet", "needs_review": False},
                           headers=self.S).status_code == 200
        for who, to in ((self.S, "reviewed"), (self.O, "accepted"), (self.O, "in_cost_book")):
            assert self.c.post(f"/api/documents/{doc}/transition", json={"to": to}, headers=who).status_code == 200
        return doc


@pytest.fixture
def env(pg_url, monkeypatch):
    monkeypatch.setenv("DATABASE_URL", pg_url)
    monkeypatch.setenv("ILMU_API_KEY", "test-key")
    monkeypatch.setenv("DEMO_MODE", "1")  # header-only demo mode; tests of the real rule unset it
    with psycopg.connect(pg_url, autocommit=True) as c:
        c.execute("drop schema public cascade; create schema public")
    db.apply_schema(seed=True)
    with psycopg.connect(pg_url, autocommit=True) as c:  # the app runs as laris_app, so row-level security applies to every test
        c.execute((db.DB_DIR / "roles.sql").read_text(encoding="utf-8"))
    real_tx = db.tx

    @contextmanager
    def as_app(*a, **k):
        with real_tx(*a, **k) as c:
            c.execute("set local role laris_app")
            yield c
    monkeypatch.setattr(db, "tx", as_app)
    monkeypatch.setattr(clock, "_store", lambda conn, *a: clock._upsert(conn, *a))  # PGlite serves one connection at a time: no second one while a request transaction is open
    ai = AI()
    ai.payload, ai.fail, ai.calls = {}, False, 0
    svc = FakeSvc(ai)
    app.state.svc = svc
    webhooks._HITS.clear()
    deps.HITS.clear()  # per-user write limits
    yield Env(TestClient(app), ai, svc)
    app.state.svc = Services()
