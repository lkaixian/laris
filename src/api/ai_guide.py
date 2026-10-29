"""Optional in-app AI guide (default OFF, owner opt-in). The guide sees ONLY a redacted question plus menu names supplied by the
screen; it never reads business records and never calls an action. The owner picks hosted ILMU or their own server.
Nothing here logs or stores a question, a key or a URL beyond its host name."""
import ipaddress
import json
import logging
import os
import re
import socket
import time
from collections import defaultdict, deque
from typing import Literal
from urllib.parse import urlsplit

import httpx
from fastapi import APIRouter, Depends, Request
from pydantic import BaseModel, Field

from .. import ilmu, tgbots
from ..errors import ApiError
from ..parse_util import Mask
from .deps import Ctx, audit, read_ctx, require_owner, svc, throttle, write_ctx

log = logging.getLogger("laris")
r = APIRouter(prefix="/api")

AI_DISCLOSURE = {"version": 1, "text": (
    "What is sent: only the question you type, with email addresses, phone numbers and ID numbers removed, plus the names of menu items "
    "on the screen. It goes to the AI provider you choose here: hosted ILMU, or your own AI server. Nothing from your quotes, customers "
    "or costs is sent in Guide only mode. Guide plus my data also lets the Assistant answer from your records; it uses the existing "
    "Assistant, which also sends only the question, never the records. You must tell your customers about this in your privacy notice. "
    "The provider's own data retention applies; for your own server, that is your responsibility. You can turn this off at any time.")}
LIMIT, WINDOW = 20, 60  # guide questions per user per minute
_HITS = defaultdict(deque)  # ponytail: in-memory per process (single worker)
MAX_BODY, MAX_REPLY, MAX_TIME = 8_192, 65_536, 15
PORTS = (None, 443, 8443)
HOST = re.compile(r"[A-Za-z0-9.:-]+")
# Extra ranges that is_global lets through but that can carry a private IPv4 (NAT64, 6to4, Teredo).
EXTRA_BAD = tuple(ipaddress.ip_network(n) for n in ("64:ff9b::/96", "2002::/16", "2001::/32"))
BLOCKED = "That address is not allowed. Use the public https address of your AI server."


class AiError(ilmu.IlmuError):
    """A failure whose message is written here and is safe to show; an IlmuError's text is never shown."""


# ---------------------------------------------------------------- SSRF-safe client for the owner's own server
def check_url(url: str) -> tuple[str, int, str, str]:
    """Returns (host, port, path, ip to connect to), or raises AiError. Run at save time AND before every call."""
    try:
        u = urlsplit(url.strip())
        port = u.port
    except ValueError:
        raise AiError(BLOCKED) from None
    if (u.scheme != "https" or not u.hostname or not HOST.fullmatch(u.hostname) or "@" in u.netloc or "\\" in url
            or port not in PORTS or u.query or u.fragment):
        raise AiError(BLOCKED)
    port = port or 443
    try:
        infos = socket.getaddrinfo(u.hostname, port, type=socket.SOCK_STREAM)
    except (OSError, UnicodeError):
        raise AiError("That address could not be found.") from None
    ips = [i[4][0].split("%")[0] for i in infos]
    for a in ips:
        ip = ipaddress.ip_address(a)
        ip = getattr(ip, "ipv4_mapped", None) or ip
        if (not ip.is_global or ip.is_multicast or ip.is_private or ip.is_loopback or ip.is_link_local or ip.is_reserved
                or ip.is_unspecified or getattr(ip, "is_site_local", False) or any(ip in n for n in EXTRA_BAD)):
            raise AiError(BLOCKED)  # ONE bad address among several is enough: the caller cannot choose which one we connect to
    if not ips:
        raise AiError("That address could not be found.")
    return u.hostname, port, u.path.rstrip("/"), ips[0]


def chat(url: str, model: str, key: str, messages: list, client=None) -> str:
    """One chat completion on the owner's own server. https only, ports 443/8443, every resolved address public, no redirects,
    15 s, 64 KB reply. ponytail: the connection is PINNED to the address that was just checked (certificate and SNI still use the
    host name), which closes the DNS-rebinding gap between check and connect. The 15 s limit is checked between reads, so a server
    that drips one byte just under each read timeout can run longer; add a hard timer thread if that matters.
    UNVERIFIED against a real TLS server (tests use a fake transport)."""
    host, port, path, ip = check_url(url)
    body = json.dumps({"model": model, "messages": messages, "max_tokens": 200, "temperature": 0}).encode()
    if len(body) > MAX_BODY:
        raise AiError("The question is too long for the AI server.")
    target = f"https://[{ip}]:{port}" if ":" in ip else f"https://{ip}:{port}"
    own = client is None
    client = client or httpx.Client(trust_env=False)  # trust_env off: no proxy variable may redirect the call
    try:
        with client.stream("POST", target + path + "/chat/completions", content=body, follow_redirects=False, timeout=MAX_TIME,
                           headers={"Authorization": f"Bearer {key}", "Content-Type": "application/json", "Host": f"{host}:{port}" if port != 443 else host},
                           extensions={"sni_hostname": host}) as resp:
            if resp.status_code != 200:  # a 3xx lands here too and is never followed
                raise AiError("The AI server did not accept the request.")
            buf, end = bytearray(), time.monotonic() + MAX_TIME
            for chunk in resp.iter_bytes():
                buf += chunk
                if len(buf) > MAX_REPLY or time.monotonic() > end:
                    raise AiError("The AI server answered too slowly or with too much data.")
    except httpx.HTTPError:
        raise AiError("The AI server could not be reached.") from None
    finally:
        if own:
            client.close()
    try:
        content = json.loads(bytes(buf))["choices"][0]["message"]["content"]
        if isinstance(content, str):
            return content
    except (ValueError, KeyError, IndexError, TypeError):
        pass
    raise AiError("The AI server sent an answer that could not be read.")


# ---------------------------------------------------------------- settings
def ai_row(ctx: Ctx):
    return ctx.conn.execute("select * from tenant_ai where tenant_id=%s", (ctx.tenant_id,)).fetchone()


def ask_json(request: Request, row, text: str, schema: dict) -> dict:
    """The one model call used by the Assistant and the guide: the owner's own server when chosen, else hosted ILMU."""
    if not (row and row["provider"] == "custom"):
        return ilmu.extract_json(text, schema, client=svc(request).ilmu)
    try:
        key = tgbots.decrypt(row["custom_key_enc"])
    except (RuntimeError, ApiError, TypeError):
        raise AiError("The saved key cannot be read. Enter it again in AI settings.") from None
    mask = Mask()
    msgs = [{"role": "system", "content": "Reply with ONLY a JSON object matching this JSON schema:\n" + json.dumps(schema)},
            {"role": "user", "content": mask(text)}]
    out = chat(row["custom_base_url"], row["custom_model"], key, msgs, getattr(svc(request), "ai_http", None))
    out = out.strip()
    if out.startswith("```"):
        out = out.strip("`").removeprefix("json").strip()
    try:
        j = json.loads(out)
    except ValueError:
        j = None
    if not isinstance(j, dict):
        raise AiError("The AI server did not answer in the expected form.")
    return mask.unmask(j)


def view(ctx: Ctx, row) -> dict:
    by = ctx.conn.execute("select name from users where id=%s", (row["consent_by"],)).fetchone() if row and row["consent_by"] else None
    return {"mode": row["mode"] if row else "off", "provider": row["provider"] if row else "ilmu",
            "custom": {"base_url": row["custom_base_url"] if row else None, "model": row["custom_model"] if row else None,
                       "has_key": bool(row and row["custom_key_enc"])},
            "consent": {"at": row["consent_at"] if row else None, "by": by["name"] if by else None, "version": row["consent_version"] if row else None},
            "disclosure": AI_DISCLOSURE, "available": {"ilmu": bool(os.environ.get("ILMU_API_KEY", "").strip())},
            "legacy_assistant": row is None}


class CustomIn(BaseModel, extra="forbid"):
    base_url: str = Field(min_length=1, max_length=200)
    model: str = Field(min_length=1, max_length=100)
    api_key: str | None = Field(None, min_length=1, max_length=400)


class AiIn(BaseModel, extra="forbid"):
    mode: Literal["off", "guide", "guide_data"]
    provider: Literal["ilmu", "custom"] | None = None
    custom: CustomIn | None = None
    accept_disclosure: bool = False


def host_of(url) -> str | None:
    return (urlsplit(url).hostname or None) if url else None


@r.get("/settings/ai")
def get_ai(ctx: Ctx = Depends(read_ctx)):
    require_owner(ctx)
    return view(ctx, ai_row(ctx))


@r.post("/settings/ai")
def set_ai(body: AiIn, ctx: Ctx = Depends(write_ctx)):
    require_owner(ctx)
    old = ai_row(ctx)
    provider = body.provider or (old["provider"] if old else "ilmu")
    url, model, enc = (old["custom_base_url"], old["custom_model"], old["custom_key_enc"]) if old and provider == "custom" else (None, None, None)
    if provider == "custom" and (body.custom or body.mode != "off"):
        if not os.environ.get("SECRET_KEY", "").strip():
            raise ApiError(422, "secret_key_unset", "The server has no SECRET_KEY, so the key for your own AI server cannot be stored safely. Ask whoever runs this server to set it.")
        if body.custom:
            url, model = body.custom.base_url.strip(), body.custom.model.strip()
            enc = tgbots.encrypt(body.custom.api_key) if body.custom.api_key else enc
        if not (url and model and enc):
            raise ApiError(422, "custom_incomplete", "Your own AI server needs an address, a model name and a key.")
        try:
            check_url(url)
        except AiError as e:
            raise ApiError(422, "bad_url", str(e)) from None
    was_on = bool(old and old["mode"] != "off")
    moved = was_on and (old["provider"] != provider or host_of(old["custom_base_url"]) != host_of(url))
    if body.mode != "off" and (not was_on or moved) and not body.accept_disclosure:
        raise ApiError(422, "disclosure_required", "Read the AI notice and tick the box to accept it before turning the AI on.")
    agreed = body.mode != "off" and body.accept_disclosure
    action = "disable" if body.mode == "off" else "change" if was_on else "enable"
    ctx.conn.execute("""insert into tenant_ai(tenant_id, mode, provider, custom_base_url, custom_model, custom_key_enc, consent_version, consent_at, consent_by)
                        values (%(t)s, %(m)s, %(p)s, %(u)s, %(mo)s, %(k)s, case when %(a)s then %(v)s end, case when %(a)s then now() end, case when %(a)s then %(by)s::uuid end)
                        on conflict (tenant_id) do update set mode=%(m)s, provider=%(p)s, custom_base_url=%(u)s, custom_model=%(mo)s, custom_key_enc=%(k)s,
                          consent_version=case when %(a)s then %(v)s else tenant_ai.consent_version end,
                          consent_at=case when %(a)s then now() else tenant_ai.consent_at end,
                          consent_by=case when %(a)s then %(by)s::uuid else tenant_ai.consent_by end, updated_at=now()""",
                      {"t": ctx.tenant_id, "m": body.mode, "p": provider, "u": url, "mo": model, "k": enc, "a": agreed,
                       "v": AI_DISCLOSURE["version"], "by": str(ctx.user_id)})
    ctx.conn.execute("insert into ai_consent_log(tenant_id, user_id, action, mode, provider, host, disclosure_version) values (%s,%s,%s,%s,%s,%s,%s)",
                     (ctx.tenant_id, ctx.user_id, action, body.mode, provider, host_of(url), AI_DISCLOSURE["version"] if agreed else None))
    audit(ctx, "tenant_ai", ctx.tenant_id, "ai settings changed",
          {"mode": old["mode"], "provider": old["provider"], "host": host_of(old["custom_base_url"])} if old else None,
          {"mode": body.mode, "provider": provider, "host": host_of(url)})
    return view(ctx, ai_row(ctx))


@r.post("/settings/ai/test")
def test_ai(request: Request, ctx: Ctx = Depends(write_ctx)):
    require_owner(ctx)
    row = ai_row(ctx)
    try:
        ask_json(request, row, "Reply with the word OK", {"type": "object", "properties": {"reply": {"type": "string"}}, "required": ["reply"]})
    except AiError as e:
        return {"ok": False, "message": str(e)}
    except ilmu.IlmuError as e:
        log.warning("ai test: provider failed: %s", type(e).__name__)
        return {"ok": False, "message": "The AI provider did not answer. Check the key and try again."}
    return {"ok": True, "message": "The AI provider answered."}


# ---------------------------------------------------------------- the guide
class Cand(BaseModel, extra="forbid"):
    id: str = Field(min_length=1, max_length=60)
    label: str = Field(min_length=1, max_length=80)
    path: str = Field(max_length=120)
    href: str = Field(max_length=120, pattern=r"^#/")


class GuideIn(BaseModel, extra="forbid"):
    question: str = Field(min_length=2, max_length=300)
    lang: Literal["en", "ms"] = "en"
    candidates: list[Cand] = Field(min_length=1, max_length=8)


GUIDE_SCHEMA = {"type": "object", "properties": {"answer": {"type": "string"}, "ids": {"type": "array", "items": {"type": "string"}}},
                "required": ["answer", "ids"]}
LONG_DIGITS = re.compile(r"\+?\d(?:[\s-]?\d){5,}")  # 6 or more digits, even with spaces or dashes in between


def clean(q: str) -> str:
    return LONG_DIGITS.sub("[redacted]", q)


@r.post("/assistant/guide")
def guide(body: GuideIn, request: Request, ctx: Ctx = Depends(write_ctx)):
    row = ai_row(ctx)
    if not row or row["mode"] == "off":
        raise ApiError(403, "ai_off", "The AI guide is switched off. The owner can turn it on in AI settings.")
    throttle(f"guide:{ctx.user_id}", LIMIT, WINDOW, "Too many questions in a minute. Wait a moment.", _HITS)
    by_id = {c.id: c for c in body.candidates}
    text = ("You help someone find the right screen in a small-business app. From the candidate screens, pick the ones that best answer "
            f"the question and write a short plain-text answer (under 300 characters) in {'Malay' if body.lang == 'ms' else 'English'}. "
            "Use only the candidates; never invent a screen. Reply as JSON {\"answer\": string, \"ids\": [candidate ids]}.\n"
            + json.dumps({"question": clean(body.question), "candidates": [{"id": c.id, "label": c.label, "path": c.path} for c in body.candidates]}))
    try:
        out = ask_json(request, row, text, GUIDE_SCHEMA)
    except ilmu.IlmuError as e:
        log.warning("ai guide: provider failed: %s", type(e).__name__)  # the type only: its text could carry the question or a URL
        raise ApiError(503, "ai_unavailable", "The AI guide is not available right now. Use the menu or the search box.") from None
    ids = out.get("ids") if isinstance(out.get("ids"), list) else []
    seen = [i for n, i in enumerate(ids) if isinstance(i, str) and i in by_id and i not in ids[:n]]
    answer = " ".join(re.sub(r"[\x00-\x1f\x7f]", " ", out["answer"]).split())[:400] if isinstance(out.get("answer"), str) else ""
    ctx.conn.execute("insert into usage_events(tenant_id, kind) values (%s,'guide')", (ctx.tenant_id,))  # a count only, never the question
    return {"answer": answer or "I could not find a matching screen. Try the search box.",
            "links": [{"label": by_id[i].label, "href": by_id[i].href} for i in seen]}
