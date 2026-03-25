from __future__ import annotations

import json
import shutil
from pathlib import Path
from typing import Any, Callable

from .client import ClickUpClient
from .config import ClickUpConfig, redact_config, resolve_config, resolve_workspace_id
from .constants import (
    BACKEND_NAME,
    CONNECTOR_PATH,
    IMPLEMENTATION_MODE,
    LIVE_READ_SURFACES,
    SCAFFOLDED_SURFACES,
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
                "team_id": config.team_id,
                "space_id": config.space_id,
                "folder_id": config.folder_id,
                "list_id": config.list_id,
                "task_id": config.task_id,
                "resolved_workspace_id": resolve_workspace_id(config),
            },
            "runtime": {
                "binary_path": resolve_runtime_binary(),
                "implementation_mode": IMPLEMENTATION_MODE,
                "live_read_surfaces": LIVE_READ_SURFACES,
                "scaffolded_surfaces": SCAFFOLDED_SURFACES,
                "command_defaults": manifest["scope"].get("commandDefaults", {}),
            },
        },
    }


def _probe_details(client: ClickUpClient, config: ClickUpConfig) -> dict[str, Any]:
    details: dict[str, Any] = {"authorized_workspaces": client.list_workspaces()["workspaces"]}
    workspace_id = resolve_workspace_id(config)
    if workspace_id:
        details["workspace"] = client.read_workspace(workspace_id)["workspace"]
        details["spaces"] = client.list_spaces(workspace_id)["spaces"]
    if config.space_id:
        details["space"] = client.read_space(config.space_id)["space"]
    if config.folder_id:
        details["folder"] = client.read_folder(config.folder_id)["folder"]
    if config.list_id:
        details["list"] = client.read_list(config.list_id)["list"]
        details["tasks"] = client.list_tasks(config.list_id)["tasks"]
    if config.task_id:
        details["task"] = client.read_task(config.task_id)["task"]
    return details


def build_health_payload(*, client_factory: Callable[[ClickUpConfig], ClickUpClient] | None = None) -> dict[str, Any]:
    client_factory = client_factory or create_client
    config = resolve_config()
    runtime_binary = resolve_runtime_binary()
    workspace_id = resolve_workspace_id(config)
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
            "ok": bool(workspace_id),
            "optional": False,
            "summary": workspace_id or "Set CLICKUP_WORKSPACE_ID or CLICKUP_TEAM_ID so worker-visible reads have a stable scope.",
        },
        {
            "name": "space_scope",
            "label": "Space scope pinned",
            "ok": bool(config.space_id),
            "optional": True,
            "summary": config.space_id or "Optional: set CLICKUP_SPACE_ID for deeper reads.",
        },
        {
            "name": "folder_scope",
            "label": "Folder scope pinned",
            "ok": bool(config.folder_id),
            "optional": True,
            "summary": config.folder_id or "Optional: set CLICKUP_FOLDER_ID for folder reads.",
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
    ok = bool(runtime_binary) and bool(config.api_token) and bool(workspace_id) and bool(probe) and probe.get("ok") is True
    next_steps = []
    if not runtime_binary:
        next_steps.append("Install the harness so the aos-clickup binary is on PATH.")
    if not config.api_token:
        next_steps.append("Create or choose a ClickUp token and add CLICKUP_API_TOKEN or CLICKUP_ACCESS_TOKEN.")
    if not workspace_id:
        next_steps.append("Set CLICKUP_WORKSPACE_ID or CLICKUP_TEAM_ID so live reads have an explicit workspace scope.")
    if not config.space_id:
        next_steps.append("Optional: pin CLICKUP_SPACE_ID for space and folder discovery.")
    if not config.list_id:
        next_steps.append("Optional: pin CLICKUP_LIST_ID to narrow task discovery.")
    next_steps.append("Keep task.create_draft and task.update_draft scaffolded until a live write bridge is approved.")
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


def build_workspace_read_payload(*, client_factory: Callable[[ClickUpConfig], ClickUpClient] | None = None, workspace_id: str | None = None) -> dict[str, Any]:
    config = resolve_config()
    resolved_workspace_id = workspace_id or resolve_workspace_id(config)
    if not resolved_workspace_id:
        raise ClickUpConfigurationError("Set CLICKUP_WORKSPACE_ID or CLICKUP_TEAM_ID to read a ClickUp workspace.")
    client = (client_factory or create_client)(config)
    workspace = client.read_workspace(resolved_workspace_id)["workspace"]
    return {
        "tool": TOOL_NAME,
        "backend": BACKEND_NAME,
        "data": {
            "workspace": workspace,
            "scope_preview": build_scope_preview("workspace.read", "workspace", workspace_id=resolved_workspace_id),
        },
    }


def build_space_list_payload(*, client_factory: Callable[[ClickUpConfig], ClickUpClient] | None = None, workspace_id: str | None = None, limit: int = 25) -> dict[str, Any]:
    config = resolve_config()
    resolved_workspace_id = workspace_id or resolve_workspace_id(config)
    if not resolved_workspace_id:
        raise ClickUpConfigurationError("Set CLICKUP_WORKSPACE_ID or CLICKUP_TEAM_ID to list ClickUp spaces.")
    client = (client_factory or create_client)(config)
    spaces = client.list_spaces(resolved_workspace_id)["spaces"][:limit]
    return {
        "tool": TOOL_NAME,
        "backend": BACKEND_NAME,
        "data": {
            "space_count": len(spaces),
            "spaces": spaces,
            "scope_preview": build_scope_preview("space.list", "space", workspace_id=resolved_workspace_id),
        },
    }


def build_space_read_payload(*, client_factory: Callable[[ClickUpConfig], ClickUpClient] | None = None, space_id: str | None = None) -> dict[str, Any]:
    config = resolve_config()
    resolved_space_id = space_id or config.space_id
    if not resolved_space_id:
        raise ClickUpConfigurationError("Set CLICKUP_SPACE_ID to read a ClickUp space.")
    client = (client_factory or create_client)(config)
    space = client.read_space(resolved_space_id)["space"]
    return {
        "tool": TOOL_NAME,
        "backend": BACKEND_NAME,
        "data": {
            "space": space,
            "scope_preview": build_scope_preview("space.read", "space", space_id=resolved_space_id),
        },
    }


def build_folder_list_payload(*, client_factory: Callable[[ClickUpConfig], ClickUpClient] | None = None, space_id: str | None = None, limit: int = 25) -> dict[str, Any]:
    config = resolve_config()
    resolved_space_id = space_id or config.space_id
    if not resolved_space_id:
        raise ClickUpConfigurationError("Set CLICKUP_SPACE_ID to list ClickUp folders.")
    client = (client_factory or create_client)(config)
    folders = client.list_folders(resolved_space_id)["folders"][:limit]
    return {
        "tool": TOOL_NAME,
        "backend": BACKEND_NAME,
        "data": {
            "folder_count": len(folders),
            "folders": folders,
            "scope_preview": build_scope_preview("folder.list", "folder", space_id=resolved_space_id),
        },
    }


def build_folder_read_payload(*, client_factory: Callable[[ClickUpConfig], ClickUpClient] | None = None, folder_id: str | None = None) -> dict[str, Any]:
    config = resolve_config()
    resolved_folder_id = folder_id or config.folder_id
    if not resolved_folder_id:
        raise ClickUpConfigurationError("Set CLICKUP_FOLDER_ID to read a ClickUp folder.")
    client = (client_factory or create_client)(config)
    folder = client.read_folder(resolved_folder_id)["folder"]
    return {
        "tool": TOOL_NAME,
        "backend": BACKEND_NAME,
        "data": {
            "folder": folder,
            "scope_preview": build_scope_preview("folder.read", "folder", folder_id=resolved_folder_id),
        },
    }


def build_list_list_payload(*, client_factory: Callable[[ClickUpConfig], ClickUpClient] | None = None, space_id: str | None = None, folder_id: str | None = None, limit: int = 25) -> dict[str, Any]:
    config = resolve_config()
    resolved_space_id = space_id or config.space_id
    resolved_folder_id = folder_id or config.folder_id
    if not resolved_space_id and not resolved_folder_id:
        raise ClickUpConfigurationError("Set CLICKUP_SPACE_ID or CLICKUP_FOLDER_ID to list ClickUp lists.")
    client = (client_factory or create_client)(config)
    lists = client.list_lists(space_id=resolved_space_id, folder_id=resolved_folder_id)["lists"][:limit]
    return {
        "tool": TOOL_NAME,
        "backend": BACKEND_NAME,
        "data": {
            "list_count": len(lists),
            "lists": lists,
            "scope_preview": build_scope_preview("list.list", "list", space_id=resolved_space_id, folder_id=resolved_folder_id),
        },
    }


def build_list_read_payload(*, client_factory: Callable[[ClickUpConfig], ClickUpClient] | None = None, list_id: str | None = None) -> dict[str, Any]:
    config = resolve_config()
    resolved_list_id = list_id or config.list_id
    if not resolved_list_id:
        raise ClickUpConfigurationError("Set CLICKUP_LIST_ID to read a ClickUp list.")
    client = (client_factory or create_client)(config)
    list_data = client.read_list(resolved_list_id)["list"]
    return {
        "tool": TOOL_NAME,
        "backend": BACKEND_NAME,
        "data": {
            "list": list_data,
            "scope_preview": build_scope_preview("list.read", "list", list_id=resolved_list_id),
        },
    }


def build_task_list_payload(*, client_factory: Callable[[ClickUpConfig], ClickUpClient] | None = None, list_id: str | None = None, limit: int = 25) -> dict[str, Any]:
    config = resolve_config()
    resolved_list_id = list_id or config.list_id
    if not resolved_list_id:
        raise ClickUpConfigurationError("Set CLICKUP_LIST_ID to list ClickUp tasks.")
    client = (client_factory or create_client)(config)
    tasks = client.list_tasks(resolved_list_id, limit=limit)["tasks"]
    return {
        "tool": TOOL_NAME,
        "backend": BACKEND_NAME,
        "data": {
            "task_count": len(tasks),
            "tasks": tasks,
            "scope_preview": build_scope_preview("task.list", "task", list_id=resolved_list_id),
        },
    }


def build_task_read_payload(*, client_factory: Callable[[ClickUpConfig], ClickUpClient] | None = None, task_id: str | None = None) -> dict[str, Any]:
    config = resolve_config()
    resolved_task_id = task_id or config.task_id
    if not resolved_task_id:
        raise ClickUpConfigurationError("Set CLICKUP_TASK_ID to read a ClickUp task.")
    client = (client_factory or create_client)(config)
    task = client.read_task(resolved_task_id)["task"]
    return {
        "tool": TOOL_NAME,
        "backend": BACKEND_NAME,
        "data": {
            "task": task,
            "scope_preview": build_scope_preview("task.read", "task", task_id=resolved_task_id),
        },
    }


def build_task_create_draft_payload(*, list_id: str | None = None, name: str, description: str | None = None, due_date: str | None = None) -> dict[str, Any]:
    config = resolve_config()
    resolved_list_id = list_id or config.list_id
    if not resolved_list_id:
        raise ClickUpConfigurationError("Set CLICKUP_LIST_ID or pass --list-id to draft a task.")
    client = create_client(config)
    return {
        "tool": TOOL_NAME,
        "backend": BACKEND_NAME,
        "data": {
            **client.create_task_draft(list_id=resolved_list_id, name=name, description=description, due_date=due_date),
            "command": "task.create_draft",
            "scope_preview": build_scope_preview("task.create_draft", "task", list_id=resolved_list_id),
        },
    }


def build_task_update_draft_payload(
    *,
    task_id: str | None = None,
    name: str | None = None,
    description: str | None = None,
    list_id: str | None = None,
    due_date: str | None = None,
    status: str | None = None,
) -> dict[str, Any]:
    config = resolve_config()
    resolved_task_id = task_id or config.task_id
    if not resolved_task_id:
        raise ClickUpConfigurationError("Set CLICKUP_TASK_ID or pass --task-id to draft a task update.")
    client = create_client(config)
    return {
        "tool": TOOL_NAME,
        "backend": BACKEND_NAME,
        "data": {
            **client.update_task_draft(
                task_id=resolved_task_id,
                name=name,
                description=description,
                list_id=list_id or config.list_id,
                due_date=due_date,
                status=status,
            ),
            "command": "task.update_draft",
            "scope_preview": build_scope_preview("task.update_draft", "task", task_id=resolved_task_id, list_id=list_id or config.list_id),
        },
    }
