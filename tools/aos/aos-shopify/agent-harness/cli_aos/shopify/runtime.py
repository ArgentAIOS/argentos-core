from __future__ import annotations

from typing import Any

from .client import ShopifyAdminClient, ShopifyApiError
from .config import redacted_config_snapshot, runtime_config
from .constants import LIVE_READ_COMMANDS, SCAFFOLDED_COMMANDS
from .errors import CliError


def _runtime_context(config: dict[str, Any]) -> dict[str, Any]:
    runtime = config["runtime"]
    return {
        "backend": config["backend"],
        "shop_domain": runtime["shop_domain"],
        "api_version": runtime["api_version"],
        "api_version_source": runtime["api_version_source"],
        "live_reads_enabled": runtime["live_reads_enabled"],
        "live_writes_enabled": runtime["live_writes_enabled"],
        "scaffold_only": runtime["scaffold_only"],
        "scope": runtime["scope"],
        "command_defaults": runtime["command_defaults"],
    }


def _shop_store_scope(shop: dict[str, Any], config: dict[str, Any]) -> dict[str, Any]:
    primary_domain = shop.get("primary_domain")
    if isinstance(primary_domain, dict):
        primary_domain = primary_domain.get("host") or primary_domain.get("url")
    return {
        "shop": {
            "id": str(shop.get("id")) if shop.get("id") is not None else None,
            "name": shop.get("name") or None,
            "owner": shop.get("shop_owner") or None,
            "domain": shop.get("domain") or None,
            "primary_domain": primary_domain or None,
            "currency": shop.get("currency") or None,
            "timezone": shop.get("timezone") or None,
        },
        "scope": config["runtime"]["scope"],
        "command_defaults": config["runtime"]["command_defaults"],
    }


def _picker_options(records: list[dict[str, Any]], *, resource: str) -> list[dict[str, Any]]:
    options: list[dict[str, Any]] = []
    for record in records:
        record_id = record.get("id")
        if record_id is None:
            continue
        option: dict[str, Any] = {
            "value": str(record_id),
            "label": _picker_label(resource, record),
            "resource": resource,
        }
        subtitle = _picker_subtitle(resource, record)
        if subtitle:
            option["subtitle"] = subtitle
        options.append(option)
    return options


def _picker_label(resource: str, record: dict[str, Any]) -> str:
    if resource == "product":
        return str(record.get("title") or record.get("handle") or record.get("id") or "untitled product")
    if resource == "order":
        return str(record.get("name") or record.get("order_number") or record.get("id") or "untitled order")
    if resource == "customer":
        name = " ".join(part for part in [record.get("first_name"), record.get("last_name")] if part)
        return str(record.get("email") or name or record.get("id") or "untitled customer")
    return str(record.get("id") or resource)


def _picker_subtitle(resource: str, record: dict[str, Any]) -> str | None:
    if resource == "product":
        parts = [record.get("handle"), record.get("status")]
    elif resource == "order":
        parts = [record.get("financial_status"), record.get("fulfillment_status")]
    elif resource == "customer":
        parts = [record.get("email"), record.get("created_at")]
    else:
        parts = []
    return " | ".join(str(part) for part in parts if part)


def _api_client() -> ShopifyAdminClient:
    config = runtime_config()
    missing = config["auth"]["missing_keys"]
    if missing:
        raise CliError(
            code="SHOPIFY_SETUP_REQUIRED",
            message="Shopify connector is not configured yet",
            exit_code=4,
            details={"missing_keys": missing, "live_backend_available": False},
        )
    try:
        return ShopifyAdminClient.from_env(api_version=config["runtime"]["api_version"])
    except ShopifyApiError as err:
        raise CliError(code=err.code, message=err.message, exit_code=4, details=err.details) from err


def _live_error(err: ShopifyApiError) -> CliError:
    return CliError(code=err.code, message=err.message, exit_code=4, details=err.details)


def _read_summary(resource: str, record: dict[str, Any]) -> str:
    if resource == "shop":
        label = record.get("name") or record.get("shop_owner") or record.get("domain") or "Shop"
        return f"Read shop {label}"
    if resource == "product":
        label = record.get("title") or record.get("handle") or "untitled product"
        identifier = record.get("id", "unknown")
        return f"Read product {identifier}: {label}"
    if resource == "order":
        label = record.get("name") or record.get("order_number") or record.get("id", "unknown")
        status = record.get("financial_status") or record.get("fulfillment_status") or "unknown status"
        return f"Read order {label} ({status})"
    if resource == "customer":
        label = (
            record.get("email")
            or " ".join(part for part in [record.get("first_name"), record.get("last_name")] if part)
            or record.get("id", "unknown")
        )
        return f"Read customer {label}"
    return f"Read {resource}"


def _list_summary(resource: str, count: int, limit: int, pagination: dict[str, Any]) -> str:
    summary = f"Listed {count} {resource}"
    if count == 1:
        summary = f"Listed 1 {resource[:-1] if resource.endswith('s') else resource}"
    summary = f"{summary} (limit {limit})"
    if pagination.get("has_next_page"):
        summary += "; more results available"
    return summary


def _live_payload(
    *,
    command_id: str,
    resource: str,
    operation: str,
    inputs: dict[str, Any],
    result_key: str,
    result_value: Any,
    summary: str,
    pagination: dict[str, Any] | None = None,
    extras: dict[str, Any] | None = None,
) -> dict[str, Any]:
    config = runtime_config()
    payload: dict[str, Any] = {
        "status": "live",
        "command_id": command_id,
        "resource": resource,
        "operation": operation,
        "executed": True,
        "scaffold_only": False,
        "live_backend_available": True,
        "inputs": inputs,
        result_key: result_value,
        "summary": summary,
        "runtime": _runtime_context(config),
        "scope": config["runtime"]["scope"],
        "command_defaults": config["runtime"]["command_defaults"],
    }
    if pagination is not None:
        payload["pagination"] = pagination
    if operation == "list":
        payload["count"] = len(result_value)
        payload["limit"] = inputs["limit"]
    if extras:
        payload.update(extras)
    return payload


def probe_runtime() -> dict[str, Any]:
    config = runtime_config()
    missing = config["auth"]["missing_keys"]
    if missing:
        return {
            "ok": False,
            "code": "SHOPIFY_SETUP_REQUIRED",
            "message": "Shopify connector is not configured yet",
            "details": {
                "missing_keys": missing,
                "live_backend_available": False,
                "live_reads_enabled": False,
                "live_writes_enabled": False,
            },
        }

    try:
        client = ShopifyAdminClient.from_env(api_version=config["runtime"]["api_version"])
        shop = client.shop()
    except ShopifyApiError as err:
        return {
            "ok": False,
            "code": err.code,
            "message": err.message,
            "details": {
                **err.details,
                "probe_mode": "live_rest_admin",
                "live_backend_available": False,
                "live_reads_enabled": True,
                "live_writes_enabled": False,
            },
        }

    return {
        "ok": True,
        "code": "OK",
        "message": "Shopify live read connector is ready",
        "details": {
            "probe_mode": "live_rest_admin",
            "live_backend_available": True,
            "live_reads_enabled": True,
            "live_writes_enabled": False,
            "shop_domain": config["runtime"]["shop_domain"],
            "api_version": config["runtime"]["api_version"],
            "scope": config["runtime"]["scope"],
            "command_defaults": config["runtime"]["command_defaults"],
            "shop_id": shop.get("id"),
            "shop_name": shop.get("name"),
            "shop_owner": shop.get("shop_owner"),
            "primary_domain": shop.get("primary_domain"),
            "currency": shop.get("currency"),
            "timezone": shop.get("timezone"),
        },
    }


def health_snapshot(ctx_obj: dict[str, Any]) -> dict[str, Any]:
    config = runtime_config()
    probe = probe_runtime()
    missing = config["auth"]["missing_keys"]
    if missing:
        status = "needs_setup"
    elif probe["ok"]:
        status = "live"
    else:
        status = "degraded"
    return {
        "status": status,
        "runtime_ready": probe["ok"],
        "live_backend_available": probe["ok"],
        "scaffold_only": False,
        "checks": [
            {
                "name": "required_env",
                "ok": not missing,
                "details": {"missing_keys": missing},
            },
            {
                "name": "live_backend",
                "ok": probe["ok"],
                "details": probe["details"] if not probe["ok"] else probe["details"],
            },
        ],
        "probe": probe,
        "config": redacted_config_snapshot(),
        "scope": config["runtime"]["scope"],
        "command_defaults": config["runtime"]["command_defaults"],
    }


def doctor_snapshot(ctx_obj: dict[str, Any]) -> dict[str, Any]:
    config = runtime_config()
    probe = probe_runtime()
    missing = config["auth"]["missing_keys"]
    if missing:
        status = "needs_setup"
        next_steps = [
            "Set SHOPIFY_SHOP_DOMAIN and SHOPIFY_ADMIN_ACCESS_TOKEN for the target store.",
            "Grant read scopes for products, orders, and customers on the custom app.",
            "Leave write scopes disabled until mutation commands are implemented.",
        ]
    elif probe["ok"]:
        status = "ready"
        next_steps = [
            "Use shop.read, product.list/read, order.list/read, and customer.list/read for live data.",
            "Keep product.update, order.cancel, and fulfillment.create scaffolded until a write bridge exists.",
        ]
    else:
        status = "degraded"
        next_steps = [
            "Verify the access token can reach the Shopify Admin API from this host.",
            "Confirm the app still has read scopes for products, orders, and customers.",
            f"Check SHOPIFY_API_VERSION ({config['runtime']['api_version']}) and retry the live probe.",
        ]
    return {
        "status": status,
        "runtime_ready": probe["ok"],
        "live_backend_available": probe["ok"],
        "scaffold_only": False,
        "setup_complete": probe["ok"],
        "missing_keys": missing,
        "next_steps": next_steps,
        "supported_read_commands": LIVE_READ_COMMANDS,
        "scaffolded_commands": SCAFFOLDED_COMMANDS,
        "probe": probe,
        "config": redacted_config_snapshot(),
        "scope": config["runtime"]["scope"],
        "command_defaults": config["runtime"]["command_defaults"],
    }


def shop_read_snapshot() -> dict[str, Any]:
    client = _api_client()
    config = runtime_config()
    try:
        shop = client.shop()
    except ShopifyApiError as err:
        raise _live_error(err) from err
    return _live_payload(
        command_id="shop.read",
        resource="shop",
        operation="read",
        inputs={},
        result_key="record",
        result_value=shop,
        summary=_read_summary("shop", shop),
        extras={"store_scope": _shop_store_scope(shop, config)},
    )


def product_list_snapshot(*, limit: int, status: str | None = None) -> dict[str, Any]:
    config = runtime_config()
    scope = config["runtime"]["scope"]
    effective_status = (status or scope.get("product_status") or "").strip() or None
    client = _api_client()
    try:
        products, pagination = client.products(limit=limit, status=effective_status)
    except ShopifyApiError as err:
        raise _live_error(err) from err
    return _live_payload(
        command_id="product.list",
        resource="product",
        operation="list",
        inputs={"limit": limit, "status": effective_status},
        result_key="records",
        result_value=products,
        summary=_list_summary("products", len(products), limit, pagination),
        pagination=pagination,
        extras={"picker_options": _picker_options(products, resource="product")},
    )


def product_read_snapshot(*, product_id: str) -> dict[str, Any]:
    client = _api_client()
    try:
        product = client.product(product_id)
    except ShopifyApiError as err:
        raise _live_error(err) from err
    return _live_payload(
        command_id="product.read",
        resource="product",
        operation="read",
        inputs={"product_id": product_id},
        result_key="record",
        result_value=product,
        summary=_read_summary("product", product),
    )


def order_list_snapshot(
    *,
    limit: int,
    status: str | None = None,
    created_after: str | None = None,
    created_before: str | None = None,
) -> dict[str, Any]:
    config = runtime_config()
    scope = config["runtime"]["scope"]
    effective_status = (status or scope.get("order_status") or "").strip() or None
    effective_created_after = (created_after or scope.get("created_after") or "").strip() or None
    effective_created_before = (created_before or scope.get("created_before") or "").strip() or None
    client = _api_client()
    try:
        orders, pagination = client.orders(
            limit=limit,
            status=effective_status,
            created_after=effective_created_after,
            created_before=effective_created_before,
        )
    except ShopifyApiError as err:
        raise _live_error(err) from err
    return _live_payload(
        command_id="order.list",
        resource="order",
        operation="list",
        inputs={
            "limit": limit,
            "status": effective_status,
            "created_after": effective_created_after,
            "created_before": effective_created_before,
        },
        result_key="records",
        result_value=orders,
        summary=_list_summary("orders", len(orders), limit, pagination),
        pagination=pagination,
        extras={"picker_options": _picker_options(orders, resource="order")},
    )


def order_read_snapshot(*, order_id: str) -> dict[str, Any]:
    client = _api_client()
    try:
        order = client.order(order_id)
    except ShopifyApiError as err:
        raise _live_error(err) from err
    return _live_payload(
        command_id="order.read",
        resource="order",
        operation="read",
        inputs={"order_id": order_id},
        result_key="record",
        result_value=order,
        summary=_read_summary("order", order),
    )


def customer_list_snapshot(
    *,
    limit: int,
    email: str | None = None,
    created_after: str | None = None,
    created_before: str | None = None,
) -> dict[str, Any]:
    config = runtime_config()
    scope = config["runtime"]["scope"]
    effective_email = (email or scope.get("customer_email") or "").strip() or None
    effective_created_after = (created_after or scope.get("created_after") or "").strip() or None
    effective_created_before = (created_before or scope.get("created_before") or "").strip() or None
    client = _api_client()
    try:
        customers, pagination = client.customers(
            limit=limit,
            email=effective_email,
            created_after=effective_created_after,
            created_before=effective_created_before,
        )
    except ShopifyApiError as err:
        raise _live_error(err) from err
    return _live_payload(
        command_id="customer.list",
        resource="customer",
        operation="list",
        inputs={
            "limit": limit,
            "email": effective_email,
            "created_after": effective_created_after,
            "created_before": effective_created_before,
        },
        result_key="records",
        result_value=customers,
        summary=_list_summary("customers", len(customers), limit, pagination),
        pagination=pagination,
        extras={"picker_options": _picker_options(customers, resource="customer")},
    )


def customer_read_snapshot(*, customer_id: str) -> dict[str, Any]:
    client = _api_client()
    try:
        customer = client.customer(customer_id)
    except ShopifyApiError as err:
        raise _live_error(err) from err
    return _live_payload(
        command_id="customer.read",
        resource="customer",
        operation="read",
        inputs={"customer_id": customer_id},
        result_key="record",
        result_value=customer,
        summary=_read_summary("customer", customer),
    )


def scaffold_result(
    ctx_obj: dict[str, Any],
    *,
    command_id: str,
    resource: str,
    operation: str,
    inputs: dict[str, Any],
    consequential: bool = False,
) -> dict[str, Any]:
    config = runtime_config()
    return {
        "status": "scaffold",
        "command_id": command_id,
        "resource": resource,
        "operation": operation,
        "executed": False,
        "scaffold_only": True,
        "live_backend_available": False,
        "consequential": consequential,
        "inputs": inputs,
        "setup": {
            "configured": not config["auth"]["missing_keys"],
            "missing_keys": config["auth"]["missing_keys"],
            "shop_domain_present": config["runtime"]["shop_domain_present"],
            "access_token_present": config["runtime"]["access_token_present"],
        },
        "summary": f"{command_id} is scaffold-only and does not perform live Shopify writes yet",
    }
