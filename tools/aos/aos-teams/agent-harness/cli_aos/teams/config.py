from __future__ import annotations

import os
from typing import Any

from . import __version__
from .constants import BACKEND_NAME, CONNECTOR_AUTH, CONNECTOR_CATEGORY, CONNECTOR_CATEGORIES, CONNECTOR_LABEL, CONNECTOR_RESOURCES, MANIFEST_SCHEMA_VERSION, TOOL_NAME
from .service_keys import service_key_env, service_key_source

REQUIRED_AUTH_KEYS = ["TEAMS_TENANT_ID", "TEAMS_CLIENT_ID", "TEAMS_CLIENT_SECRET"]
SCOPED_LINKING_KEYS = ["TEAMS_TEAM_ID", "TEAMS_USER_ID"]
OPTIONAL_SCOPE_KEYS = ["TEAMS_CHANNEL_ID", "TEAMS_CHAT_ID"]


def _env(name: str) -> str:
    return os.getenv(name, "").strip()


def _resolved(name: str) -> str:
    return (service_key_env(name, "") or "").strip()


def _redact(value: str | None, *, keep: int = 4) -> str:
    if not value:
        return ""
    if len(value) <= keep:
        return "*" * len(value)
    return f"{value[:2]}...{value[-keep:]}"


def _parse_float(value: str | None, default: float) -> float:
    if not value:
        return default
    try:
        parsed = float(value)
    except ValueError:
        return default
    return parsed if parsed > 0 else default


def _command_defaults(team_id: str, user_id: str) -> dict[str, dict[str, Any]]:
    defaults: dict[str, dict[str, Any]] = {
        "team.list": {"selection_surface": "team", "limit": 20},
        "channel.list": {"selection_surface": "channel", "args": ["TEAMS_TEAM_ID"], "limit": 20},
        "channel.create": {"selection_surface": "channel", "args": ["TEAMS_TEAM_ID"]},
        "meeting.list": {"selection_surface": "meeting", "args": ["TEAMS_USER_ID"], "limit": 10},
        "meeting.create": {"selection_surface": "meeting", "args": ["TEAMS_USER_ID"]},
    }
    if team_id:
        defaults["channel.list"] = {"selection_surface": "channel", "args": [team_id], "limit": 20}
        defaults["channel.create"] = {"selection_surface": "channel", "args": [team_id]}
    if user_id:
        defaults["meeting.list"] = {"selection_surface": "meeting", "args": [user_id], "limit": 10}
        defaults["meeting.create"] = {"selection_surface": "meeting", "args": [user_id]}
    return defaults


def runtime_config() -> dict[str, Any]:
    auth_values = {key: _resolved(key) for key in REQUIRED_AUTH_KEYS}
    missing_keys = [key for key, value in auth_values.items() if not value]
    auth_ready = not missing_keys
    auth_sources = {key: service_key_source(key) for key in REQUIRED_AUTH_KEYS}

    tenant_id = auth_values["TEAMS_TENANT_ID"]
    graph_base_url = _env("TEAMS_GRAPH_BASE_URL") or "https://graph.microsoft.com/v1.0"
    token_url = _env("TEAMS_TOKEN_URL") or (
        f"https://login.microsoftonline.com/{tenant_id}/oauth2/v2.0/token" if tenant_id else ""
    )
    timeout_seconds = _parse_float(_env("TEAMS_HTTP_TIMEOUT_SECONDS"), 20.0)

    team_id = _resolved("TEAMS_TEAM_ID")
    channel_id = _resolved("TEAMS_CHANNEL_ID")
    chat_id = _resolved("TEAMS_CHAT_ID")
    user_id = _resolved("TEAMS_USER_ID")
    meeting_subject = _env("TEAMS_MEETING_SUBJECT")
    start_time = _env("TEAMS_START_TIME")
    end_time = _env("TEAMS_END_TIME")
    command_defaults = _command_defaults(team_id, user_id)
    command_readiness = {
        "team.list": auth_ready,
        "channel.list": auth_ready and bool(team_id),
        "channel.create": auth_ready and bool(team_id),
        "meeting.list": auth_ready and bool(user_id),
        "meeting.create": auth_ready and bool(user_id),
    }

    runtime = {
        "graph_base_url": graph_base_url,
        "token_url": token_url,
        "timeout_seconds": timeout_seconds,
        "team_id": team_id,
        "channel_id": channel_id,
        "chat_id": chat_id,
        "user_id": user_id,
        "meeting_subject": meeting_subject,
        "start_time": start_time,
        "end_time": end_time,
        "team_ready": auth_ready,
        "channel_ready": auth_ready and bool(team_id),
        "meeting_ready": auth_ready and bool(user_id),
        "channel_write_ready": auth_ready and bool(team_id),
        "meeting_write_ready": auth_ready and bool(user_id),
        "implementation_mode": "live_read_with_limited_live_writes" if auth_ready else "configuration_only",
        "write_bridge_available": True,
        "scaffold_only": False,
        "command_readiness": command_readiness,
    }

    return {
        "tool": TOOL_NAME,
        "backend": BACKEND_NAME,
        "version": __version__,
        "manifest_schema_version": MANIFEST_SCHEMA_VERSION,
        "connector": {
            "label": CONNECTOR_LABEL,
            "category": CONNECTOR_CATEGORY,
            "categories": CONNECTOR_CATEGORIES,
            "resources": CONNECTOR_RESOURCES,
        },
        "auth": {
            "kind": CONNECTOR_AUTH["kind"],
            "required": CONNECTOR_AUTH["required"],
            "required_keys": REQUIRED_AUTH_KEYS,
            "service_keys": list(CONNECTOR_AUTH["service_keys"]),
            "operator_service_keys": list(CONNECTOR_AUTH["service_keys"]),
            "operator_linking_keys": list(SCOPED_LINKING_KEYS),
            "configured": {key: bool(value) for key, value in auth_values.items()},
            "missing_keys": missing_keys,
            "sources": auth_sources,
            "redacted": {key: _redact(value) for key, value in auth_values.items()},
            "interactive_setup": list(CONNECTOR_AUTH["interactive_setup"]),
        },
        "runtime": runtime,
        "read_support": {
            "team.list": command_readiness["team.list"],
            "channel.list": command_readiness["channel.list"],
            "meeting.list": command_readiness["meeting.list"],
        },
        "write_support": {
            "channel.create": command_readiness["channel.create"],
            "meeting.create": command_readiness["meeting.create"],
            "live_writes_enabled": auth_ready and any(
                command_readiness[command_id] for command_id in ("channel.create", "meeting.create")
            ),
            "scaffold_only": False,
        },
        "scope": {
            "team_id": team_id or None,
            "user_id": user_id or None,
            "channel_id": channel_id or None,
            "chat_id": chat_id or None,
            "sources": {
                **{key: service_key_source(key) for key in SCOPED_LINKING_KEYS},
                **{key: service_key_source(key) for key in OPTIONAL_SCOPE_KEYS},
            },
            "commandDefaults": command_defaults,
            "commandDefaultsTemplate": _command_defaults("", ""),
        },
    }


def redacted_config_snapshot() -> dict[str, Any]:
    return runtime_config()


def config_snapshot() -> dict[str, Any]:
    return redacted_config_snapshot()
