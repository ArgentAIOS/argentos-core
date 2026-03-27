from __future__ import annotations

import os
from typing import Any

from .constants import (
    BACKEND_NAME,
    BOX_ACCESS_TOKEN_ENV,
    BOX_CLIENT_ID_ENV,
    BOX_CLIENT_SECRET_ENV,
    BOX_COLLABORATION_EMAIL_ENV,
    BOX_COLLABORATION_ROLE_ENV,
    BOX_FILE_ID_ENV,
    BOX_FILE_NAME_ENV,
    BOX_FILE_PATH_ENV,
    BOX_FOLDER_ID_ENV,
    BOX_JWT_CONFIG_ENV,
    BOX_METADATA_JSON_ENV,
    BOX_METADATA_SCOPE_ENV,
    BOX_METADATA_TEMPLATE_ENV,
    BOX_PARENT_ID_ENV,
    BOX_QUERY_ENV,
    BOX_SHARED_LINK_ACCESS_ENV,
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
    parent_id_env = ctx_obj.get("parent_id_env") or BOX_PARENT_ID_ENV
    file_name_env = ctx_obj.get("file_name_env") or BOX_FILE_NAME_ENV
    file_path_env = ctx_obj.get("file_path_env") or BOX_FILE_PATH_ENV
    query_env = ctx_obj.get("query_env") or BOX_QUERY_ENV
    collaboration_email_env = ctx_obj.get("collaboration_email_env") or BOX_COLLABORATION_EMAIL_ENV
    collaboration_role_env = ctx_obj.get("collaboration_role_env") or BOX_COLLABORATION_ROLE_ENV
    shared_link_access_env = ctx_obj.get("shared_link_access_env") or BOX_SHARED_LINK_ACCESS_ENV
    metadata_scope_env = ctx_obj.get("metadata_scope_env") or BOX_METADATA_SCOPE_ENV
    metadata_template_env = ctx_obj.get("metadata_template_env") or BOX_METADATA_TEMPLATE_ENV
    metadata_json_env = ctx_obj.get("metadata_json_env") or BOX_METADATA_JSON_ENV

    access_token = (os.getenv(access_token_env) or "").strip()
    client_id = (os.getenv(client_id_env) or "").strip()
    client_secret = (os.getenv(client_secret_env) or "").strip()
    jwt_config = (os.getenv(jwt_config_env) or "").strip()
    folder_id = (os.getenv(folder_id_env) or "0").strip()
    file_id = (os.getenv(file_id_env) or "").strip()
    parent_id = (os.getenv(parent_id_env) or "0").strip()
    file_name = (os.getenv(file_name_env) or "").strip()
    file_path = (os.getenv(file_path_env) or "").strip()
    query = (os.getenv(query_env) or "").strip()
    collaboration_email = (os.getenv(collaboration_email_env) or "").strip()
    collaboration_role = (os.getenv(collaboration_role_env) or "editor").strip()
    shared_link_access = (os.getenv(shared_link_access_env) or "open").strip()
    metadata_scope = (os.getenv(metadata_scope_env) or "global").strip()
    metadata_template = (os.getenv(metadata_template_env) or "properties").strip()
    metadata_json = (os.getenv(metadata_json_env) or "{}").strip()

    return {
        "backend": BACKEND_NAME,
        "access_token_env": access_token_env,
        "client_id_env": client_id_env,
        "client_secret_env": client_secret_env,
        "jwt_config_env": jwt_config_env,
        "folder_id_env": folder_id_env,
        "file_id_env": file_id_env,
        "parent_id_env": parent_id_env,
        "file_name_env": file_name_env,
        "file_path_env": file_path_env,
        "query_env": query_env,
        "collaboration_email_env": collaboration_email_env,
        "collaboration_role_env": collaboration_role_env,
        "shared_link_access_env": shared_link_access_env,
        "metadata_scope_env": metadata_scope_env,
        "metadata_template_env": metadata_template_env,
        "metadata_json_env": metadata_json_env,
        "access_token": access_token,
        "client_id": client_id,
        "client_secret": client_secret,
        "jwt_config": jwt_config,
        "folder_id": folder_id,
        "file_id": file_id,
        "parent_id": parent_id,
        "file_name": file_name,
        "file_path": file_path,
        "query": query,
        "collaboration_email": collaboration_email,
        "collaboration_role": collaboration_role,
        "shared_link_access": shared_link_access,
        "metadata_scope": metadata_scope,
        "metadata_template": metadata_template,
        "metadata_json": metadata_json,
        "access_token_present": bool(access_token),
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
        },
        "scope": {
            "folder_id": runtime["folder_id"],
            "file_id": runtime["file_id"] or None,
            "parent_id": runtime["parent_id"],
            "query": runtime["query"] or None,
            "collaboration_email": runtime["collaboration_email"] or None,
            "shared_link_access": runtime["shared_link_access"],
            "metadata_scope": runtime["metadata_scope"],
            "metadata_template": runtime["metadata_template"],
        },
        "runtime": {
            "implementation_mode": "live_read_write",
            "runtime_ready": bool(probe["ok"]) if probe else runtime["access_token_present"],
            "file_name": runtime["file_name"] or None,
            "file_path": runtime["file_path"] or None,
        },
        "probe": probe,
    }
