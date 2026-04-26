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
    MODE_ORDER,
    TOOL_NAME,
)
from .errors import DartConfigurationError, DartUsageError


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
    manifest = build_manifest_payload()
    return {
        "tool": manifest["tool"],
        "backend": manifest["backend"],
        "version": manifest.get("version", "0.1.0"),
        "manifest_schema_version": manifest.get("manifest_schema_version", "1.0.0"),
        "modes": MODE_ORDER,
        "connector": manifest["connector"],
        "auth": manifest["auth"],
        "scope": manifest.get("scope", {}),
        "commands": manifest["commands"],
    }


def build_scope_preview(command_id: str, selection_surface: str, **extra: Any) -> dict[str, Any]:
    payload = {"command_id": command_id, "selection_surface": selection_surface}
    payload.update({key: value for key, value in extra.items() if value is not None})
    return payload


def _command_readiness(config: DartConfig) -> dict[str, bool]:
    api_ready = bool(config.api_key)
    dartboard_scoped = bool(config.api_key and config.dartboard_id)
    task_scoped = bool(config.api_key and config.task_id)
    doc_scoped = bool(config.api_key and config.doc_id)
    return {
        "capabilities": True,
        "health": True,
        "config.show": True,
        "doctor": True,
        "dartboard.list": api_ready,
        "dartboard.get": dartboard_scoped,
        "task.list": api_ready,
        "task.get": task_scoped,
        "task.create": dartboard_scoped,
        "task.update": task_scoped,
        "task.delete": task_scoped,
        "doc.list": api_ready,
        "doc.get": doc_scoped,
        "doc.create": api_ready,
        "comment.list": task_scoped,
        "comment.create": task_scoped,
        "property.list": api_ready,
    }


def build_config_show_payload() -> dict[str, Any]:
    config = resolve_config()
    manifest = build_manifest_payload()
    command_readiness = _command_readiness(config)
    return {
        "tool": TOOL_NAME,
        "backend": BACKEND_NAME,
        "data": {
            "auth": {
                "kind": manifest["auth"]["kind"],
                "required": manifest["auth"]["required"],
                "service_keys": list(manifest["auth"]["service_keys"]),
                "configured": {"DART_API_KEY": bool(config.api_key)},
                "sources": {"DART_API_KEY": config.api_key_source},
                "redacted": {"DART_API_KEY": "<redacted>" if config.api_key else None},
                "interactive_setup": list(manifest["auth"]["interactive_setup"]),
            },
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
                "service_key_precedence": "service-keys-first-with-env-fallback",
                "command_defaults": manifest["scope"].get("commandDefaults", {}),
                "command_readiness": command_readiness,
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
            "optional": True,
            "summary": runtime_binary or "Install the harness so the aos-dart binary is available on PATH.",
        },
        {
            "name": "api_key",
            "label": "Dart API key configured",
            "ok": bool(config.api_key),
            "optional": False,
            "summary": "DART_API_KEY is configured" if config.api_key else "Add DART_API_KEY in operator service keys or use a local env fallback.",
            "details": {"source": config.api_key_source, "required_service_key": "DART_API_KEY"},
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
            probe = {"ok": True, "details": _probe_details(client, config)}
        except Exception as exc:  # noqa: BLE001
            probe = {"ok": False, "message": str(exc)}
            checks.append({"name": "api_probe", "label": "Dart API probe", "ok": False, "optional": False, "summary": str(exc)})
        else:
            checks.append({"name": "api_probe", "label": "Dart API probe", "ok": True, "optional": False, "summary": "Dart live reads succeeded."})
    ok = bool(config.api_key) and bool(probe) and probe.get("ok") is True
    status = "ready" if ok else ("needs_setup" if not config.api_key else "degraded")
    next_steps = []
    if not config.api_key:
        next_steps.append("Add DART_API_KEY to operator-controlled service keys first; use DART_API_KEY in the local env only as a harness fallback.")
    if not config.dartboard_id:
        next_steps.append("Optional: pin DART_DARTBOARD_ID for dartboard-scoped reads.")
    if not runtime_binary:
        next_steps.append("Optional: install aos-dart on PATH for shell-first operator workflows.")
    return {
        "tool": TOOL_NAME,
        "backend": BACKEND_NAME,
        "data": {
            "status": status,
            "summary": "Dart connector health check complete.",
            "connector": {
                "backend": BACKEND_NAME,
                "live_backend_available": bool(probe and probe.get("ok")),
                "live_read_available": bool(probe and probe.get("ok")),
                "live_write_available": bool(probe and probe.get("ok")),
                "write_bridge_available": True,
                "scaffold_only": False,
            },
            "auth": {
                "api_key_present": bool(config.api_key),
                "api_key_source": config.api_key_source,
                "service_key_name": "DART_API_KEY",
            },
            "checks": checks,
            "probe": probe,
            "next_steps": next_steps,
        },
    }


def build_doctor_payload() -> dict[str, Any]:
    health = build_health_payload()["data"]
    config = resolve_config()
    return {
        "tool": TOOL_NAME,
        "backend": BACKEND_NAME,
        "data": {
            "status": health["status"],
            "summary": "Dart connector diagnostics complete.",
            "runtime": {
                "implementation_mode": IMPLEMENTATION_MODE,
                "binary_path": resolve_runtime_binary(),
                "service_key_precedence": "service-keys-first-with-env-fallback",
                "command_readiness": _command_readiness(config),
                "dartboard_id_present": bool(config.dartboard_id),
                "task_id_present": bool(config.task_id),
                "doc_id_present": bool(config.doc_id),
            },
            "checks": health["checks"],
            "probe": health["probe"],
            "supported_read_commands": [command for command in LIVE_READ_SURFACES],
            "supported_write_commands": list(LIVE_WRITE_SURFACES),
            "next_steps": health["next_steps"],
        },
    }


# --- Dartboard ---

def build_dartboard_list_payload(*, client_factory: Callable[[DartConfig], DartClient] | None = None, limit: int = 25) -> dict[str, Any]:
    client = (client_factory or create_client)(resolve_config())
    dartboards = client.list_dartboards(limit=limit)["dartboards"]
    return {
        "tool": TOOL_NAME,
        "backend": BACKEND_NAME,
        "data": {
            "status": "live_read",
            "summary": f"Returned {len(dartboards)} Dart dartboard{'s' if len(dartboards) != 1 else ''}.",
            "dartboard_count": len(dartboards),
            "dartboards": dartboards,
            "scope_preview": build_scope_preview("dartboard.list", "dartboard"),
        },
    }


def build_dartboard_get_payload(*, client_factory: Callable[[DartConfig], DartClient] | None = None, dartboard_id: str | None = None) -> dict[str, Any]:
    config = resolve_config()
    resolved = dartboard_id or config.dartboard_id
    if not resolved:
        raise DartConfigurationError("Set DART_DARTBOARD_ID or pass a dartboard ID to read a dartboard.")
    client = (client_factory or create_client)(config)
    dartboard = client.get_dartboard(resolved)["dartboard"]
    return {
        "tool": TOOL_NAME,
        "backend": BACKEND_NAME,
        "data": {
            "status": "live_read",
            "summary": f"Read Dart dartboard {resolved}.",
            "dartboard": dartboard,
            "scope_preview": build_scope_preview("dartboard.get", "dartboard", dartboard_id=resolved),
        },
    }


# --- Task ---

def build_task_list_payload(*, client_factory: Callable[[DartConfig], DartClient] | None = None, dartboard_id: str | None = None, assignee: str | None = None, status: str | None = None, limit: int = 25) -> dict[str, Any]:
    config = resolve_config()
    resolved_dartboard = dartboard_id or config.dartboard_id
    client = (client_factory or create_client)(config)
    tasks = client.list_tasks(dartboard_id=resolved_dartboard, assignee=assignee, status=status, limit=limit)["tasks"]
    return {
        "tool": TOOL_NAME,
        "backend": BACKEND_NAME,
        "data": {
            "status": "live_read",
            "summary": f"Returned {len(tasks)} Dart task{'s' if len(tasks) != 1 else ''}.",
            "task_count": len(tasks),
            "tasks": tasks,
            "scope_preview": build_scope_preview("task.list", "task", dartboard_id=resolved_dartboard),
        },
    }


def build_task_get_payload(*, client_factory: Callable[[DartConfig], DartClient] | None = None, task_id: str | None = None) -> dict[str, Any]:
    config = resolve_config()
    resolved = task_id or config.task_id
    if not resolved:
        raise DartConfigurationError("Set DART_TASK_ID or pass a task ID to read a task.")
    client = (client_factory or create_client)(config)
    task = client.get_task(resolved)["task"]
    return {
        "tool": TOOL_NAME,
        "backend": BACKEND_NAME,
        "data": {
            "status": "live_read",
            "summary": f"Read Dart task {resolved}.",
            "task": task,
            "scope_preview": build_scope_preview("task.get", "task", task_id=resolved),
        },
    }


def build_task_create_payload(*, client_factory: Callable[[DartConfig], DartClient] | None = None, dartboard_id: str | None = None, title: str, description: str | None = None, assignee: str | None = None, priority: str | None = None) -> dict[str, Any]:
    config = resolve_config()
    resolved = dartboard_id or config.dartboard_id
    if not resolved:
        raise DartConfigurationError("Set DART_DARTBOARD_ID or pass --dartboard-id to create a task.")
    client = (client_factory or create_client)(config)
    result = client.create_task(dartboard_id=resolved, title=title, description=description, assignee=assignee, priority=priority)
    task = result["task"]
    return {
        "tool": TOOL_NAME,
        "backend": BACKEND_NAME,
        "data": {
            "status": "live_write",
            "summary": f"Created Dart task {task.get('id') or task.get('title') or title}.",
            "task": task,
            "scope_preview": build_scope_preview("task.create", "task", dartboard_id=resolved),
        },
    }


def build_task_update_payload(*, client_factory: Callable[[DartConfig], DartClient] | None = None, task_id: str | None = None, title: str | None = None, description: str | None = None, status: str | None = None, assignee: str | None = None, priority: str | None = None) -> dict[str, Any]:
    config = resolve_config()
    resolved = task_id or config.task_id
    if not resolved:
        raise DartConfigurationError("Set DART_TASK_ID or pass a task ID to update a task.")
    if all(value is None for value in (title, description, status, assignee, priority)):
        raise DartUsageError("Provide at least one field to update.", details={"fields": ["title", "description", "status", "assignee", "priority"]})
    client = (client_factory or create_client)(config)
    result = client.update_task(task_id=resolved, title=title, description=description, status=status, assignee=assignee, priority=priority)
    task = result["task"]
    return {
        "tool": TOOL_NAME,
        "backend": BACKEND_NAME,
        "data": {
            "status": "live_write",
            "summary": f"Updated Dart task {task.get('id') or resolved}.",
            "task": task,
            "scope_preview": build_scope_preview("task.update", "task", task_id=resolved),
        },
    }


def build_task_delete_payload(*, client_factory: Callable[[DartConfig], DartClient] | None = None, task_id: str | None = None) -> dict[str, Any]:
    config = resolve_config()
    resolved = task_id or config.task_id
    if not resolved:
        raise DartConfigurationError("Set DART_TASK_ID or pass a task ID to delete a task.")
    client = (client_factory or create_client)(config)
    result = client.delete_task(resolved)
    return {
        "tool": TOOL_NAME,
        "backend": BACKEND_NAME,
        "data": {
            "status": "live_write",
            "summary": f"Deleted Dart task {resolved}.",
            **result,
            "scope_preview": build_scope_preview("task.delete", "task", task_id=resolved),
        },
    }


# --- Doc ---

def build_doc_list_payload(*, client_factory: Callable[[DartConfig], DartClient] | None = None, limit: int = 25) -> dict[str, Any]:
    client = (client_factory or create_client)(resolve_config())
    docs = client.list_docs(limit=limit)["docs"]
    return {
        "tool": TOOL_NAME,
        "backend": BACKEND_NAME,
        "data": {
            "status": "live_read",
            "summary": f"Returned {len(docs)} Dart doc{'s' if len(docs) != 1 else ''}.",
            "doc_count": len(docs),
            "docs": docs,
            "scope_preview": build_scope_preview("doc.list", "doc"),
        },
    }


def build_doc_get_payload(*, client_factory: Callable[[DartConfig], DartClient] | None = None, doc_id: str | None = None) -> dict[str, Any]:
    config = resolve_config()
    resolved = doc_id or config.doc_id
    if not resolved:
        raise DartConfigurationError("Set DART_DOC_ID or pass a doc ID to read a doc.")
    client = (client_factory or create_client)(config)
    doc = client.get_doc(resolved)["doc"]
    return {
        "tool": TOOL_NAME,
        "backend": BACKEND_NAME,
        "data": {
            "status": "live_read",
            "summary": f"Read Dart doc {resolved}.",
            "doc": doc,
            "scope_preview": build_scope_preview("doc.get", "doc", doc_id=resolved),
        },
    }


def build_doc_create_payload(*, client_factory: Callable[[DartConfig], DartClient] | None = None, title: str, content: str | None = None) -> dict[str, Any]:
    client = (client_factory or create_client)(resolve_config())
    result = client.create_doc(title=title, content=content)
    doc = result["doc"]
    return {
        "tool": TOOL_NAME,
        "backend": BACKEND_NAME,
        "data": {
            "status": "live_write",
            "summary": f"Created Dart doc {doc.get('id') or doc.get('title') or title}.",
            "doc": doc,
            "scope_preview": build_scope_preview("doc.create", "doc"),
        },
    }


# --- Comment ---

def build_comment_list_payload(*, client_factory: Callable[[DartConfig], DartClient] | None = None, task_id: str | None = None) -> dict[str, Any]:
    config = resolve_config()
    resolved = task_id or config.task_id
    if not resolved:
        raise DartConfigurationError("Set DART_TASK_ID or pass a task ID to list comments.")
    client = (client_factory or create_client)(config)
    result = client.list_comments(resolved)
    comments = result["comments"]
    return {
        "tool": TOOL_NAME,
        "backend": BACKEND_NAME,
        "data": {
            "status": "live_read",
            "summary": f"Returned {len(comments)} comment{'s' if len(comments) != 1 else ''} for Dart task {resolved}.",
            "comments": comments,
            "comment_count": len(comments),
            "scope_preview": build_scope_preview("comment.list", "comment", task_id=resolved),
        },
    }


def build_comment_create_payload(*, client_factory: Callable[[DartConfig], DartClient] | None = None, task_id: str | None = None, text: str) -> dict[str, Any]:
    config = resolve_config()
    resolved = task_id or config.task_id
    if not resolved:
        raise DartConfigurationError("Set DART_TASK_ID or pass --task-id to create a comment.")
    client = (client_factory or create_client)(config)
    result = client.create_comment(task_id=resolved, text=text)
    comment = result["comment"]
    return {
        "tool": TOOL_NAME,
        "backend": BACKEND_NAME,
        "data": {
            "status": "live_write",
            "summary": f"Created a comment on Dart task {resolved}.",
            "comment": comment,
            "scope_preview": build_scope_preview("comment.create", "comment", task_id=resolved),
        },
    }


# --- Property ---

def build_property_list_payload(*, client_factory: Callable[[DartConfig], DartClient] | None = None) -> dict[str, Any]:
    client = (client_factory or create_client)(resolve_config())
    result = client.list_properties()
    properties = result["properties"]
    return {
        "tool": TOOL_NAME,
        "backend": BACKEND_NAME,
        "data": {
            "status": "live_read",
            "summary": f"Returned {len(properties)} Dart propert{'y' if len(properties) == 1 else 'ies'}.",
            "properties": properties,
            "property_count": len(properties),
            "scope_preview": build_scope_preview("property.list", "property"),
        },
    }
