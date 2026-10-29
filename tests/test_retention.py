"""Scheduler retention purge, per-email code limits, fixed mail greeting, dev-echo off on a deployment."""
import re

from src import mailer, scheduler
from src.api import deps
from support.fixtures import env, pg_url  # noqa: F401
from test_signup import BODY, fresh, last_code, signup, verify, wrong  # noqa: F401


def n(e, q):
    return e.sql(q)[0]["n"]


def test_purge_stale_ages(env):
    e = env
    tid = e.sql("select tenant_id from users where id=%s", (e.owner,))[0]["tenant_id"]
    sup = e.sql("insert into parties(tenant_id, role, name) values (%s,'supplier','S') returning id", (tid,))[0]["id"]
    item = e.sql("insert into rfq_items(tenant_id, description, note, image, image_mime) values (%s,'d','n','\x01','image/png') returning id", (tid,))[0]["id"]
    send = e.sql("insert into rfq_sends(rfq_item_id, tenant_id, supplier_id, status) values (%s,%s,%s,'sent') returning id", (item, tid, sup))[0]["id"]
    for age in (10, 200):
        e.sql("insert into rfq_replies(send_id, tenant_id, message_text, created_at) values (%s,%s,'RM5', now() - %s * interval '1 day')", (send, tid, age))
    for age in (10, 100):
        lid = e.sql("insert into listings(tenant_id, image, image_mime, created_at) values (%s,decode('0102','hex'),'image/png', now() - %s * interval '1 day') returning id", (tid, age))[0]["id"]
        e.sql("insert into listing_items(listing_id, tenant_id, position, bbox, crop, cutout) values (%s,%s,0,'[0,0,1,1]','\x03','\x04')", (lid, tid))
    e.sql("insert into email_codes(purpose, user_id, tenant_id, code_hash, expires_at) select 'reset', id, tenant_id, 'x', now() - interval '2 days' from users limit 1")
    e.sql("insert into email_codes(purpose, user_id, tenant_id, code_hash, expires_at) select 'reset', id, tenant_id, 'y', now() + interval '5 minutes' from users limit 1")
    role = e.sql("select id from roles where tenant_id=%s limit 1", (tid,))[0]["id"]
    for i, (st, age) in enumerate((("accepted", 40), ("revoked", 5), ("pending", 3))):
        e.sql("""insert into invites(tenant_id, email, role_id, token_sha256, status, created_at, expires_at, accepted_at)
                 values (%s,%s,%s,%s,%s, now() - %s * interval '1 day', now() + interval '7 days' - %s * interval '1 day', case when %s='accepted' then now() - %s * interval '1 day' end)""",
              (tid, f"i{i}@x.com", role, f"h{i}", st, age, age, st, age))
    assert signup(e).status_code == 202 and signup(e, email="old@example.com").status_code == 202
    e.sql("update users set created_at = now() - interval '8 days' where email='old@example.com'")
    scheduler.run_once()
    assert n(e, "select count(*) n from email_codes where code_hash='x'") == 0 and n(e, "select count(*) n from email_codes where code_hash='y'") == 1
    assert n(e, "select count(*) n from invites") == 2  # the 40-day-old accepted one is gone
    assert n(e, "select count(*) n from users where email='old@example.com'") == 0 and n(e, "select count(*) n from users where email='ann@example.com'") == 1
    assert n(e, "select count(*) n from tenants where display_name='Acme Print'") == 1  # the old signup's own business went with it
    assert e.sql("select message_text is null gone from rfq_replies order by created_at desc") == [{"gone": False}, {"gone": True}]
    assert e.sql("select length(image) l from listings order by created_at desc") == [{"l": 2}, {"l": 0}]
    assert e.sql("select length(crop) l from listing_items i join listings l on l.id=i.listing_id order by l.created_at desc") == [{"l": 1}, {"l": 0}]
    assert e.sql("select cutout is null gone from listing_items i join listings l on l.id=i.listing_id order by l.created_at desc") == [{"gone": False}, {"gone": True}]


def test_wrong_guesses_survive_a_new_code(env):
    e = env
    signup(e)
    for _ in range(4):
        verify(e, wrong(last_code(e)))
    e.c.post("/api/signup/resend", json={"email": "ann@example.com"})  # fresh code, but 4 tries are already spent
    code = last_code(e)
    assert verify(e, wrong(code)).status_code == 400
    assert verify(e, code).status_code == 400  # dead: the budget is shared across codes


def _free():  # lift the short-window limits so only the daily cap is left
    for k in [k for k in deps.HITS if k.startswith("resend:")]:
        del deps.HITS[k]


def test_daily_cap_per_email(env):
    e = env
    signup(e)
    for _ in range(9):
        _free()
        assert e.c.post("/api/signup/resend", json={"email": "ann@example.com"}).status_code == 202
    _free()
    assert e.c.post("/api/signup/resend", json={"email": "ann@example.com"}).status_code == 429


def test_mail_greeting_is_fixed():
    for text in (mailer.verification_mail("123456")[1], mailer.reset_mail("123456")[1]):
        assert "\n\nHello,\n\n" in text


def test_dev_echo_ignored_on_deployment(env, monkeypatch):
    e = env
    monkeypatch.setenv("SIGNUP_DEV_ECHO", "1")
    assert re.fullmatch(r"\d{6}", signup(e, email="a@example.com").json()["dev_code"])
    monkeypatch.setenv("REPL_DEPLOYMENT", "1")
    assert "dev_code" not in signup(e, email="b@example.com").json()
