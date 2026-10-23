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
