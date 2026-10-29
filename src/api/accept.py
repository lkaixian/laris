"""Customer accept link: a SIMULATED e-signature ("Simulated signature for demonstration; not a legal e-signature").
Owner: POST /api/documents/{id}/accept-link. Public (no login, no cookies): GET /api/public/quote/{token}, POST .../accept, POST .../decline.
Every public read and write goes through the two SECURITY DEFINER functions in db/accept.sql; this file only validates input, limits
rates and shapes the answer (selling prices only). Errors are built here, not raised, so the app's error log never prints the token path."""
import logging
import re
import unicodedata
from uuid import UUID

from fastapi import APIRouter, Depends, Request
from pydantic import BaseModel, Field

from .. import auth, clock, db, logsetup, mailer, pipeline, quote_doc
from ..errors import ApiError
from .deps import JR, Ctx, require_owner, throttle, write_ctx
from .routes import _out_doc

log = logging.getLogger("laris")
r = APIRouter(prefix="/api")

TOKEN = re.compile(r"[A-Za-z0-9_-]{16,64}")
MAX_BODY = 2048
SIM = "Simulated signature for demonstration; not a legal e-signature."


def _err(status: int, code: str, msg: str, **extra) -> JR:
    return JR({"error": {"code": code, "message": msg, "request_id": logsetup.request_id.get(), **extra}}, status_code=status)


def _gone() -> JR:
    return _err(404, "not_found", "This link is not valid.")  # unknown, revoked, expired, used up: all the same answer


def _slow(key: str, limit: int, window: int) -> JR | None:
    try:
        throttle(key, limit, window, "Too many requests. Try again later.")
    except ApiError:
        return _err(429, "rate_limited", "Too many requests. Try again later.")


def _name(s: str) -> str:
    """Control characters out (they would break logs and mail headers), whitespace collapsed; the rest is kept as typed."""
    return " ".join("".join(ch if not unicodedata.category(ch).startswith("C") else " " for ch in s).split())


# ---------------------------------------------------------------- owner
@r.post("/documents/{doc_id}/accept-link")
def create_link(doc_id: UUID, ctx: Ctx = Depends(write_ctx)):
    """A fresh link for the customer to review and accept this quote; older unused links for it stop working."""
    require_owner(ctx)
    d = _out_doc(ctx, doc_id, lock=True)
    if d["status"] not in ("approved", "sent", "read"):
        raise ApiError(409, "not_linkable", f"quote is {d['status']}; a link works while it is approved, sent or read")
    if not mailer.base_url():
        raise ApiError(409, "public_url_missing", "The server has no public address configured (APP_PUBLIC_URL), so it cannot build the link.")
    throttle(f"acceptlink:{ctx.tenant_id}", 30, 3600, "Too many links in an hour. Wait a while.")
    url, exp = pipeline.new_link(ctx.conn, doc_id, ctx.user_id, revoke=True)
    return JR({"url": url, "expires_at": exp})


# ---------------------------------------------------------------- public
def _open(c, token: str):
    """(link row, None) or (None, error response). Leaves the connection narrowed to the link's tenant."""
    now = clock.trusted_now(c)["now"]
    link = c.execute("select accept_link_open(%s, to_timestamp(%s)) as l", (auth.token_hash(token), now)).fetchone()["l"]
    if not link:
        return None, _gone()
    c.execute("select set_config('laris.role', 'staff', true), set_config('laris.tenant', %s, true)", (link["tenant_id"],))
    return link, None


@r.get("/public/quote/{token}")
def view(token: str, request: Request):
    ip = auth.client_ip(request)
    if bad := _slow(f"pq-get:ip:{ip}", 30, 60):
        return bad
    if not TOKEN.fullmatch(token):
        return _gone()
    with db.tx("staff", "customer:link", tenant=db.ALL_TENANTS) as c:
        link, bad = _open(c, token)
        if bad:
            return bad
        m = quote_doc.load(c, link["quote_id"])
        d = link["decision"]
        return JR({"simulated": True, "notice": SIM,
                   "issuer": {"name": m["issuer"]["name"], "logo_url": m["issuer"]["logo_url"]},
                   "quote": {"doc_no": m["doc_no"], "valid_until": m["valid_until"], "status": link["status"], "currency": "RM", "total": m["total"],
                             "note": m["terms_text"],
                             "lines": [{"description": x["description"], "qty": x["qty"], "uom": x["uom"], "unit_price": x["unit_price"],
                                        "line_total": x["amount"]} for x in m["lines"] if not x["is_header"]]},
                   "can_accept": d is None,
                   "decided": {"decision": d, "at": link["decided_at"], "name": link["signer_name"]} if d else None})


class Sign(BaseModel, extra="forbid"):
    name: str = Field(max_length=300)
    agree: bool


class Decline(BaseModel, extra="forbid"):
    reason: str | None = Field(None, max_length=300)


def _decide(request: Request, token: str, decision: str, name: str | None, reason: str | None):
    ip, cl = auth.client_ip(request), request.headers.get("content-length") or "0"
    if not cl.isdigit() or int(cl) > MAX_BODY:
        return _err(413, "too_large", "request body too large")
    h = auth.token_hash(token)
    if bad := _slow(f"pq-do:ip:{ip}", 10, 3600):
        return bad
    if not TOKEN.fullmatch(token):
        return _gone()
    if bad := _slow(f"pq-do:tok:{h}", 10, 3600):
        return bad
    with db.tx("staff", "customer:link", tenant=db.ALL_TENANTS) as c:
        res = c.execute("select accept_link_decide(%s, %s, %s, %s, %s, to_timestamp(%s)) as r",
                        (h, decision, name, auth.token_hash(f"{ip}|{h}")[:16], reason, clock.trusted_now(c)["now"])).fetchone()["r"]
    if res["result"] == "not_found":
        return _gone()
    if res["result"] == "already_decided":
        if res["decision"] == decision:  # the same decision again (a double tap, a retry): the same answer, nothing changes
            return JR({"status": "accepted" if decision == "accepted" else "rejected", **({"job_created": True} if decision == "accepted" else {}), "simulated": True})
        return _err(409, "already_decided", "This quotation has already been decided.",
                    decided={"decision": res["decision"], "at": res["decided_at"], "name": res["signer_name"]})
    return JR({"status": "accepted", "job_created": True, "simulated": True} if decision == "accepted" else {"status": "rejected", "simulated": True})


@r.post("/public/quote/{token}/accept")
def accept(token: str, body: Sign, request: Request):
    name = _name(body.name)
    if not 2 <= len(name) <= 80:
        return _err(422, "bad_name", "Type your full name (2 to 80 characters).")
    if body.agree is not True:
        return _err(422, "must_agree", "Tick the box to confirm you accept this quotation.")
    return _decide(request, token, "accepted", name, None)


@r.post("/public/quote/{token}/decline")
def decline(token: str, request: Request, body: Decline | None = None):
    return _decide(request, token, "declined", None, _name(body.reason) if body and body.reason else None)
