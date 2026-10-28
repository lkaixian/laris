"""Logging: one line format with the request id; no query strings in uvicorn's access log and no exception messages in tracebacks. setup() is idempotent."""
import logging
import os
import traceback
from contextvars import ContextVar

request_id: ContextVar[str] = ContextVar("request_id", default="-")
FORMAT = "%(asctime)s %(levelname)s %(name)s [%(request_id)s] %(message)s"


class RequestIdFilter(logging.Filter):
    def filter(self, record):
        record.request_id = request_id.get()
        return True


class MaskQuery(logging.Filter):
    """uvicorn.access args are (client, method, path?query, http_version, status): drop the query string everywhere (tokens, search text)."""

    def filter(self, record):
        a = record.args
        if isinstance(a, tuple) and len(a) > 2 and isinstance(a[2], str) and "?" in a[2]:
            record.args = (*a[:2], a[2].split("?", 1)[0] + "?***", *a[3:])
        return True


class ScrubTraceback(logging.Filter):
    """Keep the stack frames of a logged exception but not its message: driver errors quote row values (emails, phones)."""

    def filter(self, record):
        if record.exc_info and record.exc_info[1] is not None:
            e = record.exc_info[1]
            record.exc_text = "".join(traceback.format_tb(e.__traceback__)) + type(e).__name__
            record.exc_info = None
        return True


def _add(target, cls):
    if not any(isinstance(f, cls) for f in target.filters):
        target.addFilter(cls())


def setup() -> None:
    lvl = os.environ.get("LOG_LEVEL", "INFO").upper()
    logging.basicConfig(level=lvl if isinstance(logging.getLevelName(lvl), int) else "INFO", format=FORMAT)  # no-op when handlers exist
    for h in logging.getLogger().handlers:
        _add(h, RequestIdFilter)
        _add(h, ScrubTraceback)
    _add(logging.getLogger("uvicorn.access"), MaskQuery)
    logging.getLogger("httpx").setLevel(logging.WARNING)  # its INFO line prints the full URL, and a Telegram URL carries the bot token
