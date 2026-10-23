"""XLSX / DOCX / CSV supplier quotes: text conversion, sniffing, and the same ingest path as PDFs and photos."""
import io
import zipfile
from datetime import date

import pytest
from openpyxl import Workbook

from src import tabular
from support.fixtures import env, pg_url  # noqa: F401

W = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"'
PAYLOAD = {"doc_no": "X-1", "issued_on": "2026-01-02", "lines": [
    {"description": "pla black", "qty": 1, "uom": "kg", "unit_price": 5, "amount": 5}]}


def xlsx(*sheets) -> bytes:
    wb = Workbook()
    wb.remove(wb.active)
    for name, rows in sheets:
        ws = wb.create_sheet(name)
        for r in rows:
            ws.append(r)
    b = io.BytesIO()
    wb.save(b)
    return b.getvalue()


def docx(body: str, extra: bytes = b"") -> bytes:
    b = io.BytesIO()
    with zipfile.ZipFile(b, "w") as z:
        z.writestr("[Content_Types].xml", "<Types/>")
        z.writestr("word/document.xml", extra + f'<w:document {W}><w:body>{body}</w:body></w:document>'.encode())
    return b.getvalue()


DOC = docx("<w:p><w:r><w:t>Quote Q-9</w:t></w:r></w:p><w:tbl><w:tr><w:tc><w:p><w:r><w:t>item</w:t></w:r></w:p></w:tc>"
           "<w:tc><w:p><w:r><w:t>price</w:t></w:r></w:p></w:tc></w:tr><w:tr><w:tc><w:p><w:r><w:t>PLA</w:t></w:r></w:p></w:tc>"
           "<w:tc><w:p><w:r><w:t>5.5</w:t></w:r></w:p></w:tc></w:tr></w:tbl><w:p><w:r><w:t>Thanks</w:t></w:r></w:p>")
SHEET = xlsx(("Prices", [["sku", "item", "unit_price", "valid"], ["A1", "PLA", 0.1 + 0.2, date(2026, 3, 1)], [], [None, None]]),
             ("Tiers", [["item", "min_qty"], ["PLA", 10]]))


def test_to_text_each_format():
    assert tabular.to_text(SHEET, tabular.XLSX) == ("## sheet: Prices\nsku\titem\tunit_price\tvalid\nA1\tPLA\t0.3\t2026-03-01\n"
                                                    "## sheet: Tiers\nitem\tmin_qty\nPLA\t10")
    assert tabular.to_text(DOC, tabular.DOCX) == "Quote Q-9\nitem\tprice\nPLA\t5.5\nThanks"
    assert tabular.to_text(b"a;b\n1;2\n", "text/csv") == "a\tb\n1\t2"
    assert tabular.to_text(b"a\tb\n1\t2\n", "text/csv") == "a\tb\n1\t2"


def test_chinese_csv_utf8_and_gb18030():
    s = "品名,单价\n亚克力板,12\n"
    assert tabular.to_text(s.encode("utf-8-sig"), "text/csv") == "品名\t单价\n亚克力板\t12"
    assert tabular.to_text(s.encode("gb18030"), "text/csv") == "品名\t单价\n亚克力板\t12"
    assert "Café" in tabular.to_text("item,note\nx,Café\n".encode("cp1252"), "text/csv")


def test_row_and_column_caps_keep_header_first():
    t = tabular.to_text(xlsx(("S", [[f"h{i}" for i in range(50)]] + [[i] for i in range(3000)])), tabular.XLSX).split("\n")
    assert t[1].count("\t") == 39 and t[1].startswith("h0\t") and t[-1].startswith("[truncated")
    assert len(t) == 2 + 2000


def test_docx_with_doctype_or_entity_is_rejected():
    for bad in (b'<!DOCTYPE d [<!ENTITY x "boom">]>', b"<!doctype d>", '<!ENTITY a "b">'.encode("utf-16-le")):
        with pytest.raises(ValueError, match="DOCTYPE"):
            tabular.to_text(docx("<w:p/>", bad), tabular.DOCX)


def test_zip_bomb_guard():
    b = io.BytesIO()
    with zipfile.ZipFile(b, "w", zipfile.ZIP_DEFLATED) as z:
        z.writestr("[Content_Types].xml", "<Types/>")
        z.writestr("word/document.xml", b"\0" * 60_000_000)
    assert len(b.getvalue()) < 1_000_000
    for mime in (tabular.DOCX, tabular.XLSX):
        with pytest.raises(ValueError, match="50 MB"):
            tabular.to_text(b.getvalue(), mime)


def test_sniff():
    assert tabular.sniff(SHEET) == tabular.XLSX and tabular.sniff(DOC) == tabular.DOCX
    assert tabular.sniff(b"%PDF-1.4") == "application/pdf"
    assert tabular.sniff(b"a,b\n1,2", "q.CSV") == "text/csv"
    assert tabular.sniff(b"a,b\n1,2", "q.bin", "text/csv") == "text/csv"
    assert tabular.sniff(b"a,b\n1,2", "q.txt", "text/plain") is None  # arbitrary text is not a sheet
    assert tabular.sniff(b"just words", "q.dat", "text/csv") is None
    assert tabular.sniff(b"\xd0\xcf\x11\xe0\xa1\xb1\x1a\xe1" + b"\0" * 20, "old.xls", "application/vnd.ms-excel") is None
    assert tabular.sniff(b"\xd0\xcf\x11\xe0", "old.csv") is None  # legacy binary renamed .csv
    b = io.BytesIO()
    with zipfile.ZipFile(b, "w") as z:
        z.writestr("x.txt", "hi")
    assert tabular.sniff(b.getvalue(), "a.xlsx") is None  # a plain zip


def post(e, name, data, ctype="application/octet-stream"):
    return e.c.post("/api/documents/ingest", files={"file": (name, data, ctype)}, headers=e.S)


def test_ingest_each_format_end_to_end(env):
    e = env
    for i, (name, data) in enumerate([("q.xlsx", SHEET), ("q.docx", DOC), ("q.csv", b"item;price\nPLA;5\n")]):
        e.ai.payload = {**PAYLOAD, "doc_no": f"X-{i}"}
        r = post(e, name, data)
        assert r.status_code == 201, r.text
        lines = e.c.get(f"/api/documents/{r.json()['id']}", headers=e.O).json()["lines"]
        assert len(lines) == 1 and lines[0]["description"] == "pla black" and lines[0]["ocr_confidence"] is None
    e.ai.payload = {**PAYLOAD, "doc_no": "X-dup"}
    r = post(e, "again.csv", b"item;price\nPLA;5\n")  # same bytes: the sha256 duplicate check still applies
    assert r.status_code == 409 and r.json()["error"]["code"] == "duplicate"
    e.ai.payload = {**PAYLOAD, "doc_no": "X-0"}  # same doc_no from the same supplier
    r = post(e, "other.csv", b"item;price\nPLA;6\n")
    assert r.status_code == 409


def test_ingest_bad_files(env):
    e = env
    e.ai.payload = PAYLOAD
    n = e.sql("select count(*) n from documents")[0]["n"]
    r = post(e, "q.csv", b"")  # empty upload
    assert r.status_code == 422
    assert post(e, "q.csv", b"\n\n").json()["error"]["code"] == "no_text"
    bad = docx("<w:p/>", b'<!DOCTYPE d [<!ENTITY x "y">]>')
    assert post(e, "q.docx", bad).status_code == 422
    corrupt = SHEET[:200] + b"garbage" + SHEET[207:]  # a real zip header, a broken body
    assert post(e, "q.xlsx", corrupt).status_code == 422
    nodoc = io.BytesIO()
    with zipfile.ZipFile(nodoc, "w") as z:
        z.writestr("[Content_Types].xml", "<Types/>")
        z.writestr("word/other.xml", "<a/>")
    r = post(e, "q.docx", nodoc.getvalue())
    assert r.status_code == 422 and r.json()["error"]["code"] == "ocr_failed"
    for name, ctype in (("old.xls", "application/vnd.ms-excel"), ("old.doc", "application/msword")):
        r = post(e, name, b"\xd0\xcf\x11\xe0\xa1\xb1\x1a\xe1" + b"\0" * 64, ctype)
        assert r.status_code == 415 and "XLSX" in r.json()["error"]["message"]
    assert e.sql("select count(*) n from documents")[0]["n"] == n


def test_chat_documents_reach_the_same_path(env, monkeypatch):
    from test_api import WA_SECRET, wa_msg, wa_post
    from src.channels import telegram
    e = env
    monkeypatch.setenv("WHATSAPP_APP_SECRET", WA_SECRET)
    e.sql("update users set channel_handle='+60 12-999 0001' where role='staff'")
    e.ai.payload = {**PAYLOAD, "doc_no": "WA-X"}
    e.svc.media["m1"] = (SHEET, "application/octet-stream")  # WhatsApp may send a generic mime
    r = wa_post(e, wa_msg(id="wamid.x1", **{"from": "60129990001"}, type="document",
                          document={"id": "m1", "filename": "q.xlsx"}))
    assert r.status_code == 200
    assert e.sql("select count(*) n from documents where doc_no='WA-X'")[0]["n"] == 1
    m = telegram.parse_update({"message": {"message_id": 1, "date": 1, "chat": {"id": 5},
                                            "document": {"file_id": "f", "file_name": "q.csv"}}})
    assert (m.media_kind, m.media_name) == ("document", "q.csv")
    assert tabular.sniff(b"a,b", m.media_name, "image/jpeg") == "text/csv"  # Telegram's default mime is overridden
