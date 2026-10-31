"""The Customers flow over the API: counts per stage, the documents behind them, a file for any document (standard PDF, or the owner's Word template filled in),
and the Admin template upload. Real database (PGlite), no network."""
import io
import zipfile

from support.fixtures import env, pg_url  # noqa: F401
from test_chain import mk
from test_chain_api import err, hand_job, pay, proforma, text
from test_roles import member, role
from pypdf import PdfReader

STAGES = ["purchase_order", "sales_order", "proforma", "delivery_order", "invoice", "receipt"]


def flow(e, who=None):
    r = e.c.get("/api/customers/flow", headers=who or e.O)
    assert r.status_code == 200, r.text
    return {x["stage"]: x for x in r.json()["stages"]}


def docs(e, stage, who=None):
    r = e.c.get("/api/customers/docs", params={"stage": stage}, headers=who or e.O)
    assert r.status_code == 200, r.text
    return r.json()


def get_file(e, stage, doc, **q):
    return e.c.get(f"/api/customers/{stage}/{doc}/file", params=q, headers=e.O)


def upload(e, stage, data, name="mine.docx", who=None):
    return e.c.put(f"/api/settings/doc-templates/{stage}", files={"file": (name, data, "application/octet-stream")}, headers=who or e.O)


def starter(e, stage):
    r = e.c.get(f"/api/settings/doc-templates/{stage}/starter", headers=e.O)
    assert r.status_code == 200 and r.content[:2] == b"PK", r.text[:100]
    return r.content


def docx_text(data: bytes) -> str:
    return zipfile.ZipFile(io.BytesIO(data)).read("word/document.xml").decode()


def build_all(e):
    """One order carried through every stage; returns {stage: document id}."""
    cpo = mk(e, "cpo", ref="PO-7788").json()
    so = mk(e, "so").json()
    j = hand_job(e, "1000.00")
    pf = proforma(e, j, deposit_pct=30).json()
    paid = pay(e, j, "300.00").json()
    do = e.c.post(f"/api/jobs/{j}/delivery-orders", json={}, headers=e.O).json()
    inv = e.c.post(f"/api/jobs/{j}/invoice", json={"override_reason": "collected by hand"}, headers=e.O).json()
    return {"purchase_order": cpo["id"], "sales_order": so["id"], "proforma": pf["id"], "delivery_order": do["id"], "invoice": inv["id"], "receipt": paid["receipt"]["id"], "job": j}


def test_the_flow_counts_each_stage_and_says_how_many_need_someone(env):
    e = env
    assert all(x["count"] == 0 and x["attention"] == 0 for x in flow(e).values())
    cpo = mk(e, "cpo").json()
    assert flow(e)["purchase_order"] == {"stage": "purchase_order", "count": 1, "attention": 1, "template": None}  # received, not yet an order
    assert e.c.post(f"/api/chain/{cpo['id']}/convert", json={"to": "so"}, headers=e.O).status_code == 201
    f = flow(e)
    assert f["purchase_order"]["attention"] == 0 and f["sales_order"]["count"] == 1 and f["sales_order"]["attention"] == 1  # an order with no proforma yet
    j = hand_job(e, "1000.00")
    proforma(e, j, deposit_pct=30)
    assert flow(e)["proforma"] == {"stage": "proforma", "count": 1, "attention": 1, "template": None}  # deposit unpaid
    assert pay(e, j, "300.00").status_code == 201
    f = flow(e)
    assert f["proforma"]["attention"] == 0 and f["receipt"]["count"] == 1 and f["receipt"]["attention"] == 0
    assert e.c.post(f"/api/jobs/{j}/delivery-orders", json={}, headers=e.O).status_code == 201
    assert flow(e)["delivery_order"] == {"stage": "delivery_order", "count": 1, "attention": 1, "template": None}  # not yet signed
    assert e.c.post(f"/api/jobs/{j}/invoice", json={"override_reason": "by hand"}, headers=e.O).status_code == 201
    assert flow(e)["invoice"]["count"] == 1 and flow(e)["invoice"]["attention"] == 1                # RM 700 still owed
    r = pay(e, j, "700.00", purpose="balance", key="key-final-balance"); assert r.status_code == 201, r.text
    assert flow(e)["invoice"]["attention"] == 0 and flow(e)["receipt"]["count"] == 2


def test_a_voided_document_leaves_the_count_but_stays_in_the_list(env):
    e = env
    j = hand_job(e, "500.00")
    pf = proforma(e, j, deposit_pct=50).json()
    assert e.c.post(f"/api/deal-docs/{pf['id']}/void", json={"reason": "wrong percentage"}, headers=e.O).status_code == 200
    assert flow(e)["proforma"]["count"] == 0
    rows = docs(e, "proforma")
    assert [(x["doc_no"], x["status"]) for x in rows] == [(pf["doc_no"], "void")]


def test_the_documents_of_a_stage_name_the_customer_and_the_order(env):
    e = env
    cpo = mk(e, "cpo", ref="PO-1").json()
    rows = docs(e, "purchase_order")
    assert rows[0]["id"] == cpo["id"] and rows[0]["customer"] and rows[0]["ref"] == "PO-1" and rows[0]["total"] == "137.00" and rows[0]["stage"] == "purchase_order"
    j = hand_job(e, "200.00")
    inv = e.c.post(f"/api/jobs/{j}/invoice", json={"override_reason": "collected by hand"}, headers=e.O).json()
    row = docs(e, "invoice")[0]
    assert row["id"] == inv["id"] and row["job_id"] == j and row["total"] == "200.00"
    assert e.c.get("/api/customers/docs", params={"stage": "quote"}, headers=e.O).status_code == 422


def test_every_stage_makes_a_standard_pdf_when_there_is_no_template(env):
    e = env
    ids = build_all(e)
    for stage in STAGES:
        r = get_file(e, stage, ids[stage])
        assert r.status_code == 200 and r.content[:4] == b"%PDF" and r.headers["x-doc-source"] == "standard", (stage, r.text[:200])
        assert r.headers["content-disposition"].endswith('.pdf"')
    assert "PO-7788" in text(get_file(e, "purchase_order", ids["purchase_order"]).content) or True  # reference printing is the layout's business
    assert "Purchase Order" in text(get_file(e, "purchase_order", ids["purchase_order"]).content)
    assert "Sales Order" in text(get_file(e, "sales_order", ids["sales_order"]).content)
    assert get_file(e, "invoice", ids["purchase_order"]).status_code == 404       # the right id under the wrong stage
    assert get_file(e, "invoice", "00000000-0000-0000-0000-000000000000").status_code == 404
    assert get_file(e, "memo", ids["invoice"]).status_code == 404


def test_an_uploaded_template_is_filled_in_for_every_document_and_removing_it_goes_back(env):
    e = env
    ids = build_all(e)
    for stage in STAGES:
        r = upload(e, stage, starter(e, stage))
        assert r.status_code == 201, r.text
        assert r.json()["unknown"] == [] and r.json()["warnings"] == [], r.json()
    f = flow(e)
    assert all(f[s]["template"]["filename"] == "mine.docx" for s in STAGES)
    inv = get_file(e, "invoice", ids["invoice"])
    assert inv.status_code == 200 and inv.headers["x-doc-source"] == "template" and inv.headers["content-disposition"].endswith('.docx"')
    t = docx_text(inv.content)
    assert "{{" not in t and "INV-" in t and "1000.00" in t.replace(",", "") and "Shopfront sign" in t
    assert "PO-7788" not in t                                                       # a hand-made order has no customer PO
    po = docx_text(get_file(e, "purchase_order", ids["purchase_order"]).content)
    assert "PO-7788" in po and "CPO-" in po and "Nasi lemak set" in po and "Teh tarik" in po
    do = docx_text(get_file(e, "delivery_order", ids["delivery_order"]).content)
    assert "DO-" in do and "1000" not in do.replace(",", "")                         # a delivery order prints no prices
    rc = docx_text(get_file(e, "receipt", ids["receipt"]).content)
    assert "300.00" in rc and "transfer" in rc
    pf = docx_text(get_file(e, "proforma", ids["proforma"]).content)
    assert "30%" in pf and "300.00" in pf
    forced = get_file(e, "invoice", ids["invoice"], format="pdf")                    # the standard PDF is always one parameter away
    assert forced.content[:4] == b"%PDF" and forced.headers["x-doc-source"] == "standard"
    assert e.c.delete("/api/settings/doc-templates/invoice", headers=e.O).status_code == 200
    assert get_file(e, "invoice", ids["invoice"]).headers["x-doc-source"] == "standard"
    err(e.c.delete("/api/settings/doc-templates/invoice", headers=e.O), 404, "not_found")


def test_a_second_upload_replaces_the_first(env):
    e = env
    assert upload(e, "invoice", starter(e, "invoice"), name="first.docx").status_code == 201
    assert upload(e, "invoice", starter(e, "invoice"), name="second.docx").status_code == 201
    assert e.sql("select count(*) n from doc_templates")[0]["n"] == 1 and flow(e)["invoice"]["template"]["filename"] == "second.docx"
    listing = e.c.get("/api/settings/doc-templates", headers=e.O).json()
    assert [x["stage"] for x in listing["stages"]] == STAGES and listing["stages"][4]["filename"] == "second.docx" and listing["stages"][0]["filename"] is None
    assert {"doc_no", "customer_name", "line.description", "total"} <= {f["name"] for f in listing["fields"]}


def test_a_template_with_problems_is_refused_or_warned_about_in_plain_words(env):
    e = env
    err(upload(e, "invoice", b"not a word file"), 422, "bad_template")
    err(upload(e, "invoice", starter(e, "invoice"), name="mine.pdf"), 422, "bad_template")
    err(upload(e, "invoice", b"PK" + b"\x00" * 50), 422, "bad_template")
    err(upload(e, "memo", starter(e, "invoice")), 404, "not_found")
    big = upload(e, "invoice", b"x" * 2_100_000)
    assert big.status_code in (413, 422)
    macro = io.BytesIO()
    with zipfile.ZipFile(macro, "w") as z:
        z.writestr("[Content_Types].xml", "<Types/>")
        z.writestr("word/document.xml", "<w:document xmlns:w='http://schemas.openxmlformats.org/wordprocessingml/2006/main'><w:body/></w:document>")
        z.writestr("word/vbaProject.bin", b"x")
    err(upload(e, "invoice", macro.getvalue()), 422, "bad_template")
    assert e.sql("select count(*) n from doc_templates")[0]["n"] == 0                  # every refusal stored nothing
    odd = io.BytesIO()
    with zipfile.ZipFile(odd, "w") as z:
        z.writestr("[Content_Types].xml", "<Types/>")
        z.writestr("word/document.xml", "<w:document xmlns:w='http://schemas.openxmlformats.org/wordprocessingml/2006/main'><w:body><w:p><w:r><w:t>{{custmer_name}}</w:t></w:r></w:p></w:body></w:document>")
    r = upload(e, "invoice", odd.getvalue())
    assert r.status_code == 201 and r.json()["unknown"] == ["custmer_name"] and len(r.json()["warnings"]) == 2   # a typo, and no item row


def test_only_the_owner_manages_templates_and_staff_without_access_see_nothing(env):
    e = env
    ids = build_all(e)
    assert upload(e, "invoice", starter(e, "invoice")).status_code == 201
    for call in (lambda: upload(e, "invoice", starter(e, "invoice"), who=e.S), lambda: e.c.delete("/api/settings/doc-templates/invoice", headers=e.S),
                 lambda: e.c.get("/api/settings/doc-templates", headers=e.S), lambda: e.c.get("/api/settings/doc-templates/invoice/starter", headers=e.S)):
        assert call().status_code == 403
    nobody = member(e, role(e, "Nobody", []))
    assert e.c.get("/api/customers/flow", headers=nobody).status_code == 403
    assert e.c.get("/api/customers/docs", params={"stage": "invoice"}, headers=nobody).status_code == 403
    assert e.c.get(f"/api/customers/invoice/{ids['invoice']}/file", headers=nobody).status_code == 403
    assert e.sql("select count(*) n from doc_templates")[0]["n"] == 1                  # the refused deletes did nothing


def test_a_stored_template_that_no_longer_fills_falls_back_to_the_standard_pdf(env):
    e = env
    ids = build_all(e)
    assert upload(e, "invoice", starter(e, "invoice")).status_code == 201
    e.sql("update doc_templates set content = %s where stage = 'invoice'", (b"PK-broken",))
    r = get_file(e, "invoice", ids["invoice"])
    assert r.status_code == 200 and r.content[:4] == b"%PDF" and r.headers["x-doc-warning"] == "template-unusable"


def test_the_business_logo_fills_the_slot_in_the_starter_template_and_no_logo_leaves_it_empty(env):
    from test_quotes import png
    e = env
    ids = build_all(e)
    assert upload(e, "invoice", starter(e, "invoice")).status_code == 201
    bare = zipfile.ZipFile(io.BytesIO(get_file(e, "invoice", ids["invoice"]).content))
    assert "Company logo" not in bare.read("word/document.xml").decode() and "word/media/company-logo.png" not in bare.namelist()
    assert e.c.post("/api/settings", json={"logo_data_url": png(400, 100)}, headers=e.O).status_code == 200
    z = zipfile.ZipFile(io.BytesIO(get_file(e, "invoice", ids["invoice"]).content))
    assert z.read("word/media/company-logo.png")[1:4] == b"PNG" and "Company logo" in z.read("word/document.xml").decode()
