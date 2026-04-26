from __future__ import annotations

import os
from typing import Any

from .constants import (
    BACKEND_NAME,
    CALENDLY_API_KEY_ENV,
    CALENDLY_EVENT_TYPE_UUID_ENV,
    CALENDLY_EVENT_UUID_ENV,
)
from .service_keys import service_key_env


def _mask(value: str | None) -> str | None:
    if not value:
        return None
    if len(value) <= 8:
        return "*" * len(value)
    return f"{value[:4]}***{value[-4:]}"


def _env_value(variable: str, default: str | None = None) -> str | None:
    value = os.getenv(variable)
    if value is not None:
        return value
    return default


def resolve_runtime_values(ctx_obj: dict[str, Any]) -> dict[str, Any]:
    api_key_env = ctx_obj.get("api_key_env") or CALENDLY_API_KEY_ENV
    event_type_uuid_env = ctx_obj.get("event_type_uuid_env") or CALENDLY_EVENT_TYPE_UUID_ENV
    event_uuid_env = ctx_obj.get("event_uuid_env") or CALENDLY_EVENT_UUID_ENV

    api_key = (service_key_env(api_key_env) or "").strip()
    event_type_uuid = (_env_value(event_type_uuid_env) or "").strip()
    event_uuid = (_env_value(event_uuid_env) or "").strip()

    return {
        "backend": BACKEND_NAME,
        "api_key_env": api_key_env,
        "event_type_uuid_env": event_type_uuid_env,
        "event_uuid_env": event_uuid_env,
        "api_key": api_key,
        "event_type_uuid": event_type_uuid,
        "event_uuid": event_uuid,
        "api_key_present": bool(api_key),
        "event_type_uuid_present": bool(event_type_uuid),
        "event_uuid_present": bool(event_uuid),
    }


def config_snapshot(ctx_obj: dict[str, Any]) -> dict[str, Any]:
    runtime = resolve_runtime_values(ctx_obj)
    from .runtime import probe_runtime

    probe = probe_runtime(ctx_obj) if runtime["api_key_present"] else {
        "ok": False,
        "code": "SKIPPED",
        "message": "Calendly probe skipped until CALENDLY_API_KEY is configured",
        "details": {"skipped": True},
    }
    return {
        "summary": "Calendly connector configuration snapshot.",
        "backend": BACKEND_NAME,
        "runtime": {
            "implementation_mode": "live_read_with_partial_writes",
            "live_read_available": runtime["api_key_present"],
            "write_bridge_available": True,
            "scaffolded_commands": ["scheduling_links.create"],
            "probe": probe,
        },
        "auth": {
            "api_key_env": runtime["api_key_env"],
            "api_key_present": runtime["api_key_present"],
            "api_key_preview": _mask(runtime["api_key"]),
        },
        "scope": {
            "workerFields": ["event_type", "invitee_email", "start_time", "end_time"],
            "event_type_uuid": runtime["event_type_uuid"] or None,
            "event_uuid": runtime["event_uuid"] or None,
        },
        "read_support": {
            "events.list": True,
            "events.get": True,
            "event_types.list": True,
            "event_types.get": True,
            "invitees.list": True,
            "availability.get": True,
        },
        "write_support": {
            "events.cancel": "live",
            "scheduling_links.create": "scaffold_only",
        },
    }
