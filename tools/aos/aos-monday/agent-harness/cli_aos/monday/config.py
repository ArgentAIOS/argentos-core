from __future__ import annotations

from typing import Any

from .constants import (
    BACKEND_NAME,
    DEFAULT_MONDAY_API_URL,
    DEFAULT_MONDAY_API_VERSION,
    MONDAY_API_URL_ENV,
    MONDAY_API_VERSION_ENV,
    MONDAY_BOARD_ENV,
    MONDAY_TOKEN_ENV,
    MONDAY_WORKSPACE_ENV,
)
from .service_keys import service_key_env


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

    token = service_key_env(token_env)
    api_version = service_key_env(api_version_env, DEFAULT_MONDAY_API_VERSION) or DEFAULT_MONDAY_API_VERSION
    api_url = service_key_env(api_url_env, DEFAULT_MONDAY_API_URL) or DEFAULT_MONDAY_API_URL
    workspace_id = service_key_env(workspace_env)
    board_id = service_key_env(board_env)

    return {
        "backend": BACKEND_NAME,
        "token_env": token_env,
        "api_version_env": api_version_env,
        "api_url_env": api_url_env,
        "workspace_env": workspace_env,
        "board_env": board_env,
        "token": token,
        "token_present": _present(token),
        "token_redacted": _redact(token),
        "api_version": api_version,
        "api_version_present": _present(service_key_env(api_version_env)),
        "api_url": api_url,
        "api_url_present": _present(service_key_env(api_url_env)),
        "workspace_id": workspace_id.strip() if workspace_id and workspace_id.strip() else None,
        "workspace_id_present": _present(workspace_id),
        "board_id": board_id.strip() if board_id and board_id.strip() else None,
        "board_id_present": _present(board_id),
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
            "token_redacted": runtime["token_redacted"],
            "api_version_env": runtime["api_version_env"],
            "api_version_present": runtime["api_version_present"],
            "api_url_env": runtime["api_url_env"],
            "api_url_present": runtime["api_url_present"],
        },
        "context": {
            "workspace_env": runtime["workspace_env"],
            "workspace_id_present": runtime["workspace_id_present"],
            "workspace_id": runtime["workspace_id"],
            "board_env": runtime["board_env"],
            "board_id_present": runtime["board_id_present"],
            "board_id": runtime["board_id"],
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
