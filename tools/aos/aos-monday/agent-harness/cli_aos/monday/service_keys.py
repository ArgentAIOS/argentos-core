from __future__ import annotations

import os
import subprocess
from functools import lru_cache
from pathlib import Path
from typing import Any

ARGENTOS_ROOT = Path(__file__).resolve().parents[6]
SERVICE_KEY_VARIABLES = {
    "MONDAY_TOKEN",
    "MONDAY_API_VERSION",
    "MONDAY_API_URL",
}


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


def _operator_value(ctx_obj: dict[str, Any] | None, variable: str) -> tuple[str, str]:
    ctx_obj = ctx_obj or {}
    variable_key = variable.lower()

    for field_name in ("service_keys", "service_key_values", "api_keys", "secrets"):
        container = ctx_obj.get(field_name)
        value = _mapping_value(container, variable, variable_key)
        if value:
            return value, f"operator:{field_name}"

        tool_scoped = None
        if isinstance(container, dict):
            tool_scoped = container.get("aos-monday") or container.get("monday")
        value = _mapping_value(tool_scoped, variable, variable_key, "token", "api_version", "api_url")
        if value:
            return value, f"operator:{field_name}:tool"

    value = _mapping_value(ctx_obj, variable, variable_key, "token", "api_version", "api_url")
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


def resolve_value(ctx_obj: dict[str, Any] | None, variable: str, default: str | None = None) -> dict[str, Any]:
    operator_value, operator_source = _operator_value(ctx_obj, variable)
    if operator_value:
        return {
            "value": operator_value,
            "present": True,
            "source": operator_source,
            "variable": variable,
        }

    if variable in SERVICE_KEY_VARIABLES:
        store_value = resolve_service_key(variable)
        if store_value:
            return {
                "value": store_value,
                "present": True,
                "source": "service-keys",
                "variable": variable,
            }

    env_value = os.getenv(variable)
    if env_value is not None:
        return {
            "value": env_value,
            "present": bool(env_value.strip()),
            "source": "process.env",
            "variable": variable,
        }

    return {
        "value": default,
        "present": bool(default and default.strip()),
        "source": "default" if default is not None else "missing",
        "variable": variable,
    }


def service_key_env(variable: str, default: str | None = None) -> str | None:
    return resolve_value({}, variable, default).get("value")


def service_key_source(ctx_obj: dict[str, Any] | None, variable: str, default: str | None = None) -> str:
    return str(resolve_value(ctx_obj, variable, default).get("source") or "missing")
