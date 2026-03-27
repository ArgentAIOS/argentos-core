from __future__ import annotations

import os
from typing import Any

from .constants import (
    BACKEND_NAME,
    DEFAULT_BASE_URL,
    GOOGLE_DRIVE_BASE_URL_ENV,
    GOOGLE_DRIVE_CLIENT_ID_ENV,
    GOOGLE_DRIVE_CLIENT_SECRET_ENV,
    GOOGLE_DRIVE_FILE_ID_ENV,
    GOOGLE_DRIVE_FILE_NAME_ENV,
    GOOGLE_DRIVE_FOLDER_ID_ENV,
    GOOGLE_DRIVE_MIME_TYPE_ENV,
    GOOGLE_DRIVE_PERMISSION_ENV,
    GOOGLE_DRIVE_QUERY_ENV,
    GOOGLE_DRIVE_REFRESH_TOKEN_ENV,
    GOOGLE_DRIVE_SHARE_EMAIL_ENV,
)


def _mask(value: str | None) -> str | None:
    if not value:
        return None
    if len(value) <= 8:
        return "*" * len(value)
    return f"{value[:4]}***{value[-4:]}"


def resolve_runtime_values(ctx_obj: dict[str, Any]) -> dict[str, Any]:
    base_url_env = ctx_obj.get("base_url_env") or GOOGLE_DRIVE_BASE_URL_ENV
    client_id_env = ctx_obj.get("client_id_env") or GOOGLE_DRIVE_CLIENT_ID_ENV
    client_secret_env = ctx_obj.get("client_secret_env") or GOOGLE_DRIVE_CLIENT_SECRET_ENV
    refresh_token_env = ctx_obj.get("refresh_token_env") or GOOGLE_DRIVE_REFRESH_TOKEN_ENV
    folder_id_env = ctx_obj.get("folder_id_env") or GOOGLE_DRIVE_FOLDER_ID_ENV
    file_id_env = ctx_obj.get("file_id_env") or GOOGLE_DRIVE_FILE_ID_ENV
    file_name_env = ctx_obj.get("file_name_env") or GOOGLE_DRIVE_FILE_NAME_ENV
    mime_type_env = ctx_obj.get("mime_type_env") or GOOGLE_DRIVE_MIME_TYPE_ENV
    query_env = ctx_obj.get("query_env") or GOOGLE_DRIVE_QUERY_ENV
    share_email_env = ctx_obj.get("share_email_env") or GOOGLE_DRIVE_SHARE_EMAIL_ENV
    permission_env = ctx_obj.get("permission_env") or GOOGLE_DRIVE_PERMISSION_ENV

    base_url = (os.getenv(base_url_env) or DEFAULT_BASE_URL).strip().rstrip("/")
    client_id = (os.getenv(client_id_env) or "").strip()
    client_secret = (os.getenv(client_secret_env) or "").strip()
    refresh_token = (os.getenv(refresh_token_env) or "").strip()
    folder_id = (os.getenv(folder_id_env) or "").strip()
    file_id = (os.getenv(file_id_env) or "").strip()
    file_name = (os.getenv(file_name_env) or "").strip()
    mime_type = (os.getenv(mime_type_env) or "").strip()
    query = (os.getenv(query_env) or "").strip()
    share_email = (os.getenv(share_email_env) or "").strip()
    permission = (os.getenv(permission_env) or "").strip()

    return {
        "backend": BACKEND_NAME,
        "base_url_env": base_url_env,
        "client_id_env": client_id_env,
        "client_secret_env": client_secret_env,
        "refresh_token_env": refresh_token_env,
        "folder_id_env": folder_id_env,
        "file_id_env": file_id_env,
        "file_name_env": file_name_env,
        "mime_type_env": mime_type_env,
        "query_env": query_env,
        "share_email_env": share_email_env,
        "permission_env": permission_env,
        "base_url": base_url,
        "client_id": client_id,
        "client_secret": client_secret,
        "refresh_token": refresh_token,
        "folder_id": folder_id,
        "file_id": file_id,
        "file_name": file_name,
        "mime_type": mime_type,
        "query": query,
        "share_email": share_email,
        "permission": permission,
        "client_id_present": bool(client_id),
        "client_secret_present": bool(client_secret),
        "refresh_token_present": bool(refresh_token),
        "folder_id_present": bool(folder_id),
        "file_id_present": bool(file_id),
        "file_name_present": bool(file_name),
        "mime_type_present": bool(mime_type),
        "query_present": bool(query),
        "share_email_present": bool(share_email),
        "permission_present": bool(permission),
        "credentials_present": bool(client_id and client_secret and refresh_token),
        "runtime_ready": bool(client_id and client_secret and refresh_token),
    }


def config_snapshot(ctx_obj: dict[str, Any], *, probe: dict[str, Any] | None = None) -> dict[str, Any]:
    runtime = resolve_runtime_values(ctx_obj)
    return {
        "backend": BACKEND_NAME,
        "auth": {
            "client_id_env": runtime["client_id_env"],
            "client_id_present": runtime["client_id_present"],
            "client_id_masked": _mask(runtime["client_id"]),
            "client_secret_env": runtime["client_secret_env"],
            "client_secret_present": runtime["client_secret_present"],
            "client_secret_masked": _mask(runtime["client_secret"]),
            "refresh_token_env": runtime["refresh_token_env"],
            "refresh_token_present": runtime["refresh_token_present"],
            "refresh_token_masked": _mask(runtime["refresh_token"]),
        },
        "scope": {
            "base_url": runtime["base_url"],
            "folder_id": runtime["folder_id"] or None,
            "file_id": runtime["file_id"] or None,
            "file_name": runtime["file_name"] or None,
            "mime_type": runtime["mime_type"] or None,
            "query": runtime["query"] or None,
            "share_email": runtime["share_email"] or None,
            "permission": runtime["permission"] or None,
        },
        "runtime": {
            "implementation_mode": "live_read_write",
            "runtime_ready": bool(probe["ok"]) if probe else runtime["runtime_ready"],
        },
        "probe": probe,
    }
