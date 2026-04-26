from __future__ import annotations

import os
import subprocess
from functools import lru_cache
from pathlib import Path

from .constants import (
    CONNECTWISE_COMPANY_ID_ENV,
    CONNECTWISE_PRIVATE_KEY_ENV,
    CONNECTWISE_PUBLIC_KEY_ENV,
    CONNECTWISE_SITE_URL_ENV,
)


ARGENTOS_ROOT = Path(__file__).resolve().parents[6]
SERVICE_KEY_VARIABLES = {
    CONNECTWISE_COMPANY_ID_ENV,
    CONNECTWISE_PUBLIC_KEY_ENV,
    CONNECTWISE_PRIVATE_KEY_ENV,
    CONNECTWISE_SITE_URL_ENV,
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


def service_key_env(variable: str, default: str | None = None) -> str | None:
    if variable in SERVICE_KEY_VARIABLES:
        value = resolve_service_key(variable)
        if value:
            return value
    value = os.getenv(variable)
    if value is not None:
        return value
    return default
