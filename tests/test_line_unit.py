"""A supplier line priced per 100g but bought in kg: the review step can now correct the unit (and the quantity) while the document is still reviewable."""
from support.fixtures import env, pg_url  # noqa: F401


def supplier_doc(e):
    e.ai.payload = {"doc_no": "U-1", "issued_on": "2026-01-02", "lines": [{"description": "PLA filament", "qty": 5, "uom": "100g", "unit_price": 8, "amount": 40}]}
    doc = e.c.post("/api/documents/ingest", data={"text": "u1", "supplier": "Acme"}, headers=e.S).json()["id"]
    ln = e.c.get(f"/api/documents/{doc}", headers=e.S).json()["lines"][0]
    return doc, ln["id"], f"/api/documents/{doc}/lines/{ln['id']}"


def test_quantity_can_be_set_in_the_unit_the_price_is_per(env):
    e = env
    doc, lid, url = supplier_doc(e)
    assert e.c.post(url, json={"qty": "50"}, headers=e.O).status_code == 200                     # 5 kg = 50 x 100g
    row = e.sql("select qty, uom, unit_price from document_lines where id=%s", (lid,))[0]
    assert (str(row["qty"]), row["uom"], str(row["unit_price"])) == ("50.000", "100g", "8.0000")


def test_the_unit_can_be_changed_with_the_price(env):
    e = env
    doc, lid, url = supplier_doc(e)
    r = e.c.post(url, json={"uom": "  kg ", "unit_price": "80"}, headers=e.O)
    assert r.status_code == 200 and r.json()["uom"] == "kg"                                      # trimmed
    row = e.sql("select uom, unit_price from document_lines where id=%s", (lid,))[0]
    assert (row["uom"], str(row["unit_price"])) == ("kg", "80.0000")
    ev = e.sql("select before, after from audit_log where entity='document_lines' and entity_id=%s order by id desc limit 1", (lid,))[0]
    assert ev["before"]["uom"] == "100g" and ev["after"]["uom"] == "kg"                          # the audit keeps the old unit


def test_a_unit_change_needs_the_cost_permission_and_a_real_value(env):
    e = env
    doc, lid, url = supplier_doc(e)
    assert e.c.post(url, json={"uom": "kg"}, headers=e.S).status_code == 403                    # staff cannot see or change costs
    assert e.c.post(url, json={"uom": "   "}, headers=e.O).json()["error"]["code"] == "bad_uom"
    assert e.c.post(url, json={"uom": "x" * 21}, headers=e.O).status_code == 422                # longer than the 20 characters a unit has
    assert e.sql("select uom from document_lines where id=%s", (lid,))[0]["uom"] == "100g"      # nothing changed


def test_the_unit_locks_with_the_rest_of_the_line_once_reviewed(env):
    e = env
    doc, lid, url = supplier_doc(e)
    e.sql("update documents set status='reviewed' where id=%s", (doc,))
    r = e.c.post(url, json={"uom": "kg"}, headers=e.O)
    assert r.status_code == 409 and r.json()["error"]["code"] == "locked"


def test_the_owner_sets_the_final_price_on_a_draft_customer_quote_only(env):
    from test_quotes import draft, tr
    e = env
    doc = draft(e)
    lid = e.c.get(f"/api/documents/{doc}", headers=e.O).json()["lines"][0]["id"]
    url = f"/api/documents/{doc}/lines/{lid}"
    assert e.c.post(url, json={"unit_price": "80"}, headers=e.S).status_code == 403                # staff cannot
    assert e.c.post(url, json={"qty": "2"}, headers=e.O).status_code == 403                        # only the price, not the rules' other output
    assert e.c.post(url, json={"unit_price": "80"}, headers=e.O).status_code == 200
    row = e.sql("select unit_price, price_source from document_lines where id=%s", (lid,))[0]
    assert (str(row["unit_price"]), row["price_source"]) == ("80.0000", "owner_override")
    assert tr(e, doc, "approved").status_code == 200
    assert e.c.post(url, json={"unit_price": "90"}, headers=e.O).status_code == 409               # locked once approved
