import io
import os

TESS_DIR = r"C:\Program Files\Tesseract-OCR"


class OcrError(RuntimeError):
    pass


def _sort(items):
    # ponytail: strict y-then-x; skewed rows may interleave, bucket by line height if needed
    return sorted(items, key=lambda i: (i["bbox"][1], i["bbox"][0]))


def _paddle(image_bytes):
    import numpy as np
    from paddleocr import PaddleOCR
    from PIL import Image

    res = PaddleOCR(lang="latin").ocr(np.array(Image.open(io.BytesIO(image_bytes)).convert("RGB")))
    out = []
    for page in res or []:
        for box, (text, conf) in page or []:  # PaddleOCR 2.x result shape (unverified for 3.x)
            xs, ys = [p[0] for p in box], [p[1] for p in box]
            out.append({"text": text, "conf": float(conf), "bbox": [min(xs), min(ys), max(xs), max(ys)]})
    return out


def _tesseract(image_bytes):
    import pytesseract
    from PIL import Image

    if os.path.isdir(TESS_DIR):
        pytesseract.pytesseract.tesseract_cmd = os.path.join(TESS_DIR, "tesseract.exe")
    # ponytail: eng only; use "msa+eng" once msa.traineddata is installed
    d = pytesseract.image_to_data(
        Image.open(io.BytesIO(image_bytes)), lang="eng", output_type=pytesseract.Output.DICT
    )
    return [
        {"text": t, "conf": float(c) / 100, "bbox": [l, tp, l + w, tp + h]}
        for t, c, l, tp, w, h in zip(d["text"], d["conf"], d["left"], d["top"], d["width"], d["height"])
        if t.strip() and float(c) >= 0
    ]


def ocr_image(image_bytes: bytes) -> list[dict]:
    errs = []
    for fn in (_paddle, _tesseract):
        try:
            return _sort(fn(image_bytes))
        except Exception as e:  # ImportError, or engine missing/failing
            errs.append(f"{fn.__name__}: {e!r}")
    raise OcrError(
        "No OCR engine available (install paddleocr or pytesseract + Tesseract): " + "; ".join(errs)
    )


def pdf_text(pdf_bytes: bytes) -> str:
    """Text layer via pypdf; empty string means scanned (rasterize, then ocr_image)."""
    try:
        from pypdf import PdfReader
    except ImportError as e:
        raise OcrError("pypdf not installed") from e
    return "\n".join((p.extract_text() or "") for p in PdfReader(io.BytesIO(pdf_bytes)).pages).strip()
