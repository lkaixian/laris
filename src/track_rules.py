"""On-track rules for the tracker: how long something sat in its stage, and whether that is too long. Pure functions, no database.
Day rules count calendar days in Malaysia time (pipeline.MY) between the stage start and `now`; "older than N days" means days > N.
The no-reply rule is exact hours since the quote was sent. Defaults are constants here and are described in docs/tracker.md."""
from datetime import datetime

from .pipeline import MY

QUOTE_SEND_DAYS = 3        # outbound draft or approved: waiting for approval / sending
NO_REPLY_HOURS = 48        # outbound sent or read with no decision; a trade template's followup_hours replaces this
EXPIRES_DAYS = 3           # outbound valid_until this close, or passed
REVIEW_DAYS = 2            # inbound received or parsed: waiting for review
OWNER_DECISION_DAYS = 2    # inbound reviewed: waiting for the owner
SUPPLIER_REPLY_DAYS = 2    # ask-suppliers reply still waiting
LISTING_REVIEW_DAYS = 3    # catalog item still needs review

TERMINAL = frozenset({"accepted", "rejected", "expired", "superseded", "cancelled", "in_cost_book", "job_created",
                      "confirmed", "discarded"})  # never overdue; confirmed / discarded are the catalog item's end states
LABELS = {"received": "Received", "draft": "Draft", "parsed": "Parsed", "reviewed": "Reviewed", "accepted": "Accepted",
          "in_cost_book": "In cost book", "approved": "Approved", "sent": "Sent", "read": "Opened by customer",
          "job_created": "Job created", "expired": "Expired", "rejected": "Rejected", "cancelled": "Cancelled",
          "superseded": "Superseded", "waiting": "Waiting for supplier", "needs_review": "Needs review", "ready": "Ready",
          "confirmed": "Confirmed", "discarded": "Discarded"}
KINDS = ("quote", "supplier_doc", "rfq", "listing")


def label(status: str) -> str:
    return LABELS.get(status, status.replace("_", " ").capitalize())


# Age colour bands ("heat") for the tracker and follow-ups: the last day each band covers. 8 days and more = stale.
HEAT = ((1, "fresh"), (3, "waiting"), (7, "late"))
HEAT_BANDS = ("fresh", "waiting", "late", "stale")


def heat(status: str, days: int) -> str | None:
    """Colour band by calendar days waiting: fresh 0-1, waiting 2-3, late 4-7, stale 8+. Finished items have none."""
    if status in TERMINAL:
        return None
    return next((name for last, name in HEAT if days <= last), "stale")


def days_in_stage(since: datetime, now: datetime) -> int:
    return (now.astimezone(MY).date() - since.astimezone(MY).date()).days


def overdue_reason(kind: str, status: str, since: datetime, now: datetime, *, sent_at: datetime | None = None,
                   valid_until=None, followup_hours: int = NO_REPLY_HOURS) -> str | None:
    """Why this item is overdue, or None. kind is one of KINDS; valid_until is a date; sent_at (else since) starts the no-reply clock."""
    if status in TERMINAL:
        return None
    age = days_in_stage(since, now)
    if kind == "quote":
        if valid_until is not None and (valid_until - now.astimezone(MY).date()).days <= EXPIRES_DAYS:
            return "expires soon"
        if status in ("draft", "approved") and age > QUOTE_SEND_DAYS:
            return "quote waiting for approval/sending"
        if status in ("sent", "read") and (now - (sent_at or since)).total_seconds() > followup_hours * 3600:
            return "no reply since sent"
    elif kind == "supplier_doc":
        if status in ("received", "parsed") and age > REVIEW_DAYS:
            return "waiting for review"
        if status == "reviewed" and age > OWNER_DECISION_DAYS:
            return "waiting for owner decision"
    elif kind == "rfq":
        if status == "waiting" and age > SUPPLIER_REPLY_DAYS:
            return "supplier has not replied"
    elif kind == "listing":
        if status == "needs_review" and age > LISTING_REVIEW_DAYS:
            return "catalog item waiting for review"
    return None
