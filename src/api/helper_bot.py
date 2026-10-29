"""The LARIS helper bot's message handling (link/unlink, one-tap bot creation). Routes stay in webhooks.py, which imports this lazily."""
import hashlib
import logging

from .. import db
from ..channels import telegram
from ..errors import ApiError
from . import webhooks as w
from .deps import HITS, Ctx, throttle

log = logging.getLogger("laris")


def _helper_link(conn, chat, code) -> tuple[str, bool]:
    try:
        throttle(f"helperlink:{chat}", 5, 3600, "too many tries", HITS)  # wrong guesses only: a success below gives the slot back
    except ApiError:
        return "Too many tries. Please wait an hour, or ask for a new link in the LARIS dashboard.", False
    row = conn.execute("""select c.id, c.user_id, c.tenant_id, u.name uname, t.name tname from telegram_link_codes c
                          join users u on u.id = c.user_id and u.active join tenants t on t.id = c.tenant_id
                          where c.code_hash = %s and c.used_at is null and c.expires_at > now() for update of c""",
                       (hashlib.sha256(code.upper().encode()).hexdigest(),)).fetchone()
    if not row:
        return w.BAD_CODE, False
    HITS[f"helperlink:{chat}"].pop()
    if conn.execute(f"select 1 from users where tenant_id=%(t)s and id <> %(u)s and active and {w.HANDLE_Q}", {"t": row["tenant_id"], "u": row["user_id"], "s": chat}).fetchone():
        return f"This Telegram account is already linked to someone else at {row['tname']}. Send /unlink from it first.", False
    conn.execute("update users set channel_handle = %s where id = %s", (f"tg:{chat}", row["user_id"]))
    conn.execute("update telegram_link_codes set used_at = now() where id = %s", (row["id"],))
    conn.execute("insert into audit_log(tenant_id,actor,entity,entity_id,event) values (%s,'system:helper','users',%s,'telegram linked')",
                 (row["tenant_id"], row["user_id"]))
    return (f"Linked to {row['tname']} as {row['uname']}. Staff: send a product photo with the caption /catalog, or forward a supplier "
            "price list. Send /unlink to disconnect."), True


def _helper(s, m, token):
    """One helper-bot message -> [(message, ok)]. Nothing but the link commands and the guide runs for a chat that is not linked."""
    m.to, m.external_id = token, f"h:{m.external_id}"
    chat, cmd = m.sender, (m.text or "") if not m.media_kind else ""
    reply, ok = None, True
    with db.tx("staff", "system:helper", tenant=db.ALL_TENANTS) as conn:
        who = conn.execute(w.STAFF_Q, {"ch": "telegram", "d": "".join(c for c in chat if c.isdigit()), "s": chat, "scope": None}).fetchall()
        if lk := w.LINK_CMD.match(cmd):
            reply, ok = _helper_link(conn, chat, lk.group(1))
        elif w.UNLINK_CMD.match(cmd):
            gone = conn.execute(f"update users set channel_handle = null where active and {w.HANDLE_Q} returning id, tenant_id", {"s": chat}).fetchall()
            for u in gone:
                conn.execute("insert into audit_log(tenant_id,actor,entity,entity_id,event) values (%s,'system:helper','users',%s,'telegram unlinked')",
                             (u["tenant_id"], u["id"]))
            reply = "Disconnected. You can link again from the LARIS dashboard." if gone else w.NOT_LINKED
        elif len(who) > 1:  # the same chat is linked in two businesses: never guess
            log.warning("helper message from %s dropped: ambiguous_sender", w._h(chat))
            return [(m, False)]
        elif not who:
            reply, ok = w.NOT_LINKED, False
        elif w.HELP_CMD.match(cmd):
            reply = w.HELPER_HELP
        else:
            m.tenant_id = who[0]["tenant_id"]
    if reply:
        try:
            s.send("telegram", chat, reply, token)
        except Exception as e:
            log.warning("helper reply to %s failed: %s", w._h(chat), type(e).__name__)
        return [(m, ok)]
    return w._process(s, [m])


def _managed_bot(s, mb, token):
    """One-tap bot creation: the owner confirmed a bot made through the helper (the manager bot). The business is found ONLY through the
    creator's linked chat (a linked owner of exactly one business); anything else in the update is ignored. Failures: a plain sentence to the owner."""
    from . import telegram_bots  # here, not at the top: telegram_bots imports webhooks
    uid = str((mb.get("user") or {}).get("id") or "") if isinstance(mb, dict) else ""
    bot = (mb.get("bot") or {}).get("id") if isinstance(mb, dict) else None
    if not uid.isdigit() or not isinstance(bot, int):
        return
    try:
        with db.tx("staff", "system:helper", tenant=db.ALL_TENANTS) as conn:
            owners = conn.execute(f"select id, tenant_id from users where active and role = 'owner' and {w.HANDLE_Q}", {"s": uid}).fetchall()
            if len(owners) != 1:
                msg = w.NOT_OWNER
            else:
                new = telegram.managed_bot_token(bot, client=s.http, token=token)
                me = telegram_bots.connect_bot(Ctx(conn, "owner", owners[0]["id"], owners[0]["tenant_id"], "", frozenset()), new, s.http)
                msg = f"Your bot @{me.get('username')} is connected. Customers can message it now."
    except ApiError as e:
        msg = e.message
    except Exception as e:  # never the exception text: it can carry a URL with a token
        log.warning("managed bot from %s failed: %s", w._h(uid), type(e).__name__)
        msg = "Sorry, we could not connect your new bot. Please try again, or connect it from the LARIS dashboard (Settings, Telegram)."
    try:
        s.send("telegram", uid, msg, token)
    except Exception as e:
        log.warning("helper reply to %s failed: %s", w._h(uid), type(e).__name__)
