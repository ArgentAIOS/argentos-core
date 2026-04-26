from __future__ import annotations

import json
import shutil
from pathlib import Path
from typing import Any

from .client import WooCommerceClient
from .config import WooCommerceConnectorContext, redact_config, resolve_config
from .constants import BACKEND_NAME, TOOL_NAME

LIVE_READ_COMMANDS = [
    "order.list",
    "order.get",
    "product.list",
    "product.get",
    "customer.list",
    "customer.get",
    "coupon.list",
    "report.sales",
    "report.top_sellers",
]
SCAFFOLDED_WRITE_COMMANDS = [
    "order.create",
    "order.update",
    "product.create",
    "product.update",
    "customer.create",
    "coupon.create",
]


def resolve_runtime_binary() -> str | None:
    return shutil.which("aos-woocommerce")


def create_client(context: WooCommerceConnectorContext | None = None) -> WooCommerceClient:
    config = context.config if context else resolve_config()
    if not config.consumer_key or not config.consumer_secret:
        raise RuntimeError("WOO_CONSUMER_KEY and WOO_CONSUMER_SECRET are required")
    if not config.base_url:
        raise RuntimeError("WOO_STORE_URL is required")
    return WooCommerceClient(
        consumer_key=config.consumer_key,
        consumer_secret=config.consumer_secret,
        base_url=config.base_url,
    )


def build_scope_preview(command_id: str, selection_surface: str, **extra: Any) -> dict[str, Any]:
    payload = {"selection_surface": selection_surface, "command_id": command_id}
    payload.update({key: value for key, value in extra.items() if value is not None})
    return payload


def build_manifest_payload() -> dict[str, Any]:
    connector_path = Path(__file__).resolve().parents[3] / "connector.json"
    return {
        "tool": TOOL_NAME,
        "backend": BACKEND_NAME,
        "connector": json.loads(connector_path.read_text()),
    }


def build_capabilities_payload() -> dict[str, Any]:
    manifest = build_manifest_payload()
    return {
        "tool": TOOL_NAME,
        "backend": BACKEND_NAME,
        "manifest_version": manifest["connector"].get("manifest_schema_version"),
        "data": manifest["connector"],
    }


def build_config_show_payload() -> dict[str, Any]:
    config = resolve_config()
    return {
        "tool": TOOL_NAME,
        "backend": BACKEND_NAME,
        "data": {
            "config": redact_config(config),
            "scope": {
                "store_url": config.store_url,
                "order_id": config.order_id,
                "product_id": config.product_id,
                "customer_id": config.customer_id,
            },
            "runtime": {
                "binary_path": resolve_runtime_binary(),
                "implementation_mode": "live_reads_with_scaffolded_writes",
                "live_read_surfaces": ["order", "product", "customer", "coupon", "report"],
                "live_read_commands": LIVE_READ_COMMANDS,
                "scaffolded_surfaces": ["order", "product", "customer", "coupon"],
                "scaffolded_write_commands": SCAFFOLDED_WRITE_COMMANDS,
            },
        },
    }


def build_health_payload(*, client_factory=None) -> dict[str, Any]:
    client_factory = client_factory or create_client
    config = resolve_config()
    checks: list[dict[str, Any]] = [
        {
            "name": "connector_runtime",
            "label": "Connector runtime installed",
            "ok": bool(resolve_runtime_binary()),
            "optional": False,
            "summary": "aos-woocommerce is on PATH" if resolve_runtime_binary() else "Install the harness to expose an aos-woocommerce binary.",
        },
        {
            "name": "consumer_key",
            "label": "WooCommerce consumer key configured",
            "ok": bool(config.consumer_key),
            "optional": False,
            "summary": "WOO_CONSUMER_KEY is set" if config.consumer_key else "Add WOO_CONSUMER_KEY in API Keys.",
        },
        {
            "name": "consumer_secret",
            "label": "WooCommerce consumer secret configured",
            "ok": bool(config.consumer_secret),
            "optional": False,
            "summary": "WOO_CONSUMER_SECRET is set" if config.consumer_secret else "Add WOO_CONSUMER_SECRET in API Keys.",
        },
        {
            "name": "store_url",
            "label": "WooCommerce store URL configured",
            "ok": bool(config.store_url),
            "optional": False,
            "summary": config.store_url or "Add WOO_STORE_URL in API Keys or set it locally for development.",
        },
    ]
    probe = None
    if config.consumer_key and config.consumer_secret and config.base_url:
        try:
            client = client_factory(WooCommerceConnectorContext(config=config))
            products = client.list_products(limit=1)
            probe = {
                "ok": True,
                "products": products,
            }
        except Exception as exc:  # noqa: BLE001
            probe = {"ok": False, "error": str(exc)}
            checks.append({
                "name": "connector_health",
                "label": "Connector health check",
                "ok": False,
                "optional": False,
                "summary": str(exc),
            })
        else:
            checks.append({
                "name": "connector_health",
                "label": "Connector health check",
                "ok": True,
                "optional": False,
                "summary": "WooCommerce API reads succeeded.",
            })
    ok = bool(config.consumer_key) and bool(config.consumer_secret) and bool(config.store_url) and bool(resolve_runtime_binary()) and (probe is None or probe.get("ok") is True)
    next_steps = []
    if not resolve_runtime_binary():
        next_steps.append("Install the WooCommerce harness so the aos-woocommerce binary is available on PATH.")
    if not config.consumer_key or not config.consumer_secret:
        next_steps.append("Generate WooCommerce REST API keys and add WOO_CONSUMER_KEY and WOO_CONSUMER_SECRET.")
    if not config.store_url:
        next_steps.append("Add WOO_STORE_URL in API Keys or set it locally for development.")
    next_steps.append("Write commands remain scaffold-only; do not expect live WooCommerce mutations yet.")
    return {
        "tool": TOOL_NAME,
        "backend": BACKEND_NAME,
        "data": {
            "status": "ready" if ok else "needs_setup",
            "checks": checks,
            "probe": probe,
            "next_steps": next_steps,
        },
    }


def build_doctor_payload() -> dict[str, Any]:
    health = build_health_payload()
    return {
        "tool": TOOL_NAME,
        "backend": BACKEND_NAME,
        "data": {
            "status": health["data"]["status"],
            "checks": health["data"]["checks"],
            "probe": health["data"]["probe"],
            "summary": "WooCommerce connector diagnostics complete.",
        },
    }


def build_order_list_payload(*, client_factory=None, status: str | None = None, customer_id: str | None = None, limit: int = 10) -> dict[str, Any]:
    client_factory = client_factory or create_client
    config = resolve_config()
    status = status or config.order_status
    customer_id = customer_id or config.customer_id
    client = client_factory(WooCommerceConnectorContext(config=config))
    orders = client.list_orders(status=status, customer_id=customer_id, limit=limit)["orders"]
    return {
        "tool": TOOL_NAME,
        "backend": BACKEND_NAME,
        "data": {
            "order_count": len(orders),
            "orders": orders,
            "picker": {"kind": "order", "items": orders},
            "scope_preview": build_scope_preview("order.list", "order"),
        },
    }


def build_order_get_payload(*, client_factory=None, order_id: str | None = None) -> dict[str, Any]:
    client_factory = client_factory or create_client
    config = resolve_config()
    order_id = order_id or config.order_id
    if not order_id:
        return {
            "tool": TOOL_NAME,
            "backend": BACKEND_NAME,
            "error": {"code": "WOO_ORDER_REQUIRED", "message": "Set WOO_ORDER_ID or pass an order id."},
        }
    client = client_factory(WooCommerceConnectorContext(config=config))
    order = client.get_order(order_id)
    return {
        "tool": TOOL_NAME,
        "backend": BACKEND_NAME,
        "data": {
            "order": order,
            "scope_preview": build_scope_preview("order.get", "order", order_id=order_id),
        },
    }


def build_order_create_payload() -> dict[str, Any]:
    return {
        "tool": TOOL_NAME,
        "backend": BACKEND_NAME,
        "data": {
            "supported": False,
            "status": "scaffold_write_only",
            "reason": "WooCommerce order creation remains scaffolded until write workflows are approved.",
            "scope_preview": build_scope_preview("order.create", "order"),
        },
    }


def build_order_update_payload(*, order_id: str | None = None, status: str | None = None) -> dict[str, Any]:
    config = resolve_config()
    order_id = order_id or config.order_id
    if not order_id:
        return {
            "tool": TOOL_NAME,
            "backend": BACKEND_NAME,
            "error": {"code": "WOO_ORDER_REQUIRED", "message": "Set WOO_ORDER_ID or pass an order id."},
        }
    return {
        "tool": TOOL_NAME,
        "backend": BACKEND_NAME,
        "data": {
            "supported": False,
            "status": "scaffold_write_only",
            "reason": "WooCommerce order update remains scaffolded until write workflows are approved.",
            "order": {"id": order_id, "status": status},
            "scope_preview": build_scope_preview("order.update", "order", order_id=order_id),
        },
    }


def build_product_list_payload(*, client_factory=None, status: str | None = None, sku: str | None = None, limit: int = 10) -> dict[str, Any]:
    client_factory = client_factory or create_client
    config = resolve_config()
    status = status or config.product_status
    sku = sku or config.sku
    client = client_factory(WooCommerceConnectorContext(config=config))
    products = client.list_products(status=status, sku=sku, limit=limit)["products"]
    return {
        "tool": TOOL_NAME,
        "backend": BACKEND_NAME,
        "data": {
            "product_count": len(products),
            "products": products,
            "picker": {"kind": "product", "items": products},
            "scope_preview": build_scope_preview("product.list", "product"),
        },
    }


def build_product_get_payload(*, client_factory=None, product_id: str | None = None) -> dict[str, Any]:
    client_factory = client_factory or create_client
    config = resolve_config()
    product_id = product_id or config.product_id
    if not product_id:
        return {
            "tool": TOOL_NAME,
            "backend": BACKEND_NAME,
            "error": {"code": "WOO_PRODUCT_REQUIRED", "message": "Set WOO_PRODUCT_ID or pass a product id."},
        }
    client = client_factory(WooCommerceConnectorContext(config=config))
    product = client.get_product(product_id)
    return {
        "tool": TOOL_NAME,
        "backend": BACKEND_NAME,
        "data": {
            "product": product,
            "scope_preview": build_scope_preview("product.get", "product", product_id=product_id),
        },
    }


def build_product_create_payload(*, name: str | None = None) -> dict[str, Any]:
    return {
        "tool": TOOL_NAME,
        "backend": BACKEND_NAME,
        "data": {
            "supported": False,
            "status": "scaffold_write_only",
            "reason": "WooCommerce product creation remains scaffolded until write workflows are approved.",
            "product": {"name": name},
            "scope_preview": build_scope_preview("product.create", "product"),
        },
    }


def build_product_update_payload(*, product_id: str | None = None, status: str | None = None) -> dict[str, Any]:
    config = resolve_config()
    product_id = product_id or config.product_id
    if not product_id:
        return {
            "tool": TOOL_NAME,
            "backend": BACKEND_NAME,
            "error": {"code": "WOO_PRODUCT_REQUIRED", "message": "Set WOO_PRODUCT_ID or pass a product id."},
        }
    return {
        "tool": TOOL_NAME,
        "backend": BACKEND_NAME,
        "data": {
            "supported": False,
            "status": "scaffold_write_only",
            "reason": "WooCommerce product update remains scaffolded until write workflows are approved.",
            "product": {"id": product_id, "status": status},
            "scope_preview": build_scope_preview("product.update", "product", product_id=product_id),
        },
    }


def build_customer_list_payload(*, client_factory=None, limit: int = 10) -> dict[str, Any]:
    client_factory = client_factory or create_client
    config = resolve_config()
    client = client_factory(WooCommerceConnectorContext(config=config))
    customers = client.list_customers(limit=limit)["customers"]
    return {
        "tool": TOOL_NAME,
        "backend": BACKEND_NAME,
        "data": {
            "customer_count": len(customers),
            "customers": customers,
            "picker": {"kind": "customer", "items": customers},
            "scope_preview": build_scope_preview("customer.list", "customer"),
        },
    }


def build_customer_get_payload(*, client_factory=None, customer_id: str | None = None) -> dict[str, Any]:
    client_factory = client_factory or create_client
    config = resolve_config()
    customer_id = customer_id or config.customer_id
    if not customer_id:
        return {
            "tool": TOOL_NAME,
            "backend": BACKEND_NAME,
            "error": {"code": "WOO_CUSTOMER_REQUIRED", "message": "Set WOO_CUSTOMER_ID or pass a customer id."},
        }
    client = client_factory(WooCommerceConnectorContext(config=config))
    customer = client.get_customer(customer_id)
    return {
        "tool": TOOL_NAME,
        "backend": BACKEND_NAME,
        "data": {
            "customer": customer,
            "scope_preview": build_scope_preview("customer.get", "customer", customer_id=customer_id),
        },
    }


def build_customer_create_payload(*, email: str | None = None) -> dict[str, Any]:
    return {
        "tool": TOOL_NAME,
        "backend": BACKEND_NAME,
        "data": {
            "supported": False,
            "status": "scaffold_write_only",
            "reason": "WooCommerce customer creation remains scaffolded until write workflows are approved.",
            "customer": {"email": email},
            "scope_preview": build_scope_preview("customer.create", "customer"),
        },
    }


def build_coupon_list_payload(*, client_factory=None, limit: int = 10) -> dict[str, Any]:
    client_factory = client_factory or create_client
    config = resolve_config()
    client = client_factory(WooCommerceConnectorContext(config=config))
    coupons = client.list_coupons(limit=limit)["coupons"]
    return {
        "tool": TOOL_NAME,
        "backend": BACKEND_NAME,
        "data": {
            "coupon_count": len(coupons),
            "coupons": coupons,
            "picker": {"kind": "coupon", "items": coupons},
            "scope_preview": build_scope_preview("coupon.list", "coupon"),
        },
    }


def build_coupon_create_payload(*, code: str | None = None) -> dict[str, Any]:
    return {
        "tool": TOOL_NAME,
        "backend": BACKEND_NAME,
        "data": {
            "supported": False,
            "status": "scaffold_write_only",
            "reason": "WooCommerce coupon creation remains scaffolded until write workflows are approved.",
            "coupon": {"code": code},
            "scope_preview": build_scope_preview("coupon.create", "coupon"),
        },
    }


def build_report_sales_payload(*, client_factory=None) -> dict[str, Any]:
    client_factory = client_factory or create_client
    config = resolve_config()
    client = client_factory(WooCommerceConnectorContext(config=config))
    report = client.report_sales()
    return {
        "tool": TOOL_NAME,
        "backend": BACKEND_NAME,
        "data": {
            "report": report,
            "scope_preview": build_scope_preview("report.sales", "report"),
        },
    }


def build_report_top_sellers_payload(*, client_factory=None) -> dict[str, Any]:
    client_factory = client_factory or create_client
    config = resolve_config()
    client = client_factory(WooCommerceConnectorContext(config=config))
    report = client.report_top_sellers()
    return {
        "tool": TOOL_NAME,
        "backend": BACKEND_NAME,
        "data": {
            "report": report,
            "scope_preview": build_scope_preview("report.top_sellers", "report"),
        },
    }
