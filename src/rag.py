"""Retrieval over ONE business's own data, for the AI. Three guards, none of them in the model:
1. tenant: every query filters on the caller's tenant_id, and the connection is the caller's own, so row level security applies too;
2. permission: each source names the permission it needs (src/perms.py). A source the caller lacks is never searched and is reported
   in `denied`, so a staff role without view_costs can never be handed a cost or a supplier price;
3. columns: a source selects only the columns the matching screen shows to that caller. No margin, no cost snapshot, no raw extraction.
Passages are DATA for the model, never instructions. ponytail: the text index is built on the fly over the newest 2000 rows of each
source; add a generated tsvector column and a GIN index when a business outgrows that."""
from .api.deps import Ctx

SCAN = 2000

# source -> (permission needed or None, inner query giving id, title, body, href)
SOURCES = {
    "quotes": (None, """select d.id::text id, 'Quote ' || coalesce(d.doc_no, '') || ' for ' || p.name title,
        d.status::text || '. ' || coalesce(string_agg(concat_ws(' ', l.description, 'x' || l.qty, l.uom, 'at', l.unit_price), '; ' order by l.line_no), '') body,
        '#/doc/' || d.id href
      from documents d join parties p on p.id = d.party_id left join document_lines l on l.document_id = d.id
      where d.tenant_id = %(t)s and d.direction = 'out' group by d.id, p.name order by d.created_at desc limit %(scan)s"""),
    "contacts": (None, """select id::text id, name || ' (' || role::text || ')' title, concat_ws('. ', attention, address) body, '#/contact/' || id href
      from parties where tenant_id = %(t)s order by name limit %(scan)s"""),
    "catalog": (None, """select id::text id, description title, concat_ws('. ', category, sku, labels::text, sizes::text, 'price ' || price) body, '#/catalog' href
      from listing_items where tenant_id = %(t)s and status = 'confirmed' order by created_at desc limit %(scan)s"""),
    "costs": ("view_costs", """select c.id::text id, c.item_key title, 'unit cost ' || c.unit_cost || ' per ' || c.uom || ' from ' || p.name || ' on ' || c.effective_date body,
        '#/contact/' || p.id href
      from cost_items c join parties p on p.id = c.supplier_id where c.tenant_id = %(t)s and c.superseded_by is null order by c.effective_date desc limit %(scan)s"""),
    "supplier_docs": ("view_costs", """select d.id::text id, 'Supplier document ' || coalesce(d.doc_no, '') || ' from ' || p.name title,
        coalesce(string_agg(concat_ws(' ', l.description, 'x' || l.qty, l.uom, 'at', l.unit_price), '; ' order by l.line_no), '') body, '#/doc/' || d.id href
      from documents d join parties p on p.id = d.party_id left join document_lines l on l.document_id = d.id
      where d.tenant_id = %(t)s and d.direction = 'in' group by d.id, p.name order by d.created_at desc limit %(scan)s"""),
}


def retrieve(ctx: Ctx, q: str, k: int = 6) -> dict:
    """-> {"passages": [{source, id, title, text, href}], "denied": [source names the caller may not search]}"""
    out, denied = [], []
    for name, (perm, inner) in SOURCES.items():
        if perm and perm not in ctx.perms:
            denied.append(name)
            continue
        rows = ctx.conn.execute(f"""select id, title, body, href, ts_rank(v, query) rank
            from (select *, to_tsvector('simple', title || ' ' || coalesce(body, '')) v from ({inner}) s) x, websearch_to_tsquery('simple', %(q)s) query
            where v @@ query order by rank desc limit %(k)s""", {"t": ctx.tenant_id, "q": q, "k": k, "scan": SCAN}).fetchall()
        out += [{"source": name, "id": r["id"], "title": r["title"], "text": r["body"] or "", "href": r["href"], "rank": r["rank"]} for r in rows]
    out.sort(key=lambda p: -p["rank"])
    return {"passages": [{k_: v for k_, v in p.items() if k_ != "rank"} for p in out[:k]], "denied": denied}
