from __future__ import annotations

import os
from .service_keys import service_key_env
from typing import Any

from .constants import (
    BACKEND_NAME,
    GITHUB_ISSUE_NUMBER_ENV,
    GITHUB_OWNER_ENV,
    GITHUB_PR_NUMBER_ENV,
    GITHUB_REPO_ENV,
    GITHUB_TOKEN_ENV,
)


def _mask(value: str | None) -> str | None:
    if not value:
        return None
    if len(value) <= 8:
        return "*" * len(value)
    return f"{value[:4]}***{value[-4:]}"


def resolve_runtime_values(ctx_obj: dict[str, Any]) -> dict[str, Any]:
    token_env = ctx_obj.get("token_env") or GITHUB_TOKEN_ENV
    owner_env = ctx_obj.get("owner_env") or GITHUB_OWNER_ENV
    repo_env = ctx_obj.get("repo_env") or GITHUB_REPO_ENV
    issue_number_env = ctx_obj.get("issue_number_env") or GITHUB_ISSUE_NUMBER_ENV
    pr_number_env = ctx_obj.get("pr_number_env") or GITHUB_PR_NUMBER_ENV

    token = (service_key_env(token_env) or "").strip()
    owner = (service_key_env(owner_env) or "").strip()
    repo = (service_key_env(repo_env) or "").strip()
    issue_number = (service_key_env(issue_number_env) or "").strip()
    pr_number = (service_key_env(pr_number_env) or "").strip()

    return {
        "backend": BACKEND_NAME,
        "token_env": token_env,
        "owner_env": owner_env,
        "repo_env": repo_env,
        "issue_number_env": issue_number_env,
        "pr_number_env": pr_number_env,
        "token": token,
        "owner": owner,
        "repo": repo,
        "issue_number": issue_number,
        "pr_number": pr_number,
        "token_present": bool(token),
        "owner_present": bool(owner),
        "repo_present": bool(repo),
        "issue_number_present": bool(issue_number),
        "pr_number_present": bool(pr_number),
    }


def config_snapshot(ctx_obj: dict[str, Any]) -> dict[str, Any]:
    runtime = resolve_runtime_values(ctx_obj)
    live_ready = runtime["token_present"]
    from .runtime import probe_runtime

    probe = probe_runtime(ctx_obj) if live_ready else {
        "ok": False,
        "code": "SKIPPED",
        "message": "GitHub probe skipped until GITHUB_TOKEN is configured",
        "details": {"skipped": True},
    }
    return {
        "summary": "GitHub connector configuration snapshot.",
        "backend": BACKEND_NAME,
        "runtime": {
            "implementation_mode": "live_read_write",
            "live_read_available": runtime["token_present"],
            "write_bridge_available": runtime["token_present"],
            "probe": probe,
        },
        "auth": {
            "token_env": runtime["token_env"],
            "token_present": runtime["token_present"],
            "token_preview": _mask(runtime["token"]),
        },
        "scope": {
            "workerFields": ["owner", "repo", "issue_number", "pr_number", "branch"],
            "owner": runtime["owner"] or None,
            "repo": runtime["repo"] or None,
            "issue_number": runtime["issue_number"] or None,
            "pr_number": runtime["pr_number"] or None,
        },
        "read_support": {
            "repo.list": True,
            "repo.get": True,
            "issue.list": True,
            "issue.get": True,
            "pr.list": True,
            "pr.get": True,
            "branch.list": True,
            "actions.list_runs": True,
            "release.list": True,
        },
        "write_support": {
            "issue.create": True,
            "issue.update": True,
            "issue.comment": True,
            "pr.create": True,
            "pr.merge": True,
            "pr.review": True,
            "branch.create": True,
            "actions.trigger": True,
            "release.create": True,
        },
    }
