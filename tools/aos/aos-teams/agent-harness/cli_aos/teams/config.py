from __future__ import annotations

import os
from typing import Any

from . import __version__
from .constants import BACKEND_NAME, CONNECTOR_AUTH, CONNECTOR_CATEGORY, CONNECTOR_CATEGORIES, CONNECTOR_LABEL, CONNECTOR_RESOURCES, MANIFEST_SCHEMA_VERSION, TOOL_NAME
from .service_keys import resolve_service_key, service_key_env

REQUIRED_AUTH_KEYS = ["TEAMS_TENANT_ID", "TEAMS_CLIENT_ID", "TEAMS_CLIENT_SECRET"]


def _env(name: str) -> str:
    return os.getenv(name, "").strip()


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


def runtime_config() -> dict[str, Any]:
    env_values = {key: (service_key_env(key, "") or "").strip() for key in REQUIRED_AUTH_KEYS}
    missing_keys = [key for key, value in env_values.items() if not value]
    auth_ready = not missing_keys
    auth_sources = {
        key: (
            "service-keys"
            if resolve_service_key(key)
            else "process.env"
            if _env(key)
            else None
        )
        for key in REQUIRED_AUTH_KEYS
    }

    tenant_id = env_values["TEAMS_TENANT_ID"]
    graph_base_url = _env("TEAMS_GRAPH_BASE_URL") or "https://graph.microsoft.com/v1.0"
    token_url = _env("TEAMS_TOKEN_URL") or (
        f"https://login.microsoftonline.com/{tenant_id}/oauth2/v2.0/token" if tenant_id else ""
    )
    timeout_seconds = _parse_float(_env("TEAMS_HTTP_TIMEOUT_SECONDS"), 20.0)

    team_id = _env("TEAMS_TEAM_ID")
    channel_id = _env("TEAMS_CHANNEL_ID")
    chat_id = _env("TEAMS_CHAT_ID")
    user_id = _env("TEAMS_USER_ID")
    meeting_subject = _env("TEAMS_MEETING_SUBJECT")
    start_time = _env("TEAMS_START_TIME")

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
        "team_ready": auth_ready,
        "channel_ready": auth_ready and bool(team_id),
        "meeting_ready": auth_ready and bool(user_id),
        "write_bridge_available": False,
        "scaffold_only": True,
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
            "configured": {key: bool(value) for key, value in env_values.items()},
            "missing_keys": missing_keys,
            "sources": auth_sources,
            "redacted": {key: _redact(value) for key, value in env_values.items()},
            "interactive_setup": list(CONNECTOR_AUTH["interactive_setup"]),
        },
        "runtime": runtime,
    }


def redacted_config_snapshot() -> dict[str, Any]:
    return runtime_config()


def config_snapshot() -> dict[str, Any]:
    return redacted_config_snapshot()
