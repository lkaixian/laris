"""Observability for model calls: the two model doors note each call here, and the route that made it records them in ai_calls.
Counts and timings only. The question, the answer and the masked values are never kept."""
import contextvars
import time
from collections import Counter
from contextlib import contextmanager
from uuid import UUID

from psycopg.types.json import Jsonb

_pending = contextvars.ContextVar("ai_pending", default=None)
MAX_PENDING = 50  # a long-lived thread that never records cannot grow this without bound


def note(provider: str, ok: bool, started: float, mask) -> None:
    calls = _pending.get()
    if calls is None:
        calls = []
        _pending.set(calls)
    if len(calls) < MAX_PENDING:
        calls.append((provider, ok, int((time.perf_counter() - started) * 1000), dict(Counter(t[1:].split("_")[0] for t in mask.seen))))


def _uuid(v):
    try:
        return v if isinstance(v, UUID) or v is None else UUID(str(v))
    except ValueError:
        return None  # an actor that is a name or a channel id, not a user


def record(conn, tenant_id, user_id, kind: str) -> Counter:
    """Writes the pending calls and returns how many values of each type were hidden from the model in them."""
    calls, _ = _pending.get() or [], _pending.set([])
    hidden = Counter()
    for provider, ok, ms, masked in calls:
        hidden.update(masked)
        conn.execute("insert into ai_calls (tenant_id, user_id, kind, provider, ok, ms, masked) values (%s,%s,%s,%s,%s,%s,%s)",
                     (tenant_id, _uuid(user_id), kind, provider, ok, ms, Jsonb(masked)))
    return hidden


@contextmanager
def logged(conn, tenant_id, user_id, kind: str, into: Counter | None = None):
    """Wrap the code that calls the model. ponytail: when the call fails and the route then raises, the request rolls back
    and so does the row; failures the route handles itself (assistant, availability, rfq reply) are kept."""
    try:
        yield
    finally:
        n = record(conn, tenant_id, user_id, kind)
        if into is not None:
            into.update(n)
