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
}


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
    if ctx_obj:
        service_keys = ctx_obj.get("service_keys")
        if isinstance(service_keys, dict):
            value = service_keys.get(variable)
            if isinstance(value, str) and value.strip():
                return value.strip(), "operator_ctx"

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
