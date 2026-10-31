"""Finer permissions: export_data became three, the catalog left upload_documents, and the Business report is a permission (not owner only).
A role saved before the split keeps exactly what it could do."""
from pathlib import Path

import psycopg

from src import perms
from support.fixtures import env, pg_url  # noqa: F401
from test_roles import member, role

ID = "00000000-0000-0000-0000-000000000001"


def test_legacy_export_data_grants_the_three_that_replaced_it():
    g = perms.grant(["export_data", "view_costs"])
    assert {"export_contacts", "export_audit", "export_documents", "view_costs"} <= g and "export_data" not in g
    assert "manage_catalog" not in perms.grant(["upload_documents"])          # not widened: a role with upload and no catalog was set up that way
    assert perms.grant(None) == perms.DEFAULT_STAFF and "manage_catalog" in perms.DEFAULT_STAFF and not {"export_contacts", "view_business_report"} & perms.DEFAULT_STAFF


def test_each_export_has_its_own_permission(env):
    e = env
    only_contacts = member(e, role(e, "Contacts only", ["export_contacts"]), "C")
    only_audit = member(e, role(e, "Audit only", ["view_audit", "export_audit"]), "A")
    only_docs = member(e, role(e, "Docs only", ["export_documents", "view_costs"]), "D")
    assert e.c.get("/api/export/contacts.csv", headers=only_contacts).status_code == 200
    assert e.c.get("/api/export/contacts.csv", headers=only_audit).status_code == 403 and e.c.get("/api/export/contacts.csv", headers=only_docs).status_code == 403
    assert e.c.get("/api/audit/export?ids=1", headers=only_contacts).status_code == 403
    assert e.c.get("/api/audit/export?ids=1", headers=only_audit).status_code != 403
    assert e.c.get(f"/api/export/po.csv?quote_id={ID}", headers=only_contacts).status_code == 403
    assert e.c.get(f"/api/export/po.csv?quote_id={ID}", headers=only_docs).status_code != 403          # passes the permission check (the quote itself is not found)


def test_catalog_is_its_own_permission(env):
    e = env
    docs_only = member(e, role(e, "Docs", ["upload_documents"]), "Du")
    catalog = member(e, role(e, "Catalog", ["manage_catalog"]), "Ca")
    body = {"name": "Filaments"}
    assert e.c.post("/api/catalog/categories", json=body, headers=docs_only).status_code == 403
    assert e.c.post("/api/catalog/categories", json=body, headers=catalog).status_code == 201
    assert e.c.post("/api/documents/ingest", data={"text": "x"}, headers=catalog).status_code == 403       # catalog does not bring supplier-document upload


def test_business_report_and_targets_need_their_own_permissions(env):
    e = env
    reader = member(e, role(e, "Reader", ["view_business_report", "view_costs", "view_revenue"]), "R")
    no_costs = member(e, role(e, "No costs", ["view_business_report"]), "N")
    setter = member(e, role(e, "Setter", ["view_business_report", "view_costs", "view_revenue", "set_report_targets"]), "S")
    assert e.c.get("/api/reports", headers=reader).status_code == 200 and e.c.get("/api/reports/targets", headers=reader).status_code == 200
    assert e.c.get("/api/reports", headers=no_costs).status_code == 403                         # the report shows costs and profit
    assert e.c.put("/api/reports/targets", json={}, headers=reader).status_code == 403          # reading is not setting
    assert e.c.put("/api/reports/targets", json={"cac": "50"}, headers=setter).status_code == 200
    assert e.c.put("/api/reports/targets", json={}, headers=e.O).status_code == 200            # the owner holds everything


def test_the_migration_rewrites_stored_lists_once(env, pg_url):
    e = env
    old = e.sql("insert into roles(tenant_id, key, name, class, is_system, permissions) select tenant_id, 'old', 'Old role', 'staff', false, "
                "array['export_data','upload_documents','view_costs'] from users where id=%s returning id", (e.owner,))[0]["id"]
    never = e.sql("insert into roles(tenant_id, key, name, class, is_system, permissions) select tenant_id, 'plain', 'Plain role', 'staff', false, "
                  "array['view_costs'] from users where id=%s returning id", (e.owner,))[0]["id"]
    sql = (Path(__file__).resolve().parents[1] / "db" / "migrations" / "0009_role_permission_split.sql").read_text(encoding="utf-8")
    with psycopg.connect(pg_url, autocommit=True) as c:
        c.execute("select set_config('laris.tenant', '*', false)")
        c.execute(sql)
        c.execute(sql)  # a second run changes nothing
    got = {r["id"]: set(r["permissions"]) for r in e.sql("select id, permissions from roles where id in (%s, %s)", (old, never))}
    assert got[old] == {"export_contacts", "export_audit", "export_documents", "upload_documents", "manage_catalog", "view_costs"}
    assert got[never] == {"view_costs"}
