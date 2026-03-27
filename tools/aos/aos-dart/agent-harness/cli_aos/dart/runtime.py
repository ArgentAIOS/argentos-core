from __future__ import annotations

import json
import shutil
from typing import Any, Callable

from .client import DartClient
from .config import DartConfig, redact_config, resolve_config
from .constants import (
    BACKEND_NAME,
    CONNECTOR_PATH,
    IMPLEMENTATION_MODE,
    LIVE_READ_SURFACES,
    LIVE_WRITE_SURFACES,
    TOOL_NAME,
)
from .errors import DartConfigurationError


def resolve_runtime_binary() -> str | None:
    return shutil.which("aos-dart")


def create_client(config: DartConfig | None = None) -> DartClient:
    config = config or resolve_config()
    if not config.api_key:
        raise DartConfigurationError("DART_API_KEY is required")
    return DartClient(api_key=config.api_key, base_url=config.base_url)


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
                "dartboard_id": config.dartboard_id,
                "task_id": config.task_id,
                "doc_id": config.doc_id,
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


def _probe_details(client: DartClient, config: DartConfig) -> dict[str, Any]:
    details: dict[str, Any] = {"dartboards": client.list_dartboards(limit=5)["dartboards"]}
    if config.dartboard_id:
        details["dartboard"] = client.get_dartboard(config.dartboard_id)["dartboard"]
        details["tasks"] = client.list_tasks(dartboard_id=config.dartboard_id, limit=5)["tasks"]
    if config.task_id:
        details["task"] = client.get_task(config.task_id)["task"]
    return details


def build_health_payload(*, client_factory: Callable[[DartConfig], DartClient] | None = None) -> dict[str, Any]:
    client_factory = client_factory or create_client
    config = resolve_config()
    runtime_binary = resolve_runtime_binary()
    checks: list[dict[str, Any]] = [
        {
            "name": "connector_runtime",
            "label": "Connector runtime installed",
            "ok": bool(runtime_binary),
            "optional": False,
            "summary": runtime_binary or "Install the harness so the aos-dart binary is available on PATH.",
        },
        {
            "name": "api_key",
            "label": "Dart API key configured",
            "ok": bool(config.api_key),
            "optional": False,
            "summary": "DART_API_KEY is set" if config.api_key else "Add DART_API_KEY in API Keys.",
        },
        {
            "name": "dartboard_scope",
            "label": "Dartboard scope pinned",
            "ok": bool(config.dartboard_id),
            "optional": True,
            "summary": config.dartboard_id or "Optional: set DART_DARTBOARD_ID for deeper reads.",
        },
    ]
    probe = None
    if config.api_key:
        try:
            client = client_factory(config)
            probe = {"ok": True, **_probe_details(client, config)}
        except Exception as exc:  # noqa: BLE001
            probe = {"ok": False, "error": str(exc)}
            checks.append({"name": "api_probe", "label": "Dart API probe", "ok": False, "optional": False, "summary": str(exc)})
        else:
            checks.append({"name": "api_probe", "label": "Dart API probe", "ok": True, "optional": False, "summary": "Dart live reads succeeded."})
    ok = bool(runtime_binary) and bool(config.api_key) and bool(probe) and probe.get("ok") is True
    next_steps = []
    if not runtime_binary:
        next_steps.append("Install the harness so the aos-dart binary is on PATH.")
    if not config.api_key:
        next_steps.append("Create a Dart API key and add DART_API_KEY.")
    if not config.dartboard_id:
        next_steps.append("Optional: pin DART_DARTBOARD_ID for dartboard-scoped reads.")
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
        "data": {"status": health["data"]["status"], "checks": health["data"]["checks"], "probe": health["data"]["probe"], "summary": "Dart connector diagnostics complete."},
    }


# --- Dartboard ---

def build_dartboard_list_payload(*, client_factory: Callable[[DartConfig], DartClient] | None = None, limit: int = 25) -> dict[str, Any]:
    client = (client_factory or create_client)(resolve_config())
    dartboards = client.list_dartboards(limit=limit)["dartboards"]
    return {"tool": TOOL_NAME, "backend": BACKEND_NAME, "data": {"dartboard_count": len(dartboards), "dartboards": dartboards, "scope_preview": build_scope_preview("dartboard.list", "dartboard")}}


def build_dartboard_get_payload(*, client_factory: Callable[[DartConfig], DartClient] | None = None, dartboard_id: str | None = None) -> dict[str, Any]:
    config = resolve_config()
    resolved = dartboard_id or config.dartboard_id
    if not resolved:
        raise DartConfigurationError("Set DART_DARTBOARD_ID or pass a dartboard_id to read a dartboard.")
    client = (client_factory or create_client)(config)
    dartboard = client.get_dartboard(resolved)["dartboard"]
    return {"tool": TOOL_NAME, "backend": BACKEND_NAME, "data": {"dartboard": dartboard, "scope_preview": build_scope_preview("dartboard.get", "dartboard", dartboard_id=resolved)}}


# --- Task ---

def build_task_list_payload(*, client_factory: Callable[[DartConfig], DartClient] | None = None, dartboard_id: str | None = None, assignee: str | None = None, status: str | None = None, limit: int = 25) -> dict[str, Any]:
    config = resolve_config()
    resolved_dartboard = dartboard_id or config.dartboard_id
    client = (client_factory or create_client)(config)
    tasks = client.list_tasks(dartboard_id=resolved_dartboard, assignee=assignee, status=status, limit=limit)["tasks"]
    return {"tool": TOOL_NAME, "backend": BACKEND_NAME, "data": {"task_count": len(tasks), "tasks": tasks, "scope_preview": build_scope_preview("task.list", "task", dartboard_id=resolved_dartboard)}}


def build_task_get_payload(*, client_factory: Callable[[DartConfig], DartClient] | None = None, task_id: str | None = None) -> dict[str, Any]:
    config = resolve_config()
    resolved = task_id or config.task_id
    if not resolved:
        raise DartConfigurationError("Set DART_TASK_ID or pass a task_id to read a task.")
    client = (client_factory or create_client)(config)
    task = client.get_task(resolved)["task"]
    return {"tool": TOOL_NAME, "backend": BACKEND_NAME, "data": {"task": task, "scope_preview": build_scope_preview("task.get", "task", task_id=resolved)}}


def build_task_create_payload(*, client_factory: Callable[[DartConfig], DartClient] | None = None, dartboard_id: str | None = None, title: str, description: str | None = None, assignee: str | None = None, priority: str | None = None) -> dict[str, Any]:
    config = resolve_config()
    resolved = dartboard_id or config.dartboard_id
    if not resolved:
        raise DartConfigurationError("Set DART_DARTBOARD_ID or pass --dartboard-id to create a task.")
    client = (client_factory or create_client)(config)
    result = client.create_task(dartboard_id=resolved, title=title, description=description, assignee=assignee, priority=priority)
    return {"tool": TOOL_NAME, "backend": BACKEND_NAME, "data": {**result, "command": "task.create", "scope_preview": build_scope_preview("task.create", "task", dartboard_id=resolved)}}


def build_task_update_payload(*, client_factory: Callable[[DartConfig], DartClient] | None = None, task_id: str | None = None, title: str | None = None, description: str | None = None, status: str | None = None, assignee: str | None = None, priority: str | None = None) -> dict[str, Any]:
    config = resolve_config()
    resolved = task_id or config.task_id
    if not resolved:
        raise DartConfigurationError("Set DART_TASK_ID or pass --task-id to update a task.")
    client = (client_factory or create_client)(config)
    result = client.update_task(task_id=resolved, title=title, description=description, status=status, assignee=assignee, priority=priority)
    return {"tool": TOOL_NAME, "backend": BACKEND_NAME, "data": {**result, "command": "task.update", "scope_preview": build_scope_preview("task.update", "task", task_id=resolved)}}


def build_task_delete_payload(*, client_factory: Callable[[DartConfig], DartClient] | None = None, task_id: str | None = None) -> dict[str, Any]:
    config = resolve_config()
    resolved = task_id or config.task_id
    if not resolved:
        raise DartConfigurationError("Set DART_TASK_ID or pass --task-id to delete a task.")
    client = (client_factory or create_client)(config)
    result = client.delete_task(resolved)
    return {"tool": TOOL_NAME, "backend": BACKEND_NAME, "data": {**result, "command": "task.delete", "scope_preview": build_scope_preview("task.delete", "task", task_id=resolved)}}


# --- Doc ---

def build_doc_list_payload(*, client_factory: Callable[[DartConfig], DartClient] | None = None, limit: int = 25) -> dict[str, Any]:
    client = (client_factory or create_client)(resolve_config())
    docs = client.list_docs(limit=limit)["docs"]
    return {"tool": TOOL_NAME, "backend": BACKEND_NAME, "data": {"doc_count": len(docs), "docs": docs, "scope_preview": build_scope_preview("doc.list", "doc")}}


def build_doc_get_payload(*, client_factory: Callable[[DartConfig], DartClient] | None = None, doc_id: str | None = None) -> dict[str, Any]:
    config = resolve_config()
    resolved = doc_id or config.doc_id
    if not resolved:
        raise DartConfigurationError("Pass a doc_id to read a doc.")
    client = (client_factory or create_client)(config)
    doc = client.get_doc(resolved)["doc"]
    return {"tool": TOOL_NAME, "backend": BACKEND_NAME, "data": {"doc": doc, "scope_preview": build_scope_preview("doc.get", "doc", doc_id=resolved)}}


def build_doc_create_payload(*, client_factory: Callable[[DartConfig], DartClient] | None = None, title: str, content: str | None = None) -> dict[str, Any]:
    client = (client_factory or create_client)(resolve_config())
    result = client.create_doc(title=title, content=content)
    return {"tool": TOOL_NAME, "backend": BACKEND_NAME, "data": {**result, "command": "doc.create", "scope_preview": build_scope_preview("doc.create", "doc")}}


# --- Comment ---

def build_comment_list_payload(*, client_factory: Callable[[DartConfig], DartClient] | None = None, task_id: str | None = None) -> dict[str, Any]:
    config = resolve_config()
    resolved = task_id or config.task_id
    if not resolved:
        raise DartConfigurationError("Set DART_TASK_ID or pass --task-id to list comments.")
    client = (client_factory or create_client)(config)
    result = client.list_comments(resolved)
    return {"tool": TOOL_NAME, "backend": BACKEND_NAME, "data": {**result, "scope_preview": build_scope_preview("comment.list", "comment", task_id=resolved)}}


def build_comment_create_payload(*, client_factory: Callable[[DartConfig], DartClient] | None = None, task_id: str | None = None, text: str) -> dict[str, Any]:
    config = resolve_config()
    resolved = task_id or config.task_id
    if not resolved:
        raise DartConfigurationError("Set DART_TASK_ID or pass --task-id to create a comment.")
    client = (client_factory or create_client)(config)
    result = client.create_comment(task_id=resolved, text=text)
    return {"tool": TOOL_NAME, "backend": BACKEND_NAME, "data": {**result, "command": "comment.create", "scope_preview": build_scope_preview("comment.create", "comment", task_id=resolved)}}


# --- Property ---

def build_property_list_payload(*, client_factory: Callable[[DartConfig], DartClient] | None = None) -> dict[str, Any]:
    client = (client_factory or create_client)(resolve_config())
    result = client.list_properties()
    return {"tool": TOOL_NAME, "backend": BACKEND_NAME, "data": {**result, "scope_preview": build_scope_preview("property.list", "property")}}
