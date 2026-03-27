from __future__ import annotations

import json
import shutil
from pathlib import Path
from typing import Any

from .client import SquareClient
from .config import SquareConnectorContext, redact_config, resolve_config
from .constants import BACKEND_NAME, TOOL_NAME


def resolve_runtime_binary() -> str | None:
    return shutil.which("aos-square")


def create_client(context: SquareConnectorContext | None = None) -> SquareClient:
    config = context.config if context else resolve_config()
    if not config.access_token:
        raise RuntimeError("SQUARE_ACCESS_TOKEN is required")
    return SquareClient(
        access_token=config.access_token,
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
                "location_id": config.location_id,
                "customer_id": config.customer_id,
                "order_id": config.order_id,
                "payment_id": config.payment_id,
                "item_id": config.item_id,
                "invoice_id": config.invoice_id,
            },
            "runtime": {
                "binary_path": resolve_runtime_binary(),
                "implementation_mode": "live_read_with_scaffolded_writes",
                "live_read_surfaces": ["payment", "customer", "order", "item", "invoice", "location"],
                "scaffolded_surfaces": [],
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
            "summary": "aos-square is on PATH" if resolve_runtime_binary() else "Install the harness to expose an aos-square binary.",
        },
        {
            "name": "access_token",
            "label": "Square access token configured",
            "ok": bool(config.access_token),
            "optional": False,
            "summary": "SQUARE_ACCESS_TOKEN is set" if config.access_token else "Add SQUARE_ACCESS_TOKEN in API Keys.",
        },
        {
            "name": "environment",
            "label": "Square environment",
            "ok": True,
            "optional": True,
            "summary": config.environment,
        },
        {
            "name": "location_scope",
            "label": "Location scope pinned",
            "ok": bool(config.location_id),
            "optional": True,
            "summary": config.location_id or "Optional: set SQUARE_LOCATION_ID for worker defaults.",
        },
    ]
    probe = None
    if config.access_token:
        try:
            client = client_factory(SquareConnectorContext(config=config))
            locations = client.list_locations()
            probe = {
                "ok": True,
                "locations": locations,
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
                "summary": "Square API reads succeeded.",
            })
    ok = bool(config.access_token) and bool(resolve_runtime_binary()) and (probe is None or probe.get("ok") is True)
    next_steps = []
    if not resolve_runtime_binary():
        next_steps.append("Install the Square harness so the aos-square binary is available on PATH.")
    if not config.access_token:
        next_steps.append("Create a Square application and add SQUARE_ACCESS_TOKEN.")
    if not config.location_id:
        next_steps.append("Optional: pin SQUARE_LOCATION_ID to default a worker to one Square location.")
    next_steps.append("Keep write commands scaffolded until Square write workflows are approved.")
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
            "summary": "Square connector diagnostics complete.",
        },
    }


def build_location_list_payload(*, client_factory=None, limit: int = 10) -> dict[str, Any]:
    client_factory = client_factory or create_client
    config = resolve_config()
    client = client_factory(SquareConnectorContext(config=config))
    locations = client.list_locations()["locations"][:limit]
    return {
        "tool": TOOL_NAME,
        "backend": BACKEND_NAME,
        "data": {
            "location_count": len(locations),
            "locations": locations,
            "picker": {"kind": "location", "items": locations},
            "scope_preview": build_scope_preview("location.list", "location"),
        },
    }


def build_payment_list_payload(*, client_factory=None, location_id: str | None = None, limit: int = 10) -> dict[str, Any]:
    client_factory = client_factory or create_client
    config = resolve_config()
    location_id = location_id or config.location_id
    client = client_factory(SquareConnectorContext(config=config))
    payments = client.list_payments(location_id=location_id, limit=limit)["payments"]
    return {
        "tool": TOOL_NAME,
        "backend": BACKEND_NAME,
        "data": {
            "payment_count": len(payments),
            "payments": payments,
            "picker": {"kind": "payment", "items": payments},
            "scope_preview": build_scope_preview("payment.list", "payment", location_id=location_id),
        },
    }


def build_payment_get_payload(*, client_factory=None, payment_id: str | None = None) -> dict[str, Any]:
    client_factory = client_factory or create_client
    config = resolve_config()
    payment_id = payment_id or config.payment_id
    if not payment_id:
        return {
            "tool": TOOL_NAME,
            "backend": BACKEND_NAME,
            "error": {"code": "SQUARE_PAYMENT_REQUIRED", "message": "Set SQUARE_PAYMENT_ID or pass a payment id."},
        }
    client = client_factory(SquareConnectorContext(config=config))
    payment = client.get_payment(payment_id)
    return {
        "tool": TOOL_NAME,
        "backend": BACKEND_NAME,
        "data": {
            "payment": payment,
            "scope_preview": build_scope_preview("payment.get", "payment", payment_id=payment_id),
        },
    }


def build_payment_create_payload(*, client_factory=None, amount: str | None = None, currency: str | None = None, location_id: str | None = None) -> dict[str, Any]:
    config = resolve_config()
    amount = amount or config.amount
    currency = currency or config.currency or "USD"
    location_id = location_id or config.location_id
    return {
        "tool": TOOL_NAME,
        "backend": BACKEND_NAME,
        "data": {
            "supported": False,
            "status": "scaffold_write_only",
            "reason": "Square payment creation remains scaffolded until write workflows are approved.",
            "payment": {"amount": amount, "currency": currency, "location_id": location_id},
            "scope_preview": build_scope_preview("payment.create", "payment", location_id=location_id),
        },
    }


def build_customer_list_payload(*, client_factory=None, limit: int = 10) -> dict[str, Any]:
    client_factory = client_factory or create_client
    config = resolve_config()
    client = client_factory(SquareConnectorContext(config=config))
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
            "error": {"code": "SQUARE_CUSTOMER_REQUIRED", "message": "Set SQUARE_CUSTOMER_ID or pass a customer id."},
        }
    client = client_factory(SquareConnectorContext(config=config))
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
    config = resolve_config()
    email = email or config.email
    return {
        "tool": TOOL_NAME,
        "backend": BACKEND_NAME,
        "data": {
            "supported": False,
            "status": "scaffold_write_only",
            "reason": "Square customer creation remains scaffolded until write workflows are approved.",
            "customer": {"email": email},
            "scope_preview": build_scope_preview("customer.create", "customer"),
        },
    }


def build_customer_update_payload(*, customer_id: str | None = None, email: str | None = None) -> dict[str, Any]:
    config = resolve_config()
    customer_id = customer_id or config.customer_id
    if not customer_id:
        return {
            "tool": TOOL_NAME,
            "backend": BACKEND_NAME,
            "error": {"code": "SQUARE_CUSTOMER_REQUIRED", "message": "Set SQUARE_CUSTOMER_ID or pass a customer id."},
        }
    return {
        "tool": TOOL_NAME,
        "backend": BACKEND_NAME,
        "data": {
            "supported": False,
            "status": "scaffold_write_only",
            "reason": "Square customer update remains scaffolded until write workflows are approved.",
            "customer": {"id": customer_id, "email": email},
            "scope_preview": build_scope_preview("customer.update", "customer", customer_id=customer_id),
        },
    }


def build_order_list_payload(*, client_factory=None, location_id: str | None = None, limit: int = 10) -> dict[str, Any]:
    client_factory = client_factory or create_client
    config = resolve_config()
    location_id = location_id or config.location_id
    if not location_id:
        return {
            "tool": TOOL_NAME,
            "backend": BACKEND_NAME,
            "error": {"code": "SQUARE_LOCATION_REQUIRED", "message": "Set SQUARE_LOCATION_ID or pass a location id."},
        }
    client = client_factory(SquareConnectorContext(config=config))
    orders = client.list_orders(location_id=location_id, limit=limit)["orders"]
    return {
        "tool": TOOL_NAME,
        "backend": BACKEND_NAME,
        "data": {
            "order_count": len(orders),
            "orders": orders,
            "picker": {"kind": "order", "items": orders},
            "scope_preview": build_scope_preview("order.list", "order", location_id=location_id),
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
            "error": {"code": "SQUARE_ORDER_REQUIRED", "message": "Set SQUARE_ORDER_ID or pass an order id."},
        }
    client = client_factory(SquareConnectorContext(config=config))
    order = client.get_order(order_id)
    return {
        "tool": TOOL_NAME,
        "backend": BACKEND_NAME,
        "data": {
            "order": order,
            "scope_preview": build_scope_preview("order.get", "order", order_id=order_id),
        },
    }


def build_order_create_payload(*, location_id: str | None = None) -> dict[str, Any]:
    config = resolve_config()
    location_id = location_id or config.location_id
    if not location_id:
        return {
            "tool": TOOL_NAME,
            "backend": BACKEND_NAME,
            "error": {"code": "SQUARE_LOCATION_REQUIRED", "message": "Set SQUARE_LOCATION_ID or pass a location id."},
        }
    return {
        "tool": TOOL_NAME,
        "backend": BACKEND_NAME,
        "data": {
            "supported": False,
            "status": "scaffold_write_only",
            "reason": "Square order creation remains scaffolded until write workflows are approved.",
            "order": {"location_id": location_id},
            "scope_preview": build_scope_preview("order.create", "order", location_id=location_id),
        },
    }


def build_item_list_payload(*, client_factory=None, limit: int = 10) -> dict[str, Any]:
    client_factory = client_factory or create_client
    config = resolve_config()
    client = client_factory(SquareConnectorContext(config=config))
    items = client.list_items(limit=limit)["items"]
    return {
        "tool": TOOL_NAME,
        "backend": BACKEND_NAME,
        "data": {
            "item_count": len(items),
            "items": items,
            "picker": {"kind": "item", "items": items},
            "scope_preview": build_scope_preview("item.list", "item"),
        },
    }


def build_item_get_payload(*, client_factory=None, item_id: str | None = None) -> dict[str, Any]:
    client_factory = client_factory or create_client
    config = resolve_config()
    item_id = item_id or config.item_id
    if not item_id:
        return {
            "tool": TOOL_NAME,
            "backend": BACKEND_NAME,
            "error": {"code": "SQUARE_ITEM_REQUIRED", "message": "Set SQUARE_ITEM_ID or pass an item id."},
        }
    client = client_factory(SquareConnectorContext(config=config))
    item = client.get_item(item_id)
    return {
        "tool": TOOL_NAME,
        "backend": BACKEND_NAME,
        "data": {
            "item": item,
            "scope_preview": build_scope_preview("item.get", "item", item_id=item_id),
        },
    }


def build_item_create_payload(*, item_name: str | None = None) -> dict[str, Any]:
    config = resolve_config()
    item_name = item_name or config.item_name
    return {
        "tool": TOOL_NAME,
        "backend": BACKEND_NAME,
        "data": {
            "supported": False,
            "status": "scaffold_write_only",
            "reason": "Square catalog item creation remains scaffolded until write workflows are approved.",
            "item": {"name": item_name},
            "scope_preview": build_scope_preview("item.create", "item"),
        },
    }


def build_invoice_list_payload(*, client_factory=None, location_id: str | None = None, limit: int = 10) -> dict[str, Any]:
    client_factory = client_factory or create_client
    config = resolve_config()
    location_id = location_id or config.location_id
    if not location_id:
        return {
            "tool": TOOL_NAME,
            "backend": BACKEND_NAME,
            "error": {"code": "SQUARE_LOCATION_REQUIRED", "message": "Set SQUARE_LOCATION_ID or pass a location id."},
        }
    client = client_factory(SquareConnectorContext(config=config))
    invoices = client.list_invoices(location_id=location_id, limit=limit)["invoices"]
    return {
        "tool": TOOL_NAME,
        "backend": BACKEND_NAME,
        "data": {
            "invoice_count": len(invoices),
            "invoices": invoices,
            "picker": {"kind": "invoice", "items": invoices},
            "scope_preview": build_scope_preview("invoice.list", "invoice", location_id=location_id),
        },
    }


def build_invoice_create_payload(*, location_id: str | None = None, customer_id: str | None = None) -> dict[str, Any]:
    config = resolve_config()
    location_id = location_id or config.location_id
    customer_id = customer_id or config.customer_id
    if not location_id:
        return {
            "tool": TOOL_NAME,
            "backend": BACKEND_NAME,
            "error": {"code": "SQUARE_LOCATION_REQUIRED", "message": "Set SQUARE_LOCATION_ID or pass a location id."},
        }
    if not customer_id:
        return {
            "tool": TOOL_NAME,
            "backend": BACKEND_NAME,
            "error": {"code": "SQUARE_CUSTOMER_REQUIRED", "message": "Set SQUARE_CUSTOMER_ID or pass a customer id."},
        }
    return {
        "tool": TOOL_NAME,
        "backend": BACKEND_NAME,
        "data": {
            "supported": False,
            "status": "scaffold_write_only",
            "reason": "Square invoice creation remains scaffolded until write workflows are approved.",
            "invoice": {"location_id": location_id, "customer_id": customer_id},
            "scope_preview": build_scope_preview("invoice.create", "invoice", location_id=location_id),
        },
    }


def build_invoice_send_payload(*, invoice_id: str | None = None) -> dict[str, Any]:
    config = resolve_config()
    invoice_id = invoice_id or config.invoice_id
    if not invoice_id:
        return {
            "tool": TOOL_NAME,
            "backend": BACKEND_NAME,
            "error": {"code": "SQUARE_INVOICE_REQUIRED", "message": "Set SQUARE_INVOICE_ID or pass an invoice id."},
        }
    return {
        "tool": TOOL_NAME,
        "backend": BACKEND_NAME,
        "data": {
            "supported": False,
            "status": "scaffold_write_only",
            "reason": "Square invoice sending remains scaffolded until write workflows are approved.",
            "invoice": {"id": invoice_id},
            "scope_preview": build_scope_preview("invoice.send", "invoice", invoice_id=invoice_id),
        },
    }
