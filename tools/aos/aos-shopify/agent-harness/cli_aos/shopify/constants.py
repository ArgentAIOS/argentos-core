from __future__ import annotations

TOOL_NAME = "aos-shopify"
MODE_ORDER = ["readonly", "write", "full", "admin"]
MANIFEST_SCHEMA_VERSION = "1.0.0"

CONNECTOR_LABEL = "Shopify"
CONNECTOR_CATEGORY = "commerce-ops"
CONNECTOR_CATEGORIES = ["commerce-ops", "orders", "inventory"]
CONNECTOR_RESOURCES = ["shop", "product", "order", "customer", "fulfillment"]
CONNECTOR_SCOPE = {
    "kind": "store-catalog",
    "summary": "Scope Shopify workers by store, catalog status, order status, customer email, and created date window.",
    "fields": [
        {
            "id": "shop_domain",
            "label": "Shop domain",
            "required": True,
            "applies_to": [
                "shop.read",
                "product.list",
                "product.read",
                "order.list",
                "order.read",
                "customer.list",
                "customer.read",
            ],
            "example": "example.myshopify.com",
        },
        {
            "id": "product_status",
            "label": "Product status",
            "required": False,
            "applies_to": ["product.list"],
            "example": "active, draft, archived, any",
        },
        {
            "id": "order_status",
            "label": "Order status",
            "required": False,
            "applies_to": ["order.list"],
            "example": "open, closed, cancelled, any",
        },
        {
            "id": "customer_email",
            "label": "Customer email",
            "required": False,
            "applies_to": ["customer.list"],
            "example": "vip@example.com",
        },
        {
            "id": "created_after",
            "label": "Created after",
            "required": False,
            "applies_to": ["order.list", "customer.list"],
            "example": "2026-01-01 or 1704067200",
        },
        {
            "id": "created_before",
            "label": "Created before",
            "required": False,
            "applies_to": ["order.list", "customer.list"],
            "example": "2026-01-31 or 1706745600",
        },
    ],
    "command_defaults": {
        "product.list": {
            "status_env": "SHOPIFY_PRODUCT_STATUS",
        },
        "order.list": {
            "status_env": "SHOPIFY_ORDER_STATUS",
            "created_after_env": "SHOPIFY_CREATED_AFTER",
            "created_before_env": "SHOPIFY_CREATED_BEFORE",
        },
        "customer.list": {
            "email_env": "SHOPIFY_CUSTOMER_EMAIL",
            "created_after_env": "SHOPIFY_CREATED_AFTER",
            "created_before_env": "SHOPIFY_CREATED_BEFORE",
        },
    },
}

LIVE_READ_COMMANDS = [
    "shop.read",
    "product.list",
    "product.read",
    "order.list",
    "order.read",
    "customer.list",
    "customer.read",
]

SCAFFOLDED_COMMANDS = ["product.update", "order.cancel", "fulfillment.create"]

REQUIRED_ENV = ["SHOPIFY_SHOP_DOMAIN", "SHOPIFY_ADMIN_ACCESS_TOKEN"]
