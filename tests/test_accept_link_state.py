"""A quote's page says whether the customer's link is live: while it is, the customer's answer records itself and nobody needs to record it by hand."""
from support.fixtures import env, pg_url  # noqa: F401
from test_accept import accept, decline, e, link, sent  # noqa: F401


def live(e, d):
    return e.c.get(f"/api/documents/{d}", headers=e.O).json()["doc"]["accept_link"]


def test_the_page_knows_whether_a_link_is_live(e):
    d = sent(e)
    assert live(e, d) is None or live(e, d)  # the send itself may have made one; what matters is that it is reported
    tok = link(e, d)
    got = live(e, d)
    assert got and got["first_viewed_at"] is None and got["expires_at"]                    # live, not opened yet
    e.c.get(f"/api/public/quote/{tok}")
    assert live(e, d)["first_viewed_at"]                                                    # opened by the customer
    newer = link(e, d)                                                                      # a newer link replaces the older one
    assert newer != tok and live(e, d)["first_viewed_at"] is None
    assert accept(e, newer).status_code == 200
    assert live(e, d) is None                                                               # answered: nothing left to wait for


def test_a_declined_or_revoked_link_is_not_live(e):
    d = sent(e)
    tok = link(e, d)
    assert decline(e, tok).status_code == 200
    assert live(e, d) is None
    d2 = sent(e)
    link(e, d2)
    e.sql("update quote_accept_links set revoked_at = now() where quote_id = %s", (d2,))
    assert live(e, d2) is None
    d3 = sent(e)
    link(e, d3)
    e.sql("update quote_accept_links set expires_at = now() - interval '1 day' where quote_id = %s", (d3,))
    assert live(e, d3) is None                                                              # expired unused: the buttons come back
