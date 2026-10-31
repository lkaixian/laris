"""The permission catalog: the single source of truth (docs/roles.md, GET /api/roles and the route checks all read it).
A role's permissions are stored as text[] in `roles`; NULL on the system staff role means "the defaults below"."""

CATALOG = {
    "view_costs": {"label": "See costs and margins", "group": "Costs and prices", "default": False,
                   "description": "Supplier prices, cost items, margins, stale-cost alerts and supplier chat text. Without it every response is scrubbed of them."},
    "view_reports": {"label": "See the margin report", "group": "Costs and prices", "default": False,
                     "description": "The margin report (cost and margin figures in it also need See costs and margins)."},
    "view_revenue": {"label": "See revenue and profit", "group": "Costs and prices", "default": False,
                     "description": "The Revenue page: money in and out, untung kasar (gross profit) and untung bersih (net profit). It shows costs, so it also needs See costs and margins."},
    "record_expenses": {"label": "Record running costs", "group": "Costs and prices", "default": False,
                        "description": "Add rent, wages and bills to the Revenue page so untung bersih is right. Taking one back out (a void) is the owner's."},
    "edit_supplier_contacts": {"label": "Change a supplier's name or number", "group": "Contacts", "default": False,
                               "description": "Where a supplier's chat is routed. Other contact fields only need Manage contacts."},
    "manage_contacts": {"label": "Add and edit contacts", "group": "Contacts", "default": True,
                        "description": "Create and edit customers, suppliers and contractors."},
    "upload_documents": {"label": "Upload supplier documents", "group": "Documents", "default": True,
                         "description": "Ingest a supplier file or pasted text, and key a document in by hand."},
    "manage_catalog": {"label": "Manage the catalog", "group": "Catalog", "default": True,
                       "description": "Read catalog photos, edit and confirm their products, and keep the catalog's own categories (add, rename, delete, move products)."},
    "ask_suppliers": {"label": "Ask suppliers for a price", "group": "Suppliers", "default": True,
                      "description": "Send a photographed item to suppliers on WhatsApp or Telegram."},
    "view_replies_prices": {"label": "See supplier replies and prices", "group": "Suppliers", "default": False,
                            "description": "The words and prices in suppliers' replies to an ask."},
    "manage_contracts": {"label": "Draft supplier contracts", "group": "Suppliers", "default": False,
                         "description": "Start a contract from a quote and submit it for approval. Also see supplier prices and contracts."},
    "approve_contracts": {"label": "Approve contracts up to a limit", "group": "Suppliers", "default": False,
                          "description": "Approve a contract worth no more than the limit in Supplier settings. Larger ones need the owner."},
    "manage_followups": {"label": "Send or skip follow-ups", "group": "Quotes", "default": False,
                         "description": "Send the suggested chase message to a customer, or skip it."},
    "export_contacts": {"label": "Export the contact book", "group": "Data", "default": False,
                        "description": "Download the contact book as CSV (names and numbers are personal data)."},
    "export_audit": {"label": "Export the activity log", "group": "Data", "default": False,
                     "description": "Download the activity log as CSV or PDF. Reading it needs See the activity feed."},
    "export_documents": {"label": "Export quotes with costs (BOM, PO, internal file)", "group": "Data", "default": False,
                         "description": "The internal quote file, bill of materials and purchase-order exports. They carry supplier cost, so they also need See costs and margins."},
    "view_business_report": {"label": "See the business report", "group": "Reports", "default": False,
                             "description": "The Business report page: KPIs against targets, operations and analytics. It shows costs, profit and what customers owe, so it also needs See costs and margins and See revenue and profit."},
    "set_report_targets": {"label": "Set report targets and cash", "group": "Reports", "default": False,
                           "description": "Change the targets and the cash on hand the Business report compares against. Reading the report needs See the business report."},
    "view_audit": {"label": "See the activity feed", "group": "Activity", "default": True,
                   "description": "The audit feed (cost entries in it also need See costs and margins)."},
    "record_payments": {"label": "Record payments", "group": "Orders", "default": False,
                        "description": "Record a deposit or balance payment, read a payment slip, and see an order's payments, receipts and balance."},
    "issue_delivery": {"label": "Issue delivery orders", "group": "Orders", "default": False,
                       "description": "Create and send a delivery order for an order (prices are off on it unless the owner turns them on)."},
}
# Owner only, never assignable: they lean on the database guard (role class owner) or are account-level powers.
NON_ASSIGNABLE = {
    "manage_team": "Add, edit and deactivate people",
    "manage_roles": "Create and edit roles",
    "manage_settings": "Organisation settings and branding",
    "approve_quotes": "Approve, accept, reject and send quotes (the database guard needs an owner)",
    "promote_to_cost_book": "Accept a supplier document or ask-supplier reply into the cost book",
    "erase_party": "Erase a customer's personal data",
    "decide_field_proposals": "Approve or ignore proposed extra fields",
    "issue_proforma": "Issue a proforma invoice and set its deposit",
    "issue_invoice": "Issue the invoice for an order",
    "void_documents": "Void an order document or reverse a payment",
}
ASSIGNABLE = frozenset(CATALOG)
ALL = ASSIGNABLE  # the owner role holds every assignable permission (and the owner-only actions by being class owner)
DEFAULT_STAFF = frozenset(k for k, v in CATALOG.items() if v["default"])


# A role saved before a permission was split keeps what it could do: the old key grants every key that replaced it. (Migration 0009 rewrites the stored
# lists once; this keeps a list from an older backup or import working the same.) upload_documents is not here on purpose: a role that has it and
# lacks manage_catalog was set up that way deliberately after the split.
LEGACY = {"export_data": ("export_contacts", "export_audit", "export_documents")}


def grant(stored) -> frozenset:
    """What a staff-class role may do: NULL = defaults; stored keys outside the catalog (removed, or owner-only) never count."""
    if stored is None:
        return DEFAULT_STAFF
    keys = set(stored)
    for old, new in LEGACY.items():
        if old in keys:
            keys.update(new)
    return frozenset(keys) & ASSIGNABLE
