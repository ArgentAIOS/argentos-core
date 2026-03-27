from __future__ import annotations

import json
from typing import Any

from .client import ClaudeCodeClient, ClaudeCodeClientError
from .config import config_snapshot, resolve_runtime_values
from .constants import BACKEND_NAME, CONNECTOR_PATH, TOOL_NAME
from .errors import CliError


def _load_manifest() -> dict[str, Any]:
    return json.loads(CONNECTOR_PATH.read_text())


def _scope_preview(command_id: str, resource: str, extra: dict[str, Any] | None = None) -> dict[str, Any]:
    payload = {"selection_surface": resource, "command_id": command_id, "backend": BACKEND_NAME}
    if extra:
        payload.update(extra)
    return payload


def _picker(items: list[dict[str, Any]], *, kind: str) -> dict[str, Any]:
    return {"kind": kind, "items": items, "count": len(items)}


def _require_arg(value: str | None, *, code: str, message: str, env_name: str) -> str:
    resolved = (value or "").strip()
    if resolved:
        return resolved
    raise CliError(code=code, message=message, exit_code=4, details={"env": env_name})


def _parse_json_arg(payload: str | None, *, code: str, message: str, env_name: str) -> dict[str, Any]:
    resolved = _require_arg(payload, code=code, message=message, env_name=env_name)
    try:
        parsed = json.loads(resolved)
    except json.JSONDecodeError as err:
        raise CliError(code=code, message=message, exit_code=4, details={"env": env_name, "error": str(err)}) from err
    if not isinstance(parsed, dict):
        raise CliError(code=code, message=message, exit_code=4, details={"env": env_name})
    return parsed


def capabilities_snapshot() -> dict[str, Any]:
    manifest = _load_manifest()
    read_support: dict[str, bool] = {}
    write_support: dict[str, bool] = {}
    for command in manifest["commands"]:
        target = read_support if command["required_mode"] == "readonly" else write_support
        target[command["id"]] = True
    return {
        "tool": manifest["tool"],
        "backend": manifest["backend"],
        "manifest_schema_version": manifest.get("manifest_schema_version", "1.0.0"),
        "connector": manifest["connector"],
        "auth": manifest["auth"],
        "scope": manifest.get("scope", {}),
        "commands": manifest["commands"],
        "read_support": read_support,
        "write_support": write_support,
    }


def create_client(ctx_obj: dict[str, Any]) -> ClaudeCodeClient:
    runtime = resolve_runtime_values(ctx_obj)
    return ClaudeCodeClient(project_dir=runtime["project_dir"], model=runtime["model"])


def probe_runtime(ctx_obj: dict[str, Any]) -> dict[str, Any]:
    client = create_client(ctx_obj)
    if not client.is_available():
        return {
            "ok": False,
            "code": "CLAUDE_CODE_NOT_INSTALLED",
            "message": "claude CLI is not installed or not on PATH",
            "details": {"binary": "claude", "live_backend_available": False},
        }
    try:
        version = client.version()
    except ClaudeCodeClientError as err:
        return {
            "ok": False,
            "code": err.code,
            "message": err.message,
            "details": {**(err.details or {}), "live_backend_available": False},
        }
    return {
        "ok": True,
        "code": "OK",
        "message": "Claude Code CLI runtime is ready",
        "details": {"live_backend_available": True, "version": version},
    }


def health_snapshot(ctx_obj: dict[str, Any]) -> dict[str, Any]:
    runtime = resolve_runtime_values(ctx_obj)
    probe = probe_runtime(ctx_obj)
    status = "ready" if probe["ok"] else "needs_setup"
    return {
        "status": status,
        "summary": probe["message"],
        "connector": {
            "tool": TOOL_NAME,
            "backend": BACKEND_NAME,
            "live_backend_available": bool(probe["ok"]),
            "live_read_available": bool(probe["ok"]),
            "write_bridge_available": bool(probe["ok"]),
            "scaffold_only": False,
        },
        "auth": {
            "api_key_env": runtime["api_key_env"],
            "api_key_present": runtime["api_key_present"],
            "login_supported": True,
        },
        "defaults": {
            "project_dir": runtime["project_dir"],
            "model": runtime["model"],
            "session_id": runtime["session_id"],
        },
        "checks": [
            {"name": "cli_available", "ok": bool(probe["ok"]), "details": probe.get("details", {})},
            {"name": "api_key_optional", "ok": True, "details": {"api_key_present": runtime["api_key_present"]}},
        ],
        "runtime_ready": bool(probe["ok"]),
        "probe": probe,
    }


def doctor_snapshot(ctx_obj: dict[str, Any]) -> dict[str, Any]:
    runtime = resolve_runtime_values(ctx_obj)
    probe = probe_runtime(ctx_obj)
    ready = bool(probe["ok"])
    return {
        "status": "ready" if ready else "needs_setup",
        "summary": "Claude Code connector diagnostics.",
        "runtime": {
            "implementation_mode": "live_cli",
            "command_readiness": {
                "prompt.send": ready,
                "prompt.stream": ready,
                "session.list": ready,
                "session.resume": ready and bool(runtime["session_id"]),
                "hook.list": ready,
                "hook.create": ready and bool(runtime["hook_event"] and runtime["hook_command"]),
                "config.get": ready,
                "config.set": ready and bool(runtime["config_key"] and runtime["config_value"]),
                "mcp.list": ready,
                "mcp.call": ready and bool(runtime["mcp_server"] and runtime["mcp_tool"]),
            },
        },
        "checks": [
            {"name": "cli_available", "ok": ready, "details": probe.get("details", {})},
            {"name": "api_key_optional", "ok": True, "details": {"api_key_present": runtime["api_key_present"]}},
        ],
        "supported_read_commands": ["session.list", "hook.list", "config.get", "mcp.list"],
        "supported_write_commands": [
            "prompt.send",
            "prompt.stream",
            "session.resume",
            "hook.create",
            "config.set",
            "mcp.call",
        ],
    }


def prompt_send_result(
    ctx_obj: dict[str, Any],
    *,
    prompt: str | None,
    stream: bool = False,
    session_id: str | None = None,
    model: str | None = None,
    project_dir: str | None = None,
) -> dict[str, Any]:
    runtime = resolve_runtime_values(ctx_obj)
    resolved_prompt = _require_arg(prompt, code="CLAUDE_CODE_PROMPT_REQUIRED", message="prompt is required", env_name="prompt")
    client = create_client(ctx_obj)
    result = client.prompt_send(
        prompt=resolved_prompt,
        project_dir=project_dir or runtime["project_dir"],
        session_id=session_id or runtime["session_id"],
        model=model or runtime["model"],
        stream=stream,
    )
    command_id = "prompt.stream" if stream else "prompt.send"
    return {
        "status": "live_write",
        "backend": BACKEND_NAME,
        "summary": "Prompt sent to Claude Code.",
        "result": result,
        "scope_preview": _scope_preview(command_id, "prompt", {"project_dir": project_dir or runtime["project_dir"]}),
    }


def session_list_result(ctx_obj: dict[str, Any], *, limit: int) -> dict[str, Any]:
    client = create_client(ctx_obj)
    sessions = client.session_list(limit=limit)
    entries = sessions.get("sessions", [])
    picker_items = [
        {
            "value": item.get("id"),
            "label": item.get("project") or item.get("id"),
            "subtitle": item.get("status") or item.get("model"),
            "selected": False,
        }
        for item in entries
        if isinstance(item, dict)
    ]
    return {
        "status": "live_read",
        "backend": BACKEND_NAME,
        "summary": f"Listed {len(picker_items)} Claude Code session(s).",
        "sessions": entries,
        "picker": _picker(picker_items, kind="claude_code_session"),
        "scope_preview": _scope_preview("session.list", "session", {"limit": limit}),
    }


def session_resume_result(
    ctx_obj: dict[str, Any],
    *,
    session_id: str | None,
    prompt: str | None,
    model: str | None = None,
    project_dir: str | None = None,
) -> dict[str, Any]:
    runtime = resolve_runtime_values(ctx_obj)
    resolved_session_id = _require_arg(
        session_id or runtime["session_id"],
        code="CLAUDE_CODE_SESSION_ID_REQUIRED",
        message="session_id is required",
        env_name=runtime["session_id_env"],
    )
    client = create_client(ctx_obj)
    result = client.session_resume(
        session_id=resolved_session_id,
        prompt=prompt,
        project_dir=project_dir or runtime["project_dir"],
        model=model or runtime["model"],
    )
    return {
        "status": "live_write",
        "backend": BACKEND_NAME,
        "summary": f"Resumed Claude Code session {resolved_session_id}.",
        "result": result,
        "scope_preview": _scope_preview("session.resume", "session", {"session_id": resolved_session_id}),
    }


def hook_list_result(ctx_obj: dict[str, Any]) -> dict[str, Any]:
    client = create_client(ctx_obj)
    hooks = client.hook_list()
    entries = hooks.get("hooks", [])
    picker_items = [
        {
            "value": item.get("id"),
            "label": item.get("event") or item.get("id"),
            "subtitle": item.get("matcher") or item.get("command"),
            "selected": False,
        }
        for item in entries
        if isinstance(item, dict)
    ]
    return {
        "status": "live_read",
        "backend": BACKEND_NAME,
        "summary": f"Listed {len(picker_items)} Claude Code hook(s).",
        "hooks": entries,
        "picker": _picker(picker_items, kind="claude_code_hook"),
        "scope_preview": _scope_preview("hook.list", "hook"),
    }


def hook_create_result(
    ctx_obj: dict[str, Any],
    *,
    event: str | None,
    matcher: str | None,
    command: str | None,
    project_dir: str | None = None,
) -> dict[str, Any]:
    runtime = resolve_runtime_values(ctx_obj)
    resolved_event = _require_arg(
        event or runtime["hook_event"],
        code="CLAUDE_CODE_HOOK_EVENT_REQUIRED",
        message="hook event is required",
        env_name=runtime["hook_event_env"],
    )
    resolved_matcher = matcher or runtime["hook_matcher"] or "*"
    resolved_command = _require_arg(
        command or runtime["hook_command"],
        code="CLAUDE_CODE_HOOK_COMMAND_REQUIRED",
        message="hook command is required",
        env_name=runtime["hook_command_env"],
    )
    client = create_client(ctx_obj)
    result = client.hook_create(
        event=resolved_event,
        matcher=resolved_matcher,
        command=resolved_command,
        project_dir=project_dir or runtime["project_dir"],
    )
    return {
        "status": "live_write",
        "backend": BACKEND_NAME,
        "summary": f"Created Claude Code hook for {resolved_event}.",
        "result": result,
        "scope_preview": _scope_preview("hook.create", "hook", {"event": resolved_event}),
    }


def config_get_result(ctx_obj: dict[str, Any], *, key: str | None) -> dict[str, Any]:
    runtime = resolve_runtime_values(ctx_obj)
    client = create_client(ctx_obj)
    result = client.config_get(key=key or runtime["config_key"])
    return {
        "status": "live_read",
        "backend": BACKEND_NAME,
        "summary": "Fetched Claude Code configuration.",
        "config": result,
        "scope_preview": _scope_preview("config.get", "config", {"key": key or runtime["config_key"]}),
    }


def config_set_result(ctx_obj: dict[str, Any], *, key: str | None, value: str | None) -> dict[str, Any]:
    runtime = resolve_runtime_values(ctx_obj)
    resolved_key = _require_arg(
        key or runtime["config_key"],
        code="CLAUDE_CODE_CONFIG_KEY_REQUIRED",
        message="config key is required",
        env_name=runtime["config_key_env"],
    )
    resolved_value = _require_arg(
        value or runtime["config_value"],
        code="CLAUDE_CODE_CONFIG_VALUE_REQUIRED",
        message="config value is required",
        env_name=runtime["config_value_env"],
    )
    client = create_client(ctx_obj)
    result = client.config_set(key=resolved_key, value=resolved_value)
    return {
        "status": "live_write",
        "backend": BACKEND_NAME,
        "summary": f"Updated Claude Code config {resolved_key}.",
        "result": result,
        "scope_preview": _scope_preview("config.set", "config", {"key": resolved_key}),
    }


def mcp_list_result(ctx_obj: dict[str, Any]) -> dict[str, Any]:
    client = create_client(ctx_obj)
    result = client.mcp_list()
    entries = result.get("servers", [])
    picker_items = [
        {
            "value": item.get("name"),
            "label": item.get("name"),
            "subtitle": item.get("status") or item.get("type"),
            "selected": False,
        }
        for item in entries
        if isinstance(item, dict)
    ]
    return {
        "status": "live_read",
        "backend": BACKEND_NAME,
        "summary": f"Listed {len(picker_items)} MCP server(s).",
        "servers": entries,
        "picker": _picker(picker_items, kind="claude_code_mcp"),
        "scope_preview": _scope_preview("mcp.list", "mcp"),
    }


def mcp_call_result(
    ctx_obj: dict[str, Any],
    *,
    server: str | None,
    tool: str | None,
    input_json: str | None,
) -> dict[str, Any]:
    runtime = resolve_runtime_values(ctx_obj)
    resolved_server = _require_arg(
        server or runtime["mcp_server"],
        code="CLAUDE_CODE_MCP_SERVER_REQUIRED",
        message="mcp server is required",
        env_name=runtime["mcp_server_env"],
    )
    resolved_tool = _require_arg(
        tool or runtime["mcp_tool"],
        code="CLAUDE_CODE_MCP_TOOL_REQUIRED",
        message="mcp tool is required",
        env_name=runtime["mcp_tool_env"],
    )
    payload = _parse_json_arg(
        input_json or runtime["mcp_input_json"],
        code="CLAUDE_CODE_MCP_INPUT_JSON_REQUIRED",
        message="mcp input_json must be valid JSON",
        env_name=runtime["mcp_input_json_env"],
    )
    client = create_client(ctx_obj)
    result = client.mcp_call(server=resolved_server, tool=resolved_tool, input_payload=payload)
    return {
        "status": "live_write",
        "backend": BACKEND_NAME,
        "summary": f"Called MCP tool {resolved_tool} on {resolved_server}.",
        "result": result,
        "scope_preview": _scope_preview("mcp.call", "mcp", {"server": resolved_server, "tool": resolved_tool}),
    }
