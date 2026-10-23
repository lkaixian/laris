"""Branding settings and custom roles with permissions (docs/roles.md). Default staff behaviour is covered by the rest of the suite."""
import base64

import psycopg
import pytest

from src import auth, db, perms
from support.fixtures import env, pg_url  # noqa: F401
from test_api import PART
from test_rfq import JPEG, other_tenant

PNG = b"\x89PNG\r\n\x1a\n" + bytes(100)
WEBP = b"RIFF\x00\x00\x00\x00WEBPVP8 " + bytes(50)
url = lambda mime, data: f"data:{mime};base64," + base64.b64encode(data).decode()


def role(e, name="Buyer", perm=(), status=201):
    r = e.c.post("/api/roles", json={"name": name, "permissions": list(perm)}, headers=e.O)
    assert r.status_code == status, r.text
    return r.json()


def member(e, r, name="Custom"):
    """A user holding role `r`, as demo-mode headers (the role decides what they may do)."""
    u = e.sql("insert into users(tenant_id,name,role,role_id) select tenant_id,%s,'staff',%s from users where id=%s returning id",
              (name, r["id"], e.owner))[0]["id"]
    return {"X-Role": "staff", "X-User": str(u)}


# ---------------------------------------------------------------- A. branding
def test_branding_validated_audited_and_visible_to_every_role(env, monkeypatch):
    e = env
    monkeypatch.setenv("ORG_LOGO_URL", "https://example.test/env.png")
    assert e.c.get("/api/me", headers=e.S).json()["org"]["logo_url"] == "https://example.test/env.png"  # env stays the fallback
    for who in (e.S,):
        assert e.c.post("/api/settings", json={"brand_color": "#112233"}, headers=who).status_code == 403
    post = lambda **b: e.c.post("/api/settings", json=b, headers=e.O)
    assert post(brand_color="red").status_code == 422 and post(brand_color="#12345").status_code == 422
    assert post(display_name="").status_code == 422
    svg = url("image/svg+xml", b"<svg xmlns='http://www.w3.org/2000/svg'><script>alert(1)</script></svg>")
    assert post(logo_data_url=svg).status_code == 415
    assert post(logo_data_url=url("image/png", b"<svg onload=alert(1)>")).status_code == 415  # says png, is not
    assert post(logo_data_url=url("image/jpeg", PNG)).status_code == 200  # the bytes decide the type, not the claim
    assert post(logo_data_url="data:image/png;base64,@@@").status_code == 415
    assert post(logo_data_url=url("image/png", PNG + bytes(200_000))).status_code == 413
    assert post(logo_data_url="x" * 400_000).status_code == 413
    r = post(display_name="Acme Signs", brand_color="#AABBCC", logo_data_url=url("image/webp", WEBP))
    assert r.status_code == 200 and r.json()["brand_color"] == "#aabbcc" and r.json()["display_name"] == "Acme Signs"
    for who in (e.O, e.S):
        org = e.c.get("/api/me", headers=who).json()["org"]
        assert org["name"] == "Acme Signs" and org["brand_color"] == "#aabbcc" and org["logo_url"].startswith("data:image/webp;base64,")
    assert e.sql("select name from tenants")[0]["name"] == "SAMPLE Signage Works (synthetic)"  # the key name is untouched
    ev = e.sql("select event, before, after from audit_log where entity='tenants' and event like 'settings changed%%' order by id desc limit 1")[0]
    assert "logo_data_url" in ev["event"] and ev["after"]["logo_data_url"] == "[image]" and len(str(ev)) < 2000  # no image bytes in the audit log
    assert post(logo_data_url=None, brand_color=None, display_name=None).status_code == 200  # clear: back to the fallbacks
    org = e.c.get("/api/me", headers=e.S).json()["org"]
    assert org == {"name": "SAMPLE Signage Works (synthetic)", "brand_color": None, "logo_url": "https://example.test/env.png"}


def test_logo_png_and_jpeg_accepted_and_pdf_uses_display_name(env):
    e = env
    for mime, data in (("image/png", PNG), ("image/jpeg", JPEG)):
        assert e.c.post("/api/settings", json={"logo_data_url": url(mime, data)}, headers=e.O).status_code == 200
        assert e.c.get("/api/me", headers=e.S).json()["org"]["logo_url"] == url(mime, data)
    assert e.c.post("/api/settings", json={"display_name": "Acme Signs"}, headers=e.O).status_code == 200
    assert e.sql("select coalesce(display_name, name) n from tenants")[0]["n"] == "Acme Signs"


# ---------------------------------------------------------------- B. roles
def test_roles_list_crud_and_non_assignable(env):
    e = env
    got = e.c.get("/api/roles", headers=e.O).json()
    assert [(x["key"], x["class"], x["is_system"]) for x in got["roles"]] == [("owner", "owner", True), ("staff", "staff", True)]
    assert {x["key"] for x in got["catalog"]} == set(perms.CATALOG) and {"key", "label", "description", "group"} <= got["catalog"][0].keys()
    assert {x["key"] for x in got["non_assignable"]} == set(perms.NON_ASSIGNABLE)
    owner, staff = got["roles"]
    assert set(owner["permissions"]) == set(perms.CATALOG) and set(staff["permissions"]) == perms.DEFAULT_STAFF
    assert e.c.get("/api/roles", headers=e.S).status_code == 403 and e.c.post("/api/roles", json={"name": "x", "permissions": []}, headers=e.S).status_code == 403
    for bad in ("manage_team", "approve_quotes", "manage_roles", "manage_settings", "promote_to_cost_book", "erase_party"):
        r = e.c.post("/api/roles", json={"name": "Boss", "permissions": [bad]}, headers=e.O)
        assert r.status_code == 422 and r.json()["error"]["code"] == "not_assignable", bad
    assert e.c.post("/api/roles", json={"name": "Boss", "permissions": ["fly"]}, headers=e.O).json()["error"]["code"] == "unknown_permission"
    buyer = role(e, "Senior Buyer!", ["view_costs", "view_costs", "ask_suppliers"])
    assert buyer["key"] == "senior-buyer" and buyer["class"] == "staff" and not buyer["is_system"]
    assert buyer["permissions"] == ["ask_suppliers", "view_costs"] and buyer["users"] == 0
    assert role(e, "senior-buyer?", status=201)["key"] == "senior-buyer-2"  # slug collision gets a suffix
    assert e.c.post("/api/roles", json={"name": "SENIOR BUYER!", "permissions": []}, headers=e.O).json()["error"]["code"] == "name_taken"
    assert e.c.post("/api/roles", json={"name": "Staff", "permissions": []}, headers=e.O).status_code == 409  # a system name
    rid = buyer["id"]
    assert e.c.patch(f"/api/roles/{rid}", json={"permissions": ["manage_team"]}, headers=e.O).status_code == 422
    r = e.c.patch(f"/api/roles/{rid}", json={"name": "Buyer", "permissions": ["view_reports"]}, headers=e.O)
    assert r.json()["name"] == "Buyer" and r.json()["permissions"] == ["view_reports"] and r.json()["key"] == "senior-buyer"
    assert e.c.patch(f"/api/roles/{rid}", json={}, headers=e.O).status_code == 422
    assert e.c.patch(f"/api/roles/{owner['id']}", json={"permissions": []}, headers=e.O).status_code == 409  # owner role is immutable
    assert e.c.patch(f"/api/roles/{staff['id']}", json={"name": "Crew"}, headers=e.O).status_code == 409  # system roles keep their names
    assert e.c.delete(f"/api/roles/{owner['id']}", headers=e.O).status_code == 409 and e.c.delete(f"/api/roles/{staff['id']}", headers=e.O).status_code == 409
    assert e.c.delete(f"/api/roles/{rid}", headers=e.S).status_code == 403
    assert e.c.delete(f"/api/roles/{rid}", headers=e.O).status_code == 200 and e.c.delete(f"/api/roles/{rid}", headers=e.O).status_code == 404
    events = [x["event"] for x in e.c.get("/api/audit", headers=e.O).json() if x["entity"] == "roles"]
    assert any(x.startswith("role created") for x in events) and any(x.startswith("role changed") for x in events) and any(x.startswith("role deleted") for x in events)


def test_owner_class_custom_role_is_refused_by_the_database(env):
    e = env
    with pytest.raises(psycopg.errors.CheckViolation):
        e.sql("insert into roles(tenant_id,key,name,class) select tenant_id,'boss','Boss','owner' from users limit 1")


def test_editing_the_staff_role_changes_what_staff_may_do(env):
    e = env
    staff = next(x for x in e.c.get("/api/roles", headers=e.O).json()["roles"] if x["key"] == "staff")
    assert e.c.get("/api/me", headers=e.S).json()["permissions"] == sorted(perms.DEFAULT_STAFF)
    assert e.c.get("/api/cost-items", headers=e.S).status_code == 403
    assert e.c.patch(f"/api/roles/{staff['id']}", json={"permissions": ["view_costs"]}, headers=e.O).status_code == 200
    assert e.c.get("/api/cost-items", headers=e.S).status_code == 200  # read on every request: no re-login needed
    assert e.c.get("/api/audit", headers=e.S).status_code == 403  # view_audit was dropped


# ---------------------------------------------------------------- permissions on the routes
def test_view_costs_decides_scrubbing(env):
    e = env
    doc = e.stock_costs()
    plain, costly = member(e, role(e, "Plain", ["manage_contacts"]), "Plain"), member(e, role(e, "Costly", ["view_costs"]), "Costly")
    for who, sees in ((e.S, False), (plain, False), (costly, True), (e.O, True)):
        d = e.c.get(f"/api/documents/{doc}", headers=who).json()
        assert (d["doc"]["total"] is not None) == sees and (d["lines"][0]["supplier_sku"] is None or sees)
        assert (e.c.get("/api/cost-items", headers=who).status_code == 200) == sees
        assert ("unit_cost" in e.c.get("/api/search?q=Supplier B", headers=who).text) == sees
    assert e.c.get("/api/alerts/stale-costs", headers=plain).status_code == 403 and e.c.get("/api/alerts/stale-costs", headers=costly).status_code == 200
    # a class-staff role with view_costs still cannot do what the DB guard keeps for owners
    draft = e.enquire([PART]).json()["id"]  # stock_costs ran above
    assert e.c.post(f"/api/documents/{draft}/transition", json={"to": "approved"}, headers=costly).status_code == 403


def test_edit_supplier_contacts_and_manage_contacts_gates(env):
    e = env
    sup = e.sql("select id from parties where role='supplier' limit 1")[0]["id"]
    cust = e.sql("select id from parties where role='customer' limit 1")[0]["id"]
    can, cannot = member(e, role(e, "Sup", ["manage_contacts", "edit_supplier_contacts"]), "Sup"), member(e, role(e, "NoSup", ["manage_contacts"]), "NoSup")
    none = member(e, role(e, "Nobody", []), "Nobody")
    assert e.c.post(f"/api/contacts/{sup}", json={"contact": "60111"}, headers=cannot).status_code == 403
    assert e.c.post(f"/api/contacts/{sup}", json={"contact": "60111"}, headers=can).status_code == 200
    assert e.c.post(f"/api/contacts/{cust}", json={"notes": "n"}, headers=cannot).status_code == 200
    assert e.c.post(f"/api/contacts/{cust}", json={"notes": "n"}, headers=none).status_code == 403
    assert e.c.post("/api/contacts", json={"role": "customer", "name": "Zed"}, headers=none).json()["error"]["code"] == "permission_required"
    assert e.c.get("/api/contacts", headers=none).status_code == 200  # reading stays open


def test_ask_suppliers_upload_and_other_gates(env):
    e = env
    sup = str(e.sql("select id from parties where role='supplier' limit 1")[0]["id"])
    none, asker = member(e, role(e, "Nobody", []), "Nobody"), member(e, role(e, "Asker", ["ask_suppliers", "upload_documents"]), "Asker")
    ask = lambda who: e.c.post("/api/rfq", headers=who, files={"image": ("i.jpg", JPEG, "image/jpeg")}, data={"description": "x", "supplier_ids": [sup]})
    r = ask(none)
    assert r.status_code == 403 and r.json()["error"]["code"] == "permission_required"
    assert ask(asker).status_code != 403
    assert e.c.post("/api/documents/ingest", data={"text": "t"}, headers=none).status_code == 403
    assert e.c.post("/api/documents/manual", json={"supplier": "S", "lines": [{"description": "d", "qty": 1, "uom": "pcs", "unit_price": 1}]}, headers=none).status_code == 403
    assert e.c.get("/api/audit", headers=none).status_code == 403 and e.c.get("/api/export/contacts.csv", headers=asker).status_code == 403
    assert e.c.get("/api/reports/margin", headers=asker).status_code == 403
    fu = e.c.post("/api/followups/00000000-0000-0000-0000-000000000001", json={"action": "skip"}, headers=asker)
    assert fu.status_code == 403 and fu.json()["error"]["code"] == "permission_required"


def test_replies_reports_followups_and_export_permissions(env):
    e = env
    rich = member(e, role(e, "Rich", ["view_replies_prices", "view_reports", "manage_followups", "export_data"]), "Rich")
    assert e.c.get("/api/reports/margin", headers=rich).status_code == 200
    rep = e.c.get("/api/reports/margin", headers=rich).json()
    assert "cost" not in rep and "margin" not in rep and "stale_margin_lost" not in rep  # reports without view_costs: no cost or margin figures
    assert e.c.get("/api/export/contacts.csv", headers=rich).status_code == 200
    assert e.c.get(f"/api/export/po.csv?quote_id=00000000-0000-0000-0000-000000000001", headers=rich).status_code == 403  # the file carries cost
    assert e.c.post("/api/followups/00000000-0000-0000-0000-000000000001", json={"action": "skip"}, headers=rich).status_code == 404  # allowed, nothing pending


# ---------------------------------------------------------------- users and roles
def test_user_with_custom_role_role_change_revokes_sessions_and_delete_is_refused_in_use(env):
    e = env
    e.sql("update users set username='boss', password_hash=%s where id=%s", (auth.hash_password("correct horse 1"), e.owner))
    O = {"Authorization": "Bearer " + e.c.post("/api/login", json={"username": "boss", "password": "correct horse 1"}).json()["token"]}
    buyer = e.c.post("/api/roles", json={"name": "Buyer", "permissions": ["view_costs"]}, headers=O).json()
    assert e.c.post("/api/users", json={"name": "A", "username": "aaa", "password": "staff pass 123"}, headers=O).json()["error"]["code"] == "role_needed"
    assert e.c.post("/api/users", json={"name": "A", "username": "aaa", "password": "staff pass 123", "role": "nope"}, headers=O).status_code == 422
    assert e.c.post("/api/users", json={"name": "A", "username": "aaa", "password": "staff pass 123", "role": "staff", "role_id": buyer["id"]}, headers=O).status_code == 422
    mk = e.c.post("/api/users", json={"name": "Bea", "username": "bea", "password": "staff pass 123", "role_id": buyer["id"]}, headers=O)
    assert mk.status_code == 201 and mk.json()["role"] == "staff" and mk.json()["role_key"] == "buyer" and mk.json()["role_name"] == "Buyer"
    assert "has_password" not in mk.json()
    uid = mk.json()["id"]
    assert e.c.post("/api/users", json={"name": "Cy", "username": "cyc", "password": "staff pass 123", "role": "buyer"}, headers=O).json()["role_key"] == "buyer"  # by key
    B = {"Authorization": "Bearer " + e.c.post("/api/login", json={"username": "bea", "password": "staff pass 123"}).json()["token"]}
    me = e.c.get("/api/me", headers=B).json()
    assert me["role"] == "staff" and me["role_key"] == "buyer" and me["role_name"] == "Buyer" and me["permissions"] == ["view_costs"]
    assert e.c.get("/api/cost-items", headers=B).status_code == 200 and e.c.get("/api/users", headers=B).status_code == 403
    assert e.c.delete(f"/api/roles/{buyer['id']}", headers=O).json()["error"]["code"] == "role_in_use"
    assert {x["key"]: x["users"] for x in e.c.get("/api/roles", headers=O).json()["roles"]}["buyer"] == 2
    # changing the role signs the person out; the permissions of the new role apply at the next sign-in
    assert e.c.post(f"/api/users/{uid}", json={"role": "staff"}, headers=O).json()["role_key"] == "staff"
    assert e.c.get("/api/me", headers=B).status_code == 401
    B = {"Authorization": "Bearer " + e.c.post("/api/login", json={"username": "bea", "password": "staff pass 123"}).json()["token"]}
    assert e.c.get("/api/cost-items", headers=B).status_code == 403
    assert e.c.post(f"/api/users/{uid}", json={"role_id": buyer["id"], "name": "Bea B"}, headers=O).status_code == 200 and e.c.get("/api/me", headers=B).status_code == 401
    assert [x["role_key"] for x in e.c.get("/api/users", headers=O).json() if x["username"] == "bea"] == ["buyer"]
    # a custom role can never make an owner, and the last owner stays protected
    assert e.c.post(f"/api/users/{e.owner}", json={"role_id": buyer["id"]}, headers=O).json()["error"]["code"] == "last_owner"
    assert e.c.post(f"/api/users/{e.owner}", json={"role": "staff"}, headers=O).json()["error"]["code"] == "last_owner"
    assert e.c.post(f"/api/users/{uid}", json={"role": "owner"}, headers=O).json()["role"] == "owner"
    assert e.c.post(f"/api/users/{e.owner}", json={"role": "buyer"}, headers=O).status_code == 200  # a second owner exists now
    assert e.sql("select role from users where id=%s", (e.owner,))[0]["role"] == "staff"  # the class follows the role


def test_roles_are_tenant_scoped(env):
    e = env
    buyer = role(e, "Buyer", ["view_costs"])
    T2 = other_tenant(e)
    mine = e.c.get("/api/roles", headers=T2).json()["roles"]
    assert [x["key"] for x in mine] == ["owner", "staff"] and buyer["id"] not in {x["id"] for x in mine}
    assert e.c.patch(f"/api/roles/{buyer['id']}", json={"name": "Hacked"}, headers=T2).status_code == 404
    assert e.c.delete(f"/api/roles/{buyer['id']}", headers=T2).status_code == 404
    assert e.c.post("/api/users", json={"name": "Z", "username": "zzz", "password": "staff pass 123", "role_id": buyer["id"]}, headers=T2).status_code == 422
    assert e.c.post("/api/users", json={"name": "Z", "username": "zzz", "password": "staff pass 123", "role": "buyer"}, headers=T2).status_code == 422
    assert e.c.post("/api/roles", json={"name": "Buyer", "permissions": []}, headers=T2).status_code == 201  # the same name is free in another tenant
    with pytest.raises(psycopg.errors.ForeignKeyViolation):  # and the database itself refuses a cross-tenant role_id
        e.sql("update users set role_id=%s where id=%s", (buyer["id"], T2["X-User"]))


# ---------------------------------------------------------------- migration
def test_apply_schema_twice_and_from_an_old_users_role_only_db(pg_url, monkeypatch):
    monkeypatch.setenv("DATABASE_URL", pg_url)
    with psycopg.connect(pg_url, autocommit=True) as c:
        c.execute("drop schema public cascade; create schema public")
        for f in ("schema.sql", "transitions.sql", "functions.sql"):  # a database from before roles existed
            c.execute((db.DB_DIR / f).read_text(encoding="utf-8"))
        assert not c.execute("select 1 from information_schema.columns where table_name='users' and column_name='role_id'").fetchone()
        t = c.execute("insert into tenants(name, trade_template, min_margin_pct) values ('Old','made_to_order',20) returning id").fetchone()[0]
        c.execute("insert into users(tenant_id,name,role) values (%s,'Boss','owner'), (%s,'Ann','staff')", (t, t))
    db.apply_schema(seed=False)
    db.apply_schema(seed=False)
    with psycopg.connect(pg_url, autocommit=True) as c:
        c.execute("select set_config('laris.tenant','*',false)")
        assert c.execute("select count(*) from roles").fetchone()[0] == 2
        assert c.execute("select u.name, u.role, r.key, r.class::text from users u join roles r on r.id=u.role_id order by u.name").fetchall() == \
            [("Ann", "staff", "staff", "staff"), ("Boss", "owner", "owner", "owner")]
        c.execute("insert into tenants(name, trade_template, min_margin_pct) values ('New','made_to_order',20)")  # a new tenant gets its system roles
        assert c.execute("select count(*) from roles").fetchone()[0] == 4
        c.execute("insert into users(tenant_id,name,role) select id,'Nia','staff' from tenants where name='New'")
        assert c.execute("select r.key from users u join roles r on r.id=u.role_id where u.name='Nia'").fetchone()[0] == "staff"
        c.execute("update users set role='owner' where name='Nia'")  # a direct change of the class follows to the system role
        assert c.execute("select r.key from users u join roles r on r.id=u.role_id where u.name='Nia'").fetchone()[0] == "owner"
