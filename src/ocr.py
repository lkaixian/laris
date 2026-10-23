import io
import os

TESS_DIR = r"C:\Program Files\Tesseract-OCR"


MAX_PIXELS = 25_000_000  # decompression-bomb guard (about 5000x5000)
MAX_IMAGE_PIXELS = 40_000_000
MAX_PAGES = 30
TESS_TIMEOUT = 30


def _open_image(image_bytes):
    from PIL import Image

    Image.MAX_IMAGE_PIXELS = MAX_IMAGE_PIXELS  # Pillow raises DecompressionBombError at 2x this; MAX_PIXELS below stops sooner
    im = Image.open(io.BytesIO(image_bytes))
    if im.width * im.height > MAX_PIXELS:
        raise OcrError(f"image too large ({im.width}x{im.height})")
    return im


class OcrError(RuntimeError):
    pass


def _sort(items):
    # ponytail: strict y-then-x; skewed rows may interleave, bucket by line height if needed
    return sorted(items, key=lambda i: (i["bbox"][1], i["bbox"][0]))


def _paddle(image_bytes):
    import numpy as np
    from paddleocr import PaddleOCR

    res = PaddleOCR(lang="latin").ocr(np.array(_open_image(image_bytes).convert("RGB")))
    out = []
    for page in res or []:
        for box, (text, conf) in page or []:  # PaddleOCR 2.x result shape (unverified for 3.x)
            xs, ys = [p[0] for p in box], [p[1] for p in box]
            out.append({"text": text, "conf": float(conf), "bbox": [min(xs), min(ys), max(xs), max(ys)]})
    return out


def _tesseract(image_bytes):
    import pytesseract

    if os.path.isdir(TESS_DIR):
        pytesseract.pytesseract.tesseract_cmd = os.path.join(TESS_DIR, "tesseract.exe")
    # ponytail: eng only; use "msa+eng" once msa.traineddata is installed
    d = pytesseract.image_to_data(
        _open_image(image_bytes), lang="eng", output_type=pytesseract.Output.DICT, timeout=TESS_TIMEOUT
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
    pages = PdfReader(io.BytesIO(pdf_bytes)).pages
    if len(pages) > MAX_PAGES:
        raise OcrError(f"PDF has {len(pages)} pages; limit is {MAX_PAGES}")
    return "\n".join((p.extract_text() or "") for p in pages).strip()
