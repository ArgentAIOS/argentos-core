from __future__ import annotations

import os
import json
from pathlib import Path
from typing import Any

DEFAULT_SERVICE_KEYS_PATH = Path(os.getenv("HOME", "/tmp")) / ".argentos" / "service-keys.json"
SERVICE_KEYS_PATH = Path(os.getenv("ARGENT_SERVICE_KEYS_PATH", str(DEFAULT_SERVICE_KEYS_PATH)))
SERVICE_KEY_VARIABLES = {
    "PAYPUNCH_API_KEY",
    "PAYPUNCH_API_BASE_URL",
    "PAYPUNCH_TENANT_ID",
    "PAYPUNCH_COMPANY_ID",
    "PAYPUNCH_EMPLOYEE_ID",
    "PAYPUNCH_TIMESHEET_ID",
    "PAYPUNCH_PAY_PERIOD",
}
TOOL_SCOPE_KEYS = ("aos-paypunch", "paypunch")
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
    suffix = variable.removeprefix("PAYPUNCH_").lower()
    keys = [variable, variable.lower(), suffix]
    aliases = {
        "PAYPUNCH_API_KEY": ("api_key", "token", "key"),
        "PAYPUNCH_API_BASE_URL": ("api_base_url", "base_url", "url"),
        "PAYPUNCH_TENANT_ID": ("tenant_id", "tenant"),
        "PAYPUNCH_COMPANY_ID": ("company_id", "company"),
        "PAYPUNCH_EMPLOYEE_ID": ("employee_id", "employee"),
        "PAYPUNCH_TIMESHEET_ID": ("timesheet_id", "timesheet"),
        "PAYPUNCH_PAY_PERIOD": ("pay_period", "period"),
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
