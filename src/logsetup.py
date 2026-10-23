"""Logging: one line format with the request id, and no webhook secrets in uvicorn's access log. setup() is idempotent."""
import logging
import os
import re
from contextvars import ContextVar

request_id: ContextVar[str] = ContextVar("request_id", default="-")
FORMAT = "%(asctime)s %(levelname)s %(name)s [%(request_id)s] %(message)s"
SECRET_QS = re.compile(r"((?:verify_token|token|secret|signature)=)[^&\s\"]*", re.I)


class RequestIdFilter(logging.Filter):
    def filter(self, record):
        record.request_id = request_id.get()
        return True


class MaskWebhookQuery(logging.Filter):
    """uvicorn.access args are (client, method, path?query, http_version, status): hide secrets in a /webhooks query string."""

    def filter(self, record):
        a = record.args
        if isinstance(a, tuple) and len(a) > 2 and isinstance(a[2], str) and a[2].startswith("/webhooks/"):
            record.args = (*a[:2], SECRET_QS.sub(r"\1***", a[2]), *a[3:])
        return True


def _add(target, cls):
    if not any(isinstance(f, cls) for f in target.filters):
        target.addFilter(cls())


def setup() -> None:
    lvl = os.environ.get("LOG_LEVEL", "INFO").upper()
    logging.basicConfig(level=lvl if isinstance(logging.getLevelName(lvl), int) else "INFO", format=FORMAT)  # no-op when handlers exist
    for h in logging.getLogger().handlers:
        _add(h, RequestIdFilter)
    _add(logging.getLogger("uvicorn.access"), MaskWebhookQuery)
