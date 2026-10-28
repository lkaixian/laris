"""Step 109: on-track tracker. Rules table (pure), status_changed_at in the database, the document timeline, GET /api/track, dashboard.track."""
import json
from datetime import date, datetime, timedelta, timezone
from decimal import Decimal

import psycopg
import pytest

from src import db, scheduler
from src import track_rules as tr
from src.api.deps import STAFF_HIDE
from src.pipeline import MY
from support.fixtures import env, pg_url  # noqa: F401
from test_api import PART, keys, make_draft
from test_api import tr as move
from test_roles import member, role
from test_rfq import other_tenant

NOW = datetime(2026, 6, 10, 12, 0, tzinfo=MY)
TODAY = NOW.date()


def ago(**kw):
    return NOW - timedelta(**kw)


# ---------------------------------------------------------------- rules (pure)
@pytest.mark.parametrize("kind,status,kw,why", [
    ("quote", "draft", {"since": ago(days=3)}, None),
    ("quote", "draft", {"since": ago(days=4)}, "quote waiting for approval/sending"),
    ("quote", "approved", {"since": ago(days=3)}, None),
    ("quote", "approved", {"since": ago(days=4)}, "quote waiting for approval/sending"),
    ("quote", "sent", {"since": ago(days=9), "sent_at": ago(hours=48)}, None),
    ("quote", "sent", {"since": ago(days=9), "sent_at": ago(hours=48, seconds=1)}, "no reply since sent"),
    ("quote", "read", {"since": ago(hours=1), "sent_at": ago(hours=49)}, "no reply since sent"),  # the clock runs from sent, not from read
    ("quote", "sent", {"since": ago(hours=25), "sent_at": ago(hours=25), "followup_hours": 24}, "no reply since sent"),
    ("quote", "sent", {"since": ago(hours=25), "sent_at": ago(hours=25), "followup_hours": 72}, None),
    ("quote", "sent", {"since": ago(hours=1), "sent_at": ago(hours=1)}, None),
    ("quote", "sent", {"since": ago(hours=1), "valid_until": TODAY + timedelta(days=3)}, "expires soon"),
    ("quote", "sent", {"since": ago(hours=1), "valid_until": TODAY + timedelta(days=4)}, None),
    ("quote", "sent", {"since": ago(hours=1), "valid_until": TODAY - timedelta(days=1)}, "expires soon"),
    ("quote", "draft", {"since": ago(hours=1), "valid_until": TODAY + timedelta(days=2)}, "expires soon"),
    ("supplier_doc", "received", {"since": ago(days=2)}, None),
    ("supplier_doc", "received", {"since": ago(days=3)}, "waiting for review"),
    ("supplier_doc", "parsed", {"since": ago(days=2)}, None),
    ("supplier_doc", "parsed", {"since": ago(days=3)}, "waiting for review"),
    ("supplier_doc", "reviewed", {"since": ago(days=2)}, None),
    ("supplier_doc", "reviewed", {"since": ago(days=3)}, "waiting for owner decision"),
    ("rfq", "waiting", {"since": ago(days=2)}, None),
    ("rfq", "waiting", {"since": ago(days=3)}, "supplier has not replied"),
    ("rfq", "needs_review", {"since": ago(days=30)}, None),
    ("rfq", "ready", {"since": ago(days=30)}, None),
    ("listing", "needs_review", {"since": ago(days=3)}, None),
    ("listing", "needs_review", {"since": ago(days=4)}, "catalog item waiting for review"),
])
def test_rules_fire_only_past_the_boundary(kind, status, kw, why):
    assert tr.overdue_reason(kind, status, kw.pop("since"), NOW, **kw) == why


@pytest.mark.parametrize("kind", tr.KINDS)
@pytest.mark.parametrize("status", sorted(tr.TERMINAL))
def test_terminal_states_are_never_overdue(kind, status):
    assert tr.overdue_reason(kind, status, ago(days=400), NOW, sent_at=ago(days=400), valid_until=TODAY - timedelta(days=300)) is None


def test_stage_age_counts_malaysia_calendar_days():
    utc = timezone.utc
    since = datetime(2026, 6, 9, 15, 0, tzinfo=utc)  # 23:00 on the 9th in Kuala Lumpur
    assert tr.days_in_stage(since, datetime(2026, 6, 9, 17, 0, tzinfo=utc)) == 1  # 01:00 on the 10th: a new day, two hours later
    assert tr.days_in_stage(since, datetime(2026, 6, 9, 15, 59, tzinfo=utc)) == 0
    assert tr.days_in_stage(since, datetime(2026, 6, 12, 15, 0, tzinfo=utc)) == 3
    assert tr.label("in_cost_book") == "In cost book" and tr.label("waiting") == "Waiting for supplier"


# ---------------------------------------------------------------- status_changed_at
def changed(e, doc):
    return e.sql("select status_changed_at s, created_at c from documents where id=%s", (doc,))[0]


def test_status_changed_at_moves_on_transition_only(env):
    e = env
    d = make_draft(e)
    assert changed(e, d)["s"] == changed(e, d)["c"]
    old = datetime.now(timezone.utc) - timedelta(days=9)
    e.sql("update documents set status_changed_at=%s where id=%s", (old, d))
    e.sql("update documents set payment_terms='net 30' where id=%s", (d,))  # not a status change
    assert changed(e, d)["s"] == old
    assert move(e, d, "approved").status_code == 200
    assert changed(e, d)["s"] > old + timedelta(days=8)
    # the same for an ask-suppliers reply and a catalog item
    ids = seed_rfq_and_listing(e, party(e, "supplier", "ZZ Sup"))
    for table, row in (("rfq_replies", ids["reply"]), ("listing_items", ids["item"])):
        e.sql(f"update {table} set status_changed_at=%s where id=%s", (old, row))
        e.sql(f"update {table} set created_at=created_at where id=%s", (row,))
        assert e.sql(f"select status_changed_at s from {table} where id=%s", (row,))[0]["s"] == old
        e.sql(f"update {table} set status=%s where id=%s", ("ready" if table == "rfq_replies" else "confirmed", row))
        assert e.sql(f"select status_changed_at s from {table} where id=%s", (row,))[0]["s"] > old + timedelta(days=8)


def trig(e, table):
    return e.sql("select count(*) n from pg_trigger where tgrelid=%s::regclass and tgname=%s", (table, table + "_status_changed"))[0]["n"]


def test_apply_schema_twice_is_harmless_and_does_not_backfill_again(env):
    e = env
    d = make_draft(e)
    old = datetime.now(timezone.utc) - timedelta(days=9)
    e.sql("update documents set status_changed_at=%s where id=%s", (old, d))
    audits = e.sql("select count(*) n from audit_log where entity='documents'")[0]["n"]
    db.apply_schema(seed=False)
    db.apply_schema(seed=False)
    assert changed(e, d)["s"] == old
    assert all(trig(e, t) == 1 for t in ("documents", "rfq_replies", "listing_items"))
    assert e.sql("select count(*) n from audit_log where entity='documents'")[0]["n"] == audits
    assert move(e, d, "approved").status_code == 200  # the guard still works next to the new trigger
    assert changed(e, d)["s"] > old
    assert move(e, d, "cancelled", e.S).status_code == 403  # and still refuses a role it should


def test_backfill_uses_the_last_status_event_else_created_at(env, pg_url):
    e = env
    a = make_draft(e)
    b = e.enquire([PART]).json()["id"]
    assert move(e, a, "approved").status_code == 200  # b stays a draft: no status event
    sup = party(e, "supplier", "ZZ Sup")
    ids = seed_rfq_and_listing(e, sup)
    when = datetime.now(timezone.utc) - timedelta(days=5)
    e.sql("update rfq_replies set created_at=%s where id=%s", (when, ids["reply"]))
    e.sql("update listing_items set created_at=%s where id=%s", (when, ids["item"]))
    last = e.sql("select max(at) t from audit_log where entity_id=%s and event like 'status %%'", (a,))[0]["t"]
    audits = e.sql("select count(*) n from audit_log where entity='documents'")[0]["n"]
    with psycopg.connect(pg_url, autocommit=True) as c:  # a database from before this step
        c.execute("select set_config('laris.tenant','*',false)")
        for t in ("documents", "rfq_replies", "listing_items"):
            c.execute(f"alter table {t} drop column status_changed_at")
    db.apply_schema(seed=False)
    assert changed(e, a)["s"] == last
    assert changed(e, b)["s"] == changed(e, b)["c"]
    for t, row in (("rfq_replies", ids["reply"]), ("listing_items", ids["item"])):
        assert e.sql(f"select status_changed_at = created_at as ok from {t} where id=%s", (row,))[0]["ok"]
    assert e.sql("select count(*) n from audit_log where entity='documents'")[0]["n"] == audits  # a back-fill is not an edit


# ---------------------------------------------------------------- data helpers
def party(e, role_, name):
    return e.sql("insert into parties(tenant_id,role,name) select tenant_id,%s::party_role,%s from users where id=%s returning id",
                 (role_, name, e.owner))[0]["id"]


def doc(e, direction, status, no, pid, days=0, price=None, sent_days=None, valid_until=None):
    at = datetime.now(timezone.utc) - timedelta(days=days)
    approved = direction == "out" and status not in ("draft", "cancelled")
    d = e.sql("""insert into documents(tenant_id,direction,kind,party_id,doc_no,status,issued_on,valid_until,approved_by,approved_at,sent_at,status_changed_at)
                 select tenant_id,%s::doc_direction,'quotation',%s,%s,%s::doc_status,current_date,%s,
                        case when %s then id end, case when %s then now() end, %s, %s from users where id=%s returning id""",
              (direction, pid, no, status, valid_until, approved, approved,
               datetime.now(timezone.utc) - timedelta(days=sent_days) if sent_days is not None else None, at, e.owner))[0]["id"]
    if price is not None:
        e.sql("insert into document_lines(document_id,line_no,description,qty,uom,unit_price) values (%s,1,'thing',2,'pcs',%s)", (d, price))
    return d


def seed_rfq(e, sup, status="waiting", days=0, price=None, desc="ZZ ballet flat"):
    at = datetime.now(timezone.utc) - timedelta(days=days)
    rfq = e.sql("""insert into rfq_items(tenant_id,description,note,image,image_mime) select tenant_id,%s,'n',decode('00','hex'),'image/png'
                   from users where id=%s returning id, tenant_id""", (desc, e.owner))[0]
    send = e.sql("insert into rfq_sends(rfq_item_id,tenant_id,supplier_id,status) values (%s,%s,%s,'sent') returning id", (rfq["id"], rfq["tenant_id"], sup))[0]["id"]
    return e.sql("insert into rfq_replies(send_id,tenant_id,status,unit_price,message_text,status_changed_at) values (%s,%s,%s,%s,%s,%s) returning id",
                 (send, rfq["tenant_id"], status, price, "RM 12 each" if price else None, at))[0]["id"]


def seed_listing(e, sup, status="needs_review", days=0, price=None, desc="ZZ list item"):
    at = datetime.now(timezone.utc) - timedelta(days=days)
    t = e.sql("select tenant_id from users where id=%s", (e.owner,))[0]["tenant_id"]
    lst = e.sql("insert into listings(tenant_id,party_id,image,image_mime) values (%s,%s,decode('00','hex'),'image/png') returning id", (t, sup))[0]["id"]
    return e.sql("""insert into listing_items(listing_id,tenant_id,position,description,bbox,crop,price,status,status_changed_at)
                    values (%s,%s,0,%s,'[0,0,1,1]',decode('00','hex'),%s,%s,%s) returning id""", (lst, t, desc, price, status, at))[0]["id"]


def seed_rfq_and_listing(e, sup):
    return {"reply": seed_rfq(e, sup), "item": seed_listing(e, sup)}


def world(e):
    """13 items, 5 of them overdue; every ref / party starts with ZZ so q=ZZ isolates them from the demo seed."""
    cust, sup = party(e, "customer", "ZZ Cust"), party(e, "supplier", "ZZ Sup")
    w = {"Q1": doc(e, "out", "draft", "ZZ-Q1", cust, days=5, price=10),
         "Q2": doc(e, "out", "draft", "ZZ-Q2", cust, price=10),
         "Q3": doc(e, "out", "sent", "ZZ-Q3", cust, days=1, price=10, sent_days=1),
         "Q4": doc(e, "out", "sent", "ZZ-Q4", cust, days=3, price=10, sent_days=3),
         "Q5": doc(e, "out", "accepted", "ZZ-Q5", cust, days=10, price=10),
         "S1": doc(e, "in", "received", "ZZ-S1", sup, days=4, price=7),
         "S2": doc(e, "in", "reviewed", "ZZ-S2", sup, days=1, price=7),
         "S3": doc(e, "in", "in_cost_book", "ZZ-S3", sup, days=20, price=7)}
    for k, (st, days, price) in {"R1": ("waiting", 4, None), "R2": ("ready", 1, 12), "R3": ("accepted", 8, 12)}.items():
        w[k] = seed_rfq(e, sup, st, days, price)
    for k, (st, days) in {"L1": ("needs_review", 5), "L2": ("confirmed", 2)}.items():
        w[k] = seed_listing(e, sup, st, days, 5)
    return w


def get(e, who, qs="", path="/api/track"):
    r = e.c.get(path + ("?" + qs if qs else ""), headers=who)
    assert r.status_code == 200, r.text
    return r.json()


def ZZ(e, who=None, extra=""):
    return get(e, who or e.O, "q=ZZ&limit=200" + extra)


# ---------------------------------------------------------------- timeline
def test_timeline_of_a_quote_in_order_with_actors_and_stage(env):
    e = env
    d = make_draft(e)
    for to, who, kw in (("approved", e.O, {}), ("sent", e.O, {}), ("read", e.S, {}), ("accepted", e.O, {"reason": "PO received"})):
        assert move(e, d, to, who, **kw).status_code == 200
    owner = e.sql("select name from users where id=%s", (e.owner,))[0]["name"]
    staff = e.sql("select name from users where id=%s", (e.staff,))[0]["name"]
    out = get(e, e.O, path=f"/api/documents/{d}/timeline")
    ev = out["events"]
    steps = [(x["kind"], x["title"], x["actor"]) for x in ev if x["kind"] != "message"]
    assert steps == [("created", "Quote drafted", staff), ("status", "Approved", owner), ("sent", "Sent to customer", owner),
                     ("status", "Opened by customer", staff), ("decision", "Accepted by customer", owner)]
    assert ev[-1]["detail"] == "PO received"
    assert [x["at"] for x in ev] == sorted(x["at"] for x in ev)
    msg = [x for x in ev if x["kind"] == "message"]
    assert msg and msg[0]["title"] == "Message received from customer" and msg[0]["detail"] == "10 small parts"
    assert out["stage"]["status"] == "accepted" and out["stage"]["overdue"] is False and out["stage"]["reason"] is None
    assert out["stage"]["days_in_stage"] == 0
    s = get(e, e.S, path=f"/api/documents/{d}/timeline")  # staff may read a quote's history (view_audit) and the customer chat
    assert [x["title"] for x in s["events"]] == [x["title"] for x in ev] and not (keys(s) & STAFF_HIDE)


def test_timeline_stage_is_overdue_and_system_actor_is_named_system(env):
    e = env
    d = make_draft(e)
    for to in ("approved", "sent"):
        assert move(e, d, to).status_code == 200
    old = datetime.now(timezone.utc) - timedelta(days=5)
    e.sql("update documents set status_changed_at=%s, sent_at=%s where id=%s", (old, old, d))
    st = get(e, e.O, path=f"/api/documents/{d}/timeline")["stage"]
    assert st["overdue"] and st["reason"] == "no reply since sent" and st["days_in_stage"] == 5
    e.sql("update documents set valid_until=current_date - 1 where id=%s", (d,))
    assert scheduler.run_once()["expired"] >= 1
    ev = get(e, e.O, path=f"/api/documents/{d}/timeline")
    assert (ev["events"][-1]["title"], ev["events"][-1]["actor"]) == ("Expired", "system")
    assert ev["stage"]["status"] == "expired" and ev["stage"]["overdue"] is False


def test_timeline_of_a_supplier_document_hides_chat_text_from_staff_without_view_costs(env):
    e = env
    d = e.stock_costs()
    o = get(e, e.O, path=f"/api/documents/{d}/timeline")
    assert [x["title"] for x in o["events"] if x["kind"] != "message"] == [
        "Received from supplier", "Supplier quote reviewed", "Supplier quote accepted", "Added to the cost book"]
    assert [x["detail"] for x in o["events"] if x["kind"] == "message"] == ["supplier quote text"]
    assert o["stage"]["status"] == "in_cost_book" and o["stage"]["overdue"] is False
    s = get(e, e.S, path=f"/api/documents/{d}/timeline")
    m = [x for x in s["events"] if x["kind"] == "message"]
    assert m == [{"at": m[0]["at"], "kind": "message", "title": "Message received", "actor": None}]
    assert "supplier quote text" not in json.dumps(s) and not (keys(s) & STAFF_HIDE)
    zero = member(e, role(e, "Zero", []))
    assert e.c.get(f"/api/documents/{d}/timeline", headers=zero).json()["error"]["code"] == "permission_required"
    assert e.c.get(f"/api/documents/{d}/timeline", headers=zero).status_code == 403
    assert e.c.get(f"/api/documents/{doc_id_zero()}/timeline", headers=e.O).status_code == 404


def doc_id_zero():
    return "00000000-0000-0000-0000-000000000000"


def test_timeline_is_tenant_scoped(env):
    e = env
    d = make_draft(e)
    other = other_tenant(e)
    assert e.c.get(f"/api/documents/{d}/timeline", headers=other).status_code == 404


# ---------------------------------------------------------------- /api/track
def test_track_lists_everything_overdue_first_then_oldest(env):
    e = env
    w = world(e)
    out = ZZ(e)
    its = out["items"]
    assert len(its) == 13 and out["has_more"] is False and out["overdue_total"] == 5
    flags = [i["overdue"] for i in its]
    assert flags == sorted(flags, reverse=True)  # overdue block first
    assert {i["id"] for i in its if i["overdue"]} == {str(w[k]) for k in ("Q1", "Q4", "S1", "R1", "L1")}
    assert [i["since"] for i in its[:5]] == sorted(i["since"] for i in its[:5])  # oldest in stage first inside the block
    open_rest = [i for i in its[5:] if i["status"] not in tr.TERMINAL]
    assert [i["since"] for i in open_rest] == sorted(i["since"] for i in open_rest)
    assert all(i["status"] in tr.TERMINAL for i in its[5 + len(open_rest):])  # closed items last
    by = {i["id"]: i for i in its}
    q1, q4, s1, r1, l1 = (by[str(w[k])] for k in ("Q1", "Q4", "S1", "R1", "L1"))
    assert (q1["kind"], q1["ref"], q1["party"], q1["status"], q1["stage_label"]) == ("quote", "ZZ-Q1", "ZZ Cust", "draft", "Draft")
    assert q1["days_in_stage"] == 5 and q1["overdue_reason"] == "quote waiting for approval/sending" and q1["link"] == f"#/doc/{w['Q1']}"
    assert q4["overdue_reason"] == "no reply since sent" and s1["overdue_reason"] == "waiting for review" and s1["kind"] == "supplier_doc"
    assert r1["kind"] == "rfq" and r1["link"] == "#/ask" and r1["overdue_reason"] == "supplier has not replied" and r1["party"] == "ZZ Sup"
    assert l1["kind"] == "listing" and l1["link"].startswith("#/catalog/") and l1["overdue_reason"] == "catalog item waiting for review"
    assert by[str(w["Q2"])]["overdue"] is False and by[str(w["Q2"])]["overdue_reason"] is None and by[str(w["Q5"])]["overdue"] is False
    assert Decimal(q1["total"]) == 20 and Decimal(s1["total"]) == 14  # the owner sees supplier totals too


def test_track_filters_kind_stage_overdue_and_search(env):
    e = env
    w = world(e)
    kinds = {k: ZZ(e, extra=f"&kind={k}")["items"] for k in ("quote", "supplier_doc", "rfq", "listing")}
    assert {k: len(v) for k, v in kinds.items()} == {"quote": 5, "supplier_doc": 3, "rfq": 3, "listing": 2}
    assert all(i["kind"] == "quote" for i in kinds["quote"]) and e.c.get("/api/track?kind=bogus", headers=e.O).status_code == 422
    assert {i["status"] for i in ZZ(e, extra="&stage=draft")["items"]} == {"draft"}
    assert len(ZZ(e, extra="&stage=draft")["items"]) == 2
    op = ZZ(e, extra="&stage=open")["items"]
    assert op and not any(i["status"] in tr.TERMINAL for i in op)
    assert len(ZZ(e, extra="&stage=waiting")["items"]) == 1 and ZZ(e, extra="&stage=nonsense")["items"] == []
    od = ZZ(e, extra="&overdue=1")
    assert len(od["items"]) == 5 and all(i["overdue"] for i in od["items"]) and od["overdue_total"] == 5
    assert [i["ref"] for i in get(e, e.O, "q=zz-q1")["items"]] == ["ZZ-Q1"]  # case-insensitive, by reference
    assert len(get(e, e.O, "q=ZZ Cust&limit=200")["items"]) == 5  # by party
    assert get(e, e.O, "q=%25")["items"] == [] and get(e, e.O, "q=_")["items"] == []  # wildcards are escaped, not interpreted
    assert get(e, e.O, "q=zz'; drop table documents; --")["items"] == [] and e.sql("select count(*) n from documents")[0]["n"] > 0
    assert e.c.get("/api/track?limit=201", headers=e.O).status_code == 422 and e.c.get("/api/track?offset=-1", headers=e.O).status_code == 422


def test_track_pagination(env):
    e = env
    world(e)
    full = [i["id"] for i in ZZ(e)["items"]]
    seen, off = [], 0
    while True:
        p = get(e, e.O, f"q=ZZ&limit=4&offset={off}")
        seen += [i["id"] for i in p["items"]]
        assert len(p["items"]) <= 4
        if not p["has_more"]:
            break
        off += 4
    assert seen == full and off == 12  # 13 items: pages of 4, 4, 4, 1
    assert get(e, e.O, "q=ZZ&limit=13")["has_more"] is False and get(e, e.O, "q=ZZ&limit=12")["has_more"] is True
    assert get(e, e.O, "q=ZZ&limit=4&offset=20")["items"] == []


def test_track_counts_and_overdue_total(env):
    e = env
    base = get(e, e.O)["counts"]
    world(e)
    out = get(e, e.O)
    c = out["counts"]
    delta = lambda kind, st: c[kind][st] - base[kind].get(st, 0)
    assert (delta("outbound", "draft"), delta("outbound", "sent"), delta("outbound", "accepted")) == (2, 2, 1)
    assert (delta("inbound", "received"), delta("inbound", "reviewed"), delta("inbound", "in_cost_book")) == (1, 1, 1)
    assert (delta("rfq", "waiting"), delta("rfq", "ready"), delta("rfq", "accepted")) == (1, 1, 1)
    assert (delta("listing", "needs_review"), delta("listing", "confirmed")) == (1, 1)
    assert set(c) == {"outbound", "inbound", "rfq", "listing"} and c["rfq"]["needs_review"] == 0
    assert out["overdue_total"] >= 5


def test_track_stats_only_with_view_audit(env):
    e = env
    d = make_draft(e)
    assert move(e, d, "approved").status_code == 200
    o = get(e, e.O)
    assert o["stats"]["draft"]["n"] >= 1 and isinstance(o["stats"]["draft"]["avg_days"], float) and o["stats"]["draft"]["avg_days"] >= 0
    assert "stats" in get(e, e.S)  # staff hold view_audit by default
    assert "stats" not in get(e, member(e, role(e, "Zero", [])))
    # only the last 90 days count
    e.sql("update documents set created_at = created_at - interval '200 days' where id=%s", (d,))
    assert get(e, e.O)["stats"]["draft"]["avg_days"] >= 0


def test_track_scrubs_supplier_money_and_rfq_prices(env):
    e = env
    w = world(e)
    by = lambda who: {i["id"]: i for i in ZZ(e, who)["items"]}
    o = by(e.O)
    assert Decimal(o[str(w["S1"])]["total"]) == 14 and Decimal(o[str(w["R2"])]["total"]) == 12  # owner: everything
    zero = member(e, role(e, "Zero", []))
    for who in (e.S, zero):
        its = by(who)
        assert its[str(w["S1"])]["total"] is None and its[str(w["S3"])]["total"] is None  # supplier totals need view_costs
        assert Decimal(its[str(w["Q1"])]["total"]) == 20  # our own selling price is shown
        assert all(i["total"] is None for i in its.values() if i["kind"] in ("rfq", "listing"))
        assert its[str(w["R2"])]["status"] == "needs_review" and its[str(w["R3"])]["status"] == "needs_review"  # who answered, not what
        assert its[str(w["R1"])]["status"] == "waiting"
        resp = ZZ(e, who)
        assert not (keys(resp) & STAFF_HIDE) and len(resp["items"]) == 13
        assert resp["counts"]["rfq"]["ready"] == 0 and resp["counts"]["rfq"]["accepted"] == 0
        assert len(ZZ(e, who, "&stage=ready")["items"]) == 0 and len(ZZ(e, who, "&stage=needs_review&kind=rfq")["items"]) == 2
    seer = member(e, role(e, "Seer", ["view_replies_prices"]), "Seer")  # may see replies, still no supplier-document costs
    its = by(seer)
    assert Decimal(its[str(w["R2"])]["total"]) == 12 and its[str(w["R2"])]["status"] == "ready" and its[str(w["S1"])]["total"] is None
    assert ZZ(e, seer, "&stage=ready")["items"][0]["id"] == str(w["R2"])
    assert not (keys(ZZ(e, seer)) & STAFF_HIDE)


def test_track_is_tenant_isolated(env):
    e = env
    world(e)
    other = other_tenant(e)
    out = get(e, other)
    assert out["items"] == [] and out["overdue_total"] == 0 and out["has_more"] is False
    assert all(n == 0 for k in out["counts"].values() for n in k.values())
    assert get(e, other, "q=ZZ")["items"] == [] and out.get("stats") == {}


def test_track_runs_a_constant_number_of_queries(env, monkeypatch):
    e = env
    world(e)
    calls = []
    real = psycopg.Connection.execute
    monkeypatch.setattr(psycopg.Connection, "execute", lambda self, *a, **k: (calls.append(1), real(self, *a, **k))[1])

    def count(path):
        calls.clear()
        assert e.c.get(path, headers=e.O).status_code == 200
        return len(calls)
    small = count("/api/track?limit=50")
    e.sql("""insert into documents(tenant_id,direction,kind,party_id,doc_no,status,issued_on,status_changed_at)
             select p.tenant_id, d::doc_direction, 'quotation', p.id, 'BULK-' || d || g, case when d = 'in' then 'received' else 'draft' end::doc_status, current_date,
                    now() - (g || ' hours')::interval
             from generate_series(1, 60) g, (values ('in'), ('out')) v(d) cross join (select id, tenant_id from parties where name = 'ZZ Sup') p""")
    # 120 more rows: still one query per kind and a fixed number of helpers, however many items there are
    big = count("/api/track?limit=50")
    assert big == small and len(e.c.get("/api/track?limit=50", headers=e.O).json()["items"]) == 50
    assert count("/api/track?limit=50&kind=quote") < small


# ---------------------------------------------------------------- dashboard
def test_dashboard_quote_speed_median_and_null(env):
    e = env
    o = other_tenant(e)  # empty tenant: no demo seed to skew the median
    assert get(e, o, path="/api/dashboard")["quote_speed"] == {"median_minutes": None, "quotes": 0, "days": 30}
    t = e.sql("select tenant_id from users where id=%s", (o["X-User"],))[0]["tenant_id"]
    p = e.sql("insert into parties(tenant_id,role,name) values (%s,'customer','QS Cust') returning id", (t,))[0]["id"]
    for no, mins in (("QS-1", 10), ("QS-2", 31)):
        e.sql("""insert into documents(tenant_id,direction,kind,party_id,doc_no,status,issued_on,approved_by,approved_at,created_at,sent_at)
                 values (%s,'out','quotation',%s,%s,'sent',current_date,%s,now(), now() - interval '1 day', now() - interval '1 day' + %s * interval '1 minute')""", (t, p, no, o["X-User"], mins))
    assert get(e, o, path="/api/dashboard")["quote_speed"] == {"median_minutes": 20.5, "quotes": 2, "days": 30}
    assert "quote_speed" not in get(e, e.S, path="/api/dashboard")


def test_dashboard_track_counters_and_failure_isolation(env, monkeypatch):
    e = env
    base = get(e, e.O, path="/api/dashboard")["track"]
    world(e)
    t = get(e, e.O, path="/api/dashboard")["track"]
    assert t["overdue"] - base["overdue"] == 5 and t["waiting_supplier"] - base["waiting_supplier"] == 1
    assert t["waiting_approval"] - base["waiting_approval"] == 2
    assert get(e, e.S, path="/api/dashboard")["track"] == t  # counts only: nothing to scrub
    import src.api.track as track

    def boom(*a, **k):
        raise RuntimeError("rules broke")
    monkeypatch.setattr(track.tr, "overdue_reason", boom)
    r = e.c.get("/api/dashboard", headers=e.O)
    assert r.status_code == 200 and r.json()["track"] is None and "open_quotes" in r.json() and "jobs" in r.json()
