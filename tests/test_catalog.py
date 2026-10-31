"""Catalog products: search across photos, the business's own categories, moving products, and category suggestions."""
from support.fixtures import env, pg_url  # noqa: F401

from src.api.catalog import nearest, pick


def test_nearest_and_pick():
    cats = ["Filaments", "Printer maintenance"]
    assert nearest("Filament", cats) == "Filaments"  # plural or not
    assert nearest("Maintenance printer", cats) == "Printer maintenance"  # word order
    assert nearest("Resin", cats) is None
    assert pick("filaments", cats) == "Filaments"  # exact, ignoring case: the spelling the business has
    assert pick("PLA filament", cats) == "Filaments"  # a more specific guess falls under the existing category
    assert pick("resin", cats) == "Resin"  # nothing close: offered as a new category
    assert pick("  ", cats) is None


def seed(e):
    t = e.sql("select id from tenants limit 1")[0]["id"]
    lid = e.sql("insert into listings(tenant_id, note, source_channel, image, image_mime) values (%s, 'shelf', 'upload', 'x'::bytea, 'image/jpeg') returning id", (t,))[0]["id"]
    ids = {}
    for n, (desc, sku, cat, sug) in enumerate([("PLA filament white 1kg", "PLA-W", "Filaments", None), ("PETG filament black", "PETG-B", None, "Filaments"),
                                               ("Nozzle 0.4 mm", "NZ-04", None, "Printer maintenance"), ("Belt kit", None, None, None)]):
        ids[desc] = str(e.sql("""insert into listing_items(listing_id, tenant_id, position, description, sku, bbox, crop, category, category_suggestion)
                             values (%s, %s, %s, %s, %s, '[0,0,1,1]'::jsonb, 'x'::bytea, %s, %s) returning id""", (lid, t, n, desc, sku, cat, sug))[0]["id"])
    return ids


def test_search_categories_move_and_confirm(env):
    e = env
    ids = seed(e)
    get = lambda path: e.c.get("/api/catalog" + path, headers=e.O)  # noqa: E731
    post = lambda path, body, who=None: e.c.post("/api/catalog" + path, json=body, headers=who or e.O)  # noqa: E731

    assert {x["description"] for x in get("/items?q=filament").json()} == {"PLA filament white 1kg", "PETG filament black"}
    assert [x["description"] for x in get("/items?q=NZ-04").json()] == ["Nozzle 0.4 mm"]  # by SKU
    assert [x["description"] for x in get("/items?category=filaments").json()] == ["PLA filament white 1kg"]
    assert len(get("/items?uncategorised=true").json()) == 3 and len(get("/items?suggested=true").json()) == 2

    c = get("/categories").json()
    assert c["total"] == 4 and c["uncategorised"] == 3 and {"name": "Filaments", "count": 1} in c["categories"]

    assert post("/categories", {"name": "  Resin  "}).status_code == 201  # a category with no product yet
    assert "Resin" in [x["name"] for x in get("/categories").json()["categories"]]

    # confirm the offered suggestion on one product, then move another by hand
    assert post("/items/accept-suggestions", {"item_ids": [ids["PETG filament black"]]}).json()["accepted"] == 1
    assert post("/items/move", {"item_ids": [ids["Belt kit"], ids["Nozzle 0.4 mm"]], "category": "printer maintenance"}).json()["moved"] == 2
    cats = {x["name"]: x["count"] for x in get("/categories").json()["categories"]}
    assert cats["Filaments"] == 2 and cats["printer maintenance"] == 2 and cats["Resin"] == 0
    assert e.sql("select count(*) n from listing_items where category_suggestion is not null")[0]["n"] == 0  # a decision clears the offer

    # rename onto an existing name merges; delete leaves the products without a category
    assert post("/categories/rename", {"old": "printer maintenance", "new": "Filaments"}).json()["moved"] == 2
    assert {x["name"]: x["count"] for x in get("/categories").json()["categories"]}["Filaments"] == 4
    assert post("/categories/delete", {"name": "Filaments"}).json()["uncategorised"] == 4
    c = get("/categories").json()
    assert c["uncategorised"] == 4 and "Filaments" not in [x["name"] for x in c["categories"]]
    assert post("/items/move", {"item_ids": [ids["Belt kit"]], "category": None}).json()["category"] is None


def test_new_photo_suggests_the_nearest_existing_category(env):
    from src import db
    from src.api import listings
    e = env
    seed(e)
    t = e.sql("select id from tenants limit 1")[0]["id"]
    item = lambda d, c: {"description": d, "labels": [], "sku": None, "sizes": [], "price": None, "currency": None, "bbox": [0, 0, 1, 1], "reasons": [], "category": c}  # noqa: E731
    d = {"data": b"x", "mime": "image/jpeg", "pics": [b"a", b"b", b"c", b"d"],
         "items": [item("Silk PLA", "Filament"), item("Wood PLA", "filament"), item("Hotend", "Hot ends"), item("Mystery", None)]}
    with db.tx(tenant=db.ALL_TENANTS) as conn:
        res = listings.store(conn, t, None, d)
    got = {r["description"]: r["category_suggestion"] for r in e.sql("select description, category_suggestion from listing_items where listing_id=%s", (res["listing_id"],))}
    assert got == {"Silk PLA": "Filaments", "Wood PLA": "Filaments", "Hotend": "Hot ends", "Mystery": None}  # existing offered; a new one stays one spelling
