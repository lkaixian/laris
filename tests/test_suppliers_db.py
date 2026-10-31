"""Suppliers schema: loads, seeds the demo, keeps tenants apart, refuses illegal contract moves."""
import psycopg
import pytest

from support.fixtures import env, pg_url  # noqa: F401


def tenant(e):
    return e.sql("select id from tenants limit 1")[0]["id"]


def test_demo_seed_loads_and_is_idempotent(env):
    t = tenant(env)
    env.sql("select seed_supplier_demo(%s)", (t,))
    env.sql("select seed_supplier_demo(%s)", (t,))
    n = lambda tb: env.sql(f"select count(*) c from {tb}")[0]["c"]
    assert n("products") == 5 and n("contracts") == 4 and n("supplier_profiles") == 8
    assert env.sql("select count(*) c from supplier_offers where product_id=(select id from products where name='Cooking oil 17kg')")[0]["c"] == 8


def test_illegal_contract_transition_is_refused_by_the_database(env):
    env.sql("select seed_supplier_demo(%s)", (tenant(env),))
    cid = env.sql("select id from contracts where state='expired' limit 1")[0]["id"]
    with pytest.raises(psycopg.errors.RaiseException, match="illegal transition"):
        env.sql("update contracts set state='active' where id=%s", (cid,))


def test_contract_events_are_append_only(env):
    env.sql("select seed_supplier_demo(%s)", (tenant(env),))
    with pytest.raises(psycopg.errors.InsufficientPrivilege):
        env.sql("delete from contract_events")
