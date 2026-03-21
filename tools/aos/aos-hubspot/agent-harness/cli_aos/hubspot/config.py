from __future__ import annotations

import os
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


def _first_present_env(*names: str) -> tuple[str | None, str | None]:
    for name in names:
        if not name:
            continue
        value = os.getenv(name, "").strip()
        if value:
            return name, value
    return None, None


def _preferred_env_name(primary: str, legacy: str) -> str:
    return primary or legacy


def resolve_runtime_values(ctx_obj: dict[str, Any]) -> dict[str, Any]:
    access_token_env = (ctx_obj.get("access_token_env") or DEFAULT_ACCESS_TOKEN_ENV).strip() or DEFAULT_ACCESS_TOKEN_ENV
    app_id_env = (ctx_obj.get("app_id_env") or DEFAULT_APP_ID_ENV).strip() or DEFAULT_APP_ID_ENV
    webhook_secret_env = (ctx_obj.get("webhook_secret_env") or DEFAULT_WEBHOOK_SECRET_ENV).strip() or DEFAULT_WEBHOOK_SECRET_ENV

    access_token_source, access_token = _first_present_env(
        access_token_env,
        DEFAULT_ACCESS_TOKEN_ENV,
        LEGACY_ACCESS_TOKEN_ENV,
    )
    app_id_source, app_id = _first_present_env(app_id_env, DEFAULT_APP_ID_ENV, LEGACY_APP_ID_ENV)
    webhook_source, webhook_secret = _first_present_env(
        webhook_secret_env,
        DEFAULT_WEBHOOK_SECRET_ENV,
        LEGACY_WEBHOOK_SECRET_ENV,
    )
    portal_source, portal_id_env_value = _first_present_env(DEFAULT_PORTAL_ID_ENV, LEGACY_PORTAL_ID_ENV)
    alias_source, account_alias_env_value = _first_present_env(
        DEFAULT_ACCOUNT_ALIAS_ENV,
        LEGACY_ACCOUNT_ALIAS_ENV,
    )

    portal_id = (str(ctx_obj.get("portal_id") or "").strip() or portal_id_env_value or None)
    account_alias = (str(ctx_obj.get("account_alias") or "").strip() or account_alias_env_value or None)
    base_url = str(ctx_obj.get("base_url") or DEFAULT_BASE_URL).strip() or DEFAULT_BASE_URL

    return {
        "tool": "aos-hubspot",
        "backend": "hubspot",
        "base_url": base_url.rstrip("/"),
        "portal_id": portal_id,
        "portal_id_source": "flag" if str(ctx_obj.get("portal_id") or "").strip() else portal_source,
        "account_alias": account_alias,
        "account_alias_source": "flag" if str(ctx_obj.get("account_alias") or "").strip() else alias_source,
        "access_token_env": _preferred_env_name(access_token_source or access_token_env, LEGACY_ACCESS_TOKEN_ENV),
        "access_token": access_token,
        "access_token_present": bool(access_token),
        "app_id_env": _preferred_env_name(app_id_source or app_id_env, LEGACY_APP_ID_ENV),
        "app_id": app_id,
        "app_id_present": bool(app_id),
        "webhook_secret_env": _preferred_env_name(webhook_source or webhook_secret_env, LEGACY_WEBHOOK_SECRET_ENV),
        "webhook_secret": webhook_secret,
        "webhook_secret_present": bool(webhook_secret),
    }


def runtime_config(ctx_obj: dict[str, Any]) -> dict[str, Any]:
    resolved = resolve_runtime_values(ctx_obj)
    return {
        "tool": resolved["tool"],
        "backend": resolved["backend"],
        "base_url": resolved["base_url"],
        "portal_id": resolved["portal_id"],
        "portal_id_source": resolved["portal_id_source"],
        "account_alias": resolved["account_alias"],
        "account_alias_source": resolved["account_alias_source"],
        "access_token_env": resolved["access_token_env"],
        "access_token_present": resolved["access_token_present"],
        "app_id_env": resolved["app_id_env"],
        "app_id_present": resolved["app_id_present"],
        "webhook_secret_env": resolved["webhook_secret_env"],
        "webhook_secret_present": resolved["webhook_secret_present"],
        "auth_ready": bool(resolved["portal_id"] and resolved["access_token_present"]),
    }
