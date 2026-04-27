from __future__ import annotations

from contextvars import ContextVar
from typing import Any

from .client import (
    find_workflow_by_name,
    get_workflow_summary,
    list_workflow_summaries,
    probe_live_read,
    probe_write_bridge,
    trigger_workflow_execution,
)
from .config import redacted_config_snapshot, resolve_runtime_values, workflow_trigger_builder_snapshot
from .constants import BACKEND_NAME, CONNECTOR_CATEGORIES, CONNECTOR_CATEGORY, CONNECTOR_LABEL, CONNECTOR_RESOURCES
from .errors import ConnectorError

_RUNTIME_CONTEXT: ContextVar[dict[str, Any] | None] = ContextVar("n8n_runtime_context", default=None)


def set_runtime_context(ctx_obj: dict[str, Any] | None):
    return _RUNTIME_CONTEXT.set(ctx_obj)


def reset_runtime_context(token) -> None:
    _RUNTIME_CONTEXT.reset(token)


def _current_context() -> dict[str, Any]:
    return _RUNTIME_CONTEXT.get() or {}


def _probe_exit_code(code: str | None) -> int:
    if code in {"N8N_SETUP_REQUIRED", "N8N_WRITE_BRIDGE_REQUIRED", "N8N_INVALID_URL", "N8N_AUTH_FAILED"}:
        return 4
    if code in {"N8N_NOT_FOUND", "N8N_WORKFLOW_NOT_FOUND"}:
        return 6
    return 5


def _probe_exit_code(code: str | None) -> int:
    if code in {"N8N_SETUP_REQUIRED", "N8N_WRITE_BRIDGE_REQUIRED", "N8N_INVALID_URL", "N8N_AUTH_FAILED"}:
        return 4
    if code in {"N8N_NOT_FOUND", "N8N_WORKFLOW_NOT_FOUND"}:
        return 6
    return 5


def _clean_pairs(items: tuple[str, ...]) -> tuple[dict[str, str], list[str]]:
    options: dict[str, str] = {}
    terms: list[str] = []
    for item in items:
        if "=" not in item:
            terms.append(item)
            continue
        key, value = item.split("=", 1)
        key = key.strip().lower()
        value = value.strip()
        if not key:
            terms.append(item)
            continue
        options[key] = value
    return options, terms


def _boolish_status(value: str | None) -> tuple[bool | None, str | None]:
    if value is None:
        return None, None
    cleaned = value.strip()
    if not cleaned:
        return None, None
    lowered = cleaned.casefold()
    if lowered in {"active", "true", "yes", "on"}:
        return True, "active"
    if lowered in {"inactive", "false", "no", "off"}:
        return False, "inactive"
    if lowered in {"all", "any"}:
        return None, lowered
    return None, cleaned


def _configured_workflow(runtime: dict[str, Any], options: dict[str, str], terms: list[str]) -> dict[str, Any]:
    workflow_id = options.get("workflow_id") or (terms[0] if terms else None) or runtime.get("workflow_id")
    workflow_name = options.get("workflow_name") or runtime.get("workflow_name")
    if workflow_name is None and workflow_id is not None:
        workflow_name = workflow_id
    workflow_status = options.get("status") or runtime.get("workflow_status")
    return {
        "workflow_id": workflow_id,
        "workflow_name": workflow_name,
        "workflow_status": workflow_status,
        "workspace_name": runtime.get("workspace_name"),
    }


def _scope_preview(
    command_id: str,
    workflow: dict[str, Any],
    *,
    operation: str,
    live_backend_available: bool,
    trigger_builder: dict[str, Any] | None = None,
) -> dict[str, Any]:
    workflow_id = workflow.get("workflow_id")
    picker: list[dict[str, Any]] = []
    if workflow_id:
        option: dict[str, Any] = {
            "value": workflow_id,
            "label": workflow.get("workflow_name") or workflow_id,
            "resource": "workflow",
        }
        subtitle_parts = [workflow.get("workflow_status")]
        subtitle = " | ".join(str(part) for part in subtitle_parts if part)
        if subtitle:
            option["subtitle"] = subtitle
        picker = [option]
    return {
        "command_id": command_id,
        "operation": operation,
        "surface": "workflow",
        "scaffold_only": False,
        "live_backend_available": live_backend_available,
        "workflow_id": workflow.get("workflow_id"),
        "workflow_name": workflow.get("workflow_name"),
        "workflow_status": workflow.get("workflow_status"),
        "workspace_name": workflow.get("workspace_name"),
        "candidate_count": len(picker),
        "picker": {"kind": "workflow", "items": picker},
        "trigger_builder": trigger_builder,
    }


def _resolve_live_state(ctx_obj: dict[str, Any]) -> tuple[dict[str, Any], dict[str, Any]]:
    runtime = resolve_runtime_values(ctx_obj)
    probe = probe_live_read(runtime)
    return runtime, probe


def _resolve_runtime_probes(ctx_obj: dict[str, Any]) -> tuple[dict[str, Any], dict[str, Any], dict[str, Any]]:
    runtime = resolve_runtime_values(ctx_obj)
    read_probe = probe_live_read(runtime)
    write_probe = probe_write_bridge(runtime)
    return runtime, read_probe, write_probe


def probe_runtime(ctx_obj: dict[str, Any] | None = None) -> dict[str, Any]:
    _, probe = _resolve_live_state(ctx_obj or {})
    return probe


def health_snapshot(ctx_obj: dict[str, Any]) -> dict[str, Any]:
    runtime, read_probe, write_probe = _resolve_runtime_probes(ctx_obj)
    auth_ready = runtime["api_url_present"] and runtime["api_key_present"]
    read_ready = bool(read_probe.get("ok"))
    write_ready = bool(write_probe.get("ok"))
    live_backend_available = read_ready and write_ready
    if not auth_ready:
        status = "needs_setup"
        summary = "Configure N8N_API_URL, N8N_API_KEY, and N8N_WEBHOOK_BASE_URL before using live n8n reads and triggers."
        next_steps = [
            f"Set {runtime['api_url_env']} to the target n8n API base URL.",
            f"Set {runtime['api_key_env']} to a valid n8n API key.",
            f"Set {runtime['webhook_base_url_env']} to the public webhook base used by workflow.trigger.",
        ]
    elif not read_ready:
        status = "degraded"
        summary = "n8n API credentials are configured, but the live read probe failed."
        next_steps = [
            f"Verify {runtime['api_url_env']} points to a reachable n8n instance with /api/v1 enabled.",
            f"Verify {runtime['api_key_env']} is valid and authorized for workflow reads.",
        ]
    elif not write_ready:
        status = "partial"
        summary = "Live reads are available, but the workflow trigger bridge is not configured."
        next_steps = [
            f"Set {runtime['webhook_base_url_env']} to the public base used by the trigger bridge.",
            "Use workflow.list and workflow.status while the connector remains read-only.",
        ]
    else:
        status = "ready"
        summary = "n8n read and trigger bridges are configured and ready."
        next_steps = [
            "Use workflow.list and workflow.status for live reads.",
            "Use workflow.trigger to post live execution payloads through the webhook bridge.",
        ]
    return {
        "status": status,
        "summary": summary,
        "connector": {
            "backend": BACKEND_NAME,
            "label": CONNECTOR_LABEL,
            "category": CONNECTOR_CATEGORY,
            "categories": CONNECTOR_CATEGORIES,
            "resources": CONNECTOR_RESOURCES,
            "live_backend_available": live_backend_available,
            "live_read_available": read_ready,
            "write_bridge_available": write_ready,
            "live_write_smoke_tested": False,
            "scaffold_only": False,
        },
        "auth": {
            "api_url_env": runtime["api_url_env"],
            "api_url_present": runtime["api_url_present"],
            "api_key_env": runtime["api_key_env"],
            "api_key_present": runtime["api_key_present"],
            "webhook_base_url_env": runtime["webhook_base_url_env"],
            "webhook_base_url_present": runtime["webhook_base_url_present"],
            "webhook_bridge_url_present": runtime["webhook_bridge_url_present"],
        },
        "checks": [
            {
                "name": "setup",
                "ok": auth_ready,
                "details": {
                    "missing_keys": [] if auth_ready else [k for k, v in {runtime["api_url_env"]: runtime["api_url_present"], runtime["api_key_env"]: runtime["api_key_present"]}.items() if not v],
                },
            },
            {
                "name": "live_read",
                "ok": read_ready,
                "details": read_probe.get("details", {}),
            },
            {
                "name": "write_bridge",
                "ok": write_ready,
                "details": write_probe.get("details", {}),
            },
        ],
        "runtime_ready": auth_ready and live_backend_available,
        "live_backend_available": live_backend_available,
        "live_read_available": read_ready,
        "write_bridge_available": write_ready,
        "live_write_smoke_tested": False,
        "scaffold_only": False,
        "probe": {"read": read_probe, "write": write_probe},
        "next_steps": next_steps,
    }


def doctor_snapshot(ctx_obj: dict[str, Any], *, health: dict[str, Any] | None = None) -> dict[str, Any]:
    health = health or health_snapshot(ctx_obj)
    if health["status"] == "needs_setup":
        recommendations = [
            "Configure the n8n API URL, API key, and webhook base URL before handing this connector to a worker.",
            "workflow.list and workflow.status remain available only after the API is reachable.",
        ]
    elif health["status"] == "degraded":
        recommendations = [
            "Fix the n8n API connection so the live read path can reach the configured instance.",
            "Verify the trigger bridge base URL if workflow.trigger is also unavailable.",
        ]
    elif health["status"] == "partial":
        recommendations = [
            "Configure the trigger bridge base URL so workflow.trigger can execute live webhook posts.",
            "Use workflow.list and workflow.status while the connector remains read-only.",
        ]
    else:
        recommendations = [
            "Use workflow.list, workflow.status, and workflow.trigger as live commands.",
            "Keep the webhook bridge pointed at the trigger workflow you want n8n to execute.",
        ]
    return {
        **health,
        "recommendations": recommendations,
    }


def config_snapshot(ctx_obj: dict[str, Any]) -> dict[str, Any]:
    runtime, read_probe, write_probe = _resolve_runtime_probes(ctx_obj)
    auth_ready = runtime["api_url_present"] and runtime["api_key_present"]
    read_ready = bool(read_probe.get("ok"))
    write_ready = bool(write_probe.get("ok"))
    live_backend_available = read_ready and write_ready
    runtime_ready = auth_ready and live_backend_available
    config = redacted_config_snapshot(ctx_obj, probe=read_probe)
    return {
        **config,
        "backend": BACKEND_NAME,
        "runtime": {
            **config["runtime"],
            "workspace_name": runtime["workspace_name"],
            "workflow_id": runtime["workflow_id"],
            "workflow_name": runtime["workflow_name"],
            "workflow_status": runtime["workflow_status"],
            "auth_ready": auth_ready,
            "runtime_ready": runtime_ready,
            "live_backend_available": live_backend_available,
            "live_read_available": read_ready,
            "write_bridge_available": write_ready,
            "scaffold_only": False,
        },
        "api_probe": read_probe,
        "write_probe": write_probe,
        "runtime_ready": runtime_ready,
        "live_backend_available": live_backend_available,
        "live_read_available": read_ready,
        "write_bridge_available": write_ready,
        "scaffold_only": False,
    }


def _workflow_status_filter(status: str | None) -> dict[str, Any]:
    active_only, requested_status = _boolish_status(status)
    return {
        "requested_status": requested_status,
        "active_only": active_only,
    }


def _parse_limit(raw_limit: str | None) -> int:
    if raw_limit is None or not raw_limit.strip():
        return 10
    try:
        return max(int(raw_limit), 1)
    except ValueError as exc:
        raise ConnectorError(
            "N8N_INVALID_USAGE",
            f"Invalid limit value: {raw_limit}",
            2,
            details={"limit": raw_limit},
        ) from exc


def _workflow_lookup_target(runtime: dict[str, Any], options: dict[str, str], terms: list[str]) -> dict[str, Any]:
    raw_workflow_id = options.get("workflow_id") or (terms[0] if terms else None) or runtime.get("workflow_id")
    workflow_name = options.get("workflow_name") or runtime.get("workflow_name")
    workflow_status = options.get("status") or runtime.get("workflow_status")

    if raw_workflow_id:
        normalized_id = raw_workflow_id.strip()
        if normalized_id.startswith("http://") or normalized_id.startswith("https://"):
            parts = [segment for segment in normalized_id.rstrip("/").split("/") if segment]
            if parts:
                normalized_id = parts[-1]
        return {
            "workflow_id": normalized_id,
            "workflow_name": workflow_name or normalized_id,
            "workflow_status": workflow_status,
            "selector": "workflow_id",
        }

    if workflow_name:
        return {
            "workflow_id": None,
            "workflow_name": workflow_name,
            "workflow_status": workflow_status,
            "selector": "workflow_name",
        }

    raise ConnectorError(
        "N8N_WORKFLOW_REQUIRED",
        "workflow.status requires a workflow_id or workflow_name in the command or environment.",
        2,
        details={"available_env": {"N8N_WORKFLOW_ID": runtime.get("workflow_id"), "N8N_WORKFLOW_NAME": runtime.get("workflow_name")}},
    )


def _workflow_list(
    runtime: dict[str, Any],
    *,
    options: dict[str, str],
    terms: list[str],
    live_probe: dict[str, Any],
    write_probe: dict[str, Any],
) -> dict[str, Any]:
    configured = _configured_workflow(runtime, options, terms)
    status_filter = _workflow_status_filter(options.get("status"))
    limit = _parse_limit(options.get("limit"))
    live = list_workflow_summaries(runtime, limit=limit, active_only=status_filter["active_only"])
    read_ready = bool(live_probe.get("ok"))
    write_ready = bool(write_probe.get("ok"))
    trigger_builder = workflow_trigger_builder_snapshot(
        runtime,
        workflow=configured,
        trigger_url_redacted=write_probe.get("details", {}).get("trigger_url_redacted") if isinstance(write_probe.get("details"), dict) else None,
    )
    preview = _scope_preview(
        "workflow.list",
        configured,
        operation="list",
        live_backend_available=read_ready and write_ready,
        trigger_builder=trigger_builder,
    )
    summary = f"Retrieved {live['count']} workflow(s) from live n8n API."
    if status_filter["requested_status"]:
        summary = f"Retrieved {live['count']} workflow(s) from live n8n API with requested status '{status_filter['requested_status']}'."
    return {
        "status": "live",
        "backend": BACKEND_NAME,
        "resource": "workflow",
        "operation": "list",
        "summary": summary,
        "scaffold_only": False,
        "executed": True,
        "live_backend_available": read_ready and write_ready,
        "live_read_available": read_ready,
        "write_bridge_available": write_ready,
        "live_write_smoke_tested": False,
        "count": live["count"],
        "limit": limit,
        "filters": status_filter,
        "workflows": live["workflows"],
        "workflow_candidates": live["picker_options"],
        "picker_options": live["picker_options"],
        "configured_workflow": configured,
        "scope": {"workflow": configured, "preview": preview},
        "scope_preview": preview,
        "trigger_builder": trigger_builder,
        "runtime_ready": read_ready and write_ready,
        "next_step": "workflow.trigger posts live webhook executions when the bridge is configured.",
    }


def _resolve_status_workflow(runtime: dict[str, Any], options: dict[str, str], terms: list[str]) -> dict[str, Any]:
    lookup = _workflow_lookup_target(runtime, options, terms)
    if lookup["selector"] == "workflow_id" and lookup["workflow_id"]:
        return lookup

    workflow_name = lookup["workflow_name"]
    if not workflow_name:
        raise ConnectorError("N8N_WORKFLOW_REQUIRED", "workflow.status requires a workflow selector.", 2)

    workflow = find_workflow_by_name(runtime, workflow_name)
    if workflow is None:
        raise ConnectorError(
            "N8N_WORKFLOW_NOT_FOUND",
            f"No workflow matched the name '{workflow_name}'.",
            6,
            details={"workflow_name": workflow_name},
        )
    resolved = _workflow_lookup_target(runtime, {"workflow_id": str(workflow.get("id") or workflow.get("workflowId") or "")}, [])
    resolved["workflow_name"] = workflow.get("name") or workflow_name
    resolved["selector"] = "workflow_name"
    return resolved


def _workflow_status(
    runtime: dict[str, Any],
    *,
    options: dict[str, str],
    terms: list[str],
    live_probe: dict[str, Any],
    write_probe: dict[str, Any],
) -> dict[str, Any]:
    configured = _configured_workflow(runtime, options, terms)
    lookup = _resolve_status_workflow(runtime, options, terms)
    summary = get_workflow_summary(runtime, str(lookup["workflow_id"]))
    workflow = summary["workflow"]
    picker = summary["picker_options"]
    read_ready = bool(live_probe.get("ok"))
    write_ready = bool(write_probe.get("ok"))
    trigger_builder = workflow_trigger_builder_snapshot(
        runtime,
        workflow=configured,
        trigger_url_redacted=write_probe.get("details", {}).get("trigger_url_redacted") if isinstance(write_probe.get("details"), dict) else None,
    )
    preview = _scope_preview(
        "workflow.status",
        configured,
        operation="status",
        live_backend_available=read_ready and write_ready,
        trigger_builder=trigger_builder,
    )
    requested_status = options.get("status")
    live_status = workflow.get("status")
    matches_requested_status = None
    if requested_status:
        normalized_requested, _ = _boolish_status(requested_status)
        if normalized_requested is not None:
            matches_requested_status = (
                (normalized_requested is True and live_status == "active")
                or (normalized_requested is False and live_status == "inactive")
            )
    return {
        "status": "live",
        "backend": BACKEND_NAME,
        "resource": "workflow",
        "operation": "status",
        "summary": f"Retrieved workflow '{workflow.get('name') or workflow.get('id')}' from live n8n API.",
        "scaffold_only": False,
        "executed": True,
        "live_backend_available": read_ready and write_ready,
        "live_read_available": read_ready,
        "write_bridge_available": write_ready,
        "live_write_smoke_tested": False,
        "workflow": workflow,
        "resolved_target": lookup,
        "picker_options": picker,
        "configured_workflow": configured,
        "scope": {"workflow": configured, "preview": preview},
        "scope_preview": preview,
        "trigger_builder": trigger_builder,
        "requested_status": requested_status,
        "matches_requested_status": matches_requested_status,
        "runtime_ready": read_ready and write_ready,
        "next_step": "workflow.trigger posts live webhook executions when the bridge is configured.",
    }


def run_read_command(command_id: str, items: tuple[str, ...]) -> dict[str, Any]:
    runtime, read_probe, write_probe = _resolve_runtime_probes(_current_context())
    if not read_probe.get("ok"):
        raise ConnectorError(
            read_probe.get("code", "N8N_LIVE_READ_UNAVAILABLE"),
            read_probe.get("message", "n8n live read access is unavailable."),
            _probe_exit_code(read_probe.get("code")),
            details=read_probe.get("details", {}),
        )
    options, terms = _clean_pairs(items)
    if command_id == "workflow.list":
        return _workflow_list(runtime, options=options, terms=terms, live_probe=read_probe, write_probe=write_probe)
    if command_id == "workflow.status":
        return _workflow_status(runtime, options=options, terms=terms, live_probe=read_probe, write_probe=write_probe)
    raise ConnectorError("N8N_INVALID_USAGE", f"Unknown command: {command_id}", 2)


def run_trigger_command(inputs: dict[str, Any]) -> dict[str, Any]:
    runtime, read_probe, write_probe = _resolve_runtime_probes(_current_context())
    if not write_probe.get("ok"):
        raise ConnectorError(
            write_probe.get("code", "N8N_WRITE_BRIDGE_REQUIRED"),
            write_probe.get("message", "n8n workflow trigger bridge is unavailable."),
            _probe_exit_code(write_probe.get("code")),
            details=write_probe.get("details", {}),
        )

    workflow_options = {
        key: value
        for key, value in {
            "workflow_id": inputs.get("workflow_id") or runtime.get("workflow_id"),
            "workflow_name": inputs.get("workflow_name") or runtime.get("workflow_name"),
            "status": inputs.get("status") or runtime.get("workflow_status"),
        }.items()
        if value
    }
    workflow = _configured_workflow(runtime, workflow_options, [])
    event = str(inputs.get("event") or "manual")
    payload = inputs.get("payload") or {}
    if not isinstance(payload, dict):
        raise ConnectorError(
            "N8N_INVALID_USAGE",
            "workflow.trigger payload must be a mapping of key=value pairs.",
            2,
            details={"payload_type": type(payload).__name__},
        )

    bridge_payload = {
        "tool": "aos-n8n",
        "command": "workflow.trigger",
        "event": event,
        "workflow": workflow,
        "payload": payload,
    }
    trigger_result = trigger_workflow_execution(runtime, bridge_payload)
    read_ready = bool(read_probe.get("ok"))
    live_backend_available = read_ready and bool(write_probe.get("ok"))
    trigger_builder = workflow_trigger_builder_snapshot(
        runtime,
        workflow=workflow,
        trigger_url_redacted=trigger_result.get("trigger_url_redacted"),
        event=event,
        payload=payload,
        response_hints={
            "type": "json",
            "normalized_fields": [
                "ok",
                "status_code",
                "response_kind",
                "execution_id",
                "response_status",
                "summary",
                "trigger_url_redacted",
            ],
            "description": "Normalized response from the trigger bridge using the live webhook response and connector-side response parsing.",
        },
    )
    response_normalized = {
        "ok": trigger_result["ok"],
        "status_code": trigger_result["status_code"],
        "response_kind": trigger_result["response_kind"],
        "execution_id": trigger_result["execution_id"],
        "response_status": trigger_result["response_status"],
        "summary": trigger_result["summary"],
        "trigger_url_redacted": trigger_result["trigger_url_redacted"],
    }
    return {
        "status": "triggered",
        "backend": BACKEND_NAME,
        "resource": "workflow",
        "operation": "trigger",
        "summary": f"Triggered workflow bridge for {workflow.get('workflow_name') or workflow.get('workflow_id') or 'workflow'}.",
        "scaffold_only": False,
        "executed": True,
        "live_backend_available": live_backend_available,
        "live_read_available": read_ready,
        "write_bridge_available": True,
        "live_write_smoke_tested": False,
        "workflow": workflow,
        "request": bridge_payload,
        "bridge": trigger_result,
        "response_normalized": response_normalized,
        "response": trigger_result["response"],
        "trigger_builder": trigger_builder,
        "runtime_ready": live_backend_available,
        "next_step": "The trigger bridge executed a live webhook POST.",
    }
