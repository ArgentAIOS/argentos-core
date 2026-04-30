from __future__ import annotations

from typing import Any

from .constants import (
    BACKEND_NAME,
    DEFAULT_MONDAY_API_URL,
    DEFAULT_MONDAY_API_VERSION,
    MONDAY_API_URL_ENV,
    MONDAY_API_VERSION_ENV,
    MONDAY_BOARD_ENV,
    MONDAY_COLUMN_ENV,
    MONDAY_ITEM_ENV,
    MONDAY_TOKEN_ENV,
    MONDAY_WORKSPACE_ENV,
)
from .service_keys import service_key_details


def _present(value: str | None) -> bool:
    return bool(value and value.strip())


def _redact(value: str | None) -> str | None:
    if value is None:
        return None
    stripped = value.strip()
    if not stripped:
        return None
    if len(stripped) <= 6:
        return "***"
    return f"{stripped[:3]}...{stripped[-3:]}"


def resolve_runtime_values(ctx_obj: dict[str, Any]) -> dict[str, Any]:
    token_env = ctx_obj.get("token_env") or MONDAY_TOKEN_ENV
    api_version_env = ctx_obj.get("api_version_env") or MONDAY_API_VERSION_ENV
    api_url_env = ctx_obj.get("api_url_env") or MONDAY_API_URL_ENV
    workspace_env = ctx_obj.get("workspace_env") or MONDAY_WORKSPACE_ENV
    board_env = ctx_obj.get("board_env") or MONDAY_BOARD_ENV
    item_env = ctx_obj.get("item_env") or MONDAY_ITEM_ENV
    column_env = ctx_obj.get("column_env") or MONDAY_COLUMN_ENV

    details = {
        token_env: service_key_details(token_env, ctx_obj),
        api_version_env: service_key_details(api_version_env, ctx_obj, default=DEFAULT_MONDAY_API_VERSION),
        api_url_env: service_key_details(api_url_env, ctx_obj, default=DEFAULT_MONDAY_API_URL),
        workspace_env: service_key_details(workspace_env, ctx_obj),
        board_env: service_key_details(board_env, ctx_obj),
        item_env: service_key_details(item_env, ctx_obj),
        column_env: service_key_details(column_env, ctx_obj),
    }
    token = details[token_env]["value"]
    api_version = details[api_version_env]["value"] or DEFAULT_MONDAY_API_VERSION
    api_url = details[api_url_env]["value"] or DEFAULT_MONDAY_API_URL
    workspace_id = details[workspace_env]["value"]
    board_id = details[board_env]["value"]
    item_id = details[item_env]["value"]
    column_id = details[column_env]["value"]

    return {
        "backend": BACKEND_NAME,
        "details": details,
        "token_env": token_env,
        "api_version_env": api_version_env,
        "api_url_env": api_url_env,
        "workspace_env": workspace_env,
        "board_env": board_env,
        "item_env": item_env,
        "column_env": column_env,
        "token": token,
        "token_present": details[token_env]["present"],
        "token_usable": details[token_env]["usable"],
        "token_redacted": _redact(token),
        "api_version": api_version,
        "api_version_present": details[api_version_env]["present"],
        "api_url": api_url,
        "api_url_present": details[api_url_env]["present"],
        "workspace_id": workspace_id.strip() if workspace_id and workspace_id.strip() else None,
        "workspace_id_present": details[workspace_env]["present"],
        "board_id": board_id.strip() if board_id and board_id.strip() else None,
        "board_id_present": details[board_env]["present"],
        "item_id": item_id.strip() if item_id and item_id.strip() else None,
        "item_id_present": details[item_env]["present"],
        "column_id": column_id.strip() if column_id and column_id.strip() else None,
        "column_id_present": details[column_env]["present"],
        "verbose": bool(ctx_obj.get("verbose")),
    }


def redacted_config_snapshot(ctx_obj: dict[str, Any], *, runtime_ready: bool, live_backend_available: bool) -> dict[str, Any]:
    runtime = resolve_runtime_values(ctx_obj)
    return {
        "status": "ok",
        "summary": "Monday connector configuration snapshot.",
        "backend": BACKEND_NAME,
        "auth": {
            "token_env": runtime["token_env"],
            "token_present": runtime["token_present"],
            "token_usable": runtime["token_usable"],
            "token_redacted": runtime["token_redacted"],
            "token_source": runtime["details"][runtime["token_env"]]["source"],
            "api_version_env": runtime["api_version_env"],
            "api_version_present": runtime["api_version_present"],
            "api_version_source": runtime["details"][runtime["api_version_env"]]["source"],
            "api_url_env": runtime["api_url_env"],
            "api_url_present": runtime["api_url_present"],
            "api_url_source": runtime["details"][runtime["api_url_env"]]["source"],
        },
        "context": {
            "workspace_env": runtime["workspace_env"],
            "workspace_id_present": runtime["workspace_id_present"],
            "workspace_id": runtime["workspace_id"],
            "workspace_id_source": runtime["details"][runtime["workspace_env"]]["source"],
            "board_env": runtime["board_env"],
            "board_id_present": runtime["board_id_present"],
            "board_id": runtime["board_id"],
            "board_id_source": runtime["details"][runtime["board_env"]]["source"],
            "item_env": runtime["item_env"],
            "item_id_present": runtime["item_id_present"],
            "item_id": runtime["item_id"],
            "item_id_source": runtime["details"][runtime["item_env"]]["source"],
            "column_env": runtime["column_env"],
            "column_id_present": runtime["column_id_present"],
            "column_id": runtime["column_id"],
            "column_id_source": runtime["details"][runtime["column_env"]]["source"],
        },
        "runtime": {
            "api_url": runtime["api_url"],
            "api_version": runtime["api_version"],
            "runtime_ready": runtime_ready,
            "live_backend_available": live_backend_available,
            "live_read_available": live_backend_available,
            "write_bridge_available": live_backend_available,
            "write_paths_scaffolded": False,
        },
    }
