from __future__ import annotations

import json
from datetime import datetime, timezone
from typing import Any
from urllib import error, parse, request

from .config import resolve_runtime_values
from .constants import BACKEND_NAME, DEFAULT_API_BASE_URL
from .errors import CliError

API_TIMEOUT_SECONDS = 20
USER_AGENT = "aos-stripe/0.1.0"
SUPPORTED_PAYMENT_METHOD_TYPES = {"card", "us_bank_account"}


def _clean_dict(values: dict[str, Any]) -> dict[str, Any]:
    cleaned: dict[str, Any] = {}
    for key, value in values.items():
        if value is None:
            continue
        if isinstance(value, str) and not value.strip():
            continue
        cleaned[key] = value
    return cleaned


def _stringify_form_value(value: Any) -> str:
    if isinstance(value, bool):
        return "true" if value else "false"
    return str(value)


def _flatten_form(key: str, value: Any) -> list[tuple[str, str]]:
    if value is None:
        return []
    if isinstance(value, dict):
        flattened: list[tuple[str, str]] = []
        for child_key, child_value in value.items():
            flattened.extend(_flatten_form(f"{key}[{child_key}]", child_value))
        return flattened
    if isinstance(value, (list, tuple)):
        flattened = []
        for index, child_value in enumerate(value):
            flattened.extend(_flatten_form(f"{key}[{index}]", child_value))
        return flattened
    return [(key, _stringify_form_value(value))]


def _form_payload(values: dict[str, Any] | None) -> bytes | None:
    if not values:
        return None
    flattened: list[tuple[str, str]] = []
    for key, value in values.items():
        flattened.extend(_flatten_form(key, value))
    if not flattened:
        return None
    return parse.urlencode(flattened).encode("utf-8")


def _resolve_secret_key(ctx_obj: dict[str, Any]) -> str | None:
    runtime = resolve_runtime_values(ctx_obj)
    secret_key = runtime.get("secret_key")
    if isinstance(secret_key, str) and secret_key.strip():
        return secret_key.strip()
    return None


def _headers(ctx_obj: dict[str, Any], *, has_form: bool = False) -> dict[str, str]:
    runtime = resolve_runtime_values(ctx_obj)
    secret_key = _resolve_secret_key(ctx_obj)
    if not secret_key:
        raise CliError(
            code="AUTH_REQUIRED",
            message="STRIPE_SECRET_KEY is not configured",
            exit_code=4,
            details={"env": runtime["secret_key_env"]},
        )

    headers = {
        "Authorization": f"Bearer {secret_key}",
        "Accept": "application/json",
        "User-Agent": USER_AGENT,
    }
    if has_form:
        headers["Content-Type"] = "application/x-www-form-urlencoded"
    account_id = runtime.get("account_id")
    if account_id:
        headers["Stripe-Account"] = account_id
    return headers


def _base_url(ctx_obj: dict[str, Any]) -> str:
    runtime = resolve_runtime_values(ctx_obj)
    return str(runtime.get("api_base_url") or DEFAULT_API_BASE_URL).rstrip("/")


def _request_json(
    ctx_obj: dict[str, Any],
    method: str,
    path: str,
    *,
    query: dict[str, Any] | None = None,
    form: dict[str, Any] | None = None,
) -> dict[str, Any]:
    url = f"{_base_url(ctx_obj)}{path}"
    if query:
        url = f"{url}?{parse.urlencode(_clean_dict(query), doseq=True)}"

    payload = _form_payload(form)
    req = request.Request(
        url,
        data=payload,
        method=method.upper(),
        headers=_headers(ctx_obj, has_form=payload is not None),
    )
    try:
        with request.urlopen(req, timeout=API_TIMEOUT_SECONDS) as response:
            charset = response.headers.get_content_charset("utf-8")
            body = response.read().decode(charset or "utf-8")
    except error.HTTPError as exc:
        charset = exc.headers.get_content_charset("utf-8") if exc.headers else "utf-8"
        body = exc.read().decode(charset or "utf-8", errors="replace")
        details: dict[str, Any] = {"status": exc.code, "url": url}
        message = body or str(exc)
        try:
            response_payload = json.loads(body) if body else {}
        except json.JSONDecodeError:
            response_payload = {}
        if isinstance(response_payload, dict) and response_payload:
            details["response"] = response_payload
            error_payload = response_payload.get("error")
            if isinstance(error_payload, dict):
                message = str(error_payload.get("message") or error_payload.get("type") or message)
                error_code = error_payload.get("code")
                if error_code:
                    details["stripe_code"] = error_code
            elif error_payload:
                message = str(error_payload)
            else:
                message = str(response_payload.get("message") or message)
        if exc.code in {401, 403}:
            code = "STRIPE_AUTH_ERROR"
            exit_code = 4
        elif exc.code == 404:
            code = "NOT_FOUND"
            exit_code = 6
        elif exc.code == 429:
            code = "RATE_LIMITED"
            exit_code = 5
        else:
            code = "STRIPE_API_ERROR"
            exit_code = 5
        raise CliError(code=code, message=message, exit_code=exit_code, details=details) from exc
    except error.URLError as exc:
        raise CliError(
            code="BACKEND_UNAVAILABLE",
            message="Failed to reach the Stripe API",
            exit_code=5,
            details={"reason": str(exc.reason), "url": url},
        ) from exc

    if not body:
        return {}
    try:
        response_payload = json.loads(body)
    except json.JSONDecodeError as exc:
        raise CliError(
            code="STRIPE_BAD_JSON",
            message="Stripe returned invalid JSON",
            exit_code=5,
            details={"url": url, "body": body[:2000]},
        ) from exc
    if not isinstance(response_payload, dict):
        raise CliError(
            code="STRIPE_BAD_JSON",
            message="Stripe returned an unexpected payload",
            exit_code=5,
            details={"url": url},
        )
    return response_payload


def _scope(ctx_obj: dict[str, Any]) -> dict[str, Any]:
    runtime = resolve_runtime_values(ctx_obj)
    return {
        "account_id": runtime.get("account_id"),
        "customer_id": runtime.get("customer_id"),
        "subscription_id": runtime.get("subscription_id"),
        "invoice_id": runtime.get("invoice_id"),
    }


def _collection_result(
    resource: str,
    operation: str,
    ctx_obj: dict[str, Any],
    response: dict[str, Any],
    items: list[dict[str, Any]],
) -> dict[str, Any]:
    return {
        "status": "ok",
        "backend": BACKEND_NAME,
        "resource": resource,
        "operation": operation,
        "scope": _scope(ctx_obj),
        "count": len(items),
        "has_more": bool(response.get("has_more")),
        "results": items,
    }


def _single_result(
    resource: str,
    operation: str,
    ctx_obj: dict[str, Any],
    response: dict[str, Any],
    *,
    result_key: str = "result",
) -> dict[str, Any]:
    return {
        "status": "ok",
        "backend": BACKEND_NAME,
        "resource": resource,
        "operation": operation,
        "scope": _scope(ctx_obj),
        result_key: response,
    }


def _write_result(
    resource: str,
    operation: str,
    ctx_obj: dict[str, Any],
    response: dict[str, Any],
) -> dict[str, Any]:
    return {
        "status": "live_write",
        "backend": BACKEND_NAME,
        "resource": resource,
        "operation": operation,
        "scope": _scope(ctx_obj),
        "result": response,
    }


def _parse_metadata_json(raw: str | None) -> dict[str, str]:
    if not raw or not raw.strip():
        return {}
    try:
        payload = json.loads(raw)
    except json.JSONDecodeError as exc:
        raise CliError(
            code="INVALID_METADATA_JSON",
            message="metadata_json must be valid JSON",
            exit_code=2,
            details={"value": raw},
        ) from exc
    if not isinstance(payload, dict):
        raise CliError(
            code="INVALID_METADATA_JSON",
            message="metadata_json must be a JSON object",
            exit_code=2,
            details={"value": raw},
        )
    metadata: dict[str, str] = {}
    for key, value in payload.items():
        metadata[str(key)] = "" if value is None else str(value)
    return metadata


def _resolve_identifier(
    value: str | None,
    *,
    runtime_key: str,
    env_key: str,
    label: str,
    ctx_obj: dict[str, Any],
) -> str:
    cleaned = str(value or "").strip()
    if cleaned:
        return cleaned
    runtime = resolve_runtime_values(ctx_obj)
    fallback = str(runtime.get(runtime_key) or "").strip()
    if fallback:
        return fallback
    raise CliError(
        code="MISSING_ARGUMENT",
        message=f"{label} is required",
        exit_code=2,
        details={"env": env_key},
    )


def _normalize_customer(customer: dict[str, Any]) -> dict[str, Any]:
    return {
        "id": customer.get("id"),
        "object": customer.get("object"),
        "email": customer.get("email"),
        "name": customer.get("name"),
        "description": customer.get("description"),
        "phone": customer.get("phone"),
        "livemode": customer.get("livemode"),
        "created": customer.get("created"),
        "currency": customer.get("currency"),
        "metadata": customer.get("metadata") or {},
        "deleted": customer.get("deleted", False),
    }


def _customer_option(customer: dict[str, Any]) -> dict[str, Any]:
    label = customer.get("name") or customer.get("email") or customer.get("id")
    subtitle = customer.get("email") or customer.get("name")
    option = {"value": customer.get("id"), "label": label}
    if subtitle and subtitle != label:
        option["subtitle"] = subtitle
    if customer.get("email"):
        option["email"] = customer.get("email")
    return option


def _normalize_payment_intent(payment: dict[str, Any]) -> dict[str, Any]:
    return {
        "id": payment.get("id"),
        "object": payment.get("object"),
        "amount": payment.get("amount"),
        "currency": payment.get("currency"),
        "status": payment.get("status"),
        "customer": payment.get("customer"),
        "description": payment.get("description"),
        "livemode": payment.get("livemode"),
        "created": payment.get("created"),
        "latest_charge": payment.get("latest_charge"),
        "payment_method": payment.get("payment_method"),
        "payment_method_types": payment.get("payment_method_types") or [],
        "automatic_payment_methods": payment.get("automatic_payment_methods") or {},
        "metadata": payment.get("metadata") or {},
    }


def _payment_option(payment: dict[str, Any]) -> dict[str, Any]:
    label = payment.get("id")
    subtitle = payment.get("status")
    option = {"value": payment.get("id"), "label": label}
    if subtitle:
        option["subtitle"] = subtitle
    if payment.get("amount") is not None:
        option["amount"] = payment.get("amount")
    if payment.get("currency"):
        option["currency"] = payment.get("currency")
    return option


def _normalize_subscription_item(item: dict[str, Any]) -> dict[str, Any]:
    price = item.get("price") if isinstance(item.get("price"), dict) else {}
    return {
        "id": item.get("id"),
        "quantity": item.get("quantity"),
        "price_id": price.get("id"),
        "product": price.get("product"),
        "currency": price.get("currency"),
        "unit_amount": price.get("unit_amount"),
        "recurring": price.get("recurring") or {},
    }


def _normalize_subscription(subscription: dict[str, Any]) -> dict[str, Any]:
    items_block = subscription.get("items") if isinstance(subscription.get("items"), dict) else {}
    items = items_block.get("data") if isinstance(items_block.get("data"), list) else []
    return {
        "id": subscription.get("id"),
        "object": subscription.get("object"),
        "customer": subscription.get("customer"),
        "status": subscription.get("status"),
        "cancel_at_period_end": subscription.get("cancel_at_period_end"),
        "canceled_at": subscription.get("canceled_at"),
        "current_period_start": subscription.get("current_period_start"),
        "current_period_end": subscription.get("current_period_end"),
        "collection_method": subscription.get("collection_method"),
        "latest_invoice": subscription.get("latest_invoice"),
        "livemode": subscription.get("livemode"),
        "created": subscription.get("created"),
        "metadata": subscription.get("metadata") or {},
        "items": [_normalize_subscription_item(item) for item in items if isinstance(item, dict)],
    }


def _subscription_option(subscription: dict[str, Any]) -> dict[str, Any]:
    label = subscription.get("id")
    subtitle = subscription.get("status")
    option = {"value": subscription.get("id"), "label": label}
    if subtitle:
        option["subtitle"] = subtitle
    if subscription.get("customer"):
        option["customer"] = subscription.get("customer")
    return option


def _normalize_invoice(invoice: dict[str, Any]) -> dict[str, Any]:
    return {
        "id": invoice.get("id"),
        "object": invoice.get("object"),
        "number": invoice.get("number"),
        "status": invoice.get("status"),
        "currency": invoice.get("currency"),
        "customer": invoice.get("customer"),
        "customer_email": invoice.get("customer_email"),
        "subscription": invoice.get("subscription"),
        "amount_due": invoice.get("amount_due"),
        "amount_paid": invoice.get("amount_paid"),
        "amount_remaining": invoice.get("amount_remaining"),
        "collection_method": invoice.get("collection_method"),
        "livemode": invoice.get("livemode"),
        "created": invoice.get("created"),
        "due_date": invoice.get("due_date"),
        "hosted_invoice_url": invoice.get("hosted_invoice_url"),
        "invoice_pdf": invoice.get("invoice_pdf"),
        "metadata": invoice.get("metadata") or {},
    }


def _invoice_option(invoice: dict[str, Any]) -> dict[str, Any]:
    label = invoice.get("number") or invoice.get("id")
    subtitle = invoice.get("status")
    option = {"value": invoice.get("id"), "label": label}
    if subtitle:
        option["subtitle"] = subtitle
    if invoice.get("customer"):
        option["customer"] = invoice.get("customer")
    return option


def _normalize_balance_entry(entry: dict[str, Any]) -> dict[str, Any]:
    return {
        "amount": entry.get("amount"),
        "currency": entry.get("currency"),
        "source_types": entry.get("source_types") or {},
    }


def _normalize_balance(response: dict[str, Any]) -> dict[str, Any]:
    return {
        "object": response.get("object", "balance"),
        "livemode": response.get("livemode"),
        "available": [_normalize_balance_entry(item) for item in response.get("available", []) if isinstance(item, dict)],
        "pending": [_normalize_balance_entry(item) for item in response.get("pending", []) if isinstance(item, dict)],
    }


def _parse_timestamp(value: str | None) -> int | None:
    raw = str(value or "").strip()
    if not raw:
        return None
    if raw.isdigit():
        return int(raw)
    normalized = raw.replace("Z", "+00:00")
    try:
        parsed = datetime.fromisoformat(normalized)
    except ValueError:
        raise CliError(
            code="INVALID_DATE_FILTER",
            message=f"Invalid timestamp or ISO-8601 value: {raw}",
            exit_code=2,
            details={"value": raw},
        ) from None
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=timezone.utc)
    return int(parsed.timestamp())


def _build_created_filters(
    *,
    created_after: str | None = None,
    created_before: str | None = None,
) -> dict[str, Any]:
    filters: dict[str, Any] = {}
    lower = _parse_timestamp(created_after)
    upper = _parse_timestamp(created_before)
    if lower is not None:
        filters["created[gte]"] = lower
    if upper is not None:
        filters["created[lte]"] = upper
    return filters


def probe_runtime(ctx_obj: dict[str, Any]) -> dict[str, Any]:
    runtime = resolve_runtime_values(ctx_obj)
    if not runtime["secret_key_present"]:
        return {
            "ok": False,
            "code": "STRIPE_AUTH_REQUIRED",
            "message": "Stripe secret key is not configured",
            "details": {"env": runtime["secret_key_env"]},
        }

    try:
        balance = read_balance(ctx_obj)
    except CliError as exc:
        return {
            "ok": False,
            "code": exc.code,
            "message": exc.message,
            "details": exc.details,
        }

    details = balance.get("result") or {}
    return {
        "ok": True,
        "code": "OK",
        "message": "Stripe live read probe succeeded",
        "details": {
            "probe_mode": "live_balance_read",
            "account_id_present": runtime["account_id_present"],
            "available_currencies": [entry.get("currency") for entry in details.get("available", []) if entry.get("currency")],
            "pending_currencies": [entry.get("currency") for entry in details.get("pending", []) if entry.get("currency")],
        },
    }


def read_balance(ctx_obj: dict[str, Any]) -> dict[str, Any]:
    response = _request_json(ctx_obj, "GET", "/v1/balance")
    return _single_result("balance", "get", ctx_obj, _normalize_balance(response))


def read_account(ctx_obj: dict[str, Any]) -> dict[str, Any]:
    response = _request_json(ctx_obj, "GET", "/v1/account")
    return _single_result("account", "read", ctx_obj, response)


def list_customers(
    ctx_obj: dict[str, Any],
    *,
    limit: int,
    email: str | None = None,
    starting_after: str | None = None,
) -> dict[str, Any]:
    runtime = resolve_runtime_values(ctx_obj)
    query: dict[str, Any] = {"limit": max(1, min(limit, 100))}
    effective_email = str(email or runtime.get("customer_email") or "").strip() or None
    if effective_email:
        query["email"] = effective_email
    if starting_after:
        query["starting_after"] = starting_after
    response = _request_json(ctx_obj, "GET", "/v1/customers", query=query)
    customers = [_normalize_customer(item) for item in response.get("data", []) if isinstance(item, dict)]
    result = _collection_result("customer", "list", ctx_obj, response, customers)
    result["options"] = [_customer_option(customer) for customer in customers if customer.get("id")]
    return result


def read_customer(ctx_obj: dict[str, Any], *, customer_id: str | None) -> dict[str, Any]:
    resolved_customer_id = _resolve_identifier(
        customer_id,
        runtime_key="customer_id",
        env_key="STRIPE_CUSTOMER_ID",
        label="customer_id",
        ctx_obj=ctx_obj,
    )
    response = _request_json(ctx_obj, "GET", f"/v1/customers/{parse.quote(resolved_customer_id, safe='')}")
    return _single_result("customer", "get", ctx_obj, _normalize_customer(response))


def create_customer(
    ctx_obj: dict[str, Any],
    *,
    email: str | None,
    name: str | None,
    description: str | None,
    metadata_json: str | None,
) -> dict[str, Any]:
    metadata = _parse_metadata_json(metadata_json)
    effective_email = str(email or resolve_runtime_values(ctx_obj).get("customer_email") or "").strip() or None
    if not any([effective_email, name, description, metadata]):
        raise CliError(
            code="MISSING_ARGUMENT",
            message="Provide at least one of email, name, description, or metadata_json",
            exit_code=2,
            details={},
        )
    form = _clean_dict(
        {
            "email": effective_email,
            "name": name,
            "description": description,
            "metadata": metadata or None,
        }
    )
    response = _request_json(ctx_obj, "POST", "/v1/customers", form=form)
    return _write_result("customer", "create", ctx_obj, _normalize_customer(response))


def list_payments(
    ctx_obj: dict[str, Any],
    *,
    limit: int,
    customer_id: str | None = None,
    created_after: str | None = None,
    created_before: str | None = None,
    starting_after: str | None = None,
) -> dict[str, Any]:
    runtime = resolve_runtime_values(ctx_obj)
    effective_customer_id = str(customer_id or runtime.get("customer_id") or "").strip() or None
    query: dict[str, Any] = {"limit": max(1, min(limit, 100))}
    if effective_customer_id:
        query["customer"] = effective_customer_id
    if starting_after:
        query["starting_after"] = starting_after
    query.update(_build_created_filters(created_after=created_after, created_before=created_before))
    response = _request_json(ctx_obj, "GET", "/v1/payment_intents", query=query)
    payments = [_normalize_payment_intent(item) for item in response.get("data", []) if isinstance(item, dict)]
    result = _collection_result("payment", "list", ctx_obj, response, payments)
    result["options"] = [_payment_option(payment) for payment in payments if payment.get("id")]
    return result


def read_payment(ctx_obj: dict[str, Any], *, payment_id: str | None) -> dict[str, Any]:
    resolved_payment_id = _resolve_identifier(
        payment_id,
        runtime_key="payment_intent_id",
        env_key="STRIPE_PAYMENT_INTENT_ID",
        label="payment_intent_id",
        ctx_obj=ctx_obj,
    )
    response = _request_json(ctx_obj, "GET", f"/v1/payment_intents/{parse.quote(resolved_payment_id, safe='')}")
    return _single_result("payment", "get", ctx_obj, _normalize_payment_intent(response))


def create_payment(
    ctx_obj: dict[str, Any],
    *,
    amount: int,
    currency: str,
    customer_id: str | None,
    payment_method: str | None,
    description: str | None,
    metadata_json: str | None,
) -> dict[str, Any]:
    runtime = resolve_runtime_values(ctx_obj)
    effective_customer_id = str(customer_id or runtime.get("customer_id") or "").strip() or None
    metadata = _parse_metadata_json(metadata_json)
    method = str(payment_method or "").strip() or None
    if method == "bank_transfer":
        raise CliError(
            code="UNSUPPORTED_OPTION",
            message="payment_method=bank_transfer is intentionally blocked until the connector can collect the additional Stripe customer_balance fields safely",
            exit_code=2,
            details={"payment_method": method},
        )
    if method and method not in SUPPORTED_PAYMENT_METHOD_TYPES:
        raise CliError(
            code="UNSUPPORTED_OPTION",
            message=f"Unsupported payment_method: {method}",
            exit_code=2,
            details={"payment_method": method},
        )
    form: dict[str, Any] = {
        "amount": amount,
        "currency": currency.lower(),
        "customer": effective_customer_id,
        "description": description,
        "metadata": metadata or None,
    }
    if method:
        form["payment_method_types"] = [method]
    else:
        # Keep writes conservative: create the PaymentIntent without confirming it.
        form["automatic_payment_methods"] = {"enabled": True}
    response = _request_json(ctx_obj, "POST", "/v1/payment_intents", form=form)
    return _write_result("payment", "create", ctx_obj, _normalize_payment_intent(response))


def list_subscriptions(
    ctx_obj: dict[str, Any],
    *,
    limit: int,
    customer_id: str | None = None,
    starting_after: str | None = None,
) -> dict[str, Any]:
    runtime = resolve_runtime_values(ctx_obj)
    effective_customer_id = str(customer_id or runtime.get("customer_id") or "").strip() or None
    query: dict[str, Any] = {"limit": max(1, min(limit, 100))}
    if effective_customer_id:
        query["customer"] = effective_customer_id
    if starting_after:
        query["starting_after"] = starting_after
    response = _request_json(ctx_obj, "GET", "/v1/subscriptions", query=query)
    subscriptions = [_normalize_subscription(item) for item in response.get("data", []) if isinstance(item, dict)]
    result = _collection_result("subscription", "list", ctx_obj, response, subscriptions)
    result["options"] = [_subscription_option(item) for item in subscriptions if item.get("id")]
    return result


def read_subscription(ctx_obj: dict[str, Any], *, subscription_id: str | None) -> dict[str, Any]:
    resolved_subscription_id = _resolve_identifier(
        subscription_id,
        runtime_key="subscription_id",
        env_key="STRIPE_SUBSCRIPTION_ID",
        label="subscription_id",
        ctx_obj=ctx_obj,
    )
    response = _request_json(ctx_obj, "GET", f"/v1/subscriptions/{parse.quote(resolved_subscription_id, safe='')}")
    return _single_result("subscription", "get", ctx_obj, _normalize_subscription(response))


def create_subscription(
    ctx_obj: dict[str, Any],
    *,
    customer_id: str | None,
    price_id: str | None,
    metadata_json: str | None,
) -> dict[str, Any]:
    resolved_customer_id = _resolve_identifier(
        customer_id,
        runtime_key="customer_id",
        env_key="STRIPE_CUSTOMER_ID",
        label="customer_id",
        ctx_obj=ctx_obj,
    )
    resolved_price_id = _resolve_identifier(
        price_id,
        runtime_key="price_id",
        env_key="STRIPE_PRICE_ID",
        label="price_id",
        ctx_obj=ctx_obj,
    )
    metadata = _parse_metadata_json(metadata_json)
    form = _clean_dict(
        {
            "customer": resolved_customer_id,
            "payment_behavior": "default_incomplete",
            "items": [{"price": resolved_price_id}],
            "metadata": metadata or None,
        }
    )
    response = _request_json(ctx_obj, "POST", "/v1/subscriptions", form=form)
    return _write_result("subscription", "create", ctx_obj, _normalize_subscription(response))


def cancel_subscription(ctx_obj: dict[str, Any], *, subscription_id: str | None) -> dict[str, Any]:
    resolved_subscription_id = _resolve_identifier(
        subscription_id,
        runtime_key="subscription_id",
        env_key="STRIPE_SUBSCRIPTION_ID",
        label="subscription_id",
        ctx_obj=ctx_obj,
    )
    response = _request_json(
        ctx_obj,
        "DELETE",
        f"/v1/subscriptions/{parse.quote(resolved_subscription_id, safe='')}",
    )
    return _write_result("subscription", "cancel", ctx_obj, _normalize_subscription(response))


def list_invoices(
    ctx_obj: dict[str, Any],
    *,
    limit: int,
    customer_id: str | None = None,
    status: str | None = None,
    created_after: str | None = None,
    created_before: str | None = None,
    starting_after: str | None = None,
) -> dict[str, Any]:
    runtime = resolve_runtime_values(ctx_obj)
    effective_customer_id = str(customer_id or runtime.get("customer_id") or "").strip() or None
    query: dict[str, Any] = {"limit": max(1, min(limit, 100))}
    if effective_customer_id:
        query["customer"] = effective_customer_id
    if status:
        query["status"] = status
    if starting_after:
        query["starting_after"] = starting_after
    query.update(_build_created_filters(created_after=created_after, created_before=created_before))
    response = _request_json(ctx_obj, "GET", "/v1/invoices", query=query)
    invoices = [_normalize_invoice(item) for item in response.get("data", []) if isinstance(item, dict)]
    result = _collection_result("invoice", "list", ctx_obj, response, invoices)
    result["options"] = [_invoice_option(item) for item in invoices if item.get("id")]
    return result


def read_invoice(ctx_obj: dict[str, Any], *, invoice_id: str | None) -> dict[str, Any]:
    resolved_invoice_id = _resolve_identifier(
        invoice_id,
        runtime_key="invoice_id",
        env_key="STRIPE_INVOICE_ID",
        label="invoice_id",
        ctx_obj=ctx_obj,
    )
    response = _request_json(ctx_obj, "GET", f"/v1/invoices/{parse.quote(resolved_invoice_id, safe='')}")
    return _single_result("invoice", "get", ctx_obj, _normalize_invoice(response))


def send_invoice(ctx_obj: dict[str, Any], *, invoice_id: str | None) -> dict[str, Any]:
    resolved_invoice_id = _resolve_identifier(
        invoice_id,
        runtime_key="invoice_id",
        env_key="STRIPE_INVOICE_ID",
        label="invoice_id",
        ctx_obj=ctx_obj,
    )
    response = _request_json(
        ctx_obj,
        "POST",
        f"/v1/invoices/{parse.quote(resolved_invoice_id, safe='')}/send",
    )
    return _write_result("invoice", "send", ctx_obj, _normalize_invoice(response))
