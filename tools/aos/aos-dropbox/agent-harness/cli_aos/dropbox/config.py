from __future__ import annotations

from typing import Any

from .service_keys import SERVICE_KEY_VARIABLES, service_key_env, service_key_source
from .constants import (
    BACKEND_NAME,
    DEFAULT_API_BASE_URL,
    DEFAULT_CONTENT_BASE_URL,
    DROPBOX_APP_KEY_ENV,
    DROPBOX_APP_SECRET_ENV,
    DROPBOX_BASE_URL_ENV,
    DROPBOX_CONTENT_URL_ENV,
    DROPBOX_CURSOR_ENV,
    DROPBOX_FILE_ID_ENV,
    DROPBOX_LIMIT_ENV,
    DROPBOX_PATH_ENV,
    DROPBOX_QUERY_ENV,
    DROPBOX_REFRESH_TOKEN_ENV,
)


def _mask(value: str | None) -> str | None:
    if not value:
        return None
    if len(value) <= 8:
        return "*" * len(value)
    return f"{value[:4]}***{value[-4:]}"


def _int_or_none(value: str | None) -> int | None:
    try:
        return int(value) if value not in (None, "") else None
    except ValueError:
        return None


def resolve_runtime_values(ctx_obj: dict[str, Any]) -> dict[str, Any]:
    app_key_env = ctx_obj.get("app_key_env") or DROPBOX_APP_KEY_ENV
    app_secret_env = ctx_obj.get("app_secret_env") or DROPBOX_APP_SECRET_ENV
    refresh_token_env = ctx_obj.get("refresh_token_env") or DROPBOX_REFRESH_TOKEN_ENV
    base_url_env = ctx_obj.get("base_url_env") or DROPBOX_BASE_URL_ENV
    content_url_env = ctx_obj.get("content_url_env") or DROPBOX_CONTENT_URL_ENV
    path_env = ctx_obj.get("path_env") or DROPBOX_PATH_ENV
    file_id_env = ctx_obj.get("file_id_env") or DROPBOX_FILE_ID_ENV
    query_env = ctx_obj.get("query_env") or DROPBOX_QUERY_ENV
    cursor_env = ctx_obj.get("cursor_env") or DROPBOX_CURSOR_ENV
    limit_env = ctx_obj.get("limit_env") or DROPBOX_LIMIT_ENV

    app_key = (service_key_env(app_key_env) or "").strip()
    app_secret = (service_key_env(app_secret_env) or "").strip()
    refresh_token = (service_key_env(refresh_token_env) or "").strip()
    base_url = (service_key_env(base_url_env) or DEFAULT_API_BASE_URL).strip().rstrip("/")
    content_url = (service_key_env(content_url_env) or DEFAULT_CONTENT_BASE_URL).strip().rstrip("/")
    path = (service_key_env(path_env) or "").strip()
    file_id = (service_key_env(file_id_env) or "").strip()
    query = (service_key_env(query_env) or "").strip()
    cursor = (service_key_env(cursor_env) or "").strip()
    limit = _int_or_none(service_key_env(limit_env))

    return {
        "backend": BACKEND_NAME,
        "app_key_env": app_key_env,
        "app_secret_env": app_secret_env,
        "refresh_token_env": refresh_token_env,
        "base_url_env": base_url_env,
        "content_url_env": content_url_env,
        "path_env": path_env,
        "file_id_env": file_id_env,
        "query_env": query_env,
        "cursor_env": cursor_env,
        "limit_env": limit_env,
        "app_key": app_key,
        "app_secret": app_secret,
        "refresh_token": refresh_token,
        "base_url": base_url,
        "content_url": content_url,
        "path": path,
        "file_id": file_id,
        "query": query,
        "cursor": cursor,
        "limit": limit,
        "app_key_present": bool(app_key),
        "app_secret_present": bool(app_secret),
        "refresh_token_present": bool(refresh_token),
        "runtime_ready": bool(app_key and app_secret and refresh_token),
        "service_keys": sorted(SERVICE_KEY_VARIABLES),
        "sources": {key: service_key_source(key) for key in sorted(SERVICE_KEY_VARIABLES)},
    }


def config_snapshot(ctx_obj: dict[str, Any], *, probe: dict[str, Any] | None = None) -> dict[str, Any]:
    runtime = resolve_runtime_values(ctx_obj)
    return {
        "backend": BACKEND_NAME,
        "auth": {
            "app_key_env": runtime["app_key_env"],
            "app_key_present": runtime["app_key_present"],
            "app_key_masked": _mask(runtime["app_key"]),
            "app_secret_env": runtime["app_secret_env"],
            "app_secret_present": runtime["app_secret_present"],
            "app_secret_masked": _mask(runtime["app_secret"]),
            "refresh_token_env": runtime["refresh_token_env"],
            "refresh_token_present": runtime["refresh_token_present"],
            "refresh_token_masked": _mask(runtime["refresh_token"]),
            "service_keys": sorted(SERVICE_KEY_VARIABLES),
            "operator_service_keys": sorted(SERVICE_KEY_VARIABLES),
            "sources": {key: service_key_source(key) for key in sorted(SERVICE_KEY_VARIABLES)},
            "development_fallback": sorted(SERVICE_KEY_VARIABLES),
        },
        "scope": {
            "path": runtime["path"] or None,
            "file_id": runtime["file_id"] or None,
            "query": runtime["query"] or None,
            "cursor": runtime["cursor"] or None,
        },
        "runtime": {
            "implementation_mode": "live_read_only",
            "runtime_ready": bool(probe["ok"]) if probe else runtime["runtime_ready"],
            "limit": runtime["limit"],
            "base_url": runtime["base_url"],
            "content_url": runtime["content_url"],
        },
        "probe": probe,
    }
