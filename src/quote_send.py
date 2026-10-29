"""Quote out: the follow-up chase, customer accept links and sending a quote (text + PDF) on a channel."""
import logging
import re
import secrets
from decimal import Decimal

from . import mailer, pricing, quote_doc, quote_pdf, tgbots
from .auth import token_hash
from .channels import telegram

log = logging.getLogger("laris")


def _record_message(conn, enquiry_id, doc_id, direction, channel, body, external_id):
    return conn.execute("""insert into messages(enquiry_id,document_id,direction,channel,body,external_id)
                           values (%s,%s,%s,%s,%s,%s) returning id""", (enquiry_id, doc_id, direction, channel, body, external_id)).fetchone()["id"]


# ---------------------------------------------------------------- quote out
def _target(conn, doc_id):
    """The quote plus where to reach its customer, or None when there is no chat contact on file."""
    d = conn.execute("""select d.doc_no, d.valid_until, d.currency, d.party_id, p.name, p.contact, e.channel,
                               t.wa_phone_number_id pn, d.tenant_id from documents d
                        join parties p on p.id=d.party_id join enquiries e on e.id=d.enquiry_id join tenants t on t.id=d.tenant_id
                        where d.id=%s and d.direction='out'""", (doc_id,)).fetchone()
    return d if d and d["contact"] and d["channel"] in ("whatsapp", "telegram") else None


def followup_text(conn, doc_id) -> str | None:
    """Suggested chase message (deterministic template, no model). The owner reads it before it goes out."""
    d = _target(conn, doc_id)
    if not d:
        return None
    total = conn.execute("""select coalesce(sum(round(qty * unit_price * (1 - coalesce(discount_pct, 0) / 100), 2)), 0) t
                            from document_lines where document_id=%s and not is_header""", (doc_id,)).fetchone()["t"]
    until = f", valid until {d['valid_until']}" if d["valid_until"] else ""
    return (f"Hi {d['name']}, just checking if you had a chance to look at quotation {d['doc_no']} "
            f"({d['currency']} {total:.2f}{until}). Happy to adjust it if needed.")


def send_followup(conn, send, doc_id) -> bool:
    d, body = _target(conn, doc_id), followup_text(conn, doc_id)
    if not d:
        return False
    _record_message(conn, None, doc_id, "out", d["channel"], body, send(d["channel"], d["contact"], body, tgbots.via(conn, d["tenant_id"], d["channel"], d["pn"])))
    return True


def recipient(p: dict, channel: str) -> str | None:
    """Where this customer is reached on a channel: email -> parties.email; telegram -> a tg:<id> contact; whatsapp -> any other contact."""
    if channel == "email":
        return (p["email"] or "").strip() or None
    c = (p["contact"] or "").strip()
    if channel == "telegram":
        return telegram.chat_of(c)
    return c if c and not re.match(r"(?i)(tg|telegram):", c) else None  # a tg: contact is never read as a phone number


def new_link(conn, doc_id, actor, revoke: bool = False) -> tuple[str | None, object]:
    """A fresh customer accept link (db/accept.sql) for an out quote: (url, expires_at), or (None, None) when APP_PUBLIC_URL is unset.
    Expires at the end of valid_until (Kuala Lumpur), else in 30 days. Only the token's SHA-256 is stored. revoke=True kills the quote's
    older unused links (the owner's explicit "new link"); a send leaves them, so a resend on another channel does not break the first link.
    The caller has checked the quote is the tenant's and open (approved / sent / read)."""
    base = mailer.base_url()
    if not base:
        return None, None
    tok = secrets.token_urlsafe(24)
    if revoke:
        conn.execute("update quote_accept_links set revoked_at = now() where quote_id=%s and decided_at is null and revoked_at is null", (doc_id,))
    row = conn.execute(
        """insert into quote_accept_links(tenant_id, quote_id, token_hash, created_by, expires_at)
           select d.tenant_id, d.id, %s, %s, case when d.valid_until is not null then (d.valid_until + 1)::timestamp at time zone 'Asia/Kuala_Lumpur'
                                                  else now() + interval '30 days' end
           from documents d where d.id=%s returning tenant_id, id, expires_at""", (token_hash(tok), actor, doc_id)).fetchone()
    conn.execute("insert into audit_log(tenant_id,actor,entity,entity_id,event) values (%s,%s,'documents',%s,'customer accept link created')",
                 (row["tenant_id"], str(actor), doc_id))
    return f"{base}/#/q/{tok}", row["expires_at"]


def deliver_quote(conn, svc, doc_id, channel: str, to: str, note: str | None = None, accept_url: str | None = None) -> None:
    """Send the customer PDF (selling prices only) on one channel and record a short note of it on the quote. Raises when it fails.
    accept_url (a secret link) goes out with the message but is never written to the recorded note."""
    m = quote_doc.load(conn, doc_id)
    pdf, name = quote_pdf.render_model(m), re.sub(r"[^A-Za-z0-9_-]", "_", m["doc_no"] or "quote") + ".pdf"
    if channel == "email":
        if not svc.mail(to, *mailer.quote_mail(m, note, accept_url), "quote", attachments=[{"filename": name, "content": pdf, "mime": "application/pdf"}]):
            raise RuntimeError("the email was not accepted (email is off, the provider refused it, or the PDF is over 8 MB)")
        wid = None
    else:
        pn = conn.execute("select wa_phone_number_id from tenants where id=(select tenant_id from documents where id=%s)", (doc_id,)).fetchone()["wa_phone_number_id"]
        wid = svc.send_document(channel, to, pdf, name, f"Quotation {m['doc_no']}" + (f"\n{note}" if note else "")
                                + (f"\nReview and accept: {accept_url}" if accept_url else ""), pn)
    _record_message(conn, None, doc_id, "out", channel, f"Quotation {m['doc_no']} sent as a PDF" + (f": {note}" if note else ""), wid)


def send_quote(conn, svc, doc_id, accept_url: str | None = None) -> bool:
    """Send an approved quote to the customer on the channel the enquiry came in on (text, then the PDF), else by email with the PDF
    when the customer has an email. Selling prices only. False = nowhere to send it; raises when the text could not be sent."""
    d = _target(conn, doc_id)
    if not d:
        p = conn.execute("select p.email from documents d join parties p on p.id=d.party_id where d.id=%s and d.direction='out'", (doc_id,)).fetchone()
        if not (p and recipient(p, "email")):
            return False
        deliver_quote(conn, svc, doc_id, "email", recipient(p, "email"), accept_url=accept_url)
        return True
    ls = conn.execute("select * from document_lines where document_id=%s order by line_no", (doc_id,)).fetchall()
    total = sum((pricing._q(l["qty"] * l["unit_price"] * (1 - (l["discount_pct"] or 0) / Decimal(100))) for l in ls), Decimal(0))
    body = "\n".join(
        [f"Quotation {d['doc_no']}"]
        + [f"{l['line_no']}. {l['description']} x {l['qty']:f} {l['uom']} @ {d['currency']} {l['unit_price']:.2f}" for l in ls]
        + [f"Total: {d['currency']} {total:.2f}"] + ([f"Valid until {d['valid_until']}"] if d["valid_until"] else []))
    wid = svc.send(d["channel"], d["contact"], body + (f"\nReview and accept: {accept_url}" if accept_url else ""), tgbots.via(conn, d["tenant_id"], d["channel"], d["pn"]))
    _record_message(conn, None, doc_id, "out", d["channel"], body, wid)
    try:  # the text is out; the PDF is a bonus that must not turn a delivered quote into a failed one
        deliver_quote(conn, svc, doc_id, d["channel"], d["contact"])
    except Exception as e:
        log.warning("quote %s: PDF not attached on %s (%s)", d["doc_no"], d["channel"], type(e).__name__)
    return True
