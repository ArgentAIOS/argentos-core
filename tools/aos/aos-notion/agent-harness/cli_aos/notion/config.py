from __future__ import annotations

import os
from typing import Any

from .constants import DEFAULT_NOTION_VERSION, NOTION_TOKEN_ENV, NOTION_VERSION_ENV, NOTION_WORKSPACE_ENV


def _present(value: str | None) -> bool:
    return bool(value and value.strip())


def _redact(value: str | None) -> str | None:
    if value is None:
        return None
    stripped = value.strip()
    if not stripped:
        return None
    if len(stripped) <= 6:
        return "***"
    return f"{stripped[:3]}...{stripped[-3:]}"


def resolve_runtime_values(ctx_obj: dict[str, Any]) -> dict[str, Any]:
    token_env = ctx_obj.get("token_env") or NOTION_TOKEN_ENV
    version_env = ctx_obj.get("version_env") or NOTION_VERSION_ENV
    workspace_env = ctx_obj.get("workspace_env") or NOTION_WORKSPACE_ENV

    token = os.getenv(token_env)
    notion_version = os.getenv(version_env) or DEFAULT_NOTION_VERSION
    workspace_id = os.getenv(workspace_env)

    return {
        "backend": "notion-api",
        "token_env": token_env,
        "version_env": version_env,
        "workspace_env": workspace_env,
        "token": token,
        "token_present": _present(token),
        "token_redacted": _redact(token),
        "version": notion_version,
        "version_present": _present(os.getenv(version_env)),
        "workspace_id": workspace_id.strip() if workspace_id and workspace_id.strip() else None,
        "workspace_id_present": _present(workspace_id),
        "verbose": bool(ctx_obj.get("verbose")),
    }


def redacted_config_snapshot(ctx_obj: dict[str, Any]) -> dict[str, Any]:
    runtime = resolve_runtime_values(ctx_obj)
    return {
        "status": "ok",
        "summary": "Notion connector configuration snapshot.",
        "backend": "notion-api",
        "auth": {
            "token_env": runtime["token_env"],
            "token_present": runtime["token_present"],
            "token_redacted": runtime["token_redacted"],
            "version_env": runtime["version_env"],
            "version_present": runtime["version_present"],
            "workspace_env": runtime["workspace_env"],
            "workspace_id_present": runtime["workspace_id_present"],
        },
        "runtime": {
            "notion_version": runtime["version"],
            "workspace_id": runtime["workspace_id"],
            "runtime_ready": runtime["token_present"],
            "live_backend_available": runtime["token_present"],
            "live_read_available": runtime["token_present"],
            "write_bridge_available": False,
            "scaffold_only": False,
        },
    }
