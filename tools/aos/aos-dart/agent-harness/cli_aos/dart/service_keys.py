from __future__ import annotations

import json
import os
from pathlib import Path
from typing import Any

DEFAULT_SERVICE_KEYS_PATH = Path(os.getenv("HOME", "/tmp")) / ".argentos" / "service-keys.json"
SERVICE_KEYS_PATH = Path(os.getenv("ARGENT_SERVICE_KEYS_PATH", str(DEFAULT_SERVICE_KEYS_PATH)))
SERVICE_KEY_VARIABLES = {
    "DART_API_KEY",
    "DART_BASE_URL",
    "DART_DARTBOARD_ID",
    "DART_TASK_ID",
    "DART_DOC_ID",
}
TOOL_SCOPE_KEYS = ("aos-dart", "dart")
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
    suffix = variable.removeprefix("DART_").lower()
    keys = [variable, variable.lower(), suffix]
    aliases = {
        "DART_API_KEY": ("api_key", "token", "key"),
        "DART_BASE_URL": ("base_url", "api_url", "url"),
        "DART_DARTBOARD_ID": ("dartboard_id", "dartboard"),
        "DART_TASK_ID": ("task_id", "task"),
        "DART_DOC_ID": ("doc_id", "doc"),
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


def _has_scoped_policy(entry: dict[str, Any]) -> bool:
    return (
        entry.get("denyAll") is True
        or bool(entry.get("allowedRoles"))
        or bool(entry.get("allowedAgents"))
        or bool(entry.get("allowedTeams"))
    )


def repo_service_key_details(variable: str) -> dict[str, Any] | None:
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
        if not value:
            return None
        if _has_scoped_policy(entry):
            return {
                "value": "",
                "present": True,
                "usable": False,
                "source": "repo-service-key-scoped",
                "variable": variable,
                "blocked": True,
                "reason": "scoped service keys must be injected by the operator runtime",
            }
        if value.startswith("enc:v1:"):
            return None
        return {
            "value": value,
            "present": True,
            "usable": True,
            "source": "repo-service-key",
            "variable": variable,
        }
    return None


def service_key_details(variable: str, ctx_obj: dict[str, Any] | None = None, default: str | None = None) -> dict[str, Any]:
    if variable in SERVICE_KEY_VARIABLES:
        value, source = _operator_service_key_value(ctx_obj, variable)
        if value:
            return {"value": value, "present": True, "usable": True, "source": source, "variable": variable}

        repo_detail = repo_service_key_details(variable)
        if repo_detail:
            return repo_detail

    value = _string_value(os.getenv(variable))
    if value:
        return {"value": value, "present": True, "usable": True, "source": "env_fallback", "variable": variable}

    fallback = _string_value(default)
    if fallback:
        return {"value": fallback, "present": False, "usable": True, "source": "default", "variable": variable}

    return {"value": "", "present": False, "usable": False, "source": "missing", "variable": variable}


def service_key_env(variable: str, default: str | None = None, ctx_obj: dict[str, Any] | None = None) -> str | None:
    value = service_key_details(variable, ctx_obj, default=default)["value"]
    return value or None


def service_key_source(variable: str, ctx_obj: dict[str, Any] | None = None) -> str | None:
    detail = service_key_details(variable, ctx_obj)
    return detail["source"] if detail["present"] else None
