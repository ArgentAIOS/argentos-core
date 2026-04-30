from __future__ import annotations

import os
import subprocess
from functools import lru_cache
from pathlib import Path
from typing import Any

ARGENTOS_ROOT = Path(__file__).resolve().parents[6]
SERVICE_KEY_VARIABLES = {
    "HOLACE_API_KEY",
    "HOLACE_API_BASE_URL",
    "HOLACE_ATTORNEY_ID",
    "HOLACE_CASE_ID",
    "HOLACE_CLIENT_ID",
    "HOLACE_DOCUMENT_ID",
    "HOLACE_SETTLEMENT_ID",
    "HOLACE_CASE_TYPE",
    "HOLACE_STATUTE_STATE",
}
TOOL_SCOPE_KEYS = ("aos-holace", "holace")
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
    suffix = variable.removeprefix("HOLACE_").lower()
    keys = [variable, variable.lower(), suffix]
    aliases = {
        "HOLACE_API_KEY": ("api_key", "token", "key"),
        "HOLACE_API_BASE_URL": ("api_base_url", "base_url", "url"),
        "HOLACE_ATTORNEY_ID": ("attorney_id", "attorney"),
        "HOLACE_CASE_ID": ("case_id", "case"),
        "HOLACE_CLIENT_ID": ("client_id", "client"),
        "HOLACE_DOCUMENT_ID": ("document_id", "document"),
        "HOLACE_SETTLEMENT_ID": ("settlement_id", "settlement"),
        "HOLACE_CASE_TYPE": ("case_type",),
        "HOLACE_STATUTE_STATE": ("statute_state", "state"),
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
