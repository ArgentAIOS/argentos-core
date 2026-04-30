from __future__ import annotations

from typing import Any

from .constants import (
    DEFAULT_ACCESS_TOKEN_ENV,
    DEFAULT_ACCOUNT_ALIAS_ENV,
    DEFAULT_APP_ID_ENV,
    DEFAULT_BASE_URL,
    DEFAULT_PORTAL_ID_ENV,
    DEFAULT_WEBHOOK_SECRET_ENV,
    LEGACY_ACCESS_TOKEN_ENV,
    LEGACY_ACCOUNT_ALIAS_ENV,
    LEGACY_APP_ID_ENV,
    LEGACY_PORTAL_ID_ENV,
    LEGACY_WEBHOOK_SECRET_ENV,
)
from . import service_keys


def _first_present_env(ctx_obj: dict[str, Any], *names: str) -> tuple[str | None, str | None, str | None, bool]:
    for name in names:
        if not name:
            continue
        detail = service_keys.service_key_details(name, ctx_obj)
        if detail["source"] in {"env_fallback", "default", "missing"}:
            continue
        if detail["usable"] and detail["value"]:
            return name, detail["value"], detail["source"], True
        return name, None, detail["source"], False
    for name in names:
        if not name:
            continue
        detail = service_keys.service_key_details(name, ctx_obj)
        if detail["usable"] and detail["value"]:
            return name, detail["value"], detail["source"], True
        if detail["present"] and not detail["usable"]:
            return name, None, detail["source"], False
    return None, None, None, False


def _preferred_env_name(primary: str, legacy: str) -> str:
    return primary or legacy


def resolve_runtime_values(ctx_obj: dict[str, Any]) -> dict[str, Any]:
    access_token_env = (ctx_obj.get("access_token_env") or DEFAULT_ACCESS_TOKEN_ENV).strip() or DEFAULT_ACCESS_TOKEN_ENV
    app_id_env = (ctx_obj.get("app_id_env") or DEFAULT_APP_ID_ENV).strip() or DEFAULT_APP_ID_ENV
    webhook_secret_env = (ctx_obj.get("webhook_secret_env") or DEFAULT_WEBHOOK_SECRET_ENV).strip() or DEFAULT_WEBHOOK_SECRET_ENV

    access_token_source, access_token, access_token_source_kind, access_token_usable = _first_present_env(
        ctx_obj,
        access_token_env,
        DEFAULT_ACCESS_TOKEN_ENV,
        LEGACY_ACCESS_TOKEN_ENV,
    )
    app_id_source, app_id, app_id_source_kind, app_id_usable = _first_present_env(
        ctx_obj, app_id_env, DEFAULT_APP_ID_ENV, LEGACY_APP_ID_ENV
    )
    webhook_source, webhook_secret, webhook_source_kind, webhook_secret_usable = _first_present_env(
        ctx_obj,
        webhook_secret_env,
        DEFAULT_WEBHOOK_SECRET_ENV,
        LEGACY_WEBHOOK_SECRET_ENV,
    )
    portal_source, portal_id_env_value, portal_source_kind, portal_id_usable = _first_present_env(
        ctx_obj,
        DEFAULT_PORTAL_ID_ENV,
        LEGACY_PORTAL_ID_ENV,
    )
    alias_source, account_alias_env_value, alias_source_kind, account_alias_usable = _first_present_env(
        ctx_obj,
        DEFAULT_ACCOUNT_ALIAS_ENV,
        LEGACY_ACCOUNT_ALIAS_ENV,
    )
    base_url_source, base_url_value, base_url_source_kind, _base_url_usable = _first_present_env(
        ctx_obj,
        "HUBSPOT_BASE_URL",
        "AOS_HUBSPOT_BASE_URL",
    )

    portal_id = (str(ctx_obj.get("portal_id") or "").strip() or portal_id_env_value or None)
    account_alias = (str(ctx_obj.get("account_alias") or "").strip() or account_alias_env_value or None)
    raw_base_url = str(ctx_obj.get("base_url") or "").strip()
    base_url = raw_base_url if raw_base_url and raw_base_url != DEFAULT_BASE_URL else base_url_value or DEFAULT_BASE_URL

    return {
        "tool": "aos-hubspot",
        "backend": "hubspot",
        "base_url": base_url.rstrip("/"),
        "base_url_source": "flag" if raw_base_url and raw_base_url != DEFAULT_BASE_URL else base_url_source,
        "base_url_source_kind": "flag" if raw_base_url and raw_base_url != DEFAULT_BASE_URL else base_url_source_kind,
        "portal_id": portal_id,
        "portal_id_source": "flag" if str(ctx_obj.get("portal_id") or "").strip() else portal_source,
        "portal_id_source_kind": "flag" if str(ctx_obj.get("portal_id") or "").strip() else portal_source_kind,
        "portal_id_usable": portal_id_usable,
        "account_alias": account_alias,
        "account_alias_source": "flag" if str(ctx_obj.get("account_alias") or "").strip() else alias_source,
        "account_alias_source_kind": "flag"
        if str(ctx_obj.get("account_alias") or "").strip()
        else alias_source_kind,
        "account_alias_usable": account_alias_usable,
        "access_token_env": _preferred_env_name(access_token_source or access_token_env, LEGACY_ACCESS_TOKEN_ENV),
        "access_token": access_token,
        "access_token_present": bool(access_token),
        "access_token_source_kind": access_token_source_kind,
        "access_token_usable": access_token_usable,
        "app_id_env": _preferred_env_name(app_id_source or app_id_env, LEGACY_APP_ID_ENV),
        "app_id": app_id,
        "app_id_present": bool(app_id),
        "app_id_source_kind": app_id_source_kind,
        "app_id_usable": app_id_usable,
        "webhook_secret_env": _preferred_env_name(webhook_source or webhook_secret_env, LEGACY_WEBHOOK_SECRET_ENV),
        "webhook_secret": webhook_secret,
        "webhook_secret_present": bool(webhook_secret),
        "webhook_secret_source_kind": webhook_source_kind,
        "webhook_secret_usable": webhook_secret_usable,
    }


def runtime_config(ctx_obj: dict[str, Any]) -> dict[str, Any]:
    resolved = resolve_runtime_values(ctx_obj)
    return {
        "tool": resolved["tool"],
        "backend": resolved["backend"],
        "base_url": resolved["base_url"],
        "base_url_source": resolved["base_url_source"],
        "base_url_source_kind": resolved["base_url_source_kind"],
        "portal_id": resolved["portal_id"],
        "portal_id_source": resolved["portal_id_source"],
        "portal_id_source_kind": resolved["portal_id_source_kind"],
        "portal_id_usable": resolved["portal_id_usable"],
        "account_alias": resolved["account_alias"],
        "account_alias_source": resolved["account_alias_source"],
        "account_alias_source_kind": resolved["account_alias_source_kind"],
        "account_alias_usable": resolved["account_alias_usable"],
        "access_token_env": resolved["access_token_env"],
        "access_token_present": resolved["access_token_present"],
        "access_token_source_kind": resolved["access_token_source_kind"],
        "access_token_usable": resolved["access_token_usable"],
        "app_id_env": resolved["app_id_env"],
        "app_id_present": resolved["app_id_present"],
        "app_id_source_kind": resolved["app_id_source_kind"],
        "app_id_usable": resolved["app_id_usable"],
        "webhook_secret_env": resolved["webhook_secret_env"],
        "webhook_secret_present": resolved["webhook_secret_present"],
        "webhook_secret_source_kind": resolved["webhook_secret_source_kind"],
        "webhook_secret_usable": resolved["webhook_secret_usable"],
        "auth_ready": bool(resolved["portal_id"] and resolved["access_token_present"]),
        "service_key_resolution_order": ["operator-context", "service-keys", "process.env"],
        "live_write_smoke_tested": False,
    }
