"""The owner's Word template: what is accepted, what is refused, and how it is filled. Pure; no database."""
import base64
import io
import re
import zipfile

import pytest

from src import doc_template as dt

VALUES = {k: f"V_{k}" for k in dt.FIELDS if not k.startswith("line.")}
LINES = [{"no": "1", "description": "Bracket & clip", "qty": "2", "uom": "pcs", "unit_price": "10.00", "amount": "20.00"},
         {"no": "2", "description": "Gear", "qty": "1", "uom": "pcs", "unit_price": "5.50", "amount": "5.50"},
         {"no": "3", "description": "Cover\nsecond line", "qty": "4", "uom": "pcs", "unit_price": "1.00", "amount": "4.00"}]
NS = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"'


def docx(body: str, extra: dict | None = None, types: str | None = None) -> bytes:
    out = io.BytesIO()
    with zipfile.ZipFile(out, "w") as z:
        z.writestr("[Content_Types].xml", types or '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"></Types>')
        z.writestr("word/document.xml", f'<?xml version="1.0"?><w:document {NS}><w:body>{body}</w:body></w:document>')
        for n, v in (extra or {}).items():
            z.writestr(n, v)
    return out.getvalue()


def text_of(data: bytes) -> str:
    return zipfile.ZipFile(io.BytesIO(data)).read("word/document.xml").decode()


@pytest.mark.parametrize("stage", dt.STAGES)
def test_every_starter_is_a_valid_template_that_knows_all_its_placeholders(stage):
    r = dt.check(dt.starter(stage))
    assert r["unknown"] == [] and r["placeholders"] and (r["repeats_lines"] or stage == "receipt")


def out_rows_before(stage):
    return text_of(dt.starter(stage)).count("<w:tr>")


@pytest.mark.parametrize("stage", dt.STAGES)
def test_filling_a_starter_replaces_every_placeholder(stage):
    out = text_of(dt.fill(dt.starter(stage), VALUES, LINES))
    assert "{{" not in out
    assert "V_doc_no" in out and "V_company_name" in out
    if stage != "receipt":
        assert out.count("Bracket &amp; clip") == 1 and out.count("<w:tr>") == out_rows_before(stage) + len(LINES) - 1  # one row per item, escaped


def test_a_row_is_repeated_per_line_and_removed_when_there_are_none():
    t = docx('<w:tbl><w:tr><w:tc><w:p><w:r><w:t>Item</w:t></w:r></w:p></w:tc></w:tr><w:tr><w:tc><w:p><w:r><w:t>{{line.description}}</w:t></w:r></w:p></w:tc></w:tr></w:tbl>')
    assert text_of(dt.fill(t, {}, LINES)).count("<w:tr>") == 4
    assert text_of(dt.fill(t, {}, [])).count("<w:tr>") == 1


def test_a_placeholder_split_over_several_runs_is_still_found_and_a_line_break_is_kept():
    t = docx('<w:p><w:r><w:t>Hi {{cust</w:t></w:r><w:r><w:rPr><w:b/></w:rPr><w:t>omer_name}}!</w:t></w:r></w:p>')
    assert dt.check(t)["placeholders"] == ["customer_name"]
    out = text_of(dt.fill(t, {"customer_name": "Ali\nSdn Bhd & Co <x>"}, []))
    assert "Hi Ali</w:t><w:br/><w:t xml:space=\"preserve\">Sdn Bhd &amp; Co &lt;x&gt;!" in out and "<w:t></w:t>" in out


def test_an_unknown_placeholder_is_reported_and_left_as_typed():
    t = docx("<w:p><w:r><w:t>{{doc_no}} {{custmer_name}}</w:t></w:r></w:p>")
    assert dt.check(t)["unknown"] == ["custmer_name"]
    assert "A-1 {{custmer_name}}" in text_of(dt.fill(t, {"doc_no": "A-1"}, []))


def test_values_cannot_break_the_file_or_smuggle_markup():
    t = docx("<w:p><w:r><w:t>{{customer_name}}</w:t></w:r></w:p>")
    out = text_of(dt.fill(t, {"customer_name": "</w:t></w:p><w:p>evil\x00\x08 </w:t>"}, []))
    assert "<w:p>evil" not in out and "&lt;/w:t&gt;" in out and "\x00" not in out


@pytest.mark.parametrize("data, why", [
    (b"", "under"), (b"not a zip at all", "not a Word"), (b"x" * 2_000_001, "under"),
    (docx("<w:p/>", {"word/vbaProject.bin": b"x"}), "macros"),
    (docx("<w:p/>", {"word/embeddings/o.bin": b"x"}), "macros"),
    (docx("<w:p/>", types='<Types>macroEnabled</Types>'), "macros"),
    (docx("<w:p/>", {"word/_rels/document.xml.rels": '<Relationships><Relationship Type="x/attachedTemplate" Target="http://evil/t.dotm" TargetMode="External"/></Relationships>'}), "another file"),
], ids=["empty", "notzip", "huge", "vba", "embedded", "macro-type", "remote-template"])
def test_files_that_are_not_safe_templates_are_refused(data, why):
    with pytest.raises(dt.TemplateError, match=why):
        dt.check(data)


def test_a_zip_without_the_word_parts_is_refused():
    out = io.BytesIO()
    with zipfile.ZipFile(out, "w") as z:
        z.writestr("hello.txt", "x")
    with pytest.raises(dt.TemplateError, match="not a Word"):
        dt.check(out.getvalue())


def test_xml_tricks_are_refused():
    bomb = '<?xml version="1.0"?><!DOCTYPE d [<!ENTITY a "aaaa"><!ENTITY b "&a;&a;&a;&a;">]><w:document ' + NS + '><w:body><w:p><w:r><w:t>&b;</w:t></w:r></w:p></w:body></w:document>'
    out = io.BytesIO()
    with zipfile.ZipFile(out, "w") as z:
        z.writestr("[Content_Types].xml", "<Types/>")
        z.writestr("word/document.xml", bomb)
    with pytest.raises(dt.TemplateError, match="damaged or uses something"):
        dt.check(out.getvalue())


def test_headers_and_footers_are_filled_too_and_other_parts_pass_through_untouched():
    hdr = f'<w:hdr {NS}><w:p><w:r><w:t>{{{{company_name}}}}</w:t></w:r></w:p></w:hdr>'
    t = docx("<w:p><w:r><w:t>x</w:t></w:r></w:p>", {"word/header1.xml": hdr, "word/media/logo.png": b"\x89PNG-bytes"})
    z = zipfile.ZipFile(io.BytesIO(dt.fill(t, {"company_name": "Kedai Jaya"}, [])))
    assert b"Kedai Jaya" in z.read("word/header1.xml") and z.read("word/media/logo.png") == b"\x89PNG-bytes"


# ---------------------------------------------------------------- the company logo slot
def logo_url(w=300, h=100, fmt="PNG"):
    from PIL import Image
    buf = io.BytesIO()
    Image.new("RGB", (w, h), (200, 30, 30)).save(buf, fmt)
    return f"data:image/{fmt.lower().replace('jpg', 'jpeg')};base64," + base64.b64encode(buf.getvalue()).decode()


def parts(data: bytes) -> dict:
    z = zipfile.ZipFile(io.BytesIO(data))
    return {n: z.read(n) for n in z.namelist()}


@pytest.mark.parametrize("stage", dt.STAGES)
def test_the_logo_goes_into_the_slot_of_every_starter(stage):
    out = parts(dt.fill(dt.starter(stage), VALUES, LINES, logo_url(300, 100)))
    assert out["word/media/company-logo.png"][1:4] == b"PNG"
    assert b"media/company-logo.png" in out["word/_rels/document.xml.rels"]
    doc = out["word/document.xml"].decode()
    assert doc.count("Company logo") == 3 and "V_company_name" in doc
    assert 'cx="1371600" cy="457200"' in doc  # 3:1 logo fills the width, aspect kept
    assert dt.check(dt.fill(dt.starter(stage), VALUES, LINES, logo_url()))["placeholders"] is not None


@pytest.mark.parametrize("stage", dt.STAGES)
def test_without_a_logo_the_slot_is_empty_and_only_the_company_name_shows(stage):
    for none in (None, "", "data:image/png;base64,not-an-image", "javascript:alert(1)"):
        out = parts(dt.fill(dt.starter(stage), VALUES, LINES, none))
        doc = out["word/document.xml"].decode()
        assert "Company logo" not in doc and "<w:drawing>" not in doc and "V_company_name" in doc
        assert "word/media/company-logo.png" not in out


def test_a_tall_logo_is_scaled_to_fit_the_height():
    doc = parts(dt.fill(dt.starter("invoice"), VALUES, LINES, logo_url(100, 300, "JPEG")))["word/document.xml"].decode()
    assert 'cx="171450" cy="514350"' in doc


def test_a_picture_the_owner_put_in_the_slot_is_left_alone():
    mine = parts(dt.starter("invoice"))
    rels = mine["word/_rels/document.xml.rels"].decode()
    name = re.search(r'Id="rId8"[^>]*Target="([^"]+)"', rels).group(1)
    from PIL import Image
    buf = io.BytesIO()
    Image.new("RGB", (40, 40), (0, 0, 255)).save(buf, "PNG")
    mine["word/" + name] = buf.getvalue()
    out = io.BytesIO()
    with zipfile.ZipFile(out, "w") as w:
        for n, raw in mine.items():
            w.writestr(n, raw)
    for logo in (None, logo_url()):
        res = parts(dt.fill(out.getvalue(), VALUES, LINES, logo))
        assert res["word/" + name] == buf.getvalue() and "Company logo" in res["word/document.xml"].decode()
