from __future__ import annotations

import os
from typing import Any

from .constants import (
    ANTHROPIC_API_KEY_ENV,
    CONFIG_KEY_ENV,
    CONFIG_VALUE_ENV,
    HOOK_COMMAND_ENV,
    HOOK_EVENT_ENV,
    HOOK_MATCHER_ENV,
    MCP_INPUT_JSON_ENV,
    MCP_SERVER_ENV,
    MCP_TOOL_ENV,
    MODEL_ENV,
    PROJECT_DIR_ENV,
    SESSION_ID_ENV,
)


def _mask(value: str | None) -> str | None:
    if not value:
        return None
    if len(value) <= 4:
        return "*" * len(value)
    return f"{value[:2]}***{value[-2:]}"


def resolve_runtime_values(_ctx_obj: dict[str, Any]) -> dict[str, Any]:
    api_key = os.getenv(ANTHROPIC_API_KEY_ENV, "").strip()
    project_dir = os.getenv(PROJECT_DIR_ENV, "").strip()
    model = os.getenv(MODEL_ENV, "").strip()
    session_id = os.getenv(SESSION_ID_ENV, "").strip()
    hook_event = os.getenv(HOOK_EVENT_ENV, "").strip()
    hook_matcher = os.getenv(HOOK_MATCHER_ENV, "").strip()
    hook_command = os.getenv(HOOK_COMMAND_ENV, "").strip()
    config_key = os.getenv(CONFIG_KEY_ENV, "").strip()
    config_value = os.getenv(CONFIG_VALUE_ENV, "").strip()
    mcp_server = os.getenv(MCP_SERVER_ENV, "").strip()
    mcp_tool = os.getenv(MCP_TOOL_ENV, "").strip()
    mcp_input_json = os.getenv(MCP_INPUT_JSON_ENV, "").strip()
    return {
        "api_key": api_key,
        "api_key_present": bool(api_key),
        "api_key_env": ANTHROPIC_API_KEY_ENV,
        "project_dir": project_dir or None,
        "project_dir_env": PROJECT_DIR_ENV,
        "model": model or None,
        "model_env": MODEL_ENV,
        "session_id": session_id or None,
        "session_id_env": SESSION_ID_ENV,
        "hook_event": hook_event or None,
        "hook_event_env": HOOK_EVENT_ENV,
        "hook_matcher": hook_matcher or None,
        "hook_matcher_env": HOOK_MATCHER_ENV,
        "hook_command": hook_command or None,
        "hook_command_env": HOOK_COMMAND_ENV,
        "config_key": config_key or None,
        "config_key_env": CONFIG_KEY_ENV,
        "config_value": config_value or None,
        "config_value_env": CONFIG_VALUE_ENV,
        "mcp_server": mcp_server or None,
        "mcp_server_env": MCP_SERVER_ENV,
        "mcp_tool": mcp_tool or None,
        "mcp_tool_env": MCP_TOOL_ENV,
        "mcp_input_json": mcp_input_json or None,
        "mcp_input_json_env": MCP_INPUT_JSON_ENV,
    }


def config_snapshot(ctx_obj: dict[str, Any]) -> dict[str, Any]:
    runtime = resolve_runtime_values(ctx_obj)
    return {
        "auth": {
            "api_key_env": runtime["api_key_env"],
            "api_key_present": runtime["api_key_present"],
            "api_key_preview": _mask(runtime["api_key"]),
        },
        "defaults": {
            "project_dir": runtime["project_dir"],
            "model": runtime["model"],
            "session_id": runtime["session_id"],
            "hook_event": runtime["hook_event"],
            "hook_matcher": runtime["hook_matcher"],
            "config_key": runtime["config_key"],
            "mcp_server": runtime["mcp_server"],
            "mcp_tool": runtime["mcp_tool"],
        },
    }
