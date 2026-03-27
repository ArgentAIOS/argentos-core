from __future__ import annotations

import json
from typing import Any

from .client import JiraApiError, JiraClient
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


def create_client(ctx_obj: dict[str, Any]) -> JiraClient:
    runtime = resolve_runtime_values(ctx_obj)
    missing = []
    if not runtime["base_url_present"]:
        missing.append(runtime["base_url_env"])
    if not runtime["email_present"]:
        missing.append(runtime["email_env"])
    if not runtime["api_token_present"]:
        missing.append(runtime["api_token_env"])
    if missing:
        raise CliError(
            code="JIRA_SETUP_REQUIRED",
            message="Jira connector is missing required credentials",
            exit_code=4,
            details={"missing_keys": missing},
        )
    return JiraClient(base_url=runtime["base_url"], email=runtime["email"], api_token=runtime["api_token"])


def probe_runtime(ctx_obj: dict[str, Any]) -> dict[str, Any]:
    runtime = resolve_runtime_values(ctx_obj)
    if not runtime["auth_ready"]:
        missing = []
        if not runtime["base_url_present"]:
            missing.append(runtime["base_url_env"])
        if not runtime["email_present"]:
            missing.append(runtime["email_env"])
        if not runtime["api_token_present"]:
            missing.append(runtime["api_token_env"])
        return {
            "ok": False,
            "code": "JIRA_SETUP_REQUIRED",
            "message": "Jira connector is missing required credentials",
            "details": {"missing_keys": missing, "live_backend_available": False},
        }
    try:
        client = create_client(ctx_obj)
        user = client.myself()
    except CliError as err:
        return {"ok": False, "code": err.code, "message": err.message, "details": err.details}
    except JiraApiError as err:
        code = "JIRA_AUTH_FAILED" if err.status_code in {401, 403} else "JIRA_API_ERROR"
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
        "message": "Jira live runtime is ready",
        "details": {
            "live_backend_available": True,
            "user": user.get("displayName") or user.get("emailAddress"),
        },
    }


def health_snapshot(ctx_obj: dict[str, Any]) -> dict[str, Any]:
    runtime = resolve_runtime_values(ctx_obj)
    probe = probe_runtime(ctx_obj)
    status = "ready" if probe["ok"] else ("needs_setup" if probe["code"] == "JIRA_SETUP_REQUIRED" else "degraded")
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
            "base_url_env": runtime["base_url_env"],
            "base_url_present": runtime["base_url_present"],
            "email_env": runtime["email_env"],
            "email_present": runtime["email_present"],
            "api_token_env": runtime["api_token_env"],
            "api_token_present": runtime["api_token_present"],
        },
        "scope": {
            "project_key": runtime["project_key"] or None,
            "issue_key": runtime["issue_key"] or None,
            "board_id": runtime["board_id"] or None,
            "sprint_id": runtime["sprint_id"] or None,
        },
        "checks": [
            {
                "name": "required_env",
                "ok": runtime["auth_ready"],
                "details": {"missing_keys": [k for k in [runtime["base_url_env"], runtime["email_env"], runtime["api_token_env"]] if not runtime.get(k.lower().replace("jira_", "") + "_present", runtime["auth_ready"])]},
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
            f"Set {runtime['base_url_env']}, {runtime['email_env']}, and {runtime['api_token_env']}.",
            "Set JIRA_PROJECT_KEY to pin the default project scope.",
            "Optionally set JIRA_BOARD_ID and JIRA_SPRINT_ID for board/sprint-scoped flows.",
        ],
    }


def doctor_snapshot(ctx_obj: dict[str, Any]) -> dict[str, Any]:
    runtime = resolve_runtime_values(ctx_obj)
    probe = probe_runtime(ctx_obj)
    live = bool(probe.get("ok"))
    return {
        "status": "ready" if live else ("needs_setup" if probe.get("code") == "JIRA_SETUP_REQUIRED" else "degraded"),
        "summary": "Jira connector diagnostics.",
        "runtime": {
            "implementation_mode": "live_read_write",
            "command_readiness": {
                "project.list": live,
                "project.get": live,
                "issue.list": live,
                "issue.get": live,
                "issue.create": live,
                "issue.update": live,
                "issue.transition": live,
                "issue.comment": live,
                "board.list": live,
                "board.get": live,
                "sprint.list": live,
                "sprint.get": live,
                "sprint.issues": live,
                "search.jql": live,
            },
            "project_key_present": runtime["project_key_present"],
            "issue_key_present": runtime["issue_key_present"],
            "board_id_present": runtime["board_id_present"],
            "sprint_id_present": runtime["sprint_id_present"],
        },
        "checks": [
            {"name": "required_env", "ok": runtime["auth_ready"]},
            {"name": "live_backend", "ok": live, "details": probe.get("details", {})},
        ],
        "supported_read_commands": [
            "project.list", "project.get",
            "issue.list", "issue.get",
            "board.list", "board.get",
            "sprint.list", "sprint.get", "sprint.issues",
            "search.jql",
        ],
        "supported_write_commands": [
            "issue.create", "issue.update", "issue.transition", "issue.comment",
        ],
        "next_steps": [
            f"Set {runtime['base_url_env']}, {runtime['email_env']}, and {runtime['api_token_env']}.",
            "Set JIRA_PROJECT_KEY to scope commands to a default project.",
        ],
    }


def _picker(items: list[dict[str, Any]], *, kind: str, label_key: str = "label") -> dict[str, Any]:
    return {"kind": kind, "items": items, "count": len(items), "label_key": label_key}


def _require_arg(value: str | None, *, code: str, message: str, detail_key: str, detail_value: str) -> str:
    resolved = (value or "").strip()
    if resolved:
        return resolved
    raise CliError(code=code, message=message, exit_code=4, details={detail_key: detail_value})


# --- Project commands ---

def project_list_result(ctx_obj: dict[str, Any], *, limit: int) -> dict[str, Any]:
    client = create_client(ctx_obj)
    payload = client.list_projects(limit=limit)
    projects = payload.get("projects", [])
    items = [
        {
            "id": str(item.get("key") or item.get("id") or ""),
            "label": f"{item.get('key')} — {item.get('name') or 'Project'}",
            "subtitle": item.get("projectTypeKey") or None,
            "kind": "project",
        }
        for item in projects
        if isinstance(item, dict)
    ]
    return {
        "status": "live_read",
        "backend": BACKEND_NAME,
        "summary": f"Returned {len(projects)} project{'s' if len(projects) != 1 else ''}.",
        "projects": projects,
        "project_count": len(projects),
        "picker": _picker(items, kind="project"),
        "scope_preview": {
            "selection_surface": "project",
            "command_id": "project.list",
        },
    }


def project_get_result(ctx_obj: dict[str, Any], project_key: str | None) -> dict[str, Any]:
    runtime = resolve_runtime_values(ctx_obj)
    resolved = _require_arg(
        project_key or runtime["project_key"],
        code="JIRA_PROJECT_REQUIRED",
        message="Project key is required",
        detail_key="env",
        detail_value=runtime["project_key_env"],
    )
    client = create_client(ctx_obj)
    project = client.get_project(resolved)
    return {
        "status": "live_read",
        "backend": BACKEND_NAME,
        "summary": f"Read Jira project {resolved}.",
        "project": project,
        "scope_preview": {
            "selection_surface": "project",
            "command_id": "project.get",
            "project_key": resolved,
        },
    }


# --- Issue commands ---

def issue_list_result(ctx_obj: dict[str, Any], project_key: str | None, *, limit: int) -> dict[str, Any]:
    runtime = resolve_runtime_values(ctx_obj)
    resolved = _require_arg(
        project_key or runtime["project_key"],
        code="JIRA_PROJECT_REQUIRED",
        message="Project key is required",
        detail_key="env",
        detail_value=runtime["project_key_env"],
    )
    client = create_client(ctx_obj)
    payload = client.list_issues(resolved, limit=limit)
    issues = payload.get("issues", [])
    items = [
        {
            "id": str(item.get("key") or ""),
            "label": f"{item.get('key')} {item.get('summary') or ''}".strip(),
            "subtitle": item.get("status") or None,
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
            "project_key": resolved,
        },
    }


def issue_get_result(ctx_obj: dict[str, Any], issue_key: str | None) -> dict[str, Any]:
    runtime = resolve_runtime_values(ctx_obj)
    resolved = _require_arg(
        issue_key or runtime["issue_key"],
        code="JIRA_ISSUE_REQUIRED",
        message="Issue key is required",
        detail_key="env",
        detail_value=runtime["issue_key_env"],
    )
    client = create_client(ctx_obj)
    issue = client.get_issue(resolved)
    return {
        "status": "live_read",
        "backend": BACKEND_NAME,
        "summary": f"Read Jira issue {resolved}.",
        "issue": issue,
        "scope_preview": {
            "selection_surface": "issue",
            "command_id": "issue.get",
            "issue_key": resolved,
        },
    }


def issue_create_result(ctx_obj: dict[str, Any], project_key: str | None, *, summary: str, issue_type: str, description: str | None) -> dict[str, Any]:
    runtime = resolve_runtime_values(ctx_obj)
    resolved = _require_arg(
        project_key or runtime["project_key"],
        code="JIRA_PROJECT_REQUIRED",
        message="Project key is required",
        detail_key="env",
        detail_value=runtime["project_key_env"],
    )
    client = create_client(ctx_obj)
    issue = client.create_issue(project_key=resolved, summary=summary, issue_type=issue_type, description=description)
    return {
        "status": "live_write",
        "backend": BACKEND_NAME,
        "summary": f"Created issue {issue.get('key')} in {resolved}.",
        "issue": issue,
        "scope_preview": {
            "selection_surface": "issue",
            "command_id": "issue.create",
            "project_key": resolved,
        },
    }


def issue_update_result(ctx_obj: dict[str, Any], issue_key: str, *, summary: str | None, description: str | None) -> dict[str, Any]:
    client = create_client(ctx_obj)
    issue = client.update_issue(issue_key, summary=summary, description=description)
    return {
        "status": "live_write",
        "backend": BACKEND_NAME,
        "summary": f"Updated issue {issue_key}.",
        "issue": issue,
        "scope_preview": {
            "selection_surface": "issue",
            "command_id": "issue.update",
            "issue_key": issue_key,
        },
    }


def issue_transition_result(ctx_obj: dict[str, Any], issue_key: str, *, status: str) -> dict[str, Any]:
    client = create_client(ctx_obj)
    issue = client.transition_issue(issue_key, transition_name=status)
    return {
        "status": "live_write",
        "backend": BACKEND_NAME,
        "summary": f"Transitioned issue {issue_key} to {status}.",
        "issue": issue,
        "scope_preview": {
            "selection_surface": "issue",
            "command_id": "issue.transition",
            "issue_key": issue_key,
        },
    }


def issue_comment_result(ctx_obj: dict[str, Any], issue_key: str, *, body: str) -> dict[str, Any]:
    client = create_client(ctx_obj)
    comment = client.comment_issue(issue_key, body=body)
    return {
        "status": "live_write",
        "backend": BACKEND_NAME,
        "summary": f"Commented on issue {issue_key}.",
        "comment": comment,
        "scope_preview": {
            "selection_surface": "issue",
            "command_id": "issue.comment",
            "issue_key": issue_key,
        },
    }


# --- Board commands ---

def board_list_result(ctx_obj: dict[str, Any], project_key: str | None, *, limit: int) -> dict[str, Any]:
    runtime = resolve_runtime_values(ctx_obj)
    resolved_project = (project_key or runtime["project_key"] or "").strip() or None
    client = create_client(ctx_obj)
    payload = client.list_boards(limit=limit, project_key=resolved_project)
    boards = payload.get("boards", [])
    items = [
        {
            "id": str(item.get("id") or ""),
            "label": str(item.get("name") or "Board"),
            "subtitle": item.get("type") or None,
            "kind": "board",
        }
        for item in boards
        if isinstance(item, dict)
    ]
    return {
        "status": "live_read",
        "backend": BACKEND_NAME,
        "summary": f"Returned {len(boards)} board{'s' if len(boards) != 1 else ''}.",
        "boards": boards,
        "board_count": len(boards),
        "picker": _picker(items, kind="board"),
        "scope_preview": {
            "selection_surface": "board",
            "command_id": "board.list",
        },
    }


def board_get_result(ctx_obj: dict[str, Any], board_id: int | None) -> dict[str, Any]:
    runtime = resolve_runtime_values(ctx_obj)
    resolved = int(_require_arg(
        str(board_id) if board_id else runtime["board_id"],
        code="JIRA_BOARD_REQUIRED",
        message="Board ID is required",
        detail_key="env",
        detail_value=runtime["board_id_env"],
    ))
    client = create_client(ctx_obj)
    board = client.get_board(resolved)
    return {
        "status": "live_read",
        "backend": BACKEND_NAME,
        "summary": f"Read Jira board {resolved}.",
        "board": board,
        "scope_preview": {
            "selection_surface": "board",
            "command_id": "board.get",
            "board_id": resolved,
        },
    }


# --- Sprint commands ---

def sprint_list_result(ctx_obj: dict[str, Any], board_id: int | None, *, limit: int) -> dict[str, Any]:
    runtime = resolve_runtime_values(ctx_obj)
    resolved = int(_require_arg(
        str(board_id) if board_id else runtime["board_id"],
        code="JIRA_BOARD_REQUIRED",
        message="Board ID is required for sprint listing",
        detail_key="env",
        detail_value=runtime["board_id_env"],
    ))
    client = create_client(ctx_obj)
    payload = client.list_sprints(resolved, limit=limit)
    sprints = payload.get("sprints", [])
    items = [
        {
            "id": str(item.get("id") or ""),
            "label": str(item.get("name") or "Sprint"),
            "subtitle": item.get("state") or None,
            "kind": "sprint",
        }
        for item in sprints
        if isinstance(item, dict)
    ]
    return {
        "status": "live_read",
        "backend": BACKEND_NAME,
        "summary": f"Returned {len(sprints)} sprint{'s' if len(sprints) != 1 else ''}.",
        "sprints": sprints,
        "sprint_count": len(sprints),
        "picker": _picker(items, kind="sprint"),
        "scope_preview": {
            "selection_surface": "sprint",
            "command_id": "sprint.list",
            "board_id": resolved,
        },
    }


def sprint_get_result(ctx_obj: dict[str, Any], sprint_id: int | None) -> dict[str, Any]:
    runtime = resolve_runtime_values(ctx_obj)
    resolved = int(_require_arg(
        str(sprint_id) if sprint_id else runtime["sprint_id"],
        code="JIRA_SPRINT_REQUIRED",
        message="Sprint ID is required",
        detail_key="env",
        detail_value=runtime["sprint_id_env"],
    ))
    client = create_client(ctx_obj)
    sprint = client.get_sprint(resolved)
    return {
        "status": "live_read",
        "backend": BACKEND_NAME,
        "summary": f"Read Jira sprint {resolved}.",
        "sprint": sprint,
        "scope_preview": {
            "selection_surface": "sprint",
            "command_id": "sprint.get",
            "sprint_id": resolved,
        },
    }


def sprint_issues_result(ctx_obj: dict[str, Any], sprint_id: int | None, *, limit: int) -> dict[str, Any]:
    runtime = resolve_runtime_values(ctx_obj)
    resolved = int(_require_arg(
        str(sprint_id) if sprint_id else runtime["sprint_id"],
        code="JIRA_SPRINT_REQUIRED",
        message="Sprint ID is required",
        detail_key="env",
        detail_value=runtime["sprint_id_env"],
    ))
    client = create_client(ctx_obj)
    payload = client.sprint_issues(resolved, limit=limit)
    issues = payload.get("issues", [])
    items = [
        {
            "id": str(item.get("key") or ""),
            "label": f"{item.get('key')} {item.get('summary') or ''}".strip(),
            "subtitle": item.get("status") or None,
            "kind": "issue",
        }
        for item in issues
        if isinstance(item, dict)
    ]
    return {
        "status": "live_read",
        "backend": BACKEND_NAME,
        "summary": f"Returned {len(issues)} issue{'s' if len(issues) != 1 else ''} in sprint {resolved}.",
        "issues": issues,
        "issue_count": len(issues),
        "picker": _picker(items, kind="issue"),
        "scope_preview": {
            "selection_surface": "sprint",
            "command_id": "sprint.issues",
            "sprint_id": resolved,
        },
    }


# --- Search ---

def search_jql_result(ctx_obj: dict[str, Any], *, jql: str, limit: int) -> dict[str, Any]:
    client = create_client(ctx_obj)
    payload = client.search_jql(jql=jql, limit=limit)
    issues = payload.get("issues", [])
    items = [
        {
            "id": str(item.get("key") or ""),
            "label": f"{item.get('key')} {item.get('summary') or ''}".strip(),
            "subtitle": item.get("status") or None,
            "kind": "issue",
        }
        for item in issues
        if isinstance(item, dict)
    ]
    return {
        "status": "live_read",
        "backend": BACKEND_NAME,
        "summary": f"JQL returned {len(issues)} issue{'s' if len(issues) != 1 else ''} (total: {payload.get('total', 0)}).",
        "issues": issues,
        "issue_count": len(issues),
        "total": payload.get("total", 0),
        "jql": jql,
        "picker": _picker(items, kind="issue"),
        "scope_preview": {
            "selection_surface": "issue",
            "command_id": "search.jql",
        },
    }
