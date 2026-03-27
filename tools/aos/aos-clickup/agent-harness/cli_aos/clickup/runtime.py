from __future__ import annotations

import json
import shutil
from typing import Any, Callable

from .client import ClickUpClient
from .config import ClickUpConfig, redact_config, resolve_config
from .constants import (
    BACKEND_NAME,
    CONNECTOR_PATH,
    IMPLEMENTATION_MODE,
    LIVE_READ_SURFACES,
    LIVE_WRITE_SURFACES,
    TOOL_NAME,
)
from .errors import ClickUpConfigurationError


def resolve_runtime_binary() -> str | None:
    return shutil.which("aos-clickup")


def create_client(config: ClickUpConfig | None = None) -> ClickUpClient:
    config = config or resolve_config()
    if not config.api_token:
        raise ClickUpConfigurationError("CLICKUP_API_TOKEN or CLICKUP_ACCESS_TOKEN is required")
    return ClickUpClient(api_token=config.api_token, base_url=config.base_url)


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
                "workspace_id": config.workspace_id,
                "space_id": config.space_id,
                "list_id": config.list_id,
                "task_id": config.task_id,
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


def _probe_details(client: ClickUpClient, config: ClickUpConfig) -> dict[str, Any]:
    details: dict[str, Any] = {"authorized_workspaces": client.list_workspaces()["workspaces"]}
    if config.workspace_id:
        details["spaces"] = client.list_spaces(config.workspace_id)["spaces"]
    if config.space_id:
        details["space"] = client.get_space(config.space_id)["space"]
    if config.list_id:
        details["list"] = client.get_list(config.list_id)["list"]
        details["tasks"] = client.list_tasks(config.list_id)["tasks"]
    if config.task_id:
        details["task"] = client.get_task(config.task_id)["task"]
    return details


def build_health_payload(*, client_factory: Callable[[ClickUpConfig], ClickUpClient] | None = None) -> dict[str, Any]:
    client_factory = client_factory or create_client
    config = resolve_config()
    runtime_binary = resolve_runtime_binary()
    checks: list[dict[str, Any]] = [
        {
            "name": "connector_runtime",
            "label": "Connector runtime installed",
            "ok": bool(runtime_binary),
            "optional": False,
            "summary": runtime_binary or "Install the harness so the aos-clickup binary is available on PATH.",
        },
        {
            "name": "api_token",
            "label": "ClickUp API token configured",
            "ok": bool(config.api_token),
            "optional": False,
            "summary": "CLICKUP_API_TOKEN or CLICKUP_ACCESS_TOKEN is set" if config.api_token else "Add CLICKUP_API_TOKEN or CLICKUP_ACCESS_TOKEN in API Keys.",
        },
        {
            "name": "workspace_scope",
            "label": "Workspace scope pinned",
            "ok": bool(config.workspace_id),
            "optional": False,
            "summary": config.workspace_id or "Set CLICKUP_WORKSPACE_ID so worker-visible reads have a stable scope.",
        },
        {
            "name": "space_scope",
            "label": "Space scope pinned",
            "ok": bool(config.space_id),
            "optional": True,
            "summary": config.space_id or "Optional: set CLICKUP_SPACE_ID for deeper reads.",
        },
        {
            "name": "list_scope",
            "label": "List scope pinned",
            "ok": bool(config.list_id),
            "optional": True,
            "summary": config.list_id or "Optional: set CLICKUP_LIST_ID for list and task reads.",
        },
    ]
    probe = None
    if config.api_token:
        try:
            client = client_factory(config)
            probe = {"ok": True, **_probe_details(client, config)}
        except Exception as exc:  # noqa: BLE001
            probe = {"ok": False, "error": str(exc)}
            checks.append(
                {
                    "name": "api_probe",
                    "label": "ClickUp API probe",
                    "ok": False,
                    "optional": False,
                    "summary": str(exc),
                }
            )
        else:
            checks.append(
                {
                    "name": "api_probe",
                    "label": "ClickUp API probe",
                    "ok": True,
                    "optional": False,
                    "summary": "ClickUp live reads succeeded.",
                }
            )
    ok = bool(runtime_binary) and bool(config.api_token) and bool(config.workspace_id) and bool(probe) and probe.get("ok") is True
    next_steps = []
    if not runtime_binary:
        next_steps.append("Install the harness so the aos-clickup binary is on PATH.")
    if not config.api_token:
        next_steps.append("Create or choose a ClickUp token and add CLICKUP_API_TOKEN or CLICKUP_ACCESS_TOKEN.")
    if not config.workspace_id:
        next_steps.append("Set CLICKUP_WORKSPACE_ID so live reads have an explicit workspace scope.")
    if not config.space_id:
        next_steps.append("Optional: pin CLICKUP_SPACE_ID for space and list discovery.")
    if not config.list_id:
        next_steps.append("Optional: pin CLICKUP_LIST_ID to narrow task discovery.")
    return {
        "tool": TOOL_NAME,
        "backend": BACKEND_NAME,
        "data": {
            "status": "ready" if ok else "needs_setup",
            "checks": checks,
            "probe": probe,
            "next_steps": next_steps,
        },
    }


def build_doctor_payload() -> dict[str, Any]:
    health = build_health_payload()
    return {
        "tool": TOOL_NAME,
        "backend": BACKEND_NAME,
        "data": {
            "status": health["data"]["status"],
            "checks": health["data"]["checks"],
            "probe": health["data"]["probe"],
            "summary": "ClickUp connector diagnostics complete.",
        },
    }


# --- Workspace ---

def build_workspace_list_payload(*, client_factory: Callable[[ClickUpConfig], ClickUpClient] | None = None, limit: int = 25) -> dict[str, Any]:
    client = (client_factory or create_client)(resolve_config())
    workspaces = client.list_workspaces()["workspaces"][:limit]
    return {
        "tool": TOOL_NAME,
        "backend": BACKEND_NAME,
        "data": {
            "workspace_count": len(workspaces),
            "workspaces": workspaces,
            "scope_preview": build_scope_preview("workspace.list", "workspace"),
        },
    }


# --- Space ---

def build_space_list_payload(*, client_factory: Callable[[ClickUpConfig], ClickUpClient] | None = None, workspace_id: str | None = None, limit: int = 25) -> dict[str, Any]:
    config = resolve_config()
    resolved = workspace_id or config.workspace_id
    if not resolved:
        raise ClickUpConfigurationError("Set CLICKUP_WORKSPACE_ID to list ClickUp spaces.")
    client = (client_factory or create_client)(config)
    spaces = client.list_spaces(resolved)["spaces"][:limit]
    return {
        "tool": TOOL_NAME,
        "backend": BACKEND_NAME,
        "data": {
            "space_count": len(spaces),
            "spaces": spaces,
            "scope_preview": build_scope_preview("space.list", "space", workspace_id=resolved),
        },
    }


def build_space_get_payload(*, client_factory: Callable[[ClickUpConfig], ClickUpClient] | None = None, space_id: str | None = None) -> dict[str, Any]:
    config = resolve_config()
    resolved = space_id or config.space_id
    if not resolved:
        raise ClickUpConfigurationError("Set CLICKUP_SPACE_ID to read a ClickUp space.")
    client = (client_factory or create_client)(config)
    space = client.get_space(resolved)["space"]
    return {
        "tool": TOOL_NAME,
        "backend": BACKEND_NAME,
        "data": {
            "space": space,
            "scope_preview": build_scope_preview("space.get", "space", space_id=resolved),
        },
    }


# --- List ---

def build_list_list_payload(*, client_factory: Callable[[ClickUpConfig], ClickUpClient] | None = None, space_id: str | None = None, limit: int = 25) -> dict[str, Any]:
    config = resolve_config()
    resolved = space_id or config.space_id
    if not resolved:
        raise ClickUpConfigurationError("Set CLICKUP_SPACE_ID to list ClickUp lists.")
    client = (client_factory or create_client)(config)
    lists = client.list_lists(space_id=resolved)["lists"][:limit]
    return {
        "tool": TOOL_NAME,
        "backend": BACKEND_NAME,
        "data": {
            "list_count": len(lists),
            "lists": lists,
            "scope_preview": build_scope_preview("list.list", "list", space_id=resolved),
        },
    }


def build_list_get_payload(*, client_factory: Callable[[ClickUpConfig], ClickUpClient] | None = None, list_id: str | None = None) -> dict[str, Any]:
    config = resolve_config()
    resolved = list_id or config.list_id
    if not resolved:
        raise ClickUpConfigurationError("Set CLICKUP_LIST_ID to read a ClickUp list.")
    client = (client_factory or create_client)(config)
    list_data = client.get_list(resolved)["list"]
    return {
        "tool": TOOL_NAME,
        "backend": BACKEND_NAME,
        "data": {
            "list": list_data,
            "scope_preview": build_scope_preview("list.get", "list", list_id=resolved),
        },
    }


def build_list_create_payload(*, client_factory: Callable[[ClickUpConfig], ClickUpClient] | None = None, space_id: str | None = None, name: str) -> dict[str, Any]:
    config = resolve_config()
    resolved = space_id or config.space_id
    if not resolved:
        raise ClickUpConfigurationError("Set CLICKUP_SPACE_ID or pass --space-id to create a list.")
    client = (client_factory or create_client)(config)
    result = client.create_list(space_id=resolved, name=name)
    return {
        "tool": TOOL_NAME,
        "backend": BACKEND_NAME,
        "data": {
            **result,
            "command": "list.create",
            "scope_preview": build_scope_preview("list.create", "list", space_id=resolved),
        },
    }


# --- Task ---

def build_task_list_payload(*, client_factory: Callable[[ClickUpConfig], ClickUpClient] | None = None, list_id: str | None = None, limit: int = 25) -> dict[str, Any]:
    config = resolve_config()
    resolved = list_id or config.list_id
    if not resolved:
        raise ClickUpConfigurationError("Set CLICKUP_LIST_ID to list ClickUp tasks.")
    client = (client_factory or create_client)(config)
    tasks = client.list_tasks(resolved, limit=limit)["tasks"]
    return {
        "tool": TOOL_NAME,
        "backend": BACKEND_NAME,
        "data": {
            "task_count": len(tasks),
            "tasks": tasks,
            "scope_preview": build_scope_preview("task.list", "task", list_id=resolved),
        },
    }


def build_task_get_payload(*, client_factory: Callable[[ClickUpConfig], ClickUpClient] | None = None, task_id: str | None = None) -> dict[str, Any]:
    config = resolve_config()
    resolved = task_id or config.task_id
    if not resolved:
        raise ClickUpConfigurationError("Set CLICKUP_TASK_ID to read a ClickUp task.")
    client = (client_factory or create_client)(config)
    task = client.get_task(resolved)["task"]
    return {
        "tool": TOOL_NAME,
        "backend": BACKEND_NAME,
        "data": {
            "task": task,
            "scope_preview": build_scope_preview("task.get", "task", task_id=resolved),
        },
    }


def build_task_create_payload(
    *,
    client_factory: Callable[[ClickUpConfig], ClickUpClient] | None = None,
    list_id: str | None = None,
    name: str,
    description: str | None = None,
    priority: int | None = None,
    status: str | None = None,
) -> dict[str, Any]:
    config = resolve_config()
    resolved = list_id or config.list_id
    if not resolved:
        raise ClickUpConfigurationError("Set CLICKUP_LIST_ID or pass --list-id to create a task.")
    client = (client_factory or create_client)(config)
    result = client.create_task(list_id=resolved, name=name, description=description, priority=priority, status=status)
    return {
        "tool": TOOL_NAME,
        "backend": BACKEND_NAME,
        "data": {
            **result,
            "command": "task.create",
            "scope_preview": build_scope_preview("task.create", "task", list_id=resolved),
        },
    }


def build_task_update_payload(
    *,
    client_factory: Callable[[ClickUpConfig], ClickUpClient] | None = None,
    task_id: str | None = None,
    name: str | None = None,
    description: str | None = None,
    status: str | None = None,
    priority: int | None = None,
) -> dict[str, Any]:
    config = resolve_config()
    resolved = task_id or config.task_id
    if not resolved:
        raise ClickUpConfigurationError("Set CLICKUP_TASK_ID or pass --task-id to update a task.")
    client = (client_factory or create_client)(config)
    result = client.update_task(task_id=resolved, name=name, description=description, status=status, priority=priority)
    return {
        "tool": TOOL_NAME,
        "backend": BACKEND_NAME,
        "data": {
            **result,
            "command": "task.update",
            "scope_preview": build_scope_preview("task.update", "task", task_id=resolved),
        },
    }


def build_task_delete_payload(*, client_factory: Callable[[ClickUpConfig], ClickUpClient] | None = None, task_id: str | None = None) -> dict[str, Any]:
    config = resolve_config()
    resolved = task_id or config.task_id
    if not resolved:
        raise ClickUpConfigurationError("Set CLICKUP_TASK_ID or pass --task-id to delete a task.")
    client = (client_factory or create_client)(config)
    result = client.delete_task(resolved)
    return {
        "tool": TOOL_NAME,
        "backend": BACKEND_NAME,
        "data": {
            **result,
            "command": "task.delete",
            "scope_preview": build_scope_preview("task.delete", "task", task_id=resolved),
        },
    }


# --- Comment ---

def build_comment_list_payload(*, client_factory: Callable[[ClickUpConfig], ClickUpClient] | None = None, task_id: str | None = None) -> dict[str, Any]:
    config = resolve_config()
    resolved = task_id or config.task_id
    if not resolved:
        raise ClickUpConfigurationError("Set CLICKUP_TASK_ID or pass --task-id to list comments.")
    client = (client_factory or create_client)(config)
    result = client.list_comments(resolved)
    return {
        "tool": TOOL_NAME,
        "backend": BACKEND_NAME,
        "data": {
            **result,
            "scope_preview": build_scope_preview("comment.list", "comment", task_id=resolved),
        },
    }


def build_comment_create_payload(*, client_factory: Callable[[ClickUpConfig], ClickUpClient] | None = None, task_id: str | None = None, comment_text: str) -> dict[str, Any]:
    config = resolve_config()
    resolved = task_id or config.task_id
    if not resolved:
        raise ClickUpConfigurationError("Set CLICKUP_TASK_ID or pass --task-id to create a comment.")
    client = (client_factory or create_client)(config)
    result = client.create_comment(task_id=resolved, comment_text=comment_text)
    return {
        "tool": TOOL_NAME,
        "backend": BACKEND_NAME,
        "data": {
            **result,
            "command": "comment.create",
            "scope_preview": build_scope_preview("comment.create", "comment", task_id=resolved),
        },
    }


# --- Doc ---

def build_doc_list_payload(*, client_factory: Callable[[ClickUpConfig], ClickUpClient] | None = None, workspace_id: str | None = None) -> dict[str, Any]:
    config = resolve_config()
    resolved = workspace_id or config.workspace_id
    if not resolved:
        raise ClickUpConfigurationError("Set CLICKUP_WORKSPACE_ID to list docs.")
    client = (client_factory or create_client)(config)
    result = client.list_docs(resolved)
    return {
        "tool": TOOL_NAME,
        "backend": BACKEND_NAME,
        "data": {
            **result,
            "scope_preview": build_scope_preview("doc.list", "doc", workspace_id=resolved),
        },
    }


def build_doc_get_payload(*, client_factory: Callable[[ClickUpConfig], ClickUpClient] | None = None, doc_id: str) -> dict[str, Any]:
    config = resolve_config()
    client = (client_factory or create_client)(config)
    result = client.get_doc(doc_id)
    return {
        "tool": TOOL_NAME,
        "backend": BACKEND_NAME,
        "data": {
            **result,
            "scope_preview": build_scope_preview("doc.get", "doc", doc_id=doc_id),
        },
    }


def build_doc_create_payload(*, client_factory: Callable[[ClickUpConfig], ClickUpClient] | None = None, workspace_id: str | None = None, name: str, content: str | None = None) -> dict[str, Any]:
    config = resolve_config()
    resolved = workspace_id or config.workspace_id
    if not resolved:
        raise ClickUpConfigurationError("Set CLICKUP_WORKSPACE_ID or pass --workspace-id to create a doc.")
    client = (client_factory or create_client)(config)
    result = client.create_doc(workspace_id=resolved, name=name, content=content)
    return {
        "tool": TOOL_NAME,
        "backend": BACKEND_NAME,
        "data": {
            **result,
            "command": "doc.create",
            "scope_preview": build_scope_preview("doc.create", "doc", workspace_id=resolved),
        },
    }


# --- Time Tracking ---

def build_time_tracking_list_payload(*, client_factory: Callable[[ClickUpConfig], ClickUpClient] | None = None, task_id: str | None = None) -> dict[str, Any]:
    config = resolve_config()
    resolved = task_id or config.task_id
    if not resolved:
        raise ClickUpConfigurationError("Set CLICKUP_TASK_ID or pass --task-id to list time entries.")
    client = (client_factory or create_client)(config)
    result = client.list_time_entries(resolved)
    return {
        "tool": TOOL_NAME,
        "backend": BACKEND_NAME,
        "data": {
            **result,
            "scope_preview": build_scope_preview("time_tracking.list", "time_tracking", task_id=resolved),
        },
    }


def build_time_tracking_create_payload(*, client_factory: Callable[[ClickUpConfig], ClickUpClient] | None = None, task_id: str | None = None, duration: int, description: str | None = None) -> dict[str, Any]:
    config = resolve_config()
    resolved = task_id or config.task_id
    if not resolved:
        raise ClickUpConfigurationError("Set CLICKUP_TASK_ID or pass --task-id to create a time entry.")
    client = (client_factory or create_client)(config)
    result = client.create_time_entry(task_id=resolved, duration=duration, description=description)
    return {
        "tool": TOOL_NAME,
        "backend": BACKEND_NAME,
        "data": {
            **result,
            "command": "time_tracking.create",
            "scope_preview": build_scope_preview("time_tracking.create", "time_tracking", task_id=resolved),
        },
    }


# --- Goal ---

def build_goal_list_payload(*, client_factory: Callable[[ClickUpConfig], ClickUpClient] | None = None, workspace_id: str | None = None) -> dict[str, Any]:
    config = resolve_config()
    resolved = workspace_id or config.workspace_id
    if not resolved:
        raise ClickUpConfigurationError("Set CLICKUP_WORKSPACE_ID to list goals.")
    client = (client_factory or create_client)(config)
    result = client.list_goals(resolved)
    return {
        "tool": TOOL_NAME,
        "backend": BACKEND_NAME,
        "data": {
            **result,
            "scope_preview": build_scope_preview("goal.list", "goal", workspace_id=resolved),
        },
    }


def build_goal_get_payload(*, client_factory: Callable[[ClickUpConfig], ClickUpClient] | None = None, goal_id: str) -> dict[str, Any]:
    config = resolve_config()
    client = (client_factory or create_client)(config)
    result = client.get_goal(goal_id)
    return {
        "tool": TOOL_NAME,
        "backend": BACKEND_NAME,
        "data": {
            **result,
            "scope_preview": build_scope_preview("goal.get", "goal", goal_id=goal_id),
        },
    }
