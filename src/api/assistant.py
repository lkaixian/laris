"""Assistant: a chat box over the owner's own data. The model only PICKS an intent and a search phrase from a closed list;
every answer is composed here from the database for the signed-in role. It cannot change anything, set a price or send a
message: requests to do so are refused with a link to the screen where a person does it."""
import logging
from collections import defaultdict, deque

from fastapi import APIRouter, Depends, Request
from pydantic import BaseModel, Field

from .. import ilmu, pipeline
from ..errors import ApiError
from .contacts import list_contacts, like
from .deps import Ctx, read_ctx, reply, svc, throttle, write_ctx
from .routes import SUMMARY, summary

log = logging.getLogger("laris")
r = APIRouter(prefix="/api")

INTENTS = ("attention", "search", "contacts", "stale_costs", "followups", "margin_report", "jobs", "cost_of", "do_action", "help")
SCHEMA = {
    "type": "object",
    "properties": {
        "intent": {"type": "string", "enum": list(INTENTS), "description": (
            "attention: what needs my attention / overview. search: find a document or anything by name or number. "
            "contacts: find a customer, supplier or contractor. stale_costs: quotes hurt by a supplier price rise. "
            "followups: quotes waiting for a customer reply. margin_report: recent quotes, margin, won and lost. "
            "jobs: job board status. cost_of: what an item costs from suppliers. "
            "do_action: the user asks to change, approve, send, price, delete or create something. help: anything else.")},
        "query": {"type": ["string", "null"], "description": "the name, number or item to look for, copied from the message; null if none"},
        "days": {"type": ["integer", "null"], "description": "for margin_report: how many days back"},
    },
    "required": ["intent"],
}
LIMIT, WINDOW = 20, 60  # questions per user per minute (each one can cost a model call)
# ponytail: in-memory per process (single worker)
_HITS = defaultdict(deque)

SUGGESTIONS = ["What needs my attention?", "Which quotes are waiting for a reply?", "How did the last 7 days go?",
               "Find the acrylic supplier", "What is the status of the jobs?"]


def rm(x) -> str:
    return f"RM {x:,.2f}"


FILLER = {"find", "show", "me", "who", "what", "whats", "is", "are", "the", "a", "an", "for", "of", "to", "supplier", "suppliers",
          "customer", "customers", "contractor", "contractors", "contact", "contacts", "number", "phone", "please", "search", "look",
          "up", "where", "give", "get", "how", "much", "does", "do", "cost", "costs", "my", "i", "need", "want", "about", "on", "in"}


def phrase(text: str) -> str | None:
    """What is left of a question once the filler words are removed (keyword fallback only)."""
    words = [w for w in "".join(ch if ch.isalnum() or ch in "-_." else " " for ch in text).split() if w.lower() not in FILLER]
    return " ".join(words) or None


def fallback(text: str) -> dict:
    """Keyword intent when the model is unavailable: deterministic and clearly labelled in the reply."""
    t = text.lower()
    for words, intent in ((("approve", "send ", "delete", "change the price", "set the price", "create a quote"), "do_action"),
                          (("stale", "price rise", "went up"), "stale_costs"), (("follow", "waiting for a reply", "no reply"), "followups"),
                          (("margin", "report", "last week", "last 7"), "margin_report"), (("job",), "jobs"),
                          (("attention", "overview", "today", "urgent"), "attention"),
                          (("cost of", "how much does", "supplier price", "costs"), "cost_of"),
                          (("contact", "supplier", "customer", "contractor", "phone", "number for"), "contacts")):
        if any(w in t for w in words):
            return {"intent": intent, "query": phrase(text) if intent in ("contacts", "cost_of") else None}
    return {"intent": "search", "query": phrase(text) or text}


def link(label, href):
    return {"label": label, "href": href}


def run(ctx: Ctx, intent: str, query: str | None, days: int | None) -> tuple[str, list]:
    c, q = ctx.conn, (query or "").strip()[:100]
    if intent == "do_action":
        return ("I can look things up but I cannot change, approve, price or send anything. Open the quote and do it there, "
                "so a person stays in control.", [link("Open the tracker", "#/tracker")])
    need = {"stale_costs": "view_costs", "cost_of": "view_costs", "margin_report": "view_reports"}  # margin_report shows margins: also view_costs
    if intent in need and not (need[intent] in ctx.perms and ctx.costs):
        return ("That needs cost and margin figures, which only the owner can see.", [])
    if intent == "followups" and "manage_followups" not in ctx.perms:  # names customers, like GET /api/followups
        return ("That needs the follow-up permission, which your role does not have.", [])
    if intent == "attention":
        n_review = c.execute("""select count(distinct d.id) n from documents d join document_lines l on l.document_id=d.id
                                where d.tenant_id=%s and l.needs_review and d.status in ('received','parsed','draft')""", (ctx.tenant_id,)).fetchone()["n"]
        n_jobs = c.execute("select count(*) n from jobs where tenant_id=%s and status<>'done'", (ctx.tenant_id,)).fetchone()["n"]
        parts, items = [f"{n_review} {'document needs' if n_review == 1 else 'documents need'} review", f"{n_jobs} open {'job' if n_jobs == 1 else 'jobs'}"], \
            [link("Tracker", "#/tracker"), link("Jobs", "#/jobs")]
        if ctx.costs:
            st = c.execute("select count(distinct quote_id) n, coalesce(sum(margin_delta),0) lost from v_stale_alerts where tenant_id=%s", (ctx.tenant_id,)).fetchone()
            fu = c.execute("""select count(*) n from followups f join documents d on d.id=f.document_id
                              where d.tenant_id=%s and f.state='pending' and d.direction='out'""", (ctx.tenant_id,)).fetchone()["n"]
            parts += [f"{st['n']} sent {'quote' if st['n'] == 1 else 'quotes'} hit by a cost rise" + (f" ({rm(-st['lost'])} margin)" if st["n"] else ""),
                      f"{fu} {'quote' if fu == 1 else 'quotes'} waiting for a reply"]
            items = [link("Stale costs", "#/alerts")] + items
        return ("Right now: " + "; ".join(parts) + ".", items)
    if intent == "stale_costs":
        rows = c.execute("select quote_id, quote_no, customer, margin_delta from v_stale_alerts where tenant_id=%s order by margin_delta limit 8", (ctx.tenant_id,)).fetchall()
        if not rows:
            return ("No open quote is affected by a newer supplier cost.", [])
        return (f"{len(rows)} open {'quote is' if len(rows) == 1 else 'quotes are'} hurt by a supplier cost rise, {rm(-sum(x['margin_delta'] for x in rows))} of margin in total. Nothing is re-priced automatically.",
                [link(f"{x['quote_no']} for {x['customer']} ({rm(-x['margin_delta'])})", f"#/doc/{x['quote_id']}") for x in rows])
    if intent == "followups":
        rows = c.execute("""select f.document_id, d.doc_no, p.name from followups f join documents d on d.id=f.document_id join parties p on p.id=d.party_id
                            where d.tenant_id=%s and f.state='pending' and d.direction='out' order by f.due_at limit 8""", (ctx.tenant_id,)).fetchall()
        if not rows:
            return ("No quote is waiting for a follow-up.", [])
        return (f"{len(rows)} {'quote has' if len(rows) == 1 else 'quotes have'} had no reply. Open the Stale costs page to read the suggested message and send it.",
                [link(f"{x['doc_no']} for {x['name']}", f"#/doc/{x['document_id']}") for x in rows] + [link("Stale costs page", "#/alerts")])
    if intent == "margin_report":
        d = min(max(days or 7, 1), 366)
        t = c.execute("""select count(distinct m.quote_id) n, coalesce(sum(m.line_total),0) rev, coalesce(sum(m.line_cost),0) cost
                         from v_quote_margin m join documents d on d.id=m.quote_id
                         where m.tenant_id=%s and d.created_at >= now() - %s * interval '1 day' and d.status not in ('cancelled','superseded')""", (ctx.tenant_id, d)).fetchone()
        if not t["n"]:
            return (f"No quotes were created in the last {d} days.", [])
        pct = (t["rev"] - t["cost"]) / t["rev"] * 100 if t["rev"] else 0
        return (f"Last {d} days: {t['n']} {'quote' if t['n'] == 1 else 'quotes'}, {rm(t['rev'])} quoted, margin {rm(t['rev'] - t['cost'])} ({pct:.1f}%).",
                [link("Open the full report", "#/alerts")])
    if intent == "jobs":
        rows = c.execute("""select j.status, count(*) n from jobs j where j.tenant_id=%s group by j.status""", (ctx.tenant_id,)).fetchall()
        k = {x["status"]: x["n"] for x in rows}
        return (f"Jobs: {k.get('todo', 0)} to do, {k.get('doing', 0)} in progress, {k.get('done', 0)} done.", [link("Open the job board", "#/jobs")])
    if not q:
        return ("What should I look for? Give me a name, a document number or an item.", [])
    if intent == "cost_of":
        rows = c.execute("""select ci.item_key, ci.uom, ci.unit_cost, p.name supplier, p.id sid from cost_items ci join parties p on p.id=ci.supplier_id
                            where ci.tenant_id=%s and ci.superseded_by is null and (ci.item_key ilike %s or p.name ilike %s) order by ci.item_key limit 8""",
                         (ctx.tenant_id, like(q), like(q))).fetchall()
        if not rows:
            return (f"No current cost matches \"{q}\".", [])
        return (f"{len(rows)} current {'cost' if len(rows) == 1 else 'costs'} for \"{q}\": " + "; ".join(f"{x['item_key']} {rm(x['unit_cost'])} per {x['uom']} ({x['supplier']})" for x in rows) + ".",
                [link(x["supplier"], f"#/contact/{x['sid']}") for x in rows[:4]])
    if intent == "contacts":
        rows = list_contacts(ctx, q, limit=8)
        if not rows:
            return (f"No contact matches \"{q}\".", [link("Add a contact", "#/contacts")])
        return (f"{len(rows)} {'contact matches' if len(rows) == 1 else 'contacts match'} \"{q}\".", [link(f"{x['name']} ({x['role']})", f"#/contact/{x['id']}") for x in rows])
    # search (also the fallback for help with a phrase)
    docs = c.execute(SUMMARY + """ where d.tenant_id=%(t)s and (d.doc_no ilike %(q)s or p.name ilike %(q)s or exists (
                        select 1 from document_lines l where l.document_id=d.id and (l.description ilike %(q)s or l.item_key ilike %(q)s)))
                      order by d.created_at desc limit 6""", {"t": ctx.tenant_id, "q": like(q)}).fetchall()
    people = list_contacts(ctx, q, limit=4)
    if not docs and not people:
        return (f"Nothing matches \"{q}\".", [])
    return (f"Found {len(docs)} {'document' if len(docs) == 1 else 'documents'} and {len(people)} {'contact' if len(people) == 1 else 'contacts'} for \"{q}\".",
            [link(f"{summary(ctx, d)['doc_no'] or 'Document'} ({d['party_name']})", f"#/doc/{d['id']}") for d in docs]
            + [link(f"{x['name']} ({x['role']})", f"#/contact/{x['id']}") for x in people])


class Ask(BaseModel, extra="forbid"):
    message: str = Field(min_length=1, max_length=500)


@r.post("/assistant")
def assistant(body: Ask, request: Request, ctx: Ctx = Depends(write_ctx)):
    throttle(f"assistant:{ctx.tenant_id}", LIMIT, WINDOW, "Too many questions in a minute. Wait a moment.", _HITS)
    source = "model"
    try:
        out = ilmu.extract_json(pipeline.redact(body.message), SCHEMA, client=svc(request).ilmu)
    except ilmu.IlmuError:
        log.warning("assistant: model unavailable, using keywords")
        out, source = fallback(body.message), "keywords"
    intent = out.get("intent") if out.get("intent") in INTENTS else "help"
    query = out.get("query") if isinstance(out.get("query"), str) else None
    days = out.get("days") if isinstance(out.get("days"), int) and not isinstance(out.get("days"), bool) else None
    if intent == "help":
        text, items = ("I can find documents and contacts, show what needs attention, stale costs, follow-ups, jobs and the margin report, "
                       "and look up supplier costs. Try one of the suggestions.", [])
    else:
        text, items = run(ctx, intent, query, days)
    pipeline._log_ai(ctx.conn, ctx.tenant_id, "assistant_query", None, {"intent": intent, "source": source})
    return reply(ctx, {"reply": text, "intent": intent, "items": items, "source": source, "suggestions": SUGGESTIONS if intent == "help" else []})


@r.get("/assistant/suggestions")
def suggestions(ctx: Ctx = Depends(read_ctx)):
    return reply(ctx, SUGGESTIONS if ctx.costs else [s for s in SUGGESTIONS if "reply" not in s and "7 days" not in s])
