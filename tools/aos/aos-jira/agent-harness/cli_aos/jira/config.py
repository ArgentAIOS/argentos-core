from __future__ import annotations

import os
from typing import Any

from .constants import (
    BACKEND_NAME,
    JIRA_API_TOKEN_ENV,
    JIRA_BASE_URL_ENV,
    JIRA_BOARD_ID_ENV,
    JIRA_EMAIL_ENV,
    JIRA_ISSUE_KEY_ENV,
    JIRA_PROJECT_KEY_ENV,
    JIRA_SPRINT_ID_ENV,
)


def _mask(value: str | None) -> str | None:
    if not value:
        return None
    if len(value) <= 8:
        return "*" * len(value)
    return f"{value[:4]}***{value[-4:]}"


def resolve_runtime_values(ctx_obj: dict[str, Any]) -> dict[str, Any]:
    base_url_env = ctx_obj.get("base_url_env") or JIRA_BASE_URL_ENV
    email_env = ctx_obj.get("email_env") or JIRA_EMAIL_ENV
    api_token_env = ctx_obj.get("api_token_env") or JIRA_API_TOKEN_ENV
    project_key_env = ctx_obj.get("project_key_env") or JIRA_PROJECT_KEY_ENV
    issue_key_env = ctx_obj.get("issue_key_env") or JIRA_ISSUE_KEY_ENV
    board_id_env = ctx_obj.get("board_id_env") or JIRA_BOARD_ID_ENV
    sprint_id_env = ctx_obj.get("sprint_id_env") or JIRA_SPRINT_ID_ENV

    base_url = (os.getenv(base_url_env) or "").strip()
    email = (os.getenv(email_env) or "").strip()
    api_token = (os.getenv(api_token_env) or "").strip()
    project_key = (os.getenv(project_key_env) or "").strip()
    issue_key = (os.getenv(issue_key_env) or "").strip()
    board_id = (os.getenv(board_id_env) or "").strip()
    sprint_id = (os.getenv(sprint_id_env) or "").strip()

    return {
        "backend": BACKEND_NAME,
        "base_url_env": base_url_env,
        "email_env": email_env,
        "api_token_env": api_token_env,
        "project_key_env": project_key_env,
        "issue_key_env": issue_key_env,
        "board_id_env": board_id_env,
        "sprint_id_env": sprint_id_env,
        "base_url": base_url,
        "email": email,
        "api_token": api_token,
        "project_key": project_key,
        "issue_key": issue_key,
        "board_id": board_id,
        "sprint_id": sprint_id,
        "base_url_present": bool(base_url),
        "email_present": bool(email),
        "api_token_present": bool(api_token),
        "project_key_present": bool(project_key),
        "issue_key_present": bool(issue_key),
        "board_id_present": bool(board_id),
        "sprint_id_present": bool(sprint_id),
        "auth_ready": bool(base_url and email and api_token),
    }


def config_snapshot(ctx_obj: dict[str, Any]) -> dict[str, Any]:
    runtime = resolve_runtime_values(ctx_obj)
    live_ready = runtime["auth_ready"]
    from .runtime import probe_runtime

    probe = probe_runtime(ctx_obj) if live_ready else {
        "ok": False,
        "code": "SKIPPED",
        "message": "Jira probe skipped until JIRA_BASE_URL, JIRA_EMAIL, and JIRA_API_TOKEN are configured",
        "details": {"skipped": True},
    }
    missing = []
    if not runtime["base_url_present"]:
        missing.append(runtime["base_url_env"])
    if not runtime["email_present"]:
        missing.append(runtime["email_env"])
    if not runtime["api_token_present"]:
        missing.append(runtime["api_token_env"])
    return {
        "summary": "Jira connector configuration snapshot.",
        "backend": BACKEND_NAME,
        "runtime": {
            "implementation_mode": "live_read_write",
            "live_read_available": runtime["auth_ready"],
            "write_bridge_available": runtime["auth_ready"],
            "probe": probe,
        },
        "auth": {
            "base_url_env": runtime["base_url_env"],
            "base_url_present": runtime["base_url_present"],
            "base_url": runtime["base_url"] or None,
            "email_env": runtime["email_env"],
            "email_present": runtime["email_present"],
            "api_token_env": runtime["api_token_env"],
            "api_token_present": runtime["api_token_present"],
            "api_token_preview": _mask(runtime["api_token"]),
            "missing_keys": missing,
        },
        "scope": {
            "workerFields": ["project_key", "issue_key", "assignee", "status", "sprint_id"],
            "project_key": runtime["project_key"] or None,
            "issue_key": runtime["issue_key"] or None,
            "board_id": runtime["board_id"] or None,
            "sprint_id": runtime["sprint_id"] or None,
        },
        "read_support": {
            "project.list": True,
            "project.get": True,
            "issue.list": True,
            "issue.get": True,
            "board.list": True,
            "board.get": True,
            "sprint.list": True,
            "sprint.get": True,
            "sprint.issues": True,
            "search.jql": True,
        },
        "write_support": {
            "issue.create": True,
            "issue.update": True,
            "issue.transition": True,
            "issue.comment": True,
        },
    }
