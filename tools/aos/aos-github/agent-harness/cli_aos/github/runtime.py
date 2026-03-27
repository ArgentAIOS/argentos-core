from __future__ import annotations

import json
from typing import Any

from .client import GitHubApiError, GitHubClient
from .config import resolve_runtime_values
from .constants import BACKEND_NAME, CONNECTOR_PATH
from .errors import CliError


def _load_manifest() -> dict[str, Any]:
    return json.loads(CONNECTOR_PATH.read_text())


def capabilities_snapshot() -> dict[str, Any]:
    manifest = _load_manifest()
    return {
        "tool": manifest["tool"],
        "backend": manifest["backend"],
        "manifest_schema_version": manifest.get("manifest_schema_version", "1.0.0"),
        "connector": manifest["connector"],
        "auth": manifest["auth"],
        "scope": manifest.get("scope", {}),
        "commands": manifest["commands"],
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


def create_client(ctx_obj: dict[str, Any]) -> GitHubClient:
    runtime = resolve_runtime_values(ctx_obj)
    if not runtime["token_present"]:
        raise CliError(
            code="GITHUB_SETUP_REQUIRED",
            message="GitHub connector is missing the required token",
            exit_code=4,
            details={"missing_keys": [runtime["token_env"]]},
        )
    return GitHubClient(token=runtime["token"])


def probe_runtime(ctx_obj: dict[str, Any]) -> dict[str, Any]:
    runtime = resolve_runtime_values(ctx_obj)
    if not runtime["token_present"]:
        return {
            "ok": False,
            "code": "GITHUB_SETUP_REQUIRED",
            "message": "GitHub connector is missing the required token",
            "details": {"missing_keys": [runtime["token_env"]], "live_backend_available": False},
        }
    try:
        client = create_client(ctx_obj)
        # Probe by fetching authenticated user
        user = client._request("GET", "/user")
    except CliError as err:
        return {"ok": False, "code": err.code, "message": err.message, "details": err.details}
    except GitHubApiError as err:
        code = "GITHUB_AUTH_FAILED" if err.status_code in {401, 403} else "GITHUB_API_ERROR"
        return {
            "ok": False,
            "code": code,
            "message": err.message,
            "details": {
                **(err.details or {}),
                "status_code": err.status_code,
                "live_backend_available": False,
            },
        }
    return {
        "ok": True,
        "code": "OK",
        "message": "GitHub live runtime is ready",
        "details": {
            "live_backend_available": True,
            "user": user.get("login") if isinstance(user, dict) else None,
        },
    }


def health_snapshot(ctx_obj: dict[str, Any]) -> dict[str, Any]:
    runtime = resolve_runtime_values(ctx_obj)
    probe = probe_runtime(ctx_obj)
    status = "ready" if probe["ok"] else ("needs_setup" if probe["code"] == "GITHUB_SETUP_REQUIRED" else "degraded")
    return {
        "status": status,
        "summary": probe["message"],
        "connector": {
            "backend": BACKEND_NAME,
            "live_backend_available": bool(probe.get("ok")),
            "live_read_available": bool(probe.get("ok")),
            "write_bridge_available": bool(probe.get("ok")),
            "scaffold_only": False,
        },
        "auth": {
            "token_env": runtime["token_env"],
            "token_present": runtime["token_present"],
        },
        "scope": {
            "owner": runtime["owner"] or None,
            "repo": runtime["repo"] or None,
            "issue_number": runtime["issue_number"] or None,
            "pr_number": runtime["pr_number"] or None,
        },
        "checks": [
            {
                "name": "required_env",
                "ok": runtime["token_present"],
                "details": {"missing_keys": [] if runtime["token_present"] else [runtime["token_env"]]},
            },
            {"name": "live_backend", "ok": bool(probe.get("ok")), "details": probe.get("details", {})},
        ],
        "runtime_ready": bool(probe.get("ok")),
        "live_backend_available": bool(probe.get("ok")),
        "live_read_available": bool(probe.get("ok")),
        "write_bridge_available": bool(probe.get("ok")),
        "scaffold_only": False,
        "probe": probe,
        "next_steps": [
            f"Set {runtime['token_env']} with a personal access token.",
            "Set GITHUB_OWNER and GITHUB_REPO to pin repository scope.",
            "Optionally set GITHUB_ISSUE_NUMBER and GITHUB_PR_NUMBER for issue/PR-scoped flows.",
        ],
    }


def doctor_snapshot(ctx_obj: dict[str, Any]) -> dict[str, Any]:
    runtime = resolve_runtime_values(ctx_obj)
    probe = probe_runtime(ctx_obj)
    live = bool(probe.get("ok"))
    return {
        "status": "ready" if live else ("needs_setup" if probe.get("code") == "GITHUB_SETUP_REQUIRED" else "degraded"),
        "summary": "GitHub connector diagnostics.",
        "runtime": {
            "implementation_mode": "live_read_write",
            "command_readiness": {
                "repo.list": live,
                "repo.get": live,
                "issue.list": live,
                "issue.get": live,
                "issue.create": live,
                "issue.update": live,
                "issue.comment": live,
                "pr.list": live,
                "pr.get": live,
                "pr.create": live,
                "pr.merge": live,
                "pr.review": live,
                "branch.list": live,
                "branch.create": live,
                "actions.list_runs": live,
                "actions.trigger": live,
                "release.list": live,
                "release.create": live,
            },
            "owner_present": runtime["owner_present"],
            "repo_present": runtime["repo_present"],
            "issue_number_present": runtime["issue_number_present"],
            "pr_number_present": runtime["pr_number_present"],
        },
        "checks": [
            {"name": "required_env", "ok": runtime["token_present"]},
            {"name": "live_backend", "ok": live, "details": probe.get("details", {})},
        ],
        "supported_read_commands": [
            "repo.list", "repo.get",
            "issue.list", "issue.get",
            "pr.list", "pr.get",
            "branch.list",
            "actions.list_runs",
            "release.list",
        ],
        "supported_write_commands": [
            "issue.create", "issue.update", "issue.comment",
            "pr.create", "pr.merge", "pr.review",
            "branch.create",
            "actions.trigger",
            "release.create",
        ],
        "next_steps": [
            f"Set {runtime['token_env']} with a personal access token.",
            "Set GITHUB_OWNER and GITHUB_REPO to scope commands to a default repository.",
        ],
    }


def _picker(items: list[dict[str, Any]], *, kind: str, label_key: str = "label") -> dict[str, Any]:
    return {"kind": kind, "items": items, "count": len(items), "label_key": label_key}


def _require_arg(value: str | None, *, code: str, message: str, detail_key: str, detail_value: str) -> str:
    resolved = (value or "").strip()
    if resolved:
        return resolved
    raise CliError(code=code, message=message, exit_code=4, details={detail_key: detail_value})


def _resolve_owner_repo(ctx_obj: dict[str, Any], owner: str | None, repo: str | None) -> tuple[str, str]:
    runtime = resolve_runtime_values(ctx_obj)
    resolved_owner = _require_arg(
        owner or runtime["owner"],
        code="GITHUB_OWNER_REQUIRED",
        message="Owner/org is required",
        detail_key="env",
        detail_value=runtime["owner_env"],
    )
    resolved_repo = _require_arg(
        repo or runtime["repo"],
        code="GITHUB_REPO_REQUIRED",
        message="Repository name is required",
        detail_key="env",
        detail_value=runtime["repo_env"],
    )
    return resolved_owner, resolved_repo


# --- Repo commands ---

def repo_list_result(ctx_obj: dict[str, Any], owner: str | None, *, limit: int) -> dict[str, Any]:
    runtime = resolve_runtime_values(ctx_obj)
    resolved_owner = (owner or runtime["owner"] or "").strip() or None
    client = create_client(ctx_obj)
    payload = client.list_repos(owner=resolved_owner, limit=limit)
    repos = payload.get("repos", [])
    items = [
        {
            "id": str(item.get("full_name") or item.get("id") or ""),
            "label": str(item.get("full_name") or item.get("name") or "Repo"),
            "subtitle": item.get("description") or item.get("language") or None,
            "kind": "repo",
        }
        for item in repos
        if isinstance(item, dict)
    ]
    return {
        "status": "live_read",
        "backend": BACKEND_NAME,
        "summary": f"Returned {len(repos)} repo{'s' if len(repos) != 1 else ''}.",
        "repos": repos,
        "repo_count": len(repos),
        "picker": _picker(items, kind="repo"),
        "scope_preview": {
            "selection_surface": "repo",
            "command_id": "repo.list",
            "owner": resolved_owner,
        },
    }


def repo_get_result(ctx_obj: dict[str, Any], owner: str | None, repo: str | None) -> dict[str, Any]:
    resolved_owner, resolved_repo = _resolve_owner_repo(ctx_obj, owner, repo)
    client = create_client(ctx_obj)
    repo_record = client.get_repo(resolved_owner, resolved_repo)
    return {
        "status": "live_read",
        "backend": BACKEND_NAME,
        "summary": f"Read repo {resolved_owner}/{resolved_repo}.",
        "repo": repo_record,
        "scope_preview": {
            "selection_surface": "repo",
            "command_id": "repo.get",
            "owner": resolved_owner,
            "repo": resolved_repo,
        },
    }


# --- Issue commands ---

def issue_list_result(ctx_obj: dict[str, Any], owner: str | None, repo: str | None, *, limit: int, state: str) -> dict[str, Any]:
    resolved_owner, resolved_repo = _resolve_owner_repo(ctx_obj, owner, repo)
    client = create_client(ctx_obj)
    payload = client.list_issues(resolved_owner, resolved_repo, limit=limit, state=state)
    issues = payload.get("issues", [])
    items = [
        {
            "id": str(item.get("number") or ""),
            "label": f"#{item.get('number')} {item.get('title') or ''}".strip(),
            "subtitle": item.get("state") or None,
            "kind": "issue",
        }
        for item in issues
        if isinstance(item, dict)
    ]
    return {
        "status": "live_read",
        "backend": BACKEND_NAME,
        "summary": f"Returned {len(issues)} issue{'s' if len(issues) != 1 else ''}.",
        "issues": issues,
        "issue_count": len(issues),
        "picker": _picker(items, kind="issue"),
        "scope_preview": {
            "selection_surface": "issue",
            "command_id": "issue.list",
            "owner": resolved_owner,
            "repo": resolved_repo,
        },
    }


def issue_get_result(ctx_obj: dict[str, Any], owner: str | None, repo: str | None, number: int | None) -> dict[str, Any]:
    runtime = resolve_runtime_values(ctx_obj)
    resolved_owner, resolved_repo = _resolve_owner_repo(ctx_obj, owner, repo)
    resolved_number = int(_require_arg(
        str(number) if number else runtime["issue_number"],
        code="GITHUB_ISSUE_REQUIRED",
        message="Issue number is required",
        detail_key="env",
        detail_value=runtime["issue_number_env"],
    ))
    client = create_client(ctx_obj)
    issue = client.get_issue(resolved_owner, resolved_repo, resolved_number)
    return {
        "status": "live_read",
        "backend": BACKEND_NAME,
        "summary": f"Read issue #{resolved_number} in {resolved_owner}/{resolved_repo}.",
        "issue": issue,
        "scope_preview": {
            "selection_surface": "issue",
            "command_id": "issue.get",
            "owner": resolved_owner,
            "repo": resolved_repo,
            "issue_number": resolved_number,
        },
    }


def issue_create_result(ctx_obj: dict[str, Any], owner: str | None, repo: str | None, *, title: str, body: str | None) -> dict[str, Any]:
    resolved_owner, resolved_repo = _resolve_owner_repo(ctx_obj, owner, repo)
    client = create_client(ctx_obj)
    issue = client.create_issue(resolved_owner, resolved_repo, title=title, body=body)
    return {
        "status": "live_write",
        "backend": BACKEND_NAME,
        "summary": f"Created issue #{issue.get('number')} in {resolved_owner}/{resolved_repo}.",
        "issue": issue,
        "scope_preview": {
            "selection_surface": "issue",
            "command_id": "issue.create",
            "owner": resolved_owner,
            "repo": resolved_repo,
        },
    }


def issue_update_result(ctx_obj: dict[str, Any], owner: str | None, repo: str | None, number: int, *, title: str | None, body: str | None, state: str | None) -> dict[str, Any]:
    resolved_owner, resolved_repo = _resolve_owner_repo(ctx_obj, owner, repo)
    client = create_client(ctx_obj)
    issue = client.update_issue(resolved_owner, resolved_repo, number, title=title, body=body, state=state)
    return {
        "status": "live_write",
        "backend": BACKEND_NAME,
        "summary": f"Updated issue #{number} in {resolved_owner}/{resolved_repo}.",
        "issue": issue,
        "scope_preview": {
            "selection_surface": "issue",
            "command_id": "issue.update",
            "owner": resolved_owner,
            "repo": resolved_repo,
            "issue_number": number,
        },
    }


def issue_comment_result(ctx_obj: dict[str, Any], owner: str | None, repo: str | None, number: int, *, body: str) -> dict[str, Any]:
    resolved_owner, resolved_repo = _resolve_owner_repo(ctx_obj, owner, repo)
    client = create_client(ctx_obj)
    comment = client.comment_issue(resolved_owner, resolved_repo, number, body=body)
    return {
        "status": "live_write",
        "backend": BACKEND_NAME,
        "summary": f"Commented on issue #{number} in {resolved_owner}/{resolved_repo}.",
        "comment": comment,
        "scope_preview": {
            "selection_surface": "issue",
            "command_id": "issue.comment",
            "owner": resolved_owner,
            "repo": resolved_repo,
            "issue_number": number,
        },
    }


# --- PR commands ---

def pr_list_result(ctx_obj: dict[str, Any], owner: str | None, repo: str | None, *, limit: int, state: str) -> dict[str, Any]:
    resolved_owner, resolved_repo = _resolve_owner_repo(ctx_obj, owner, repo)
    client = create_client(ctx_obj)
    payload = client.list_prs(resolved_owner, resolved_repo, limit=limit, state=state)
    prs = payload.get("prs", [])
    items = [
        {
            "id": str(item.get("number") or ""),
            "label": f"#{item.get('number')} {item.get('title') or ''}".strip(),
            "subtitle": f"{item.get('head_branch')} -> {item.get('base_branch')}" if item.get("head_branch") else None,
            "kind": "pr",
        }
        for item in prs
        if isinstance(item, dict)
    ]
    return {
        "status": "live_read",
        "backend": BACKEND_NAME,
        "summary": f"Returned {len(prs)} PR{'s' if len(prs) != 1 else ''}.",
        "prs": prs,
        "pr_count": len(prs),
        "picker": _picker(items, kind="pr"),
        "scope_preview": {
            "selection_surface": "pr",
            "command_id": "pr.list",
            "owner": resolved_owner,
            "repo": resolved_repo,
        },
    }


def pr_get_result(ctx_obj: dict[str, Any], owner: str | None, repo: str | None, number: int | None) -> dict[str, Any]:
    runtime = resolve_runtime_values(ctx_obj)
    resolved_owner, resolved_repo = _resolve_owner_repo(ctx_obj, owner, repo)
    resolved_number = int(_require_arg(
        str(number) if number else runtime["pr_number"],
        code="GITHUB_PR_REQUIRED",
        message="PR number is required",
        detail_key="env",
        detail_value=runtime["pr_number_env"],
    ))
    client = create_client(ctx_obj)
    pr = client.get_pr(resolved_owner, resolved_repo, resolved_number)
    return {
        "status": "live_read",
        "backend": BACKEND_NAME,
        "summary": f"Read PR #{resolved_number} in {resolved_owner}/{resolved_repo}.",
        "pr": pr,
        "scope_preview": {
            "selection_surface": "pr",
            "command_id": "pr.get",
            "owner": resolved_owner,
            "repo": resolved_repo,
            "pr_number": resolved_number,
        },
    }


def pr_create_result(ctx_obj: dict[str, Any], owner: str | None, repo: str | None, *, title: str, head: str, base: str, body: str | None) -> dict[str, Any]:
    resolved_owner, resolved_repo = _resolve_owner_repo(ctx_obj, owner, repo)
    client = create_client(ctx_obj)
    pr = client.create_pr(resolved_owner, resolved_repo, title=title, head=head, base=base, body=body)
    return {
        "status": "live_write",
        "backend": BACKEND_NAME,
        "summary": f"Created PR #{pr.get('number')} in {resolved_owner}/{resolved_repo}.",
        "pr": pr,
        "scope_preview": {
            "selection_surface": "pr",
            "command_id": "pr.create",
            "owner": resolved_owner,
            "repo": resolved_repo,
        },
    }


def pr_merge_result(ctx_obj: dict[str, Any], owner: str | None, repo: str | None, number: int) -> dict[str, Any]:
    resolved_owner, resolved_repo = _resolve_owner_repo(ctx_obj, owner, repo)
    client = create_client(ctx_obj)
    result = client.merge_pr(resolved_owner, resolved_repo, number)
    return {
        "status": "live_write",
        "backend": BACKEND_NAME,
        "summary": f"Merged PR #{number} in {resolved_owner}/{resolved_repo}.",
        "merge": result,
        "scope_preview": {
            "selection_surface": "pr",
            "command_id": "pr.merge",
            "owner": resolved_owner,
            "repo": resolved_repo,
            "pr_number": number,
        },
    }


def pr_review_result(ctx_obj: dict[str, Any], owner: str | None, repo: str | None, number: int, *, event: str, body: str | None) -> dict[str, Any]:
    resolved_owner, resolved_repo = _resolve_owner_repo(ctx_obj, owner, repo)
    client = create_client(ctx_obj)
    review = client.review_pr(resolved_owner, resolved_repo, number, event=event, body=body)
    return {
        "status": "live_write",
        "backend": BACKEND_NAME,
        "summary": f"Submitted {event} review on PR #{number} in {resolved_owner}/{resolved_repo}.",
        "review": review,
        "scope_preview": {
            "selection_surface": "pr",
            "command_id": "pr.review",
            "owner": resolved_owner,
            "repo": resolved_repo,
            "pr_number": number,
        },
    }


# --- Branch commands ---

def branch_list_result(ctx_obj: dict[str, Any], owner: str | None, repo: str | None, *, limit: int) -> dict[str, Any]:
    resolved_owner, resolved_repo = _resolve_owner_repo(ctx_obj, owner, repo)
    client = create_client(ctx_obj)
    payload = client.list_branches(resolved_owner, resolved_repo, limit=limit)
    branches = payload.get("branches", [])
    items = [
        {
            "id": str(item.get("name") or ""),
            "label": str(item.get("name") or "Branch"),
            "subtitle": f"sha={item.get('commit_sha', '')[:7]}" if item.get("commit_sha") else None,
            "kind": "branch",
        }
        for item in branches
        if isinstance(item, dict)
    ]
    return {
        "status": "live_read",
        "backend": BACKEND_NAME,
        "summary": f"Returned {len(branches)} branch{'es' if len(branches) != 1 else ''}.",
        "branches": branches,
        "branch_count": len(branches),
        "picker": _picker(items, kind="branch"),
        "scope_preview": {
            "selection_surface": "branch",
            "command_id": "branch.list",
            "owner": resolved_owner,
            "repo": resolved_repo,
        },
    }


def branch_create_result(ctx_obj: dict[str, Any], owner: str | None, repo: str | None, *, branch: str, sha: str) -> dict[str, Any]:
    resolved_owner, resolved_repo = _resolve_owner_repo(ctx_obj, owner, repo)
    client = create_client(ctx_obj)
    result = client.create_branch(resolved_owner, resolved_repo, branch=branch, sha=sha)
    return {
        "status": "live_write",
        "backend": BACKEND_NAME,
        "summary": f"Created branch {branch} in {resolved_owner}/{resolved_repo}.",
        "ref": result,
        "scope_preview": {
            "selection_surface": "branch",
            "command_id": "branch.create",
            "owner": resolved_owner,
            "repo": resolved_repo,
            "branch": branch,
        },
    }


# --- Actions commands ---

def actions_list_runs_result(ctx_obj: dict[str, Any], owner: str | None, repo: str | None, *, limit: int) -> dict[str, Any]:
    resolved_owner, resolved_repo = _resolve_owner_repo(ctx_obj, owner, repo)
    client = create_client(ctx_obj)
    payload = client.list_workflow_runs(resolved_owner, resolved_repo, limit=limit)
    runs = payload.get("workflow_runs", [])
    items = [
        {
            "id": str(item.get("id") or ""),
            "label": str(item.get("name") or "Workflow Run"),
            "subtitle": f"{item.get('status')} / {item.get('conclusion') or 'in_progress'}" if item.get("status") else None,
            "kind": "workflow_run",
        }
        for item in runs
        if isinstance(item, dict)
    ]
    return {
        "status": "live_read",
        "backend": BACKEND_NAME,
        "summary": f"Returned {len(runs)} workflow run{'s' if len(runs) != 1 else ''}.",
        "workflow_runs": runs,
        "run_count": len(runs),
        "total_count": payload.get("total_count", 0),
        "picker": _picker(items, kind="workflow_run"),
        "scope_preview": {
            "selection_surface": "actions",
            "command_id": "actions.list_runs",
            "owner": resolved_owner,
            "repo": resolved_repo,
        },
    }


def actions_trigger_result(ctx_obj: dict[str, Any], owner: str | None, repo: str | None, *, workflow_id: str, ref: str) -> dict[str, Any]:
    resolved_owner, resolved_repo = _resolve_owner_repo(ctx_obj, owner, repo)
    client = create_client(ctx_obj)
    result = client.trigger_workflow(resolved_owner, resolved_repo, workflow_id=workflow_id, ref=ref)
    return {
        "status": "live_write",
        "backend": BACKEND_NAME,
        "summary": f"Triggered workflow {workflow_id} on {ref} in {resolved_owner}/{resolved_repo}.",
        "trigger": result,
        "scope_preview": {
            "selection_surface": "actions",
            "command_id": "actions.trigger",
            "owner": resolved_owner,
            "repo": resolved_repo,
        },
    }


# --- Release commands ---

def release_list_result(ctx_obj: dict[str, Any], owner: str | None, repo: str | None, *, limit: int) -> dict[str, Any]:
    resolved_owner, resolved_repo = _resolve_owner_repo(ctx_obj, owner, repo)
    client = create_client(ctx_obj)
    payload = client.list_releases(resolved_owner, resolved_repo, limit=limit)
    releases = payload.get("releases", [])
    items = [
        {
            "id": str(item.get("tag_name") or item.get("id") or ""),
            "label": str(item.get("name") or item.get("tag_name") or "Release"),
            "subtitle": item.get("tag_name") or None,
            "kind": "release",
        }
        for item in releases
        if isinstance(item, dict)
    ]
    return {
        "status": "live_read",
        "backend": BACKEND_NAME,
        "summary": f"Returned {len(releases)} release{'s' if len(releases) != 1 else ''}.",
        "releases": releases,
        "release_count": len(releases),
        "picker": _picker(items, kind="release"),
        "scope_preview": {
            "selection_surface": "release",
            "command_id": "release.list",
            "owner": resolved_owner,
            "repo": resolved_repo,
        },
    }


def release_create_result(ctx_obj: dict[str, Any], owner: str | None, repo: str | None, *, tag_name: str, name: str | None, body: str | None) -> dict[str, Any]:
    resolved_owner, resolved_repo = _resolve_owner_repo(ctx_obj, owner, repo)
    client = create_client(ctx_obj)
    release = client.create_release(resolved_owner, resolved_repo, tag_name=tag_name, name=name, body=body)
    return {
        "status": "live_write",
        "backend": BACKEND_NAME,
        "summary": f"Created release {tag_name} in {resolved_owner}/{resolved_repo}.",
        "release": release,
        "scope_preview": {
            "selection_surface": "release",
            "command_id": "release.create",
            "owner": resolved_owner,
            "repo": resolved_repo,
        },
    }
