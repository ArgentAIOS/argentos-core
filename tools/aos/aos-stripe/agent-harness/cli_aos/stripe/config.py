from __future__ import annotations

import os
from typing import Any

from .constants import (
    AUTH_DESCRIPTOR,
    CONNECTOR_DESCRIPTOR,
    DEFAULT_API_BASE_URL,
    STRIPE_ACCOUNT_ID_ENV,
    STRIPE_CREATED_AFTER_ENV,
    STRIPE_CREATED_BEFORE_ENV,
    STRIPE_CUSTOMER_FOCUS_ENV,
    STRIPE_INVOICE_STATUS_ENV,
    SCOPE_DESCRIPTOR,
    STRIPE_SECRET_KEY_ENV,
    STRIPE_WEBHOOK_SECRET_ENV,
)


def _present(value: str | None) -> bool:
    return bool(value and value.strip())


def resolve_runtime_values(ctx_obj: dict[str, Any]) -> dict[str, Any]:
    secret_key_env = ctx_obj.get("secret_key_env") or STRIPE_SECRET_KEY_ENV
    webhook_secret_env = ctx_obj.get("webhook_secret_env") or STRIPE_WEBHOOK_SECRET_ENV
    account_id_env = ctx_obj.get("account_id_env") or STRIPE_ACCOUNT_ID_ENV
    customer_focus_env = ctx_obj.get("customer_focus_env") or STRIPE_CUSTOMER_FOCUS_ENV
    invoice_status_env = ctx_obj.get("invoice_status_env") or STRIPE_INVOICE_STATUS_ENV
    created_after_env = ctx_obj.get("created_after_env") or STRIPE_CREATED_AFTER_ENV
    created_before_env = ctx_obj.get("created_before_env") or STRIPE_CREATED_BEFORE_ENV

    secret_key = os.getenv(secret_key_env) or None
    webhook_secret = os.getenv(webhook_secret_env) or None
    account_id = os.getenv(account_id_env) or None
    customer_focus = os.getenv(customer_focus_env) or None
    invoice_status = os.getenv(invoice_status_env) or None
    created_after = os.getenv(created_after_env) or None
    created_before = os.getenv(created_before_env) or None

    return {
        "backend": "stripe",
        "api_base_url": ctx_obj.get("api_base_url") or DEFAULT_API_BASE_URL,
        "secret_key_env": secret_key_env,
        "webhook_secret_env": webhook_secret_env,
        "account_id_env": account_id_env,
        "customer_focus_env": customer_focus_env,
        "invoice_status_env": invoice_status_env,
        "created_after_env": created_after_env,
        "created_before_env": created_before_env,
        "secret_key_present": _present(secret_key),
        "webhook_secret_present": _present(webhook_secret),
        "account_id_present": _present(account_id),
        "account_id": account_id or None,
        "customer_focus": customer_focus.strip() if customer_focus and customer_focus.strip() else None,
        "invoice_status": invoice_status.strip() if invoice_status and invoice_status.strip() else None,
        "created_after": created_after.strip() if created_after and created_after.strip() else None,
        "created_before": created_before.strip() if created_before and created_before.strip() else None,
        "account_alias": ctx_obj.get("account_alias") or None,
        "verbose": bool(ctx_obj.get("verbose")),
        "connector": CONNECTOR_DESCRIPTOR,
        "auth": AUTH_DESCRIPTOR,
        "scope": SCOPE_DESCRIPTOR,
    }


def config_snapshot(ctx_obj: dict[str, Any]) -> dict[str, Any]:
    runtime = resolve_runtime_values(ctx_obj)
    from .runtime import probe_runtime

    probe = probe_runtime(ctx_obj) if runtime["secret_key_present"] else None
    if probe is None:
        probe = {
            "ok": False,
            "code": "SKIPPED",
            "message": "Stripe probe skipped until STRIPE_SECRET_KEY is configured",
            "details": {"skipped": True},
        }
    customer_focus = runtime["customer_focus"]
    customer_id = customer_focus if customer_focus and customer_focus.startswith("cus_") else None
    customer_email = customer_focus if customer_focus and "@" in customer_focus else None
    command_defaults = {
        "account.read": {
            "account_id": runtime["account_id"],
        },
        "balance.read": {
            "account_id": runtime["account_id"],
        },
        "customer.list": {
            "account_id": runtime["account_id"],
            "email": customer_email,
        },
        "customer.search": {
            "account_id": runtime["account_id"],
            "query": customer_focus if customer_focus and not customer_focus.startswith("cus_") else None,
        },
        "customer.read": {
            "account_id": runtime["account_id"],
            "customer_id": customer_id,
        },
        "payment.list": {
            "customer_id": customer_id,
            "created_after": runtime["created_after"],
            "created_before": runtime["created_before"],
        },
        "invoice.list": {
            "customer_id": customer_id,
            "status": runtime["invoice_status"],
            "created_after": runtime["created_after"],
            "created_before": runtime["created_before"],
        },
    }
    return {
        "status": "ok",
        "summary": "Stripe connector configuration snapshot.",
        "backend": "stripe",
        "connector": CONNECTOR_DESCRIPTOR,
        "scope": SCOPE_DESCRIPTOR,
        "auth": {
            "secret_key_env": runtime["secret_key_env"],
            "secret_key_present": runtime["secret_key_present"],
            "webhook_secret_env": runtime["webhook_secret_env"],
            "webhook_secret_present": runtime["webhook_secret_present"],
            "account_id_env": runtime["account_id_env"],
            "account_id_present": runtime["account_id_present"],
            "customer_focus_env": runtime["customer_focus_env"],
            "invoice_status_env": runtime["invoice_status_env"],
            "created_after_env": runtime["created_after_env"],
            "created_before_env": runtime["created_before_env"],
        },
        "runtime": {
            "api_base_url": runtime["api_base_url"],
            "account_id": runtime["account_id"],
            "account_alias": runtime["account_alias"],
            "customer_focus": runtime["customer_focus"],
            "invoice_status": runtime["invoice_status"],
            "created_after": runtime["created_after"],
            "created_before": runtime["created_before"],
            "command_defaults": command_defaults,
            "runtime_ready": bool(probe and probe["ok"]),
            "api_probe": probe,
        },
    }
