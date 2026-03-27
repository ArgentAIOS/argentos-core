from __future__ import annotations

import os
from typing import Any

from .constants import (
    API_BASE_URL_ENV,
    CLIENT_ID_ENV,
    CLIENT_SECRET_ENV,
    CONTACT_ID_ENV,
    INVOICE_ID_ENV,
    PAYMENT_ID_ENV,
    REFRESH_TOKEN_ENV,
    TENANT_ID_ENV,
    TOKEN_URL_ENV,
)


def _mask(value: str | None) -> str | None:
    if not value:
        return None
    if len(value) <= 4:
        return "*" * len(value)
    return f"{value[:2]}***{value[-2:]}"


def resolve_runtime_values(_ctx_obj: dict[str, Any]) -> dict[str, Any]:
    client_id = os.getenv(CLIENT_ID_ENV, "").strip()
    client_secret = os.getenv(CLIENT_SECRET_ENV, "").strip()
    refresh_token = os.getenv(REFRESH_TOKEN_ENV, "").strip()
    tenant_id = os.getenv(TENANT_ID_ENV, "").strip()
    contact_id = os.getenv(CONTACT_ID_ENV, "").strip()
    invoice_id = os.getenv(INVOICE_ID_ENV, "").strip()
    payment_id = os.getenv(PAYMENT_ID_ENV, "").strip()
    amount = os.getenv("XERO_AMOUNT", "").strip()
    currency = os.getenv("XERO_CURRENCY", "").strip()
    account_code = os.getenv("XERO_ACCOUNT_CODE", "").strip()
    date = os.getenv("XERO_DATE", "").strip()
    due_date = os.getenv("XERO_DUE_DATE", "").strip()
    description = os.getenv("XERO_DESCRIPTION", "").strip()
    api_base_url = os.getenv(API_BASE_URL_ENV, "").strip()
    token_url = os.getenv(TOKEN_URL_ENV, "").strip()
    return {
        "client_id": client_id,
        "client_id_present": bool(client_id),
        "client_id_env": CLIENT_ID_ENV,
        "client_secret": client_secret,
        "client_secret_present": bool(client_secret),
        "client_secret_env": CLIENT_SECRET_ENV,
        "refresh_token": refresh_token,
        "refresh_token_present": bool(refresh_token),
        "refresh_token_env": REFRESH_TOKEN_ENV,
        "tenant_id": tenant_id,
        "tenant_id_present": bool(tenant_id),
        "tenant_id_env": TENANT_ID_ENV,
        "contact_id": contact_id or None,
        "contact_id_env": CONTACT_ID_ENV,
        "invoice_id": invoice_id or None,
        "invoice_id_env": INVOICE_ID_ENV,
        "payment_id": payment_id or None,
        "payment_id_env": PAYMENT_ID_ENV,
        "amount": amount or None,
        "amount_env": "XERO_AMOUNT",
        "currency": currency or None,
        "currency_env": "XERO_CURRENCY",
        "account_code": account_code or None,
        "account_code_env": "XERO_ACCOUNT_CODE",
        "date": date or None,
        "date_env": "XERO_DATE",
        "due_date": due_date or None,
        "due_date_env": "XERO_DUE_DATE",
        "description": description or None,
        "description_env": "XERO_DESCRIPTION",
        "api_base_url": api_base_url or None,
        "api_base_url_env": API_BASE_URL_ENV,
        "token_url": token_url or None,
        "token_url_env": TOKEN_URL_ENV,
        "credentials_present": bool(client_id and client_secret and refresh_token and tenant_id),
    }


def config_snapshot(ctx_obj: dict[str, Any]) -> dict[str, Any]:
    runtime = resolve_runtime_values(ctx_obj)
    return {
        "auth": {
            "client_id_env": runtime["client_id_env"],
            "client_id_present": runtime["client_id_present"],
            "client_id_preview": _mask(runtime["client_id"]),
            "client_secret_env": runtime["client_secret_env"],
            "client_secret_present": runtime["client_secret_present"],
            "client_secret_preview": _mask(runtime["client_secret"]),
            "refresh_token_env": runtime["refresh_token_env"],
            "refresh_token_present": runtime["refresh_token_present"],
            "refresh_token_preview": _mask(runtime["refresh_token"]),
            "tenant_id_env": runtime["tenant_id_env"],
            "tenant_id_present": runtime["tenant_id_present"],
            "tenant_id_preview": _mask(runtime["tenant_id"]),
        },
        "scope": {
            "contact_id": runtime["contact_id"],
            "invoice_id": runtime["invoice_id"],
            "payment_id": runtime["payment_id"],
            "amount": runtime["amount"],
            "currency": runtime["currency"],
            "account_code": runtime["account_code"],
            "date": runtime["date"],
            "due_date": runtime["due_date"],
            "description": runtime["description"],
            "api_base_url": runtime["api_base_url"],
            "token_url": runtime["token_url"],
        },
    }
