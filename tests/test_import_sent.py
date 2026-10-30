"""POST /api/documents/import-sent: a quotation the owner made and sent outside LARIS becomes a tracked outgoing quote in status 'sent'."""
from support.fixtures import env, pg_url  # noqa: F401

PAPER = {"doc_no": "MY-OWN-17", "issued_on": "2026-10-01", "currency": "MYR",
         "lines": [{"description": "Acrylic signboard 60x30", "qty": 4, "uom": "pcs", "unit_price": 120, "amount": 480},
                   {"description": "Install", "qty": None, "uom": "job", "unit_price": 150}],
         "totals": {"grand_total": 630}}


def go(e, who=None, **kw):
    e.ai.payload = kw.pop("payload", PAPER)
    return e.c.post("/api/documents/import-sent", data={"text": "my quotation", "customer": "SAMPLE Customer Ah Meng", **kw}, headers=who or e.O)


def test_owner_import_becomes_a_sent_quote_with_the_papers_own_prices(env):
    e = env
    r = go(e, sent_on="2026-10-02")
    assert r.status_code == 201, r.text
    d = e.sql("select direction::text d, status::text s, doc_no, sent_at is not null sent, approved_by is not null ap, source_channel::text ch, stated_total::float st from documents where id=%s",
              (r.json()["id"],))[0]
    assert d == {"d": "out", "s": "sent", "doc_no": "MY-OWN-17", "sent": True, "ap": True, "ch": "upload", "st": 630.0}
    ls = e.sql("select description, qty::float q, unit_price::float p, price_source::text ps, needs_review nr from document_lines where document_id=%s order by line_no", (r.json()["id"],))
    assert ls[0] == {"description": "Acrylic signboard 60x30", "q": 4.0, "p": 120.0, "ps": "owner_override", "nr": False}
    assert ls[1]["nr"] is True and ls[1]["q"] is None  # no readable quantity: flagged, not guessed
    assert e.sql("select p.name, p.role::text r from parties p join documents d on d.party_id=p.id where d.id=%s", (r.json()["id"],)) == [{"name": "SAMPLE Customer Ah Meng", "r": "customer"}]
    assert e.sql("select count(*) n from audit_log where event='own quotation added as sent'")[0]["n"] == 1


def test_it_is_tracked_and_can_get_an_accept_link(env, monkeypatch):
    e = env
    monkeypatch.setenv("APP_PUBLIC_URL", "https://laris.example")
    doc = go(e).json()["id"]
    tr = e.c.get("/api/track", headers=e.O).json()
    assert doc in str(tr)
    assert e.c.post(f"/api/documents/{doc}/accept-link", headers=e.O).status_code in (200, 201)


def test_owner_only_and_validation(env):
    e = env
    assert go(e, e.S).status_code == 403
    assert go(e, sent_on="2999-01-01").json()["error"]["code"] == "future_date"
    assert e.c.post("/api/documents/import-sent", data={"text": "x"}, headers=e.O).status_code == 422  # a customer name is required
    assert e.c.post("/api/documents/import-sent", data={"customer": "A"}, headers=e.O).json()["error"]["code"] == "empty"
    assert go(e, payload={"lines": []}).json()["error"]["code"] == "no_lines"


def test_same_quotation_twice_is_refused(env):
    e = env
    assert go(e).status_code == 201
    assert go(e).json()["error"]["code"] == "duplicate"
    assert go(e, payload=dict(PAPER, lines=PAPER["lines"][:1], totals={}), customer="SAMPLE Customer Ah Meng").json()["error"]["code"] == "duplicate"  # same number, same customer
