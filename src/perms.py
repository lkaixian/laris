"""The permission catalog: the single source of truth (docs/roles.md, GET /api/roles and the route checks all read it).
A role's permissions are stored as text[] in `roles`; NULL on the system staff role means "the defaults below"."""

CATALOG = {
    "view_costs": {"label": "See costs and margins", "group": "Costs and prices", "default": False,
                   "description": "Supplier prices, cost items, margins, stale-cost alerts and supplier chat text. Without it every response is scrubbed of them."},
    "view_reports": {"label": "See the margin report", "group": "Costs and prices", "default": False,
                     "description": "The margin report (cost and margin figures in it also need See costs and margins)."},
    "edit_supplier_contacts": {"label": "Change a supplier's name or number", "group": "Contacts", "default": False,
                               "description": "Where a supplier's chat is routed. Other contact fields only need Manage contacts."},
    "manage_contacts": {"label": "Add and edit contacts", "group": "Contacts", "default": True,
                        "description": "Create and edit customers, suppliers and contractors."},
    "upload_documents": {"label": "Upload supplier documents", "group": "Documents", "default": True,
                         "description": "Ingest a supplier file or pasted text, and key a document in by hand."},
    "ask_suppliers": {"label": "Ask suppliers for a price", "group": "Suppliers", "default": True,
                      "description": "Send a photographed item to suppliers on WhatsApp or Telegram."},
    "view_replies_prices": {"label": "See supplier replies and prices", "group": "Suppliers", "default": False,
                            "description": "The words and prices in suppliers' replies to an ask."},
    "manage_followups": {"label": "Send or skip follow-ups", "group": "Quotes", "default": False,
                         "description": "Send the suggested chase message to a customer, or skip it."},
    "export_data": {"label": "Export data", "group": "Data", "default": False,
                    "description": "Contact book CSV; the BOM and PO exports also need See costs and margins."},
    "view_audit": {"label": "See the activity feed", "group": "Activity", "default": True,
                   "description": "The audit feed (cost entries in it also need See costs and margins)."},
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
}
ASSIGNABLE = frozenset(CATALOG)
ALL = ASSIGNABLE  # the owner role holds every assignable permission (and the owner-only actions by being class owner)
DEFAULT_STAFF = frozenset(k for k, v in CATALOG.items() if v["default"])


def grant(stored) -> frozenset:
    """What a staff-class role may do: NULL = defaults; stored keys outside the catalog (removed, or owner-only) never count."""
    return DEFAULT_STAFF if stored is None else frozenset(stored) & ASSIGNABLE
