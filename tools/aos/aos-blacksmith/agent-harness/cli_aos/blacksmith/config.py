from __future__ import annotations

import os
from typing import Any

from .constants import (
    BACKEND_NAME,
    BLACKSMITH_API_BASE_URL_ENV,
    BLACKSMITH_API_KEY_ENV,
    BLACKSMITH_DATE_RANGE_ENV,
    BLACKSMITH_REPO_ENV,
    BLACKSMITH_RUN_ID_ENV,
    BLACKSMITH_WORKFLOW_NAME_ENV,
    DEFAULT_API_BASE_URL,
)


def _mask(value: str | None) -> str | None:
    if not value:
        return None
    if len(value) <= 8:
        return "*" * len(value)
    return f"{value[:4]}***{value[-4:]}"


def resolve_runtime_values(ctx_obj: dict[str, Any]) -> dict[str, Any]:
    api_key_env = ctx_obj.get("api_key_env") or BLACKSMITH_API_KEY_ENV
    base_url_env = ctx_obj.get("base_url_env") or BLACKSMITH_API_BASE_URL_ENV
    repo_env = ctx_obj.get("repo_env") or BLACKSMITH_REPO_ENV
    run_id_env = ctx_obj.get("run_id_env") or BLACKSMITH_RUN_ID_ENV
    workflow_name_env = ctx_obj.get("workflow_name_env") or BLACKSMITH_WORKFLOW_NAME_ENV
    date_range_env = ctx_obj.get("date_range_env") or BLACKSMITH_DATE_RANGE_ENV

    api_key = (os.getenv(api_key_env) or "").strip()
    base_url = (os.getenv(base_url_env) or DEFAULT_API_BASE_URL).strip().rstrip("/")
    repo = (ctx_obj.get("repo") or os.getenv(repo_env) or "").strip()
    run_id = (ctx_obj.get("run_id") or os.getenv(run_id_env) or "").strip()
    workflow_name = (ctx_obj.get("workflow_name") or os.getenv(workflow_name_env) or "").strip()
    date_range = (ctx_obj.get("date_range") or os.getenv(date_range_env) or "").strip()

    return {
        "backend": BACKEND_NAME,
        "api_key_env": api_key_env,
        "base_url_env": base_url_env,
        "repo_env": repo_env,
        "run_id_env": run_id_env,
        "workflow_name_env": workflow_name_env,
        "date_range_env": date_range_env,
        "api_key": api_key,
        "base_url": base_url,
        "repo": repo,
        "run_id": run_id,
        "workflow_name": workflow_name,
        "date_range": date_range,
        "api_key_present": bool(api_key),
        "runtime_ready": bool(api_key),
    }


def config_snapshot(ctx_obj: dict[str, Any], *, probe: dict[str, Any] | None = None) -> dict[str, Any]:
    runtime = resolve_runtime_values(ctx_obj)
    return {
        "backend": BACKEND_NAME,
        "auth": {
            "api_key_env": runtime["api_key_env"],
            "api_key_present": runtime["api_key_present"],
            "api_key_masked": _mask(runtime["api_key"]),
        },
        "scope": {
            "base_url": runtime["base_url"],
            "repo": runtime["repo"] or None,
            "run_id": runtime["run_id"] or None,
            "workflow_name": runtime["workflow_name"] or None,
            "date_range": runtime["date_range"] or None,
        },
        "runtime": {
            "implementation_mode": "scaffold_only_live_read",
            "runtime_ready": bool(probe["ok"]) if probe else runtime["runtime_ready"],
        },
        "probe": probe,
    }
