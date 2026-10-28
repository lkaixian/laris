"""Guided-tour progress: per person, own row only, the server turns a second 'later' into 'skipped'."""
from support.fixtures import env, pg_url  # noqa: F401
from test_rfq import other_tenant
from test_roles import member, role

URL = "/api/me/onboarding"


def test_default_view_and_transitions(env):
    e = env
    assert e.c.get(URL, headers=e.O).json() == {"tour": "owner", "state": "new", "step": 0, "later_count": 0}
    assert e.c.get(URL, headers=e.S).json() == {"tour": "staff", "state": "new", "step": 0, "later_count": 0}
    r = e.c.post(URL, json={"state": "in_progress", "step": 3}, headers=e.S)
    assert r.status_code == 200 and r.json() == {"tour": "staff", "state": "in_progress", "step": 3, "later_count": 0}
    assert e.c.post(URL, json={"state": "in_progress"}, headers=e.S).json()["step"] == 3  # step kept when not sent
    assert e.c.post(URL, json={"state": "in_progress", "step": 51}, headers=e.S).status_code == 422
    assert e.c.get(URL, headers=e.O).json()["state"] == "new"  # the owner's row is untouched
    assert e.c.post(URL, json={"state": "done", "step": 9}, headers=e.S).json()["state"] == "done"
    assert e.c.post(URL, json={"state": "in_progress", "step": 0, "tour": "owner"}, headers=e.S).json()["tour"] == "owner"


def test_later_twice_becomes_skipped_and_final_until_restart(env):
    e = env
    assert e.c.post(URL, json={"state": "later"}, headers=e.O).json() == {"tour": "owner", "state": "later", "step": 0, "later_count": 1}
    r = e.c.post(URL, json={"state": "later"}, headers=e.O).json()
    assert r["state"] == "skipped" and r["later_count"] == 2
    assert e.c.post(URL, json={"state": "done"}, headers=e.O).json()["state"] == "skipped"  # final
    r = e.c.post(URL, json={"state": "in_progress", "step": 0}, headers=e.O).json()  # restart from Help
    assert r["state"] == "in_progress" and r["later_count"] == 0
    assert e.c.post(URL, json={"state": "done"}, headers=e.O).json()["state"] == "done"
    assert e.c.post(URL, json={"state": "later"}, headers=e.O).json()["state"] == "done"
    assert e.c.post(URL, json={"state": "in_progress"}, headers=e.O).json()["state"] == "in_progress"


def test_own_row_only_and_unknown_keys(env):
    e = env
    other = other_tenant(e)
    e.c.post(URL, json={"state": "done"}, headers=e.O)
    assert e.c.get(URL, headers=other).json()["state"] == "new"  # another tenant's owner
    assert e.c.get(URL, headers=e.S).json()["state"] == "new"  # another user, same tenant
    assert e.c.post(URL, json={"state": "skipped"}, headers=other).json()["state"] == "skipped"
    assert e.c.get(URL, headers=e.O).json()["state"] == "done"
    rows = e.sql("select user_id from user_onboarding")
    assert len(rows) == 2 and len({x["user_id"] for x in rows}) == 2
    for body in ({"state": "done", "user_id": "x"}, {"state": "done", "tenant_id": "x"}, {"state": "bogus"}, {}):
        assert e.c.post(URL, json=body, headers=e.O).status_code == 422
    none = member(e, role(e, "Nothing", []))  # no permissions still reads and writes its own tour
    assert e.c.post(URL, json={"state": "in_progress", "step": 1}, headers=none).status_code == 200
