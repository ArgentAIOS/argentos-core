from __future__ import annotations

import os
from typing import Any

from .constants import (
    BACKEND_NAME,
    WORKFLOW_TRIGGER_EVENT_HINTS,
    WORKFLOW_TRIGGER_PAYLOAD_HINTS,
    WORKFLOW_TRIGGER_RESPONSE_HINTS,
    N8N_API_KEY_ENV,
    N8N_API_URL_ENV,
    N8N_WEBHOOK_BASE_URL_ENV,
    N8N_WORKFLOW_ID_ENV,
    N8N_WORKFLOW_NAME_ENV,
    N8N_WORKFLOW_STATUS_ENV,
    N8N_WORKSPACE_NAME_ENV,
)
from .client import normalize_api_base_url, normalize_webhook_base_url, probe_live_read, probe_write_bridge
from .errors import ConnectorError
from .service_keys import service_key_env


def _present(value: str | None) -> bool:
    return bool(value and value.strip())


def _redact(value: str | None) -> str | None:
    if value is None:
        return None
    stripped = value.strip()
    if not stripped:
        return None
    if len(stripped) <= 6:
        return "***"
    return f"{stripped[:3]}...{stripped[-3:]}"


def workflow_trigger_builder_snapshot(
    runtime: dict[str, Any],
    *,
    workflow: dict[str, Any] | None = None,
    trigger_url_redacted: str | None = None,
    event: str = "manual",
    payload: dict[str, Any] | None = None,
    response_hints: dict[str, Any] | None = None,
) -> dict[str, Any]:
    workflow = workflow or runtime
    workflow_id = workflow.get("workflow_id") or runtime.get("workflow_id")
    workflow_name = workflow.get("workflow_name") or runtime.get("workflow_name") or workflow_id
    workflow_status = workflow.get("workflow_status") or runtime.get("workflow_status")
    payload_example = payload if isinstance(payload, dict) and payload else dict(WORKFLOW_TRIGGER_PAYLOAD_HINTS["example"])
    request_template = {
        "tool": "aos-n8n",
        "command": "workflow.trigger",
        "event": event or "manual",
        "workflow": {
            "workflow_id": workflow_id,
            "workflow_name": workflow_name,
            "workflow_status": workflow_status,
            "workspace_name": workflow.get("workspace_name") or runtime.get("workspace_name"),
        },
        "payload": payload_example,
    }
    builder = {
        "command_id": "workflow.trigger",
        "event_hints": WORKFLOW_TRIGGER_EVENT_HINTS,
        "payload_hints": WORKFLOW_TRIGGER_PAYLOAD_HINTS,
        "request_template": request_template,
        "response_hints": response_hints or WORKFLOW_TRIGGER_RESPONSE_HINTS,
        "trigger_url_redacted": trigger_url_redacted,
    }
    return builder


def resolve_runtime_values(ctx_obj: dict[str, Any]) -> dict[str, Any]:
    api_url_env = N8N_API_URL_ENV
    api_key_env = N8N_API_KEY_ENV
    webhook_base_url_env = N8N_WEBHOOK_BASE_URL_ENV

    api_url = service_key_env(api_url_env)
    api_key = service_key_env(api_key_env)
    webhook_base_url = service_key_env(webhook_base_url_env)
    api_base_url = None
    api_base_url_present = False
    api_base_url_redacted = None
    api_base_url_error = None
    webhook_bridge_url = None
    webhook_bridge_url_present = False
    webhook_bridge_url_redacted = None
    webhook_base_url_error = None
    if _present(api_url):
        try:
            api_base_url = normalize_api_base_url(api_url)
            api_base_url_present = True
            api_base_url_redacted = _redact(api_base_url)
        except (ConnectorError, ValueError) as err:
            api_base_url_error = str(err)
    if _present(webhook_base_url):
        try:
            webhook_bridge_url = f"{normalize_webhook_base_url(webhook_base_url)}/aos-n8n/workflow-trigger"
            webhook_bridge_url_present = True
            webhook_bridge_url_redacted = _redact(webhook_bridge_url)
        except (ConnectorError, ValueError) as err:
            webhook_base_url_error = str(err)

    workspace_name = os.getenv(N8N_WORKSPACE_NAME_ENV)
    workflow_id = os.getenv(N8N_WORKFLOW_ID_ENV)
    workflow_name = os.getenv(N8N_WORKFLOW_NAME_ENV)
    workflow_status = os.getenv(N8N_WORKFLOW_STATUS_ENV)

    return {
        "backend": BACKEND_NAME,
        "api_url_env": api_url_env,
        "api_key_env": api_key_env,
        "webhook_base_url_env": webhook_base_url_env,
        "api_url": api_url,
        "api_url_present": _present(api_url),
        "api_url_redacted": _redact(api_url),
        "api_key": api_key,
        "api_key_present": _present(api_key),
        "api_key_redacted": _redact(api_key),
        "api_base_url": api_base_url,
        "api_base_url_present": api_base_url_present,
        "api_base_url_redacted": api_base_url_redacted,
        "api_base_url_error": api_base_url_error,
        "webhook_base_url": webhook_base_url,
        "webhook_base_url_present": _present(webhook_base_url),
        "webhook_base_url_redacted": _redact(webhook_base_url),
        "webhook_base_url_error": webhook_base_url_error,
        "webhook_bridge_url": webhook_bridge_url,
        "webhook_bridge_url_present": webhook_bridge_url_present,
        "webhook_bridge_url_redacted": webhook_bridge_url_redacted,
        "workspace_name": workspace_name.strip() if workspace_name and workspace_name.strip() else None,
        "workflow_id": workflow_id.strip() if workflow_id and workflow_id.strip() else None,
        "workflow_name": workflow_name.strip() if workflow_name and workflow_name.strip() else None,
        "workflow_status": workflow_status.strip() if workflow_status and workflow_status.strip() else None,
        "verbose": bool(ctx_obj.get("verbose")),
    }


def redacted_config_snapshot(ctx_obj: dict[str, Any], *, probe: dict[str, Any] | None = None) -> dict[str, Any]:
    runtime = resolve_runtime_values(ctx_obj)
    auth_ready = runtime["api_url_present"] and runtime["api_key_present"]
    if probe is None:
        runtime_probe = probe_live_read(runtime)
    elif "ok" in probe:
        runtime_probe = probe
    else:
        runtime_probe = probe.get("read") if isinstance(probe.get("read"), dict) else probe_live_read(runtime)
    write_probe = probe_write_bridge(runtime)
    live_read_available = bool(runtime_probe.get("ok"))
    write_bridge_available = bool(write_probe.get("ok"))
    live_backend_available = live_read_available and write_bridge_available
    runtime_ready = auth_ready and live_backend_available
    trigger_builder = workflow_trigger_builder_snapshot(
        runtime,
        trigger_url_redacted=write_probe.get("details", {}).get("trigger_url_redacted") if isinstance(write_probe.get("details"), dict) else None,
    )
    return {
        "status": "ok",
        "summary": "n8n connector configuration snapshot.",
        "backend": BACKEND_NAME,
        "auth": {
            "api_url_env": runtime["api_url_env"],
            "api_url_present": runtime["api_url_present"],
            "api_url_redacted": runtime["api_url_redacted"],
            "api_base_url_present": runtime["api_base_url_present"],
            "api_base_url_redacted": runtime["api_base_url_redacted"],
            "api_base_url_error": runtime["api_base_url_error"],
            "api_key_env": runtime["api_key_env"],
            "api_key_present": runtime["api_key_present"],
            "api_key_redacted": runtime["api_key_redacted"],
            "webhook_base_url_env": runtime["webhook_base_url_env"],
            "webhook_base_url_present": runtime["webhook_base_url_present"],
            "webhook_base_url_redacted": runtime["webhook_base_url_redacted"],
            "webhook_base_url_error": runtime["webhook_base_url_error"],
            "webhook_bridge_url_present": runtime["webhook_bridge_url_present"],
            "webhook_bridge_url_redacted": runtime["webhook_bridge_url_redacted"],
        },
        "runtime": {
            "workspace_name": runtime["workspace_name"],
            "workflow_id": runtime["workflow_id"],
            "workflow_name": runtime["workflow_name"],
            "workflow_status": runtime["workflow_status"],
            "auth_ready": auth_ready,
            "read_bridge_available": live_read_available,
            "write_bridge_available": write_bridge_available,
            "runtime_ready": runtime_ready,
            "live_backend_available": live_backend_available,
            "live_read_available": live_read_available,
            "write_bridge_available": write_bridge_available,
            "scaffold_only": False,
            "trigger_builder": trigger_builder,
        },
        "api_probe": runtime_probe,
        "write_probe": write_probe,
        "trigger_builder": trigger_builder,
        "runtime_ready": runtime_ready,
        "live_backend_available": live_backend_available,
        "live_read_available": live_read_available,
        "write_bridge_available": write_bridge_available,
        "scaffold_only": False,
    }
