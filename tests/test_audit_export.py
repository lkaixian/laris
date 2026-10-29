"""Activity log search (filters, paging, polling), facets and the selective CSV / PDF export."""
import csv
import io
from datetime import timedelta

import pytest

from src import pipeline
from support.fixtures import env, pg_url  # noqa: F401
from test_rfq import other_tenant
from test_roles import member, role


def tid(e):
    return e.sql("select tenant_id from users where id=%s", (e.owner,))[0]["tenant_id"]


def ev(e, event, entity="jobs", actor=None, days_ago=0):
    """An activity log row of the owner's business (the log is append-only, so tests add rows rather than change them)."""
    return e.sql("""insert into audit_log(tenant_id, actor, entity, entity_id, event, at) values (%s, %s, %s, gen_random_uuid(), %s,
                    now() - %s * interval '1 day') returning id""", (tid(e), actor or e.owner, entity, event, days_ago))[0]["id"]


def search(e, qs="", who=None, status=200):
    r = e.c.get("/api/audit/search" + ("?" + qs if qs else ""), headers=who or e.O)
    assert r.status_code == status, r.text
    return r.json()


@pytest.fixture
def a(env):
    env.ids = {"old": ev(env, "insert", "documents", days_ago=40), "status": ev(env, "status draft->approved", "documents", days_ago=2),
               "job": ev(env, "job changed: priority", "jobs", days_ago=1), "pct": ev(env, "100% done_x", "listing_items"),
               "evil": ev(env, "=HYPERLINK(\"http://x\")", "parties", actor="system:scheduler")}
    return env


def test_search_newest_first_pages_back_and_polls_forward(a):
    e = a
    first = search(e, "limit=2")
    assert [x["id"] for x in first["items"]] == sorted((x["id"] for x in first["items"]), reverse=True) and first["has_more"]
    older = search(e, f"limit=2&before={first['items'][-1]['id']}")
    assert older["items"][0]["id"] < first["items"][-1]["id"]
    top = first["items"][0]["id"]
    assert search(e, f"after={top}")["items"] == []
    new = ev(e, "settings changed: name", "tenants")
    assert [x["id"] for x in search(e, f"after={top}")["items"]] == [new]


def test_filters_module_action_text_dates_and_person(a):
    e = a
    ids = e.ids
    got = lambda qs: {x["id"] for x in search(e, qs + "&limit=500")["items"]}
    assert ids["job"] in got("module=jobs") and not got("module=jobs") & {ids["status"], ids["pct"]}
    assert ids["status"] in got("action=status") and all(x["action"] == "status" for x in search(e, "action=status&limit=500")["items"])
    assert ids["old"] in got("action=created") and ids["job"] in got("action=other") and ids["job"] not in got("action=created")
    assert got("q=PRIORITY") == {ids["job"]}  # case-insensitive words in the event
    assert got("q=100%25") == {ids["pct"]} and got("q=d_ne") == set()  # % and _ are searched as text, not wildcards
    today = pipeline.today_my()
    assert ids["old"] not in got(f"from={(today - timedelta(days=30)).isoformat()}")
    assert ids["old"] in got(f"to={(today - timedelta(days=39)).isoformat()}") and ids["job"] not in got(f"to={(today - timedelta(days=39)).isoformat()}")
    assert got("actor=system:scheduler") == {ids["evil"]}
    owner_name = e.sql("select name from users where id=%s", (e.owner,))[0]["name"]
    assert ids["job"] in got(f"actor={owner_name}")  # the person as shown, or the stored actor
    search(e, f"from={today.isoformat()}&to={(today - timedelta(days=1)).isoformat()}", status=422)
    search(e, "action=deleted", status=422)


def test_facets_list_people_and_modules(a):
    f = a.c.get("/api/audit/facets", headers=a.O).json()
    assert {"jobs", "documents", "listing_items", "parties"} <= set(f["modules"]) and "system:scheduler" in f["people"]


def test_export_only_the_chosen_entries_as_csv_formula_guarded_and_audited(a):
    e = a
    pick = [e.ids["job"], e.ids["evil"]]
    r = e.c.get(f"/api/audit/export?format=csv&ids={pick[0]},{pick[1]}", headers=e.O)
    assert r.status_code == 200 and r.headers["content-type"].startswith("text/csv") and "activity-log-" in r.headers["content-disposition"]
    rows = list(csv.reader(io.StringIO(r.text)))
    assert rows[0] == ["entry", "time (Malaysia)", "person", "module", "action", "event"]
    assert [int(x[0]) for x in rows[1:]] == sorted(pick, reverse=True)
    evil = next(x for x in rows[1:] if int(x[0]) == e.ids["evil"])
    assert evil[5].startswith("'=")  # a spreadsheet will not run it
    assert search(e, "q=activity log exported")["items"][0]["event"] == "activity log exported: 2 entries as csv"


def test_export_by_filters_as_pdf_and_limits(a):
    e = a
    r = e.c.get("/api/audit/export?format=pdf&module=documents", headers=e.O)
    assert r.status_code == 200 and r.content.startswith(b"%PDF") and r.headers["content-type"] == "application/pdf"
    bad = lambda qs: e.c.get("/api/audit/export?" + qs, headers=e.O).status_code
    assert bad("ids=1,x") == 422 and bad("ids=" + ",".join(map(str, range(1, 1002)))) == 422 and bad("format=xlsx") == 422
    assert bad("q=no-such-event-anywhere") == 404


def test_permissions_and_tenant_isolation(a):
    e = a
    assert e.c.get("/api/audit/export?ids=1", headers=e.S).status_code == 403  # staff may read the log, not export it (export_data)
    assert e.c.get("/api/audit/search", headers=e.S).status_code == 200
    none = member(e, role(e, "Viewer", []))
    for url in ("/api/audit/search", "/api/audit/facets", f"/api/audit/export?ids={e.ids['job']}"):
        assert e.c.get(url, headers=none).status_code == 403, url
    x = other_tenant(e)
    assert all(i["id"] not in e.ids.values() for i in search(e, "limit=500", who=x)["items"])
    assert e.c.get(f"/api/audit/export?ids={e.ids['job']}", headers=x).status_code == 404


def test_days_count_entries_per_malaysian_day_newest_first(a):
    e = a
    days = e.c.get("/api/audit/days", headers=e.O).json()
    assert [d["day"] for d in days] == sorted([d["day"] for d in days], reverse=True)
    today = pipeline.today_my().isoformat()
    assert any(d["day"] == today and d["entries"] >= 2 for d in days)
    assert any(d["day"] == (pipeline.today_my() - timedelta(days=40)).isoformat() for d in days)
    assert e.c.get("/api/audit/days?limit=0", headers=e.O).status_code == 422


def test_entry_detail_scrubs_secrets_and_money_without_view_costs(a):
    e = a
    i = e.sql("""insert into audit_log(tenant_id, actor, entity, entity_id, event, before, after) values (%s, %s, 'jobs', gen_random_uuid(),
                 'job changed: notes', '{"notes": "old", "unit_cost": 5}', '{"notes": "new", "api_token": "abc", "unit_cost": 7}') returning id""",
              (tid(e), e.owner))[0]["id"]
    d = e.c.get(f"/api/audit/{i}", headers=e.O).json()
    assert d["before"]["notes"] == "old" and d["after"]["notes"] == "new" and d["after"]["api_token"] == "[hidden]" and d["after"]["unit_cost"] == 7
    s = e.c.get(f"/api/audit/{i}", headers=e.S)
    assert s.status_code == 200 and s.json()["after"].get("unit_cost", "[hidden]") == "[hidden]" and s.json()["after"]["notes"] == "new"
    assert e.c.get("/api/audit/999999999", headers=e.O).status_code == 404
    assert e.c.get("/api/audit/export?ids=" + str(i), headers=e.O).status_code == 200  # the {entry} route does not swallow export
    x = other_tenant(e)
    assert e.c.get(f"/api/audit/{i}", headers=x).status_code == 404
