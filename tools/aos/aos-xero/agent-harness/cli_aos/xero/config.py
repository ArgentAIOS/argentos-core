from __future__ import annotations

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
from .service_keys import SERVICE_KEY_VARIABLES, service_key_env, service_key_source


def _mask(value: str | None) -> str | None:
    if not value:
        return None
    if len(value) <= 4:
        return "*" * len(value)
    return f"{value[:2]}***{value[-2:]}"


def resolve_runtime_values(_ctx_obj: dict[str, Any]) -> dict[str, Any]:
    client_id = (service_key_env(CLIENT_ID_ENV) or "").strip()
    client_secret = (service_key_env(CLIENT_SECRET_ENV) or "").strip()
    refresh_token = (service_key_env(REFRESH_TOKEN_ENV) or "").strip()
    tenant_id = (service_key_env(TENANT_ID_ENV) or "").strip()
    contact_id = (service_key_env(CONTACT_ID_ENV) or "").strip()
    invoice_id = (service_key_env(INVOICE_ID_ENV) or "").strip()
    payment_id = (service_key_env(PAYMENT_ID_ENV) or "").strip()
    date = (service_key_env("XERO_DATE") or "").strip()
    api_base_url = (service_key_env(API_BASE_URL_ENV) or "").strip()
    token_url = (service_key_env(TOKEN_URL_ENV) or "").strip()
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
        "date": date or None,
        "date_env": "XERO_DATE",
        "api_base_url": api_base_url or None,
        "api_base_url_env": API_BASE_URL_ENV,
        "token_url": token_url or None,
        "token_url_env": TOKEN_URL_ENV,
        "credentials_present": bool(client_id and client_secret and refresh_token and tenant_id),
        "service_keys": sorted(SERVICE_KEY_VARIABLES),
        "sources": {key: service_key_source(key) for key in sorted(SERVICE_KEY_VARIABLES)},
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
            "service_keys": runtime["service_keys"],
            "operator_service_keys": runtime["service_keys"],
            "sources": runtime["sources"],
            "development_fallback": runtime["service_keys"],
        },
        "scope": {
            "contact_id": runtime["contact_id"],
            "invoice_id": runtime["invoice_id"],
            "payment_id": runtime["payment_id"],
            "date": runtime["date"],
            "api_base_url": runtime["api_base_url"],
            "token_url": runtime["token_url"],
        },
    }
