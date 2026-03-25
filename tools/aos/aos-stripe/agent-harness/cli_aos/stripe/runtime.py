from __future__ import annotations

import json
import os
from datetime import datetime, timezone
from typing import Any
from urllib import error, parse, request

from .config import resolve_runtime_values
from .constants import DEFAULT_API_BASE_URL
from .errors import CliError

API_TIMEOUT_SECONDS = 20
USER_AGENT = "aos-stripe/0.1.0"


def _clean_dict(values: dict[str, Any]) -> dict[str, Any]:
    cleaned: dict[str, Any] = {}
    for key, value in values.items():
        if value is None:
            continue
        if isinstance(value, str) and not value.strip():
            continue
        cleaned[key] = value
    return cleaned


def _resolve_secret_key(ctx_obj: dict[str, Any]) -> str | None:
    runtime = resolve_runtime_values(ctx_obj)
    secret_key = runtime.get("secret_key") or os.getenv(runtime["secret_key_env"])
    if secret_key:
        return secret_key.strip()
    return None


def _headers(ctx_obj: dict[str, Any]) -> dict[str, str]:
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
) -> dict[str, Any]:
    url = f"{_base_url(ctx_obj)}{path}"
    if query:
        url = f"{url}?{parse.urlencode(_clean_dict(query), doseq=True)}"

    req = request.Request(url, method=method.upper(), headers=_headers(ctx_obj))
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
            payload = json.loads(body) if body else {}
        except json.JSONDecodeError:
            payload = {}
        if isinstance(payload, dict) and payload:
            details["response"] = payload
            error_payload = payload.get("error")
            if isinstance(error_payload, dict):
                message = str(error_payload.get("message") or error_payload.get("type") or message)
            elif error_payload:
                message = str(error_payload)
            else:
                message = str(payload.get("message") or message)
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
        payload = json.loads(body)
    except json.JSONDecodeError as exc:
        raise CliError(
            code="STRIPE_BAD_JSON",
            message="Stripe returned invalid JSON",
            exit_code=5,
            details={"url": url, "body": body[:2000]},
        ) from exc
    if not isinstance(payload, dict):
        raise CliError(
            code="STRIPE_BAD_JSON",
            message="Stripe returned an unexpected payload",
            exit_code=5,
            details={"url": url},
        )
    return payload


def _scope(ctx_obj: dict[str, Any]) -> dict[str, Any]:
    runtime = resolve_runtime_values(ctx_obj)
    customer_focus = runtime.get("customer_focus")
    return {
        "account_id": runtime.get("account_id"),
        "account_alias": runtime.get("account_alias"),
        "customer_focus": customer_focus,
        "invoice_status": runtime.get("invoice_status"),
        "created_after": runtime.get("created_after"),
        "created_before": runtime.get("created_before"),
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
        "backend": "stripe",
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
        "backend": "stripe",
        "resource": resource,
        "operation": operation,
        "scope": _scope(ctx_obj),
        result_key: response,
    }


def _normalize_customer(customer: dict[str, Any]) -> dict[str, Any]:
    return {
        "id": customer.get("id"),
        "object": customer.get("object"),
        "email": customer.get("email"),
        "name": customer.get("name"),
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
    option = {
        "value": customer.get("id"),
        "label": label,
    }
    if subtitle and subtitle != label:
        option["subtitle"] = subtitle
    if customer.get("name"):
        option["name"] = customer.get("name")
    if customer.get("email"):
        option["email"] = customer.get("email")
    return option


def _normalize_account(account: dict[str, Any]) -> dict[str, Any]:
    return {
        "id": account.get("id"),
        "object": account.get("object"),
        "business_profile": account.get("business_profile") or {},
        "charges_enabled": account.get("charges_enabled"),
        "country": account.get("country"),
        "default_currency": account.get("default_currency"),
        "details_submitted": account.get("details_submitted"),
        "display_name": account.get("display_name"),
        "email": account.get("email"),
        "livemode": account.get("livemode"),
        "metadata": account.get("metadata") or {},
        "payouts_enabled": account.get("payouts_enabled"),
        "requirements": account.get("requirements") or {},
        "type": account.get("type"),
    }


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
        "capture_method": payment.get("capture_method"),
        "metadata": payment.get("metadata") or {},
    }


def _normalize_invoice(invoice: dict[str, Any]) -> dict[str, Any]:
    return {
        "id": invoice.get("id"),
        "object": invoice.get("object"),
        "number": invoice.get("number"),
        "status": invoice.get("status"),
        "currency": invoice.get("currency"),
        "customer": invoice.get("customer"),
        "amount_due": invoice.get("amount_due"),
        "amount_paid": invoice.get("amount_paid"),
        "amount_remaining": invoice.get("amount_remaining"),
        "livemode": invoice.get("livemode"),
        "created": invoice.get("created"),
        "due_date": invoice.get("due_date"),
        "hosted_invoice_url": invoice.get("hosted_invoice_url"),
        "invoice_pdf": invoice.get("invoice_pdf"),
        "metadata": invoice.get("metadata") or {},
    }


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
        return None
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
    return _single_result("balance", "read", ctx_obj, _normalize_balance(response))


def read_account(ctx_obj: dict[str, Any]) -> dict[str, Any]:
    response = _request_json(ctx_obj, "GET", "/v1/account")
    return _single_result("account", "read", ctx_obj, _normalize_account(response))


def list_customers(ctx_obj: dict[str, Any], *, limit: int, email: str | None = None) -> dict[str, Any]:
    runtime = resolve_runtime_values(ctx_obj)
    focus = runtime.get("customer_focus")
    effective_email = email or (focus if isinstance(focus, str) and "@" in focus else None)
    query = {"limit": limit}
    if effective_email:
        query["email"] = effective_email
    response = _request_json(ctx_obj, "GET", "/v1/customers", query=query)
    customers = [_normalize_customer(item) for item in response.get("data", []) if isinstance(item, dict)]
    result = _collection_result("customer", "list", ctx_obj, response, customers)
    result["options"] = [_customer_option(customer) for customer in customers if customer.get("id")]
    return result


def search_customers(ctx_obj: dict[str, Any], *, query_text: str) -> dict[str, Any]:
    response = _request_json(
        ctx_obj,
        "GET",
        "/v1/customers/search",
        query={"query": query_text, "limit": 10},
    )
    customers = [_normalize_customer(item) for item in response.get("data", []) if isinstance(item, dict)]
    result = _collection_result("customer", "search", ctx_obj, response, customers)
    result["options"] = [_customer_option(customer) for customer in customers if customer.get("id")]
    return result


def read_customer(ctx_obj: dict[str, Any], *, customer_id: str) -> dict[str, Any]:
    response = _request_json(ctx_obj, "GET", f"/v1/customers/{parse.quote(customer_id, safe='')}")
    return _single_result("customer", "read", ctx_obj, _normalize_customer(response))


def list_payments(
    ctx_obj: dict[str, Any],
    *,
    limit: int,
    customer_id: str | None = None,
    created_after: str | None = None,
    created_before: str | None = None,
) -> dict[str, Any]:
    runtime = resolve_runtime_values(ctx_obj)
    focus = runtime.get("customer_focus")
    effective_customer_id = customer_id or (
        focus if isinstance(focus, str) and focus.startswith("cus_") else None
    )
    effective_created_after = created_after or runtime.get("created_after")
    effective_created_before = created_before or runtime.get("created_before")
    query: dict[str, Any] = {"limit": limit}
    if effective_customer_id:
        query["customer"] = effective_customer_id
    query.update(
        _build_created_filters(
            created_after=effective_created_after,
            created_before=effective_created_before,
        ),
    )
    response = _request_json(
        ctx_obj,
        "GET",
        "/v1/payment_intents",
        query=query,
    )
    payments = [_normalize_payment_intent(item) for item in response.get("data", []) if isinstance(item, dict)]
    return _collection_result("payment", "list", ctx_obj, response, payments)


def read_payment(ctx_obj: dict[str, Any], *, payment_id: str) -> dict[str, Any]:
    response = _request_json(ctx_obj, "GET", f"/v1/payment_intents/{parse.quote(payment_id, safe='')}")
    return _single_result("payment", "read", ctx_obj, _normalize_payment_intent(response))


def list_invoices(
    ctx_obj: dict[str, Any],
    *,
    limit: int,
    customer_id: str | None = None,
    status: str | None = None,
    created_after: str | None = None,
    created_before: str | None = None,
) -> dict[str, Any]:
    runtime = resolve_runtime_values(ctx_obj)
    focus = runtime.get("customer_focus")
    effective_customer_id = customer_id or (
        focus if isinstance(focus, str) and focus.startswith("cus_") else None
    )
    effective_status = status or runtime.get("invoice_status")
    effective_created_after = created_after or runtime.get("created_after")
    effective_created_before = created_before or runtime.get("created_before")
    query: dict[str, Any] = {"limit": limit}
    if effective_customer_id:
        query["customer"] = effective_customer_id
    if effective_status:
        query["status"] = effective_status
    query.update(
        _build_created_filters(
            created_after=effective_created_after,
            created_before=effective_created_before,
        ),
    )
    response = _request_json(ctx_obj, "GET", "/v1/invoices", query=query)
    invoices = [_normalize_invoice(item) for item in response.get("data", []) if isinstance(item, dict)]
    return _collection_result("invoice", "list", ctx_obj, response, invoices)


def read_invoice(ctx_obj: dict[str, Any], *, invoice_id: str) -> dict[str, Any]:
    response = _request_json(ctx_obj, "GET", f"/v1/invoices/{parse.quote(invoice_id, safe='')}")
    return _single_result("invoice", "read", ctx_obj, _normalize_invoice(response))


def run_read_command(ctx_obj: dict[str, Any], command_id: str, inputs: dict[str, Any]) -> dict[str, Any]:
    if command_id == "account.read":
        return read_account(ctx_obj)
    if command_id == "balance.read":
        return read_balance(ctx_obj)
    if command_id == "customer.list":
        return list_customers(
            ctx_obj,
            limit=int(inputs.get("limit") or 10),
            email=str(inputs.get("email") or "").strip() or None,
        )
    if command_id == "customer.search":
        return search_customers(ctx_obj, query_text=str(inputs["query"]))
    if command_id == "customer.read":
        return read_customer(ctx_obj, customer_id=str(inputs["customer_id"]))
    if command_id == "payment.list":
        return list_payments(
            ctx_obj,
            limit=int(inputs.get("limit") or 10),
            customer_id=str(inputs.get("customer_id") or "").strip() or None,
            created_after=str(inputs.get("created_after") or "").strip() or None,
            created_before=str(inputs.get("created_before") or "").strip() or None,
        )
    if command_id == "payment.read":
        return read_payment(ctx_obj, payment_id=str(inputs["payment_id"]))
    if command_id == "invoice.list":
        return list_invoices(
            ctx_obj,
            limit=int(inputs.get("limit") or 10),
            customer_id=str(inputs.get("customer_id") or "").strip() or None,
            status=str(inputs.get("status") or "").strip() or None,
            created_after=str(inputs.get("created_after") or "").strip() or None,
            created_before=str(inputs.get("created_before") or "").strip() or None,
        )
    if command_id == "invoice.read":
        return read_invoice(ctx_obj, invoice_id=str(inputs["invoice_id"]))

    raise CliError(
        code="NOT_IMPLEMENTED",
        message=f"{command_id} is not implemented",
        exit_code=10,
        details={"command_id": command_id, "inputs": inputs},
    )


def scaffold_write_command(command_id: str, inputs: dict[str, Any]) -> dict[str, Any]:
    return {
        "status": "not_implemented",
        "scaffold_only": True,
        "executed": False,
        "implemented": False,
        "command_id": command_id,
        "inputs": inputs,
        "next_step": "Implement the live Stripe write path once write safety rules are defined.",
    }
