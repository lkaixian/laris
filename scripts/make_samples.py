"""Generate SYNTHETIC supplier-quote samples + expected JSON (deterministic, fixed seed).
Usage: .venv/Scripts/python scripts/make_samples.py [outdir]   (default tests/fixtures/docs)
Everything is fake: made-up SAMPLE companies, diagonal SAMPLE watermark, no real bank/brand design."""
import json
import random
import sys
from decimal import ROUND_HALF_UP, Decimal
from pathlib import Path

from PIL import Image, ImageDraw, ImageFilter, ImageFont
from reportlab.pdfgen import canvas

SEED = 42
DEFAULT_OUT = Path(__file__).resolve().parent.parent / "tests" / "fixtures" / "docs"
A, B, C = ("SAMPLE Supplier A Acrylic Sdn Bhd", "SAMPLE Supplier B Filament Sdn Bhd",
           "SAMPLE Supplier C Packaging Sdn Bhd")
Q = Decimal("0.01")


def money(x):
    return Decimal(x).quantize(Q, ROUND_HALF_UP)


def mk(supplier, doc_no, issued, valid, items, sst=True):
    """items: (description, qty, uom, unit_price). Totals computed with 8% SST."""
    lines = [{"line_no": i, "description": d, "qty": q, "uom": u, "unit_price": float(p),
              "amount": float(money(Decimal(str(q)) * Decimal(str(p))))}
             for i, (d, q, u, p) in enumerate(items, 1)]
    sub = sum(Decimal(str(l["amount"])) for l in lines)
    tax = money(sub * Decimal("0.08")) if sst else Decimal(0)
    return {"supplier_name": supplier, "doc_no": doc_no, "issued_on": issued, "valid_until": valid,
            "currency": "MYR", "lines": lines,
            "totals": {"subtotal": float(sub), "sst": float(tax) if sst else None,
                       "grand_total": float(sub + tax)}}


def f2(x):
    return f"{x:,.2f}"


def qty_s(q):
    return str(int(q)) if float(q).is_integer() else str(q)


# ---------- fonts / watermark ----------
def font(size, mono=False):
    for p in (("cour.ttf" if mono else "arial.ttf"), "DejaVuSans.ttf"):
        try:
            return ImageFont.truetype(p, size)
        except OSError:
            pass
    return ImageFont.load_default(size)


def watermark(img):
    w, h = img.size
    layer = Image.new("RGBA", img.size, (0, 0, 0, 0))
    big = max(w, h) // 5
    t = Image.new("RGBA", (int(max(w, h) * 1.2), big * 2), (0, 0, 0, 0))
    ImageDraw.Draw(t).text((t.width // 2, big), "SAMPLE", font=font(big), fill=(200, 0, 0, 70), anchor="mm")
    t = t.rotate(35, expand=True)
    layer.paste(t, ((w - t.width) // 2, (h - t.height) // 2), t)
    return Image.alpha_composite(img.convert("RGBA"), layer).convert("RGB")


# ---------- renderers ----------
def table_text(doc, bilingual):
    hdr = (["No", "Butiran / Description", "Kuantiti", "Unit", "Harga Seunit (RM)", "Jumlah (RM)"] if bilingual
           else ["No", "Description", "Qty", "UOM", "Unit Price (RM)", "Amount (RM)"])
    rows = [[str(l["line_no"]), l["description"], qty_s(l["qty"]), l["uom"], f2(l["unit_price"]), f2(l["amount"])]
            for l in doc["lines"]]
    t = doc["totals"]
    foot = [("Subtotal", t["subtotal"])] + ([("SST 8%", t["sst"])] if t["sst"] is not None else []) + \
           [("Grand Total", t["grand_total"])]
    head = [doc["supplier_name"], "SEBUT HARGA / QUOTATION" if bilingual else "QUOTATION",
            f"No: {doc['doc_no']}   Date: {doc['issued_on']}   Valid until: {doc['valid_until']}", "Currency: MYR"]
    return head, hdr, rows, [(k, f2(v)) for k, v in foot]


def render_table(doc, borders=True, bilingual=False):
    head, hdr, rows, foot = table_text(doc, bilingual)
    W, rh = 1240, 54
    H = 330 + rh * (len(rows) + 1) + 70 * len(foot) // 1 + 80
    im = Image.new("RGB", (W, H), "white")
    d = ImageDraw.Draw(im)
    d.text((60, 50), head[0], font=font(40), fill="black")
    d.text((60, 110), head[1], font=font(34), fill="black")
    d.text((60, 165), head[2], font=font(26), fill="black")
    d.text((60, 205), head[3], font=font(26), fill="black")
    xs = [60, 130, 560, 700, 800, 1000, 1180]
    y = 270
    for r, row in enumerate([hdr] + rows):
        for c, txt in enumerate(row):
            right = c >= 4
            d.text((xs[c + 1] - 12 if right else xs[c] + 12, y + 12), txt, font=font(26),
                   fill="black", anchor="ra" if right else "la")
        if borders:
            d.line([(xs[0], y), (xs[-1], y)], fill="black", width=2)
        elif r == 0:
            d.line([(xs[0], y + rh), (xs[-1], y + rh)], fill="gray", width=1)
        y += rh
    if borders:
        d.line([(xs[0], y), (xs[-1], y)], fill="black", width=2)
        for x in xs:
            d.line([(x, 270), (x, y)], fill="black", width=2)
    y += 25
    for k, v in foot:
        d.text((1000, y), k, font=font(26), fill="black", anchor="ra")
        d.text((1168, y), v, font=font(26), fill="black", anchor="ra")
        y += 45
    lines = head + [" ".join(hdr)] + [" ".join(r) for r in rows] + [f"{k} {v}" for k, v in foot]
    return im.crop((0, 0, W, y + 40)), lines


def render_text_image(lines, width, size, bg, fg, mono, pad=24):
    f = font(size, mono)
    h = pad * 2 + int(size * 1.5) * len(lines)
    im = Image.new("RGB", (width, h), bg)
    d = ImageDraw.Draw(im)
    for i, ln in enumerate(lines):
        d.text((pad, pad + i * int(size * 1.5)), ln, font=f, fill=fg)
    return im


def degrade(im, rng):
    w, h = im.size
    # shadow: darker gradient from the right
    sh = Image.linear_gradient("L").rotate(90).resize((w, h))
    im = Image.composite(Image.new("RGB", (w, h), (90, 90, 90)), im, sh.point(lambda v: v // 3))
    im = im.rotate(3, expand=True, fillcolor=(60, 55, 50)).filter(ImageFilter.GaussianBlur(1.3))
    noise = Image.frombytes("L", im.size, rng.randbytes(im.width * im.height)).convert("RGB")
    return Image.blend(im, noise, 0.08)


def pdf(doc, path, per_page=40):
    head, hdr, rows, foot = table_text(doc, False)
    pages = [rows[i:i + per_page] for i in range(0, len(rows), per_page)] or [[]]
    c = canvas.Canvas(str(path), pagesize=(595, 842), invariant=1)
    xs = [40, 70, 290, 350, 400, 480, 555]
    for pn, chunk in enumerate(pages, 1):
        c.setFont("Helvetica-Bold", 14); c.drawString(40, 800, head[0])
        c.setFont("Helvetica", 11)
        c.drawString(40, 782, head[1]); c.drawString(40, 766, head[2]); c.drawString(40, 750, head[3])
        c.drawRightString(555, 30, f"Page {pn}/{len(pages)}")
        y = 720
        for row in [hdr] + chunk:
            for i, t in enumerate(row):
                (c.drawRightString(xs[i + 1] - 4, y - 15, t) if i >= 4 else c.drawString(xs[i] + 4, y - 15, t))
            c.line(xs[0], y, xs[-1], y)
            y -= 22
        c.line(xs[0], y, xs[-1], y)
        for x in xs:
            c.line(x, 720, x, y)
        if pn == len(pages):
            y -= 20
            for k, v in foot:
                c.drawRightString(480, y, k); c.drawRightString(551, y, v); y -= 16
        c.saveState()
        c.translate(300, 420); c.rotate(45); c.setFillColorRGB(0.85, 0, 0); c.setFillAlpha(0.18)
        c.setFont("Helvetica-Bold", 130); c.drawCentredString(0, 0, "SAMPLE")
        c.restoreState()
        c.showPage()
    c.save()


# ---------- the documents ----------
def build(out=DEFAULT_OUT):
    out = Path(out)
    out.mkdir(parents=True, exist_ok=True)
    rng = random.Random(SEED)
    man, docs = {}, {}

    def put(name, fname, doc, kind, **extra):
        docs[name] = doc
        (out / f"{name}.expected.json").write_text(json.dumps(doc, indent=2, ensure_ascii=False) + "\n", "utf-8")
        man[name] = {"file": fname, "kind": kind, "watermark": True, "expected": f"{name}.expected.json",
                     "validate": "ok", **extra}

    def save_img(name, im, doc, kind, **extra):
        im = watermark(im)
        im.save(out / f"{name}.png", optimize=False)
        put(name, f"{name}.png", doc, kind, **extra)

    # 1 clean bordered PDF (+ PNG raster of the same content for OCR)
    d1 = mk(A, "QA-2026-0107", "2026-09-07", "2026-10-07",
            [("SAMPLE acrylic 3mm sheet", 10, "sheet", 100), ("SAMPLE vinyl roll", 5, "m", 8)])
    im1, txt1 = render_table(d1)
    pdf(d1, out / "01_clean_quote.pdf")
    put("01_clean_quote", "01_clean_quote.pdf", d1, "pdf-bordered-table-sst")
    save_img("01_clean_quote_raster", im1, d1, "png-bordered-table-sst", text=txt1)
    # 2 borderless bilingual
    d2 = mk(C, "QC-0233", "2026-10-12", "2026-11-12",
            [("Kotak kertas 30x20", 100, "pcs", 1.20), ("Pita pelekat", 12, "roll", 3.50), ("Beg plastik", 500, "pcs", 0.08)])
    save_img("02_borderless_bilingual", render_table(d2, borders=False, bilingual=True)[0], d2, "png-bm-en-borderless")
    # 3 WhatsApp style
    d3 = mk(B, None, "2026-10-20", "2026-10-31", [("PLA hitam", 10, "kg", 55), ("Skru M4", 200, "pcs", 0.15)])
    wa = ["Hi boss! Quote utk u ah:", "- PLA hitam x 10 kg @ RM55 = RM550.00", "- Skru M4 x 200 pcs @ RM0.15 = RM30.00",
          "Subtotal RM580.00, SST 8% RM46.40", "Total RM626.40 lor. Valid sampai 31/10 ya",
          "Boleh bagi tau cepat, stok tinggal sikit tau"]
    save_img("03_whatsapp_manglish", render_text_image(wa, 700, 26, (229, 221, 213), (17, 27, 33), False), d3, "png-whatsapp-text")
    # 4 phone photo of #1
    im4 = degrade(im1.copy(), rng)
    save_img("04_phone_photo_degraded", im4, d1, "png-degraded-copy-of-01")
    # 5 thermal
    d5 = d2
    th = ["SAMPLE Supplier C", "Packaging Sdn Bhd", "QUOTATION QC-0233", "2026-10-12  valid 2026-11-12", "-" * 30]
    th += [f"{l['description']}" + "\n" + f"  {qty_s(l['qty'])} {l['uom']} x {f2(l['unit_price'])} = {f2(l['amount'])}"
           for l in d5["lines"]]
    th = [s for t in th for s in t.split("\n")] + ["-" * 30, f"Subtotal {f2(d5['totals']['subtotal'])}",
                                                    f"SST 8% {f2(d5['totals']['sst'])}", f"TOTAL RM {f2(d5['totals']['grand_total'])}"]
    save_img("05_thermal_receipt", render_text_image(th, 384, 22, "white", "black", True, 12).convert("L").convert("RGB"),
             d5, "png-thermal-narrow")
    # 6 stale-cost pair: OLD RM100 (= doc 1 prices, D-45) and NEWER RM140 (D-3)
    d6o = mk(A, "QA-2026-0107", "2026-09-07", "2026-10-07", [("SAMPLE acrylic 3mm sheet", 10, "sheet", 100)])
    d6n = mk(A, "QA-2026-0161", "2026-10-19", "2026-11-19", [("SAMPLE acrylic 3mm sheet", 10, "sheet", 140)])
    save_img("06a_acrylic_old_rm100", render_table(d6o)[0], d6o, "png-stale-cost-old")
    save_img("06b_acrylic_new_rm140", render_table(d6n)[0], d6n, "png-stale-cost-new")
    # 7 two-page PDF
    names = [("Skru M3", "pcs", 0.10), ("Skru M4", "pcs", 0.15), ("Skru M5", "pcs", 0.22), ("Nat M4", "pcs", 0.05),
             ("Washer M4", "pcs", 0.03), ("PLA putih", "kg", 52), ("PLA hitam", "kg", 55), ("PETG jernih", "kg", 68),
             ("Nozzle 0.4mm", "pcs", 6.5), ("Heater cartridge", "pcs", 12), ("Thermistor", "pcs", 4.5),
             ("Belt GT2", "m", 3.2), ("Bearing 608", "pcs", 1.8), ("Glue stick", "pcs", 4.0)]
    items = [(n, (i % 5 + 1) * 10, u, p) for i, (n, u, p) in enumerate(names)] + \
            [(f"{n} (pack B)", 5, u, round(p * 1.1, 2)) for n, u, p in names[:6]]
    d7 = mk(B, "QB-0310", "2026-10-15", "2026-11-15", items)
    pdf(d7, out / "07_two_page.pdf", per_page=12)
    put("07_two_page", "07_two_page.pdf", d7, "pdf-two-page", pages=2)
    # 8 wrong digit: printed line-1 amount 1,800.00 instead of 1,000.00
    d8 = mk(A, "QA-2026-0188", "2026-10-20", "2026-11-20", [("SAMPLE acrylic 3mm sheet", 10, "sheet", 100), ("SAMPLE vinyl roll", 5, "m", 8)])
    d8["lines"][0]["amount"] = 1800.0
    save_img("08_wrong_digit", render_table(d8)[0], d8, "png-wrong-digit")
    man["08_wrong_digit"].update(validate="flag", expected_flags={"line_failed": ["arith_mismatch"],
                                                                  "doc_flags": ["subtotal_mismatch:misread_digit?"]})

    # enquiries: items and quantities only
    enq = {
        "enquiry_bm": ("Boleh quote 40 keping signboard akrilik 60x30 dan 5 helai akrilik 3mm? Terima kasih.",
                       [("signboard_60x30", 40, "pcs"), ("acrylic_3mm_sheet", 5, "sheet")]),
        "enquiry_en": ("Hi, please quote 40 pcs acrylic signboard 60x30 and 5 sheets of 3mm acrylic. Thanks.",
                       [("signboard_60x30", 40, "pcs"), ("acrylic_3mm_sheet", 5, "sheet")]),
        "enquiry_manglish": ("Boss, nak 40 pcs signboard 60x30 lah, plus 20 meter vinyl. Can quote or not? Urgent ah",
                             [("signboard_60x30", 40, "pcs"), ("vinyl_roll", 20, "m")]),
    }
    for n, (text, its) in enq.items():
        (out / f"{n}.txt").write_text(text + "\n", "utf-8")
        (out / f"{n}.expected.json").write_text(json.dumps(
            {"items": [{"item_key": k, "qty": q, "uom": u} for k, q, u in its]}, indent=2) + "\n", "utf-8")
        man[n] = {"file": f"{n}.txt", "kind": "enquiry-text", "expected": f"{n}.expected.json"}
    (out / "VOICE_NOTE.md").write_text(VOICE, "utf-8")
    (out / "manifest.json").write_text(json.dumps(man, indent=2, ensure_ascii=False) + "\n", "utf-8")
    return man


VOICE = """# Recording a Manglish voice note for the demo
1. Phone, quiet room, 10-15 seconds, mouth about 15 cm from the mic. Save as .ogg/.m4a (WhatsApp voice notes are opus).
2. Say it naturally, same content as enquiry_manglish.txt:
   "Boss, nak quote lah, 40 pcs signboard sixty by thirty, plus twenty meter vinyl. Urgent ah, can or not?"
3. Say quantities and sizes clearly (numbers are what the extractor needs); no prices.
4. Record one backup take and a noisy-background take to show the fallback (owner confirms by tapping).
Expected items: tests/fixtures/docs/enquiry_manglish.expected.json
"""

if __name__ == "__main__":
    build(sys.argv[1] if len(sys.argv) > 1 else DEFAULT_OUT)
    print("done")
