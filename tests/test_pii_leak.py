"""No model call may carry a seeded customer name, email, phone or card number, whichever route made it."""
import json

import httpx
from support.fixtures import env, pg_url  # noqa: F401

SECRETS = ("Zainuddin Bakti", "Puan Rohani", "zain@bakti.my", "012-345 6789", "4242 4242 4242 4242")
TEXT = ("Quote for zainuddin bakti, attn Puan Rohani. Mail zain@bakti.my or call 012-345 6789, "
        "card 4242 4242 4242 4242. 10 small parts, SB-777 RM 50")


def test_no_route_sends_a_seeded_secret_to_the_model(env):
    e = env
    e.sql("insert into parties (tenant_id, role, name, attention) select id, 'customer', %s, %s from tenants limit 1", ("Zainuddin Bakti", "Puan Rohani"))
    sent = []

    def handler(req: httpx.Request):
        sent.append(req.content.decode())
        return httpx.Response(200, json={"choices": [{"message": {"content": json.dumps(e.ai.payload)}}]})
    e.svc.ilmu = httpx.Client(transport=httpx.MockTransport(handler))

    e.ai.payload = {"items": [{"item_key": "x", "qty": 1}]}
    e.c.post("/api/enquiries/simulate", json={"channel": "web", "text": TEXT}, headers=e.S)
    e.ai.payload = {"supplier_name": "S", "lines": []}
    e.c.post("/api/documents/ingest", data={"text": TEXT}, headers=e.S)
    e.ai.payload = {"intent": "help", "query": None}
    assert e.c.post("/api/assistant", json={"message": TEXT[:500]}, headers=e.S).status_code == 200
    assert len(sent) >= 3, "a route stopped calling the model, so this test no longer covers it"
    for body in sent:
        low = body.lower()
        for s in SECRETS:
            assert s.lower() not in low, f"{s!r} reached the model"
