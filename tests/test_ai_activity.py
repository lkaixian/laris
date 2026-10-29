"""The AI tab's activity: one counted row per model call, the owner sees all of it and staff only their own, and no text is ever kept."""
import json

from support.fixtures import env, pg_url  # noqa: F401

MSG = "who is zain@bakti.my, call 012-345 6789"


def ask(e, who):
    e.ai.payload = {"intent": "help", "query": None}
    assert e.c.post("/api/assistant", json={"message": MSG}, headers=who).status_code == 200


def test_activity_is_counted_scoped_by_role_and_holds_no_text(env):
    e = env
    ask(e, e.S)
    ask(e, e.O)
    ask(e, e.O)
    a = e.c.get("/api/ai/activity", headers=e.O).json()
    assert a["scope"] == "all" and a["totals"]["calls"] == 3 and a["totals"]["failed"] == 0
    assert a["by_kind"] == {"assistant": 3} and a["totals"]["masked"] == {"EMAIL": 3, "PHONE": 3}
    assert {x["person"] for x in a["recent"]} <= {x["name"] for x in e.sql("select name from users")}
    s = e.c.get("/api/ai/activity", headers=e.S).json()
    assert s["scope"] == "own" and s["totals"]["calls"] == 1 and len(s["recent"]) == 1
    dump = json.dumps(e.sql("select * from ai_calls"), default=str)
    assert "bakti" not in dump and "345 6789" not in dump


def test_a_failed_call_is_counted_as_failed(env):
    e = env
    e.ai.fail = True
    assert e.c.post("/api/assistant", json={"message": MSG}, headers=e.S).status_code == 200  # the Assistant falls back to keywords
    a = e.c.get("/api/ai/activity", headers=e.O).json()
    assert a["totals"]["calls"] == 1 and a["totals"]["failed"] == 1
