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
from . import service_keys


REQUIRED_SCOPE_KEYS = [MONDAY_TOKEN_ENV]
OPTIONAL_SCOPE_KEYS = [MONDAY_API_VERSION_ENV, MONDAY_API_URL_ENV, MONDAY_WORKSPACE_ENV, MONDAY_BOARD_ENV]
SUPPORTED_COMMANDS = [
    "capabilities",
    "health",
    "config.show",
    "doctor",
    "account.read",
    "workspace.list",
    "board.list",
    "board.read",
    "item.read",
    "update.list",
    "item.create",
    "item.update",
    "update.create",
]


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


def _scope_command_defaults(runtime: dict[str, Any]) -> dict[str, dict[str, Any]]:
    board_default = runtime["board_id"] or runtime["board_env"]
    return {
        "account.read": {"selection_surface": "account"},
        "workspace.list": {"selection_surface": "workspace", "limit": 10},
        "board.list": {"selection_surface": "board", "limit": 10},
        "board.read": {
            "selection_surface": "board",
            "args": [board_default],
            "limit": 5,
        },
        "item.read": {"selection_surface": "item"},
        "item.create": {
            "selection_surface": "item",
            "options": {"board_id": board_default},
        },
        "item.update": {
            "selection_surface": "item",
            "options": {"board_id": board_default},
        },
        "update.list": {"selection_surface": "update", "limit": 10},
        "update.create": {"selection_surface": "update"},
    }


def _picker_hints() -> dict[str, dict[str, Any]]:
    return {
        "account": {
            "kind": "account",
            "selection_surface": "account",
            "resource": "monday.account",
            "source_command": "account.read",
            "source_fields": ["id", "name", "email", "title"],
        },
        "workspace": {
            "kind": "workspace",
            "selection_surface": "workspace",
            "resource": "monday.workspace",
            "source_command": "workspace.list",
            "source_fields": ["id", "name", "is_default_workspace"],
        },
        "board": {
            "kind": "board",
            "selection_surface": "board",
            "resource": "monday.board",
            "source_command": "board.list",
            "source_fields": ["id", "name", "items_count"],
        },
        "item": {
            "kind": "item",
            "selection_surface": "item",
            "resource": "monday.item",
            "source_command": "board.read",
            "source_fields": ["id", "name"],
        },
        "update": {
            "kind": "update",
            "selection_surface": "update",
            "resource": "monday.update",
            "source_command": "update.list",
            "source_fields": ["id", "body", "created_at", "creator"],
        },
    }


def resolve_runtime_values(ctx_obj: dict[str, Any]) -> dict[str, Any]:
    token_env = ctx_obj.get("token_env") or MONDAY_TOKEN_ENV
    api_version_env = ctx_obj.get("api_version_env") or MONDAY_API_VERSION_ENV
    api_url_env = ctx_obj.get("api_url_env") or MONDAY_API_URL_ENV
    workspace_env = ctx_obj.get("workspace_env") or MONDAY_WORKSPACE_ENV
    board_env = ctx_obj.get("board_env") or MONDAY_BOARD_ENV

    token_info = service_keys.resolve_value(ctx_obj, token_env)
    api_version_info = service_keys.resolve_value(ctx_obj, api_version_env, DEFAULT_MONDAY_API_VERSION)
    api_url_info = service_keys.resolve_value(ctx_obj, api_url_env, DEFAULT_MONDAY_API_URL)
    workspace_info = service_keys.resolve_value(ctx_obj, workspace_env)
    board_info = service_keys.resolve_value(ctx_obj, board_env)

    token = token_info["value"]
    api_version = api_version_info["value"] or DEFAULT_MONDAY_API_VERSION
    api_url = api_url_info["value"] or DEFAULT_MONDAY_API_URL
    workspace_id = workspace_info["value"]
    board_id = board_info["value"]

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
        "token_source": token_info["source"],
        "api_version": api_version,
        "api_version_present": _present(api_version) and api_version_info["source"] != "default",
        "api_version_source": api_version_info["source"],
        "api_url": api_url,
        "api_url_present": _present(api_url) and api_url_info["source"] != "default",
        "api_url_source": api_url_info["source"],
        "workspace_id": workspace_id.strip() if workspace_id and workspace_id.strip() else None,
        "workspace_id_present": _present(workspace_id),
        "workspace_source": workspace_info["source"],
        "board_id": board_id.strip() if board_id and board_id.strip() else None,
        "board_id_present": _present(board_id),
        "board_source": board_info["source"],
        "verbose": bool(ctx_obj.get("verbose")),
    }


def redacted_config_snapshot(ctx_obj: dict[str, Any], *, runtime_ready: bool, live_backend_available: bool) -> dict[str, Any]:
    runtime = resolve_runtime_values(ctx_obj)
    command_defaults = _scope_command_defaults(runtime)
    picker_hints = _picker_hints()
    return {
        "status": "ok",
        "summary": "Monday connector configuration snapshot.",
        "backend": BACKEND_NAME,
        "auth": {
            "token_env": runtime["token_env"],
            "token_present": runtime["token_present"],
            "token_redacted": runtime["token_redacted"],
            "sources": {
                runtime["token_env"]: runtime["token_source"],
                runtime["api_version_env"]: runtime["api_version_source"],
                runtime["api_url_env"]: runtime["api_url_source"],
            },
            "api_version_env": runtime["api_version_env"],
            "api_version_present": runtime["api_version_present"],
            "api_url_env": runtime["api_url_env"],
            "api_url_present": runtime["api_url_present"],
        },
        "context": {
            "workspace_env": runtime["workspace_env"],
            "workspace_id_present": runtime["workspace_id_present"],
            "workspace_id": runtime["workspace_id"],
            "workspace_source": runtime["workspace_source"],
            "board_env": runtime["board_env"],
            "board_id_present": runtime["board_id_present"],
            "board_id": runtime["board_id"],
            "board_source": runtime["board_source"],
        },
        "scope": {
            "required": REQUIRED_SCOPE_KEYS,
            "optional": OPTIONAL_SCOPE_KEYS,
            "commandDefaults": command_defaults,
            "pickerHints": picker_hints,
        },
        "runtime": {
            "api_url": runtime["api_url"],
            "api_version": runtime["api_version"],
            "runtime_ready": runtime_ready,
            "live_backend_available": live_backend_available,
            "live_read_available": live_backend_available,
            "write_bridge_available": live_backend_available,
            "write_paths_scaffolded": False,
            "implementation_mode": "live_read_with_live_writes" if runtime["token_present"] else "configuration_only",
            "command_defaults": command_defaults,
            "picker_hints": picker_hints,
        },
        "supported_commands": SUPPORTED_COMMANDS,
    }
