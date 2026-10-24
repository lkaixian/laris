import io
import time
import zipfile

import pytest

from src import pipeline, tabular


def _zip(members):
    b = io.BytesIO()
    with zipfile.ZipFile(b, "w", zipfile.ZIP_DEFLATED) as z:
        for n, d in members.items():
            z.writestr(n, d)
    return zipfile.ZipFile(io.BytesIO(b.getvalue()))


def test_one_big_member_refused():
    with pytest.raises(ValueError):
        tabular._guard(_zip({"a": b"0" * (tabular.MAX_MEMBER + 1)}))


def test_blank_rows_stop_at_scan_cap():
    out = tabular._capped([("s", iter([(None,)] * (tabular.MAX_SCAN + 5)))])
    assert "truncated" in out


def test_redact_is_linear_on_hostile_text():
    t0 = time.monotonic()
    pipeline.redact("a" * 200_000 + "@" + "b." * 50_000)
    assert time.monotonic() - t0 < 2
    assert pipeline.redact("mail ali@shop.com.my now") == "mail [redacted] now"
