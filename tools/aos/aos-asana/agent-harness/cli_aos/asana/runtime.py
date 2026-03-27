from __future__ import annotations

import json
import shutil
from typing import Any, Callable

from .client import AsanaClient
from .config import AsanaConfig, redact_config, resolve_config
from .constants import (
    BACKEND_NAME,
    CONNECTOR_PATH,
    IMPLEMENTATION_MODE,
    LIVE_READ_SURFACES,
    LIVE_WRITE_SURFACES,
    TOOL_NAME,
)
from .errors import AsanaConfigurationError


def resolve_runtime_binary() -> str | None:
    return shutil.which("aos-asana")


def create_client(config: AsanaConfig | None = None) -> AsanaClient:
    config = config or resolve_config()
    if not config.access_token:
        raise AsanaConfigurationError("ASANA_ACCESS_TOKEN is required")
    return AsanaClient(access_token=config.access_token, base_url=config.base_url)


def build_manifest_payload() -> dict[str, Any]:
    return json.loads(CONNECTOR_PATH.read_text())


def build_capabilities_payload() -> dict[str, Any]:
    return {
        "tool": TOOL_NAME,
        "backend": BACKEND_NAME,
        "manifest_version": build_manifest_payload().get("manifest_schema_version"),
        "data": build_manifest_payload(),
    }


def build_scope_preview(command_id: str, selection_surface: str, **extra: Any) -> dict[str, Any]:
    payload = {"command_id": command_id, "selection_surface": selection_surface}
    payload.update({key: value for key, value in extra.items() if value is not None})
    return payload


def build_config_show_payload() -> dict[str, Any]:
    config = resolve_config()
    manifest = build_manifest_payload()
    return {
        "tool": TOOL_NAME,
        "backend": BACKEND_NAME,
        "data": {
            "config": redact_config(config),
            "scope": {
                "workspace_gid": config.workspace_gid,
                "project_gid": config.project_gid,
                "task_gid": config.task_gid,
            },
            "runtime": {
                "binary_path": resolve_runtime_binary(),
                "implementation_mode": IMPLEMENTATION_MODE,
                "live_read_surfaces": LIVE_READ_SURFACES,
                "live_write_surfaces": LIVE_WRITE_SURFACES,
                "command_defaults": manifest["scope"].get("commandDefaults", {}),
            },
        },
    }


def _probe_details(client: AsanaClient, config: AsanaConfig) -> dict[str, Any]:
    details: dict[str, Any] = {}
    if config.workspace_gid:
        details["projects"] = client.list_projects(config.workspace_gid, limit=5)["projects"]
    if config.project_gid:
        details["project"] = client.get_project(config.project_gid)["project"]
        details["tasks"] = client.list_tasks(config.project_gid, limit=5)["tasks"]
        details["sections"] = client.list_sections(config.project_gid)["sections"]
    if config.task_gid:
        details["task"] = client.get_task(config.task_gid)["task"]
    return details


def build_health_payload(*, client_factory: Callable[[AsanaConfig], AsanaClient] | None = None) -> dict[str, Any]:
    client_factory = client_factory or create_client
    config = resolve_config()
    runtime_binary = resolve_runtime_binary()
    checks: list[dict[str, Any]] = [
        {
            "name": "connector_runtime",
            "label": "Connector runtime installed",
            "ok": bool(runtime_binary),
            "optional": False,
            "summary": runtime_binary or "Install the harness so the aos-asana binary is available on PATH.",
        },
        {
            "name": "access_token",
            "label": "Asana access token configured",
            "ok": bool(config.access_token),
            "optional": False,
            "summary": "ASANA_ACCESS_TOKEN is set" if config.access_token else "Add ASANA_ACCESS_TOKEN in API Keys.",
        },
        {
            "name": "workspace_scope",
            "label": "Workspace scope pinned",
            "ok": bool(config.workspace_gid),
            "optional": False,
            "summary": config.workspace_gid or "Set ASANA_WORKSPACE_GID so workspace-scoped reads have a stable scope.",
        },
        {
            "name": "project_scope",
            "label": "Project scope pinned",
            "ok": bool(config.project_gid),
            "optional": True,
            "summary": config.project_gid or "Optional: set ASANA_PROJECT_GID for project-scoped reads.",
        },
    ]
    probe = None
    if config.access_token:
        try:
            client = client_factory(config)
            probe = {"ok": True, **_probe_details(client, config)}
        except Exception as exc:  # noqa: BLE001
            probe = {"ok": False, "error": str(exc)}
            checks.append({"name": "api_probe", "label": "Asana API probe", "ok": False, "optional": False, "summary": str(exc)})
        else:
            checks.append({"name": "api_probe", "label": "Asana API probe", "ok": True, "optional": False, "summary": "Asana live reads succeeded."})
    ok = bool(runtime_binary) and bool(config.access_token) and bool(config.workspace_gid) and bool(probe) and probe.get("ok") is True
    next_steps = []
    if not runtime_binary:
        next_steps.append("Install the harness so the aos-asana binary is on PATH.")
    if not config.access_token:
        next_steps.append("Create an Asana personal access token and add ASANA_ACCESS_TOKEN.")
    if not config.workspace_gid:
        next_steps.append("Set ASANA_WORKSPACE_GID so live reads have an explicit workspace scope.")
    if not config.project_gid:
        next_steps.append("Optional: pin ASANA_PROJECT_GID for project-scoped reads.")
    return {
        "tool": TOOL_NAME,
        "backend": BACKEND_NAME,
        "data": {"status": "ready" if ok else "needs_setup", "checks": checks, "probe": probe, "next_steps": next_steps},
    }


def build_doctor_payload() -> dict[str, Any]:
    health = build_health_payload()
    return {
        "tool": TOOL_NAME,
        "backend": BACKEND_NAME,
        "data": {"status": health["data"]["status"], "checks": health["data"]["checks"], "probe": health["data"]["probe"], "summary": "Asana connector diagnostics complete."},
    }


# --- Project ---

def build_project_list_payload(*, client_factory: Callable[[AsanaConfig], AsanaClient] | None = None, workspace_gid: str | None = None, limit: int = 25) -> dict[str, Any]:
    config = resolve_config()
    resolved = workspace_gid or config.workspace_gid
    if not resolved:
        raise AsanaConfigurationError("Set ASANA_WORKSPACE_GID to list projects.")
    client = (client_factory or create_client)(config)
    projects = client.list_projects(resolved, limit=limit)["projects"]
    return {"tool": TOOL_NAME, "backend": BACKEND_NAME, "data": {"project_count": len(projects), "projects": projects, "scope_preview": build_scope_preview("project.list", "project", workspace_gid=resolved)}}


def build_project_get_payload(*, client_factory: Callable[[AsanaConfig], AsanaClient] | None = None, project_gid: str | None = None) -> dict[str, Any]:
    config = resolve_config()
    resolved = project_gid or config.project_gid
    if not resolved:
        raise AsanaConfigurationError("Set ASANA_PROJECT_GID or pass a project_gid.")
    client = (client_factory or create_client)(config)
    project = client.get_project(resolved)["project"]
    return {"tool": TOOL_NAME, "backend": BACKEND_NAME, "data": {"project": project, "scope_preview": build_scope_preview("project.get", "project", project_gid=resolved)}}


def build_project_sections_payload(*, client_factory: Callable[[AsanaConfig], AsanaClient] | None = None, project_gid: str | None = None) -> dict[str, Any]:
    config = resolve_config()
    resolved = project_gid or config.project_gid
    if not resolved:
        raise AsanaConfigurationError("Set ASANA_PROJECT_GID or pass a project_gid.")
    client = (client_factory or create_client)(config)
    sections = client.list_project_sections(resolved)["sections"]
    return {"tool": TOOL_NAME, "backend": BACKEND_NAME, "data": {"section_count": len(sections), "sections": sections, "scope_preview": build_scope_preview("project.sections", "section", project_gid=resolved)}}


# --- Section ---

def build_section_list_payload(*, client_factory: Callable[[AsanaConfig], AsanaClient] | None = None, project_gid: str | None = None) -> dict[str, Any]:
    config = resolve_config()
    resolved = project_gid or config.project_gid
    if not resolved:
        raise AsanaConfigurationError("Set ASANA_PROJECT_GID or pass a project_gid to list sections.")
    client = (client_factory or create_client)(config)
    sections = client.list_sections(resolved)["sections"]
    return {"tool": TOOL_NAME, "backend": BACKEND_NAME, "data": {"section_count": len(sections), "sections": sections, "scope_preview": build_scope_preview("section.list", "section", project_gid=resolved)}}


def build_section_tasks_payload(*, client_factory: Callable[[AsanaConfig], AsanaClient] | None = None, section_gid: str, limit: int = 25) -> dict[str, Any]:
    config = resolve_config()
    client = (client_factory or create_client)(config)
    result = client.list_section_tasks(section_gid, limit=limit)
    return {"tool": TOOL_NAME, "backend": BACKEND_NAME, "data": {**result, "scope_preview": build_scope_preview("section.tasks", "task", section_gid=section_gid)}}


# --- Task ---

def build_task_list_payload(*, client_factory: Callable[[AsanaConfig], AsanaClient] | None = None, project_gid: str | None = None, limit: int = 25) -> dict[str, Any]:
    config = resolve_config()
    resolved = project_gid or config.project_gid
    if not resolved:
        raise AsanaConfigurationError("Set ASANA_PROJECT_GID to list tasks.")
    client = (client_factory or create_client)(config)
    result = client.list_tasks(resolved, limit=limit)
    return {"tool": TOOL_NAME, "backend": BACKEND_NAME, "data": {**result, "scope_preview": build_scope_preview("task.list", "task", project_gid=resolved)}}


def build_task_get_payload(*, client_factory: Callable[[AsanaConfig], AsanaClient] | None = None, task_gid: str | None = None) -> dict[str, Any]:
    config = resolve_config()
    resolved = task_gid or config.task_gid
    if not resolved:
        raise AsanaConfigurationError("Set ASANA_TASK_GID or pass a task_gid.")
    client = (client_factory or create_client)(config)
    task = client.get_task(resolved)["task"]
    return {"tool": TOOL_NAME, "backend": BACKEND_NAME, "data": {"task": task, "scope_preview": build_scope_preview("task.get", "task", task_gid=resolved)}}


def build_task_create_payload(*, client_factory: Callable[[AsanaConfig], AsanaClient] | None = None, project_gid: str | None = None, name: str, notes: str | None = None, assignee: str | None = None, due_on: str | None = None) -> dict[str, Any]:
    config = resolve_config()
    resolved = project_gid or config.project_gid
    if not resolved:
        raise AsanaConfigurationError("Set ASANA_PROJECT_GID or pass --project-gid to create a task.")
    client = (client_factory or create_client)(config)
    result = client.create_task(project_gid=resolved, name=name, notes=notes, assignee=assignee, due_on=due_on)
    return {"tool": TOOL_NAME, "backend": BACKEND_NAME, "data": {**result, "command": "task.create", "scope_preview": build_scope_preview("task.create", "task", project_gid=resolved)}}


def build_task_update_payload(*, client_factory: Callable[[AsanaConfig], AsanaClient] | None = None, task_gid: str | None = None, name: str | None = None, notes: str | None = None, assignee: str | None = None, due_on: str | None = None, completed: bool | None = None) -> dict[str, Any]:
    config = resolve_config()
    resolved = task_gid or config.task_gid
    if not resolved:
        raise AsanaConfigurationError("Set ASANA_TASK_GID or pass --task-gid to update a task.")
    client = (client_factory or create_client)(config)
    result = client.update_task(task_gid=resolved, name=name, notes=notes, assignee=assignee, due_on=due_on, completed=completed)
    return {"tool": TOOL_NAME, "backend": BACKEND_NAME, "data": {**result, "command": "task.update", "scope_preview": build_scope_preview("task.update", "task", task_gid=resolved)}}


# --- Comment ---

def build_comment_list_payload(*, client_factory: Callable[[AsanaConfig], AsanaClient] | None = None, task_gid: str | None = None) -> dict[str, Any]:
    config = resolve_config()
    resolved = task_gid or config.task_gid
    if not resolved:
        raise AsanaConfigurationError("Set ASANA_TASK_GID or pass --task-gid to list comments.")
    client = (client_factory or create_client)(config)
    result = client.list_comments(resolved)
    return {"tool": TOOL_NAME, "backend": BACKEND_NAME, "data": {**result, "scope_preview": build_scope_preview("comment.list", "comment", task_gid=resolved)}}


def build_comment_create_payload(*, client_factory: Callable[[AsanaConfig], AsanaClient] | None = None, task_gid: str | None = None, text: str) -> dict[str, Any]:
    config = resolve_config()
    resolved = task_gid or config.task_gid
    if not resolved:
        raise AsanaConfigurationError("Set ASANA_TASK_GID or pass --task-gid to create a comment.")
    client = (client_factory or create_client)(config)
    result = client.create_comment(task_gid=resolved, text=text)
    return {"tool": TOOL_NAME, "backend": BACKEND_NAME, "data": {**result, "command": "comment.create", "scope_preview": build_scope_preview("comment.create", "comment", task_gid=resolved)}}


# --- Portfolio ---

def build_portfolio_list_payload(*, client_factory: Callable[[AsanaConfig], AsanaClient] | None = None, workspace_gid: str | None = None) -> dict[str, Any]:
    config = resolve_config()
    resolved = workspace_gid or config.workspace_gid
    if not resolved:
        raise AsanaConfigurationError("Set ASANA_WORKSPACE_GID to list portfolios.")
    client = (client_factory or create_client)(config)
    result = client.list_portfolios(resolved)
    return {"tool": TOOL_NAME, "backend": BACKEND_NAME, "data": {**result, "scope_preview": build_scope_preview("portfolio.list", "portfolio", workspace_gid=resolved)}}


def build_portfolio_get_payload(*, client_factory: Callable[[AsanaConfig], AsanaClient] | None = None, portfolio_gid: str) -> dict[str, Any]:
    config = resolve_config()
    client = (client_factory or create_client)(config)
    result = client.get_portfolio(portfolio_gid)
    return {"tool": TOOL_NAME, "backend": BACKEND_NAME, "data": {**result, "scope_preview": build_scope_preview("portfolio.get", "portfolio", portfolio_gid=portfolio_gid)}}


# --- Search ---

def build_search_tasks_payload(*, client_factory: Callable[[AsanaConfig], AsanaClient] | None = None, workspace_gid: str | None = None, query: str) -> dict[str, Any]:
    config = resolve_config()
    resolved = workspace_gid or config.workspace_gid
    if not resolved:
        raise AsanaConfigurationError("Set ASANA_WORKSPACE_GID to search tasks.")
    client = (client_factory or create_client)(config)
    result = client.search_tasks(resolved, query=query)
    return {"tool": TOOL_NAME, "backend": BACKEND_NAME, "data": {**result, "scope_preview": build_scope_preview("search.tasks", "task", workspace_gid=resolved)}}
