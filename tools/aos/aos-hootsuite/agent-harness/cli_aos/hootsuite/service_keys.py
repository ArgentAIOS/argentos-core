from __future__ import annotations

import os
import subprocess
from functools import lru_cache
from pathlib import Path
from typing import Any

ARGENTOS_ROOT = Path(__file__).resolve().parents[6]
SERVICE_KEY_VARIABLES = {
    "HOOTSUITE_ACCESS_TOKEN",
    "HOOTSUITE_BASE_URL",
    "HOOTSUITE_ORGANIZATION_ID",
    "HOOTSUITE_SOCIAL_PROFILE_ID",
    "HOOTSUITE_TEAM_ID",
    "HOOTSUITE_MESSAGE_ID",
}
TOOL_SCOPE_KEYS = ("aos-hootsuite", "hootsuite")
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
    keys = [variable, variable.lower()]
    if variable == "HOOTSUITE_ACCESS_TOKEN":
        keys.extend(["access_token", "token"])
    elif variable == "HOOTSUITE_BASE_URL":
        keys.extend(["base_url", "api_url", "url"])
    elif variable == "HOOTSUITE_ORGANIZATION_ID":
        keys.extend(["organization_id", "org_id", "organization"])
    elif variable == "HOOTSUITE_SOCIAL_PROFILE_ID":
        keys.extend(["social_profile_id", "profile_id", "social_profile"])
    elif variable == "HOOTSUITE_TEAM_ID":
        keys.extend(["team_id", "team"])
    elif variable == "HOOTSUITE_MESSAGE_ID":
        keys.extend(["message_id", "message"])
    return tuple(keys)


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


@lru_cache(maxsize=64)
def resolve_service_key(variable: str) -> str | None:
    command = [
        "node",
        "--import",
        "tsx",
        "-e",
        (
            "import { resolveServiceKey } from './src/infra/service-keys.ts';"
            f" process.stdout.write(resolveServiceKey('{variable}') || '');"
            " process.exit(0);"
        ),
    ]
    result = subprocess.run(
        command,
        cwd=ARGENTOS_ROOT,
        capture_output=True,
        text=True,
        timeout=20,
        check=False,
    )
    if result.returncode != 0:
        return None
    return result.stdout.strip() or None


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


def service_key_env(variable: str, default: str | None = None, ctx_obj: dict[str, Any] | None = None) -> str | None:
    details = service_key_details(variable, ctx_obj)
    if details["present"]:
        return details["value"]
    return default
