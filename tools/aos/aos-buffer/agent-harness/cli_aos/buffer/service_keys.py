from __future__ import annotations

import os
import subprocess
from functools import lru_cache
from pathlib import Path
from typing import Any

ARGENTOS_ROOT = Path(__file__).resolve().parents[6]
SERVICE_KEY_VARIABLES = {
    "BUFFER_API_KEY",
    "BUFFER_ACCESS_TOKEN",
    "BUFFER_ORGANIZATION_ID",
    "BUFFER_CHANNEL_ID",
    "BUFFER_PROFILE_ID",
    "BUFFER_POST_ID",
    "BUFFER_BASE_URL",
}

TOOL_SCOPE_KEYS = ("aos-buffer", "buffer")
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
    if variable in {"BUFFER_API_KEY", "BUFFER_ACCESS_TOKEN"}:
        keys.extend(["api_key", "access_token", "token"])
    elif variable == "BUFFER_BASE_URL":
        keys.extend(["base_url", "api_url", "url"])
    elif variable == "BUFFER_ORGANIZATION_ID":
        keys.extend(["organization_id", "org_id", "organization"])
    elif variable == "BUFFER_CHANNEL_ID":
        keys.extend(["channel_id", "channel"])
    elif variable == "BUFFER_PROFILE_ID":
        keys.extend(["profile_id", "profile"])
    elif variable == "BUFFER_POST_ID":
        keys.extend(["post_id", "post"])
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


def service_key_value(
    variable: str,
    *,
    ctx_obj: dict[str, Any] | None = None,
    default: str | None = None,
) -> tuple[str | None, str]:
    value, source = _operator_service_key_value(ctx_obj, variable)
    if value:
        return value, source

    if variable in SERVICE_KEY_VARIABLES:
        value = resolve_service_key(variable)
        if value:
            return value, "service_key"

    value = os.getenv(variable)
    if value is not None and value.strip():
        return value.strip(), "env_fallback"

    return default, "default" if default is not None else "missing"


def service_key_env(variable: str, default: str | None = None, *, ctx_obj: dict[str, Any] | None = None) -> str | None:
    return service_key_value(variable, ctx_obj=ctx_obj, default=default)[0]
