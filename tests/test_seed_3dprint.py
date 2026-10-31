"""The 3D-printer parts demo seed loads, is idempotent, and works with the comparison API."""
from pathlib import Path

from src import db
from support.fixtures import env, pg_url  # noqa: F401

SQL = (Path(__file__).resolve().parents[1] / "db" / "seed_3dprint_parts.sql").read_text(encoding="utf-8")


def load(e):
    import psycopg
    with psycopg.connect(e.pg, autocommit=True) as c:
        c.execute(SQL)


def test_seed_loads_once_and_compares(env, pg_url):
    env.pg = pg_url
    load(env)
    load(env)
    n = lambda tb: env.sql(f"select count(*) c from {tb}")[0]["c"]
    assert n("products") >= 150 and n("supplier_offers") > 300 and env.sql("select count(distinct category) c from products")[0]["c"] == 12
    pid = env.sql("select id from products where item_key='nozzle_brass_0_4mm'")[0]["id"]
    r = env.c.get(f"/api/products/{pid}/compare?qty=50", headers=env.O).json()
    assert r["recommended"] and any("expired" in x["why_not"] for x in r["disqualified"])
