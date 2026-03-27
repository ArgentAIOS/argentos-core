from __future__ import annotations

import json
import os
import re
import subprocess
from functools import lru_cache
from pathlib import Path

from .constants import DEFAULT_GOOGLE_PLACES_API_KEY_ENV, DEFAULT_GOOGLE_PLACES_BASE_URL

ARGENTOS_ROOT = Path(__file__).resolve().parents[6]


@lru_cache(maxsize=8)
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
    value = result.stdout.strip()
    if variable == DEFAULT_GOOGLE_PLACES_API_KEY_ENV:
        match = re.search(r"(AIza[0-9A-Za-z_-]{35})", value)
        if match:
            return match.group(1)
    return value or None


def runtime_config(ctx_obj: dict | None = None) -> dict[str, object]:
    api_key = (
        (ctx_obj or {}).get("api_key_override", "")
        or os.getenv(DEFAULT_GOOGLE_PLACES_API_KEY_ENV, "")
        or resolve_service_key(DEFAULT_GOOGLE_PLACES_API_KEY_ENV)
        or ""
    )
    return {
        "base_url": ((ctx_obj or {}).get("base_url") or os.getenv("GOOGLE_PLACES_BASE_URL") or DEFAULT_GOOGLE_PLACES_BASE_URL).rstrip("/"),
        "api_key": api_key,
        "api_key_present": bool(api_key),
        "api_key_source": (
            "cli-override"
            if (ctx_obj or {}).get("api_key_override")
            else "process.env"
            if os.getenv(DEFAULT_GOOGLE_PLACES_API_KEY_ENV)
            else "service-keys"
            if api_key
            else None
        ),
    }


def redacted_config_snapshot(ctx_obj: dict | None = None) -> dict[str, object]:
    config = runtime_config(ctx_obj)
    return {
        "base_url": config["base_url"],
        "api_key_present": config["api_key_present"],
        "api_key_source": config["api_key_source"],
    }
