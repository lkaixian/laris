# Roles and permissions

Every person holds one role. A role has a **class**, `owner` or `staff`, and `users.role` stays that class: the database guards (approving a quote, accepting a supplier document, promoting it to the cost book) read `laris.role` = owner or staff and cannot be widened from the app. Roles live in the tenant-scoped table `roles` (forced row level security); `users.role_id` points at one, in the same tenant (composite foreign key), and a trigger keeps `users.role` equal to the role's class.

- **Owner** (system, class owner): holds every permission, cannot be changed or deleted.
- **Staff** (system, class staff): its permissions are editable, it cannot be deleted or renamed. It stores no list, which means the defaults marked below, so existing staff behave exactly as before until an owner edits it.
- **Custom roles**: always class staff (a database CHECK refuses an owner-class custom role). Create, rename, set permissions and delete under `/api/roles` (owner only, audited). Deleting is refused while anyone holds the role. Changing a person's role signs them out; changing a role's permissions applies at once (permissions are read on every request).

Code: the catalog is one dict, `src/perms.py` (`CATALOG`, `NON_ASSIGNABLE`, `DEFAULT_STAFF`). Routes call `require_perm(ctx, key)`; the cost scrubbing keys on `view_costs`, not on the role.

## Assignable permissions

| Key | Group | Default staff | Meaning |
|---|---|---|---|
| `view_costs` | Costs and prices | no | Supplier prices, cost items, margins, stale alerts, supplier chat text. Without it every response is scrubbed of them |
| `view_reports` | Costs and prices | no | Margin report (cost and margin figures in it also need `view_costs`) |
| `edit_supplier_contacts` | Contacts | no | Change a supplier's name or number |
| `manage_contacts` | Contacts | yes | Create and edit contacts |
| `upload_documents` | Documents | yes | Ingest a supplier file or text, key a document in |
| `ask_suppliers` | Suppliers | yes | Send a photographed item to suppliers |
| `view_replies_prices` | Suppliers | no | Words and prices in suppliers' replies |
| `manage_followups` | Quotes | no | Send or skip a follow-up |
| `export_data` | Data | no | Contact book CSV (BOM and PO exports also need `view_costs`) |
| `view_audit` | Activity | yes | The activity feed (cost entries in it also need `view_costs`) |

## Owner only, not assignable

These are refused with 422 `not_assignable` when put in a role, and stay `require_owner` (or the database guard):

| Action | Why |
|---|---|
| manage team (`/api/users`) | account level power |
| manage roles (`/api/roles`) | account level power |
| manage settings and branding (`/api/settings`) | account level power |
| approve, accept, reject, send quotes (`/api/documents/{id}/transition`) | the database guard needs an owner (`approved_by` must be an owner) |
| promote a supplier document or ask-supplier reply into the cost book (`/api/rfq/.../accept`) | same guard; it moves real cost |
| erase a customer's personal data | PDPA action |
| decide field proposals; clear `needs_review` on a quote line | owner decision |

Branding (display name, colour, logo) is readable by every signed-in role in `GET /api/me` `org`, writable by the owner only.

## Every write route and its gate (step 105)

A custom role with **no** permissions is read-only. `tests/test_permissions.py` walks every `POST/PUT/PATCH/DELETE` route under `/api`, calls it as such a role and demands 403, except the explicit `OPEN` set below; a new write route without a gate fails that test.

| Route | Gate |
|---|---|
| `POST /api/documents/ingest`, `POST /api/documents/manual` | `upload_documents` |
| `POST /api/documents/{id}/lines/{lid}` | `upload_documents`; sending `unit_price` also needs `view_costs` |
| `POST /api/documents/{id}/transition` | owner-class moves: owner (database guard); any other caller needs `upload_documents` |
| `POST /api/listings`, `PATCH /api/listings/{id}/items/{iid}` | `upload_documents` (a `price` in the patch also needs `view_costs`) |
| `POST /api/listings/{id}/items/{iid}/ask`, `POST /api/rfq` | `ask_suppliers` |
| `POST /api/rfq/{id}/replies/{rid}/accept` | owner |
| `POST /api/enquiries/simulate` | `manage_contacts` |
| `POST /api/jobs/{id}` | `manage_contacts` (status, due date, assignee, priority, notes) |
| `GET /api/jobs`, `GET /api/jobs/agenda` | any role (selling totals only) |
| `POST /api/followups/{id}` (and `GET /api/followups`) | `manage_followups` |
| `POST /api/contacts` | `manage_contacts`; `role: supplier` also `edit_supplier_contacts` |
| `POST /api/contacts/{id}` | `manage_contacts`; a supplier's name or number also `edit_supplier_contacts` (403 `owner_only`) |
| `POST /api/settings`, `POST /api/settings/channels`, `POST /api/field-proposals/{id}/decide`, `POST /api/parties/{id}/erase` | owner |
| `POST /api/documents/{id}/send` | owner (sending a quote to the customer is an owner action) |
| `GET /api/documents/{id}/export?variant=internal` | `export_data` and `view_costs` (the customer variant and `/preview` need only read access and are scrubbed like `/pdf`) |
| `POST /api/users`, `POST /api/users/{id}`, `POST/PATCH/DELETE /api/roles...`, `POST /api/invites`, `POST /api/invites/{id}/resend`, `DELETE /api/invites/{id}` | owner |
| `POST /api/license`, `POST /api/license/request` | owner |

`OPEN` (no permission needed): own account and public pages (`login`, `logout`, `signup`, `signup/verify`, `signup/resend`, `password/forgot`, `password/reset`, `invites/preview`, `invites/accept`, `me/password`, `me/sessions/revoke-others`, `me/sessions/{sid}`) and `POST /api/assistant`, which only answers questions with the caller's own scrubbed read access (its follow-up answer needs `manage_followups`, its cost and margin answers `view_costs`).

Reads: without `view_costs` every response is scrubbed (tracker, documents, contacts, dashboard, search, margin report, RFQ replies); `GET /api/followups` needs `manage_followups`.

`GET /api/system/scheduler` (read only): owner only (403 `owner_only`), asserted in `tests/test_permissions.py`.

On-track tracker (read only, so no row in the write table): `GET /api/documents/{id}/timeline` needs `view_audit`, and shows supplier chat text only with `view_costs`. `GET /api/track` is open to every role but scrubs: a supplier document's total needs `view_costs`, an ask-supplier price needs `view_replies_prices` (without it only waiting / answered is visible), a catalog item's price needs `view_costs`; its `stats` block needs `view_audit`. `dashboard.track` holds counts only.

## Accepted risk: catalog photos and crops

`GET /api/listings/{id}/image` and `GET /api/listings/{id}/items/{item_id}/crop` serve the original photo and each product's crop to every signed-in role, including one without `view_costs`. A photographed supplier price list could therefore be read from the picture itself. This is accepted: staff reviewing a catalog need the crop. The structured `price` and `currency` are withheld without `view_costs`. If this stops being acceptable, gate both routes on `view_costs` or on `upload_documents`.

## Audit log and personal data

Audit events name entities by id, never by email. Invitations log `invitation sent (role)` / `invitation resent`. Known remaining personal data: `contact changed` events store the old and new chat number of a contact (kept on purpose, it traces where a supplier's chat is routed).
