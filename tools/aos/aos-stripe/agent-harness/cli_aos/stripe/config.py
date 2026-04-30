from __future__ import annotations

import json
from pathlib import Path
from typing import Any

from .constants import (
    BACKEND_NAME,
    DEFAULT_API_BASE_URL,
    STRIPE_ACCOUNT_ID_ENV,
    STRIPE_CUSTOMER_EMAIL_ENV,
    STRIPE_CUSTOMER_ID_ENV,
    STRIPE_INVOICE_ID_ENV,
    STRIPE_PAYMENT_INTENT_ID_ENV,
    STRIPE_PRICE_ID_ENV,
    STRIPE_SECRET_KEY_ENV,
    STRIPE_SUBSCRIPTION_ID_ENV,
    STRIPE_WEBHOOK_SECRET_ENV,
)
from .service_keys import service_key_env

ROOT_DIR = Path(__file__).resolve().parents[3]
CONNECTOR_PATH = ROOT_DIR / "connector.json"


def _manifest() -> dict[str, Any]:
    return json.loads(CONNECTOR_PATH.read_text())


def _present(value: str | None) -> bool:
    return bool(value and value.strip())


def _clean(value: str | None) -> str | None:
    if value is None:
        return None
    stripped = value.strip()
    return stripped or None


def resolve_runtime_values(ctx_obj: dict[str, Any]) -> dict[str, Any]:
    secret_key_env = ctx_obj.get("secret_key_env") or STRIPE_SECRET_KEY_ENV
    webhook_secret_env = ctx_obj.get("webhook_secret_env") or STRIPE_WEBHOOK_SECRET_ENV
    account_id_env = ctx_obj.get("account_id_env") or STRIPE_ACCOUNT_ID_ENV
    customer_id_env = ctx_obj.get("customer_id_env") or STRIPE_CUSTOMER_ID_ENV
    customer_email_env = ctx_obj.get("customer_email_env") or STRIPE_CUSTOMER_EMAIL_ENV
    payment_intent_id_env = ctx_obj.get("payment_intent_id_env") or STRIPE_PAYMENT_INTENT_ID_ENV
    subscription_id_env = ctx_obj.get("subscription_id_env") or STRIPE_SUBSCRIPTION_ID_ENV
    price_id_env = ctx_obj.get("price_id_env") or STRIPE_PRICE_ID_ENV
    invoice_id_env = ctx_obj.get("invoice_id_env") or STRIPE_INVOICE_ID_ENV

    secret_key = _clean(service_key_env(secret_key_env))
    webhook_secret = _clean(service_key_env(webhook_secret_env))
    account_id = _clean(service_key_env(account_id_env))
    customer_id = _clean(service_key_env(customer_id_env))
    customer_email = _clean(service_key_env(customer_email_env))
    payment_intent_id = _clean(service_key_env(payment_intent_id_env))
    subscription_id = _clean(service_key_env(subscription_id_env))
    price_id = _clean(service_key_env(price_id_env))
    invoice_id = _clean(service_key_env(invoice_id_env))

    manifest = _manifest()
    return {
        "backend": manifest.get("backend", BACKEND_NAME),
        "api_base_url": str(ctx_obj.get("api_base_url") or DEFAULT_API_BASE_URL).rstrip("/"),
        "secret_key_env": secret_key_env,
        "webhook_secret_env": webhook_secret_env,
        "account_id_env": account_id_env,
        "customer_id_env": customer_id_env,
        "customer_email_env": customer_email_env,
        "payment_intent_id_env": payment_intent_id_env,
        "subscription_id_env": subscription_id_env,
        "price_id_env": price_id_env,
        "invoice_id_env": invoice_id_env,
        "secret_key": secret_key,
        "webhook_secret": webhook_secret,
        "account_id": account_id,
        "customer_id": customer_id,
        "customer_email": customer_email,
        "payment_intent_id": payment_intent_id,
        "subscription_id": subscription_id,
        "price_id": price_id,
        "invoice_id": invoice_id,
        "secret_key_present": _present(secret_key),
        "webhook_secret_present": _present(webhook_secret),
        "account_id_present": _present(account_id),
        "customer_id_present": _present(customer_id),
        "customer_email_present": _present(customer_email),
        "payment_intent_id_present": _present(payment_intent_id),
        "subscription_id_present": _present(subscription_id),
        "price_id_present": _present(price_id),
        "invoice_id_present": _present(invoice_id),
        "verbose": bool(ctx_obj.get("verbose")),
        "connector": manifest.get("connector", {}),
        "auth": manifest.get("auth", {}),
        "scope": manifest.get("scope", {}),
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

    return {
        "status": "ok",
        "summary": "Stripe connector configuration snapshot.",
        "backend": runtime["backend"],
        "connector": runtime["connector"],
        "scope": runtime["scope"],
        "auth": {
            "secret_key_env": runtime["secret_key_env"],
            "secret_key_present": runtime["secret_key_present"],
            "webhook_secret_env": runtime["webhook_secret_env"],
            "webhook_secret_present": runtime["webhook_secret_present"],
            "account_id_env": runtime["account_id_env"],
            "account_id_present": runtime["account_id_present"],
            "customer_id_env": runtime["customer_id_env"],
            "customer_id_present": runtime["customer_id_present"],
            "customer_email_env": runtime["customer_email_env"],
            "customer_email_present": runtime["customer_email_present"],
            "payment_intent_id_env": runtime["payment_intent_id_env"],
            "payment_intent_id_present": runtime["payment_intent_id_present"],
            "subscription_id_env": runtime["subscription_id_env"],
            "subscription_id_present": runtime["subscription_id_present"],
            "price_id_env": runtime["price_id_env"],
            "price_id_present": runtime["price_id_present"],
            "invoice_id_env": runtime["invoice_id_env"],
            "invoice_id_present": runtime["invoice_id_present"],
        },
        "runtime": {
            "api_base_url": runtime["api_base_url"],
            "account_id": runtime["account_id"],
            "customer_id": runtime["customer_id"],
            "customer_email": runtime["customer_email"],
            "payment_intent_id": runtime["payment_intent_id"],
            "subscription_id": runtime["subscription_id"],
            "price_id": runtime["price_id"],
            "invoice_id": runtime["invoice_id"],
            "command_defaults": {
                "balance.get": {"selection_surface": "balance"},
                "customer.list": {
                    "selection_surface": "customer",
                    "limit": 10,
                    "email": runtime["customer_email"],
                },
                "customer.get": {
                    "selection_surface": "customer",
                    "customer_id": runtime["customer_id"],
                },
                "customer.create": {
                    "selection_surface": "customer",
                    "email": runtime["customer_email"],
                },
                "payment.list": {
                    "selection_surface": "payment",
                    "limit": 10,
                    "customer_id": runtime["customer_id"],
                },
                "payment.get": {
                    "selection_surface": "payment",
                    "payment_intent_id": runtime["payment_intent_id"],
                },
                "payment.create": {
                    "selection_surface": "payment",
                    "customer_id": runtime["customer_id"],
                },
                "subscription.list": {
                    "selection_surface": "subscription",
                    "limit": 10,
                    "customer_id": runtime["customer_id"],
                },
                "subscription.get": {
                    "selection_surface": "subscription",
                    "subscription_id": runtime["subscription_id"],
                },
                "subscription.create": {
                    "selection_surface": "subscription",
                    "customer_id": runtime["customer_id"],
                    "price_id": runtime["price_id"],
                },
                "subscription.cancel": {
                    "selection_surface": "subscription",
                    "subscription_id": runtime["subscription_id"],
                },
                "invoice.list": {
                    "selection_surface": "invoice",
                    "limit": 10,
                    "customer_id": runtime["customer_id"],
                },
                "invoice.get": {
                    "selection_surface": "invoice",
                    "invoice_id": runtime["invoice_id"],
                },
                "invoice.send": {
                    "selection_surface": "invoice",
                    "invoice_id": runtime["invoice_id"],
                },
            },
            "runtime_ready": bool(probe and probe["ok"]),
            "api_probe": probe,
        },
    }
