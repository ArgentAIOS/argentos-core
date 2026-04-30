from __future__ import annotations

from typing import Any

from .service_keys import SERVICE_KEY_VARIABLES, service_key_env, service_key_source
from .constants import (
    BACKEND_NAME,
    BOX_ACCESS_TOKEN_ENV,
    BOX_CLIENT_ID_ENV,
    BOX_CLIENT_SECRET_ENV,
    BOX_FILE_ID_ENV,
    BOX_FOLDER_ID_ENV,
    BOX_JWT_CONFIG_ENV,
    BOX_QUERY_ENV,
)


def _mask(value: str | None) -> str | None:
    if not value:
        return None
    if len(value) <= 8:
        return "*" * len(value)
    return f"{value[:4]}***{value[-4:]}"


def resolve_runtime_values(ctx_obj: dict[str, Any]) -> dict[str, Any]:
    access_token_env = ctx_obj.get("access_token_env") or BOX_ACCESS_TOKEN_ENV
    client_id_env = ctx_obj.get("client_id_env") or BOX_CLIENT_ID_ENV
    client_secret_env = ctx_obj.get("client_secret_env") or BOX_CLIENT_SECRET_ENV
    jwt_config_env = ctx_obj.get("jwt_config_env") or BOX_JWT_CONFIG_ENV
    folder_id_env = ctx_obj.get("folder_id_env") or BOX_FOLDER_ID_ENV
    file_id_env = ctx_obj.get("file_id_env") or BOX_FILE_ID_ENV
    query_env = ctx_obj.get("query_env") or BOX_QUERY_ENV

    access_token = (service_key_env(access_token_env) or "").strip()
    client_id = (service_key_env(client_id_env) or "").strip()
    client_secret = (service_key_env(client_secret_env) or "").strip()
    jwt_config = (service_key_env(jwt_config_env) or "").strip()
    folder_id = (service_key_env(folder_id_env) or "0").strip()
    file_id = (service_key_env(file_id_env) or "").strip()
    query = (service_key_env(query_env) or "").strip()

    return {
        "backend": BACKEND_NAME,
        "access_token_env": access_token_env,
        "client_id_env": client_id_env,
        "client_secret_env": client_secret_env,
        "jwt_config_env": jwt_config_env,
        "folder_id_env": folder_id_env,
        "file_id_env": file_id_env,
        "query_env": query_env,
        "access_token": access_token,
        "client_id": client_id,
        "client_secret": client_secret,
        "jwt_config": jwt_config,
        "folder_id": folder_id,
        "file_id": file_id,
        "query": query,
        "access_token_present": bool(access_token),
        "service_keys": sorted(SERVICE_KEY_VARIABLES),
        "sources": {key: service_key_source(key) for key in sorted(SERVICE_KEY_VARIABLES)},
    }


def config_snapshot(ctx_obj: dict[str, Any], *, probe: dict[str, Any] | None = None) -> dict[str, Any]:
    runtime = resolve_runtime_values(ctx_obj)
    return {
        "backend": BACKEND_NAME,
        "auth": {
            "access_token_env": runtime["access_token_env"],
            "access_token_present": runtime["access_token_present"],
            "access_token_masked": _mask(runtime["access_token"]),
            "client_id_env": runtime["client_id_env"],
            "client_id_present": bool(runtime["client_id"]),
            "client_id_masked": _mask(runtime["client_id"]),
            "client_secret_env": runtime["client_secret_env"],
            "client_secret_present": bool(runtime["client_secret"]),
            "client_secret_masked": _mask(runtime["client_secret"]),
            "jwt_config_env": runtime["jwt_config_env"],
            "jwt_config_present": bool(runtime["jwt_config"]),
            "service_keys": sorted(SERVICE_KEY_VARIABLES),
            "operator_service_keys": sorted(SERVICE_KEY_VARIABLES),
            "sources": {key: service_key_source(key) for key in sorted(SERVICE_KEY_VARIABLES)},
            "development_fallback": sorted(SERVICE_KEY_VARIABLES),
        },
        "scope": {
            "folder_id": runtime["folder_id"],
            "file_id": runtime["file_id"] or None,
            "query": runtime["query"] or None,
        },
        "runtime": {
            "implementation_mode": "live_read_only",
            "runtime_ready": bool(probe["ok"]) if probe else runtime["access_token_present"],
        },
        "probe": probe,
    }
