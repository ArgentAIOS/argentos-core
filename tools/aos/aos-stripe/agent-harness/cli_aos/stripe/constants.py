from __future__ import annotations

MODE_ORDER = ["readonly", "write", "full", "admin"]
MANIFEST_SCHEMA_VERSION = "1.0.0"
TOOL_NAME = "aos-stripe"
BACKEND_NAME = "stripe"
DEFAULT_API_BASE_URL = "https://api.stripe.com"

STRIPE_SECRET_KEY_ENV = "STRIPE_SECRET_KEY"
STRIPE_WEBHOOK_SECRET_ENV = "STRIPE_WEBHOOK_SECRET"
STRIPE_ACCOUNT_ID_ENV = "STRIPE_ACCOUNT_ID"
STRIPE_CUSTOMER_FOCUS_ENV = "STRIPE_CUSTOMER_FOCUS"
STRIPE_INVOICE_STATUS_ENV = "STRIPE_INVOICE_STATUS"
STRIPE_CREATED_AFTER_ENV = "STRIPE_CREATED_AFTER"
STRIPE_CREATED_BEFORE_ENV = "STRIPE_CREATED_BEFORE"

CONNECTOR_DESCRIPTOR = {
    "label": "Stripe",
    "category": "finance-payments",
    "categories": ["finance-payments", "billing", "revenue-ops"],
    "resources": ["account", "balance", "customer", "invoice", "payment", "refund", "subscription", "dispute", "payout"],
}

AUTH_DESCRIPTOR = {
    "kind": "service-key",
    "required": True,
    "service_keys": [STRIPE_SECRET_KEY_ENV],
    "interactive_setup": [
        "Create a restricted Stripe secret key for the target account.",
        f"Add {STRIPE_SECRET_KEY_ENV} in API Keys before enabling live reads or writes.",
        f"Optionally set {STRIPE_WEBHOOK_SECRET_ENV} and {STRIPE_ACCOUNT_ID_ENV} for webhook-backed and connected-account workflows.",
        "Keep refund, invoice, and payout scopes narrow before enabling write actions.",
    ],
}

SCOPE_DESCRIPTOR = {
    "kind": "payments-ledger",
    "summary": "Scope Stripe workers by connected account, customer focus, invoice status, and created date window.",
    "fields": [
        {
            "id": "connected_account",
            "label": "Connected account",
            "required": False,
            "applies_to": [
                "account.read",
                "balance.read",
                "customer.list",
                "customer.search",
                "customer.read",
                "payment.list",
                "payment.read",
                "invoice.list",
                "invoice.read",
            ],
            "example": "acct_123456789",
        },
        {
            "id": "customer_focus",
            "label": "Customer focus",
            "required": False,
            "applies_to": [
                "customer.list",
                "customer.search",
                "customer.read",
                "payment.list",
                "invoice.list",
            ],
            "example": "cus_123, customer@example.com, or Acme Corp",
        },
        {
            "id": "invoice_status",
            "label": "Invoice status",
            "required": False,
            "applies_to": ["invoice.list"],
            "example": "draft, open, paid, uncollectible, void",
        },
        {
            "id": "created_after",
            "label": "Created after",
            "required": False,
            "applies_to": ["payment.list", "invoice.list"],
            "example": "2026-01-01 or 1704067200",
        },
        {
            "id": "created_before",
            "label": "Created before",
            "required": False,
            "applies_to": ["payment.list", "invoice.list"],
            "example": "2026-01-31 or 1706745600",
        },
    ],
    "command_defaults": {
        "account.read": {"account_env": STRIPE_ACCOUNT_ID_ENV},
        "balance.read": {"account_env": STRIPE_ACCOUNT_ID_ENV},
        "customer.list": {
            "account_env": STRIPE_ACCOUNT_ID_ENV,
            "customer_focus_env": STRIPE_CUSTOMER_FOCUS_ENV,
        },
        "customer.search": {
            "account_env": STRIPE_ACCOUNT_ID_ENV,
            "customer_focus_env": STRIPE_CUSTOMER_FOCUS_ENV,
        },
        "customer.read": {
            "account_env": STRIPE_ACCOUNT_ID_ENV,
            "customer_focus_env": STRIPE_CUSTOMER_FOCUS_ENV,
        },
        "payment.list": {
            "account_env": STRIPE_ACCOUNT_ID_ENV,
            "customer_focus_env": STRIPE_CUSTOMER_FOCUS_ENV,
            "created_after_env": STRIPE_CREATED_AFTER_ENV,
            "created_before_env": STRIPE_CREATED_BEFORE_ENV,
        },
        "invoice.list": {
            "account_env": STRIPE_ACCOUNT_ID_ENV,
            "customer_focus_env": STRIPE_CUSTOMER_FOCUS_ENV,
            "invoice_status_env": STRIPE_INVOICE_STATUS_ENV,
            "created_after_env": STRIPE_CREATED_AFTER_ENV,
            "created_before_env": STRIPE_CREATED_BEFORE_ENV,
        },
    },
}
