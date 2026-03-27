from __future__ import annotations

import os
from pathlib import Path
from typing import Any

from .constants import (
    BACKEND_NAME,
    CODERABBIT_API_KEY_ENV,
    CODERABBIT_BASE_URL_ENV,
    CODERABBIT_CONFIG_CONTENT_ENV,
    CODERABBIT_CONFIG_PATH_ENV,
    CODERABBIT_PR_NUMBER_ENV,
    CODERABBIT_REPO_ENV,
    CODERABBIT_REPORT_CURSOR_ENV,
    CODERABBIT_REPORT_END_DATE_ENV,
    CODERABBIT_REPORT_LIMIT_ENV,
    CODERABBIT_REPORT_PROMPT_ENV,
    CODERABBIT_REPORT_START_DATE_ENV,
    CODERABBIT_REPORT_TEMPLATE_ENV,
    CODERABBIT_REVIEW_ID_ENV,
    CODERABBIT_REVIEW_KIND_ENV,
    CODERABBIT_STATE_PATH_ENV,
    DEFAULT_BASE_URL,
    DEFAULT_CONFIG_FILENAME,
    DEFAULT_STATE_FILENAME,
)


def _mask(value: str | None) -> str | None:
    if not value:
        return None
    if len(value) <= 8:
        return "*" * len(value)
    return f"{value[:4]}***{value[-4:]}"


def _resolve_path(value: str | None, fallback_name: str) -> Path:
    resolved = (value or "").strip()
    if resolved:
        return Path(resolved).expanduser()
    return Path.cwd() / fallback_name


def _resolve_date_range(ctx_obj: dict[str, Any]) -> tuple[str, str]:
    end_date = (ctx_obj.get("report_end_date") or os.getenv(CODERABBIT_REPORT_END_DATE_ENV) or "").strip()
    start_date = (ctx_obj.get("report_start_date") or os.getenv(CODERABBIT_REPORT_START_DATE_ENV) or "").strip()
    if start_date and end_date:
        return start_date, end_date

    from datetime import UTC, date, timedelta

    today = date.today()
    default_end = today.isoformat()
    default_start = (today - timedelta(days=7)).isoformat()
    return start_date or default_start, end_date or default_end


def resolve_runtime_values(ctx_obj: dict[str, Any]) -> dict[str, Any]:
    api_key_env = ctx_obj.get("api_key_env") or CODERABBIT_API_KEY_ENV
    base_url_env = ctx_obj.get("base_url_env") or CODERABBIT_BASE_URL_ENV
    repo_env = ctx_obj.get("repo_env") or CODERABBIT_REPO_ENV
    pr_number_env = ctx_obj.get("pr_number_env") or CODERABBIT_PR_NUMBER_ENV
    review_id_env = ctx_obj.get("review_id_env") or CODERABBIT_REVIEW_ID_ENV
    config_path_env = ctx_obj.get("config_path_env") or CODERABBIT_CONFIG_PATH_ENV
    state_path_env = ctx_obj.get("state_path_env") or CODERABBIT_STATE_PATH_ENV
    report_limit_env = ctx_obj.get("report_limit_env") or CODERABBIT_REPORT_LIMIT_ENV
    report_cursor_env = ctx_obj.get("report_cursor_env") or CODERABBIT_REPORT_CURSOR_ENV
    report_template_env = ctx_obj.get("report_template_env") or CODERABBIT_REPORT_TEMPLATE_ENV
    report_prompt_env = ctx_obj.get("report_prompt_env") or CODERABBIT_REPORT_PROMPT_ENV
    review_kind_env = ctx_obj.get("review_kind_env") or CODERABBIT_REVIEW_KIND_ENV
    config_content_env = ctx_obj.get("config_content_env") or CODERABBIT_CONFIG_CONTENT_ENV

    api_key = (os.getenv(api_key_env) or "").strip()
    base_url = (os.getenv(base_url_env) or DEFAULT_BASE_URL).strip().rstrip("/")
    repo = (ctx_obj.get("repo") or os.getenv(repo_env) or "").strip()
    pr_number = (ctx_obj.get("pr_number") or os.getenv(pr_number_env) or "").strip()
    review_id = (ctx_obj.get("review_id") or os.getenv(review_id_env) or "").strip()
    config_path = _resolve_path(ctx_obj.get("config_path") or os.getenv(config_path_env), DEFAULT_CONFIG_FILENAME)
    state_path = _resolve_path(ctx_obj.get("state_path") or os.getenv(state_path_env), DEFAULT_STATE_FILENAME)
    report_start_date, report_end_date = _resolve_date_range(ctx_obj)
    report_limit_raw = ctx_obj.get("report_limit") or os.getenv(report_limit_env) or "1000"
    report_cursor = (ctx_obj.get("report_cursor") or os.getenv(report_cursor_env) or "").strip()
    report_template = (ctx_obj.get("report_template") or os.getenv(report_template_env) or "").strip()
    report_prompt = (ctx_obj.get("report_prompt") or os.getenv(report_prompt_env) or "").strip()
    review_kind = (ctx_obj.get("review_kind") or os.getenv(review_kind_env) or "incremental").strip()
    config_content = (ctx_obj.get("config_content") or os.getenv(config_content_env) or "").strip()

    try:
        report_limit = max(1, int(str(report_limit_raw)))
    except ValueError:
        report_limit = 1000

    return {
        "backend": BACKEND_NAME,
        "api_key_env": api_key_env,
        "base_url_env": base_url_env,
        "repo_env": repo_env,
        "pr_number_env": pr_number_env,
        "review_id_env": review_id_env,
        "config_path_env": config_path_env,
        "state_path_env": state_path_env,
        "report_limit_env": report_limit_env,
        "report_cursor_env": report_cursor_env,
        "report_template_env": report_template_env,
        "report_prompt_env": report_prompt_env,
        "review_kind_env": review_kind_env,
        "config_content_env": config_content_env,
        "api_key": api_key,
        "base_url": base_url,
        "repo": repo,
        "pr_number": pr_number,
        "review_id": review_id,
        "config_path": config_path,
        "state_path": state_path,
        "report_start_date": report_start_date,
        "report_end_date": report_end_date,
        "report_limit": report_limit,
        "report_cursor": report_cursor,
        "report_template": report_template,
        "report_prompt": report_prompt,
        "review_kind": review_kind,
        "config_content": config_content,
        "api_key_present": bool(api_key),
        "repo_present": bool(repo),
        "pr_number_present": bool(pr_number),
        "review_id_present": bool(review_id),
        "config_path_present": bool(str(config_path)),
        "state_path_present": bool(str(state_path)),
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
            "repo": runtime["repo"] or None,
            "pr_number": runtime["pr_number"] or None,
            "review_id": runtime["review_id"] or None,
            "config_path": str(runtime["config_path"]),
            "state_path": str(runtime["state_path"]),
        },
        "runtime": {
            "implementation_mode": "hybrid_live_read_bridge",
            "runtime_ready": bool(probe["ok"]) if probe else runtime["runtime_ready"],
        },
        "probe": probe,
    }
