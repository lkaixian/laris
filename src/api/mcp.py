"""A read-only MCP server (Model Context Protocol, JSON-RPC over HTTP POST) so the AI tool the business chooses can search its records.
An MCP key is an ordinary API key bound to ONE staff-class role: that role's permissions decide which sources the tool may search
(src/rag.py), exactly as for a person with that role. It works only while the owner's `rag` consent (disclosure version 2) is on record,
so turning that mode off switches every MCP key off. Output is masked the same way as the Assistant's, and each call is counted in
ai_calls (kind `mcp`) without its text. No write tool exists. ponytail: a thin JSON-RPC route instead of the `mcp` SDK (single request and
reply, no streaming or sessions); swap in the SDK if a client needs resumable streams. The mask is per response, so a client cannot
unmask a [NAME_1]."""
import json
import time

from fastapi import APIRouter, Body, Depends
from fastapi.responses import Response

from .. import ai_log, ai_quota, perms, rag
from ..errors import ApiError
from ..parse_util import Mask, contact_names
from .ai_guide import ai_row
from .assistant import rag_on
from .deps import JR, Ctx
from .public_api import key_conn

r = APIRouter(prefix="/api")
SUPPORTED = ("2025-06-18", "2025-03-26", "2024-11-05")
TOOLS = [{
    "name": "search",
    "description": "Search this business's own quotes, contacts and catalog (and costs or supplier prices only if this key's role may see them). "
                   "Returns short passages with a link path. Names, phone numbers, emails, ID and card numbers are replaced by placeholders.",
    "inputSchema": {"type": "object", "properties": {"query": {"type": "string", "minLength": 1, "maxLength": 200}}, "required": ["query"]},
    "annotations": {"readOnlyHint": True, "openWorldHint": False},
}]


def mcp_ctx(k=Depends(key_conn)) -> Ctx:
    conn, tid, kid = k
    row = conn.execute("select r.permissions, r.class from api_keys a join roles r on r.id = a.role_id where a.id = %s", (kid,)).fetchone()
    if not row or row["class"] != "staff":
        raise ApiError(403, "not_an_mcp_key", "this key is not an MCP key: create one for an AI tool in API access")
    ctx = Ctx(conn, "staff", None, tid, "MCP key", perms.grant(row["permissions"]))
    if not rag_on(ai_row(ctx)):
        raise ApiError(403, "ai_consent_required", "the owner has not agreed to AI reading of records in AI settings")
    return ctx


def ok(i, result):
    return JR({"jsonrpc": "2.0", "id": i, "result": result})


def err(i, code, message):
    return JR({"jsonrpc": "2.0", "id": i, "error": {"code": code, "message": message}})


def search(ctx: Ctx, q: str) -> dict:
    started, mask = time.perf_counter(), Mask(contact_names(ctx.conn, ctx.tenant_id))
    got = rag.retrieve(ctx, q)
    out = {"passages": [{"source": p["source"], "id": p["id"], "title": mask(p["title"]), "text": mask(p["text"][:300]), "path": p["href"]} for p in got["passages"]],
           "denied_sources": got["denied"]}
    ai_log.note("mcp", True, started, mask)
    ai_log.record(ctx.conn, ctx.tenant_id, None, "mcp")
    return {"content": [{"type": "text", "text": json.dumps(out, ensure_ascii=False)}], "isError": False}


@r.post("/mcp")
def mcp(msg: dict = Body(...), ctx: Ctx = Depends(mcp_ctx)):
    i, method, p = msg.get("id"), msg.get("method"), msg.get("params") or {}
    if "id" not in msg:  # a notification (for example notifications/initialized): no reply body
        return Response(status_code=202)
    if method == "initialize":
        asked = p.get("protocolVersion") if isinstance(p, dict) else None
        return ok(i, {"protocolVersion": asked if asked in SUPPORTED else SUPPORTED[0], "capabilities": {"tools": {}},
                      "serverInfo": {"name": "laris", "version": "1"}})
    if method == "ping":
        return ok(i, {})
    if method == "tools/list":
        return ok(i, {"tools": TOOLS})
    if method == "tools/call":
        a = p.get("arguments") if isinstance(p, dict) else None
        q = a.get("query") if isinstance(a, dict) else None
        if not isinstance(p, dict) or p.get("name") != "search" or not isinstance(q, str) or not 1 <= len(q.strip()) <= 200:
            return err(i, -32602, "call the search tool with a query of 1 to 200 characters")
        try:
            ai_quota.check(ctx.conn, ctx.tenant_id, "ai")
        except ApiError as e:  # the monthly allowance for AI messages is used up
            return err(i, -32000, e.message)
        return ok(i, search(ctx, q.strip()))
    return err(i, -32601, "method not found")
