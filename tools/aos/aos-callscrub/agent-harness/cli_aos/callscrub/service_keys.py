from __future__ import annotations

import os
import json
from pathlib import Path
from typing import Any

DEFAULT_SERVICE_KEYS_PATH = Path(os.getenv("HOME", "/tmp")) / ".argentos" / "service-keys.json"
SERVICE_KEYS_PATH = Path(os.getenv("ARGENT_SERVICE_KEYS_PATH", str(DEFAULT_SERVICE_KEYS_PATH)))
SERVICE_KEY_VARIABLES = {
    "CALLSCRUB_API_KEY",
    "CALLSCRUB_API_BASE_URL",
    "CALLSCRUB_TEAM_ID",
    "CALLSCRUB_AGENT_NAME",
    "CALLSCRUB_CALL_ID",
    "CALLSCRUB_COACHING_ID",
    "CALLSCRUB_DATE_RANGE",
    "CALLSCRUB_SEARCH_QUERY",
    "CALLSCRUB_REPORT_TYPE",
}
TOOL_SCOPE_KEYS = ("aos-callscrub", "callscrub")
SERVICE_KEY_CONTEXT_FIELDS = ("service_keys", "service_key_values", "api_keys", "secrets")


def _string_value(value: Any) -> str:
    return value.strip() if isinstance(value, str) else ""


def _mapping_value(mapping: Any, *keys: str) -> str:
    if not isinstance(mapping, dict):
        return ""
    for key in keys:
        value = _string_value(mapping.get(key))
        if value:
            return value
    return ""


def _candidate_keys(variable: str) -> tuple[str, ...]:
    suffix = variable.removeprefix("CALLSCRUB_").lower()
    keys = [variable, variable.lower(), suffix]
    aliases = {
        "CALLSCRUB_API_KEY": ("api_key", "token", "key"),
        "CALLSCRUB_API_BASE_URL": ("api_base_url", "base_url", "url"),
        "CALLSCRUB_TEAM_ID": ("team_id", "team"),
        "CALLSCRUB_AGENT_NAME": ("agent_name", "agent"),
        "CALLSCRUB_CALL_ID": ("call_id", "call"),
        "CALLSCRUB_COACHING_ID": ("coaching_id", "coaching"),
        "CALLSCRUB_DATE_RANGE": ("date_range",),
        "CALLSCRUB_SEARCH_QUERY": ("search_query", "query"),
        "CALLSCRUB_REPORT_TYPE": ("report_type",),
    }
    keys.extend(aliases.get(variable, ()))
    return tuple(dict.fromkeys(keys))


def _operator_service_key_value(ctx_obj: dict[str, Any] | None, variable: str) -> tuple[str, str]:
    if not isinstance(ctx_obj, dict):
        return "", "missing"

    candidate_keys = _candidate_keys(variable)
    for field_name in SERVICE_KEY_CONTEXT_FIELDS:
        container = ctx_obj.get(field_name)
        value = _mapping_value(container, *candidate_keys)
        if value:
            return value, f"operator:{field_name}"
        if isinstance(container, dict):
            for tool_scope_key in TOOL_SCOPE_KEYS:
                value = _mapping_value(container.get(tool_scope_key), *candidate_keys)
                if value:
                    return value, f"operator:{field_name}:tool"

    value = _mapping_value(ctx_obj, *candidate_keys)
    if value:
        return value, "operator:context"
    return "", "missing"


def resolve_service_key(variable: str) -> str | None:
    try:
        payload = json.loads(SERVICE_KEYS_PATH.read_text())
    except (OSError, json.JSONDecodeError):
        return None
    keys = payload.get("keys")
    if not isinstance(keys, list):
        return None
    for entry in keys:
        if not isinstance(entry, dict):
            continue
        if entry.get("variable") != variable or entry.get("enabled") is False:
            continue
        value = _string_value(entry.get("value"))
        if not value or value.startswith("enc:v1:"):
            return None
        return value
    return None


def service_key_details(variable: str, ctx_obj: dict[str, Any] | None = None) -> dict[str, Any]:
    if variable in SERVICE_KEY_VARIABLES:
        value, source = _operator_service_key_value(ctx_obj, variable)
        if value:
            return {"value": value, "present": True, "source": source, "variable": variable}

        value = resolve_service_key(variable)
        if value:
            return {"value": value, "present": True, "source": "repo-service-key", "variable": variable}

    value = _string_value(os.getenv(variable))
    if value:
        return {"value": value, "present": True, "source": "env_fallback", "variable": variable}

    return {"value": "", "present": False, "source": "missing", "variable": variable}
