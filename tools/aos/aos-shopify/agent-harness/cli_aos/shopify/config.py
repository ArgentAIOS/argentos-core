from __future__ import annotations

import os
from typing import Any

from .constants import (
    CONNECTOR_CATEGORIES,
    CONNECTOR_CATEGORY,
    CONNECTOR_LABEL,
    CONNECTOR_RESOURCES,
    CONNECTOR_SCOPE,
    LIVE_READ_COMMANDS,
    REQUIRED_ENV,
    SCAFFOLDED_COMMANDS,
    TOOL_NAME,
)


def _env(name: str) -> str:
    return os.getenv(name, "").strip()


def _redact(value: str | None, *, keep: int = 4) -> str:
    if not value:
        return ""
    if len(value) <= keep:
        return "*" * len(value)
    return f"{value[:2]}...{value[-keep:]}"


def runtime_config() -> dict[str, Any]:
    shop_domain = _env("SHOPIFY_SHOP_DOMAIN")
    access_token = _env("SHOPIFY_ADMIN_ACCESS_TOKEN")
    api_version_env = _env("SHOPIFY_API_VERSION")
    api_version = api_version_env or "latest"
    app_name = _env("SHOPIFY_APP_NAME")
    product_status = _env("SHOPIFY_PRODUCT_STATUS")
    order_status = _env("SHOPIFY_ORDER_STATUS")
    customer_email = _env("SHOPIFY_CUSTOMER_EMAIL")
    created_after = _env("SHOPIFY_CREATED_AFTER")
    created_before = _env("SHOPIFY_CREATED_BEFORE")

    configured = {name: bool(_env(name)) for name in REQUIRED_ENV}
    missing_keys = [name for name, present in configured.items() if not present]
    live_reads_enabled = not missing_keys
    scope = {
        "shop_domain": shop_domain or None,
        "product_status": product_status or None,
        "order_status": order_status or None,
        "customer_email": customer_email or None,
        "created_after": created_after or None,
        "created_before": created_before or None,
    }
    command_defaults = {
        "product.list": {"status": product_status or None},
        "order.list": {
            "status": order_status or None,
            "created_after": created_after or None,
            "created_before": created_before or None,
        },
        "customer.list": {
            "email": customer_email or None,
            "created_after": created_after or None,
            "created_before": created_before or None,
        },
    }

    return {
        "tool": TOOL_NAME,
        "backend": "shopify-admin",
        "label": CONNECTOR_LABEL,
        "category": CONNECTOR_CATEGORY,
        "categories": CONNECTOR_CATEGORIES,
        "resources": CONNECTOR_RESOURCES,
        "scope": CONNECTOR_SCOPE,
        "capabilities": {
            "live_read_commands": LIVE_READ_COMMANDS,
            "scaffolded_commands": SCAFFOLDED_COMMANDS,
            "live_reads_enabled": live_reads_enabled,
            "live_writes_enabled": False,
            "command_defaults": command_defaults,
        },
        "auth": {
            "kind": "service-key",
            "required": True,
            "service_keys": list(REQUIRED_ENV),
            "configured": configured,
            "missing_keys": missing_keys,
            "redacted": {
                "SHOPIFY_SHOP_DOMAIN": _redact(shop_domain),
                "SHOPIFY_ADMIN_ACCESS_TOKEN": _redact(access_token),
            },
        },
        "runtime": {
            "shop_domain": shop_domain,
            "shop_domain_present": bool(shop_domain),
            "access_token_present": bool(access_token),
            "api_version": api_version,
            "api_version_present": bool(api_version_env),
            "api_version_source": "env" if api_version_env else "default",
            "app_name": app_name or None,
            "scaffold_only": False,
            "live_backend_available": live_reads_enabled,
            "live_reads_enabled": live_reads_enabled,
            "live_writes_enabled": False,
            "live_backend_mode": "read-only",
            "scope": scope,
            "command_defaults": command_defaults,
        },
    }


def redacted_config_snapshot() -> dict[str, Any]:
    config = runtime_config()
    return {
        "tool": config["tool"],
        "backend": config["backend"],
        "label": config["label"],
        "category": config["category"],
        "categories": config["categories"],
        "resources": config["resources"],
        "scope": config["scope"],
        "capabilities": config["capabilities"],
        "auth": config["auth"],
        "runtime": config["runtime"],
        "runtime_ready": not config["auth"]["missing_keys"],
        "live_reads_enabled": not config["auth"]["missing_keys"],
        "live_writes_enabled": False,
        "scaffold_only": False,
    }
