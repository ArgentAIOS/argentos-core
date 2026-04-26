from __future__ import annotations

import os
import re
import subprocess
from functools import lru_cache
from pathlib import Path
from typing import Any

from .constants import (
    DEFAULT_LINEAR_API_KEY_ENV,
    DEFAULT_LINEAR_API_URL,
    DEFAULT_LINEAR_TEAM_ID_ENV,
    DEFAULT_LINEAR_TEAM_KEY,
    DEFAULT_LINEAR_TEAM_KEY_ENV,
)

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
    if variable == DEFAULT_LINEAR_API_KEY_ENV:
        match = re.search(r"([A-Za-z0-9_\-]{20,})", value)
        if match:
            return match.group(1)
    return value or None


def runtime_config(ctx_obj: dict[str, Any] | None = None) -> dict[str, Any]:
    ctx_obj = ctx_obj or {}
    api_key = (
        (ctx_obj.get("api_key_override") or "").strip()
        or resolve_service_key(DEFAULT_LINEAR_API_KEY_ENV)
        or os.getenv(DEFAULT_LINEAR_API_KEY_ENV, "").strip()
        or ""
    )
    team_key = (
        (ctx_obj.get("team_key") or "").strip()
        or os.getenv(DEFAULT_LINEAR_TEAM_KEY_ENV, "").strip()
        or DEFAULT_LINEAR_TEAM_KEY
    )
    team_id = (
        (ctx_obj.get("team_id") or "").strip()
        or os.getenv(DEFAULT_LINEAR_TEAM_ID_ENV, "").strip()
        or ""
    )
    base_url = (
        (ctx_obj.get("base_url") or "").strip()
        or os.getenv("LINEAR_GRAPHQL_URL", "").strip()
        or DEFAULT_LINEAR_API_URL
    )
    return {
        "base_url": base_url.rstrip("/"),
        "api_key": api_key,
        "api_key_present": bool(api_key),
        "api_key_source": (
            "cli-override"
            if (ctx_obj.get("api_key_override") or "").strip()
            else "service-keys"
            if resolve_service_key(DEFAULT_LINEAR_API_KEY_ENV)
            else "process.env"
            if os.getenv(DEFAULT_LINEAR_API_KEY_ENV, "").strip()
            else None
        ),
        "team_key": team_key,
        "team_key_source": (
            "cli-override"
            if (ctx_obj.get("team_key") or "").strip()
            else "process.env"
            if os.getenv(DEFAULT_LINEAR_TEAM_KEY_ENV, "").strip()
            else "default"
        ),
        "team_id": team_id or None,
        "team_id_present": bool(team_id),
        "team_id_source": (
            "cli-override"
            if (ctx_obj.get("team_id") or "").strip()
            else "process.env"
            if os.getenv(DEFAULT_LINEAR_TEAM_ID_ENV, "").strip()
            else None
        ),
        "auth_ready": bool(api_key),
    }


def redacted_config_snapshot(ctx_obj: dict[str, Any] | None = None) -> dict[str, Any]:
    config = runtime_config(ctx_obj)
    return {
        "base_url": config["base_url"],
        "api_key_present": config["api_key_present"],
        "api_key_source": config["api_key_source"],
        "team_key": config["team_key"],
        "team_key_source": config["team_key_source"],
        "team_id_present": config["team_id_present"],
        "team_id_source": config["team_id_source"],
        "auth_ready": config["auth_ready"],
    }
