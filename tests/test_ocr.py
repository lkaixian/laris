import io
import os

import pytest

from src import ocr


def test_sort_y_then_x():
    items = [
        {"text": "c", "bbox": [0, 20, 1, 21]},
        {"text": "b", "bbox": [50, 0, 51, 1]},
        {"text": "a", "bbox": [5, 0, 6, 1]},
    ]
    assert [i["text"] for i in ocr._sort(items)] == ["a", "b", "c"]


def test_no_engine_raises(monkeypatch):
    def boom(_):
        raise ImportError("missing")

    monkeypatch.setattr(ocr, "_paddle", boom)
    monkeypatch.setattr(ocr, "_tesseract", boom)
    with pytest.raises(ocr.OcrError, match="No OCR engine"):
        ocr.ocr_image(b"x")


def test_falls_back_to_second_engine(monkeypatch):
    def boom(_):
        raise ImportError("missing")

    monkeypatch.setattr(ocr, "_paddle", boom)
    monkeypatch.setattr(ocr, "_tesseract", lambda b: [{"text": "z", "conf": 1, "bbox": [0, 5, 1, 6]},
                                                      {"text": "y", "conf": 1, "bbox": [0, 1, 1, 2]}])
    assert [i["text"] for i in ocr.ocr_image(b"x")] == ["y", "z"]


def test_pdf_text_layer():
    pypdf = pytest.importorskip("pypdf")
    w = pypdf.PdfWriter()
    w.add_blank_page(100, 100)
    buf = io.BytesIO()
    w.write(buf)
    assert ocr.pdf_text(buf.getvalue()) == ""  # blank page -> no text layer


def test_tesseract_real_image():
    pytest.importorskip("pytesseract")
    Image = pytest.importorskip("PIL.Image")
    ImageDraw = pytest.importorskip("PIL.ImageDraw")
    if not (os.path.isdir(ocr.TESS_DIR) or __import__("shutil").which("tesseract")):
        pytest.skip("tesseract not installed")
    img = Image.new("RGB", (400, 100), "white")
    ImageDraw.Draw(img).text((10, 30), "CEMENT 50", fill="black")
    img = img.resize((1200, 300))
    buf = io.BytesIO()
    img.save(buf, "PNG")
    try:
        res = ocr._tesseract(buf.getvalue())
    except Exception as e:
        pytest.skip(f"tesseract unusable: {e}")
    assert res and all({"text", "conf", "bbox"} <= r.keys() for r in res)
