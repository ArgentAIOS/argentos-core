from __future__ import annotations

from typing import Any

from . import __version__
from .constants import BACKEND_NAME, CONNECTOR_AUTH, CONNECTOR_CATEGORY, CONNECTOR_CATEGORIES, CONNECTOR_LABEL, CONNECTOR_RESOURCES, MANIFEST_SCHEMA_VERSION, TOOL_NAME
from . import service_keys

REQUIRED_AUTH_KEYS = ["TEAMS_TENANT_ID", "TEAMS_CLIENT_ID", "TEAMS_CLIENT_SECRET"]
SCOPED_LINKING_KEYS = ["TEAMS_TEAM_ID", "TEAMS_USER_ID"]
OPTIONAL_SCOPE_KEYS = [
    "TEAMS_CHANNEL_ID",
    "TEAMS_CHAT_ID",
    "TEAMS_GRAPH_BASE_URL",
    "TEAMS_TOKEN_URL",
    "TEAMS_HTTP_TIMEOUT_SECONDS",
    "TEAMS_MEETING_SUBJECT",
    "TEAMS_START_TIME",
    "TEAMS_END_TIME",
]


def _detail(name: str, ctx_obj: dict[str, Any] | None = None, default: str | None = None) -> dict[str, Any]:
    return service_keys.service_key_details(name, ctx_obj, default=default)


def _resolved(name: str, ctx_obj: dict[str, Any] | None = None, default: str | None = None) -> str:
    return (_detail(name, ctx_obj, default=default)["value"] or "").strip()


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


def runtime_config(ctx_obj: dict[str, Any] | None = None) -> dict[str, Any]:
    auth_details = {key: _detail(key, ctx_obj) for key in REQUIRED_AUTH_KEYS}
    auth_values = {key: details["value"] for key, details in auth_details.items()}
    missing_keys = [key for key, value in auth_values.items() if not value]
    auth_ready = not missing_keys
    auth_sources = {key: details["source"] if details["present"] else None for key, details in auth_details.items()}

    tenant_id = auth_values["TEAMS_TENANT_ID"]
    graph_base_url = _resolved("TEAMS_GRAPH_BASE_URL", ctx_obj, "https://graph.microsoft.com/v1.0") or "https://graph.microsoft.com/v1.0"
    token_url = _resolved("TEAMS_TOKEN_URL", ctx_obj) or (
        f"https://login.microsoftonline.com/{tenant_id}/oauth2/v2.0/token" if tenant_id else ""
    )
    timeout_seconds = _parse_float(_resolved("TEAMS_HTTP_TIMEOUT_SECONDS", ctx_obj), 20.0)

    team_id = _resolved("TEAMS_TEAM_ID", ctx_obj)
    channel_id = _resolved("TEAMS_CHANNEL_ID", ctx_obj)
    chat_id = _resolved("TEAMS_CHAT_ID", ctx_obj)
    user_id = _resolved("TEAMS_USER_ID", ctx_obj)
    meeting_subject = _resolved("TEAMS_MEETING_SUBJECT", ctx_obj)
    start_time = _resolved("TEAMS_START_TIME", ctx_obj)
    end_time = _resolved("TEAMS_END_TIME", ctx_obj)
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
        "live_write_smoke_tested": False,
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
            "optional_service_keys": [*SCOPED_LINKING_KEYS, *OPTIONAL_SCOPE_KEYS],
            "configured": {key: bool(value) for key, value in auth_values.items()},
            "missing_keys": missing_keys,
            "sources": auth_sources,
            "redacted": {key: _redact(value) for key, value in auth_values.items()},
            "interactive_setup": list(CONNECTOR_AUTH["interactive_setup"]),
            "resolution_order": ["operator-context", "service-keys", "process.env", "default"],
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
                **{key: service_keys.service_key_source(key, ctx_obj) for key in SCOPED_LINKING_KEYS},
                **{key: service_keys.service_key_source(key, ctx_obj) for key in OPTIONAL_SCOPE_KEYS},
            },
            "commandDefaults": command_defaults,
            "commandDefaultsTemplate": _command_defaults("", ""),
        },
    }


def redacted_config_snapshot(ctx_obj: dict[str, Any] | None = None) -> dict[str, Any]:
    return runtime_config(ctx_obj)


def config_snapshot(ctx_obj: dict[str, Any] | None = None) -> dict[str, Any]:
    return redacted_config_snapshot(ctx_obj)
