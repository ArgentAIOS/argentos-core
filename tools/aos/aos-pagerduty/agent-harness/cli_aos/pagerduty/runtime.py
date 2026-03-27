from __future__ import annotations

import json
from pathlib import Path
from typing import Any

from .client import PagerDutyApiError, PagerDutyClient
from .config import config_snapshot, resolve_runtime_values
from .constants import (
    AUTH_DESCRIPTOR,
    BACKEND_NAME,
    CONNECTOR_DESCRIPTOR,
    MANIFEST_SCHEMA_VERSION,
    MODE_ORDER,
    SCOPE_DESCRIPTOR,
    TOOL_NAME,
)
from .errors import CliError

CONNECTOR_PATH = Path(__file__).resolve().parents[3] / "connector.json"


def _load_manifest() -> dict[str, Any]:
    return json.loads(CONNECTOR_PATH.read_text())


def capabilities_snapshot() -> dict[str, Any]:
    manifest = _load_manifest()
    read_support: dict[str, bool] = {}
    write_support: dict[str, bool] = {}
    for command in manifest["commands"]:
        command_id = command["id"]
        if command["required_mode"] == "readonly":
            read_support[command_id] = True
        else:
            write_support[command_id] = True
    return {
        "tool": manifest["tool"],
        "backend": manifest["backend"],
        "manifest_schema_version": manifest.get("manifest_schema_version", MANIFEST_SCHEMA_VERSION),
        "connector": manifest["connector"],
        "auth": manifest["auth"],
        "scope": manifest.get("scope", {}),
        "commands": manifest["commands"],
        "read_support": read_support,
        "write_support": write_support,
    }


def create_client(ctx_obj: dict[str, Any]) -> PagerDutyClient:
    runtime = resolve_runtime_values(ctx_obj)
    if not runtime["api_key_present"]:
        raise CliError(
            code="PAGERDUTY_SETUP_REQUIRED",
            message="PagerDuty connector is missing required credentials",
            exit_code=4,
            details={"missing_keys": [runtime["api_key_env"]]},
        )
    from os import getenv

    api_key = getenv(runtime["api_key_env"]) or ""
    return PagerDutyClient(api_key=api_key, base_url=runtime["api_base_url"])


def probe_runtime(ctx_obj: dict[str, Any]) -> dict[str, Any]:
    runtime = resolve_runtime_values(ctx_obj)
    if not runtime["api_key_present"]:
        return {
            "ok": False,
            "code": "PAGERDUTY_SETUP_REQUIRED",
            "message": "PagerDuty connector is missing required credentials",
            "details": {
                "missing_keys": [runtime["api_key_env"]],
                "live_read_available": True,
                "write_bridge_available": False,
            },
        }
    try:
        client = create_client(ctx_obj)
        incidents = client.list_incidents(limit=1)
    except CliError as err:
        return {"ok": False, "code": err.code, "message": err.message, "details": err.details}
    except PagerDutyApiError as err:
        return {
            "ok": False,
            "code": err.code,
            "message": err.message,
            "details": {**(err.details or {}), "status_code": err.status_code},
        }
    return {
        "ok": True,
        "code": "OK",
        "message": "PagerDuty live read runtime is ready",
        "details": {
            "live_read_available": True,
            "write_bridge_available": False,
            "incident_count": incidents["count"],
        },
    }


def health_snapshot(ctx_obj: dict[str, Any]) -> dict[str, Any]:
    runtime = resolve_runtime_values(ctx_obj)
    probe = probe_runtime(ctx_obj)
    status = "ready" if probe["ok"] else ("needs_setup" if probe["code"] == "PAGERDUTY_SETUP_REQUIRED" else "degraded")
    return {
        "status": status,
        "summary": probe["message"],
        "connector": {
            "backend": BACKEND_NAME,
            "live_backend_available": bool(probe.get("ok")),
            "live_read_available": True,
            "write_bridge_available": False,
            "scaffold_only": True,
        },
        "auth": {
            "api_key_env": runtime["api_key_env"],
            "api_key_present": runtime["api_key_present"],
            "service_id_env": runtime["service_id_env"],
            "incident_id_env": runtime["incident_id_env"],
            "escalation_policy_id_env": runtime["escalation_policy_id_env"],
        },
        "scope": {
            "api_base_url": runtime["api_base_url"],
            "service_id": runtime["service_id"],
            "incident_id": runtime["incident_id"],
            "escalation_policy_id": runtime["escalation_policy_id"],
            "urgency": runtime["urgency"],
            "title": runtime["title"],
            "description": runtime["description"],
        },
        "checks": [
            {
                "name": "required_env",
                "ok": runtime["api_key_present"],
                "details": {"missing_keys": [] if runtime["api_key_present"] else [runtime["api_key_env"]]},
            },
            {
                "name": "live_read_probe",
                "ok": bool(probe.get("ok")),
                "details": probe.get("details", {}),
            },
        ],
        "runtime_ready": bool(probe.get("ok")),
        "live_backend_available": bool(probe.get("ok")),
        "live_read_available": True,
        "write_bridge_available": False,
        "scaffold_only": True,
        "probe": probe,
        "next_steps": [
            f"Set {runtime['api_key_env']} in API Keys.",
            f"Optionally set {runtime['service_id_env']}, {runtime['incident_id_env']}, and {runtime['escalation_policy_id_env']} for stable scope defaults.",
            "Use incident.list to confirm live read access.",
        ],
    }


def doctor_snapshot(ctx_obj: dict[str, Any]) -> dict[str, Any]:
    runtime = resolve_runtime_values(ctx_obj)
    probe = probe_runtime(ctx_obj)
    ready = bool(probe.get("ok"))
    return {
        "status": "ready" if ready else ("needs_setup" if probe.get("code") == "PAGERDUTY_SETUP_REQUIRED" else "degraded"),
        "summary": "PagerDuty connector diagnostics.",
        "runtime": {
            "implementation_mode": "live_read_scaffold_write",
            "command_readiness": {
                "incident.list": ready,
                "incident.get": ready,
                "incident.create": False,
                "incident.acknowledge": False,
                "incident.resolve": False,
                "service.list": ready,
                "service.get": ready,
                "escalation_policy.list": ready,
                "on_call.list": ready,
                "alert.list": ready,
                "change_event.create": False,
            },
            "scaffold_only": True,
        },
        "checks": [
            {"name": "required_env", "ok": runtime["api_key_present"]},
            {"name": "live_read_probe", "ok": ready, "details": probe.get("details", {})},
        ],
    }


def _collection_result(
    resource: str,
    operation: str,
    response: dict[str, Any],
    items: list[dict[str, Any]],
    scope: dict[str, Any],
) -> dict[str, Any]:
    return {
        "status": "ok",
        "backend": BACKEND_NAME,
        "resource": resource,
        "operation": operation,
        "scope": scope,
        "count": len(items),
        "more": bool(response.get("more")),
        "limit": response.get("limit"),
        "offset": response.get("offset"),
        "total": response.get("total"),
        "results": items,
    }


def _single_result(
    resource: str,
    operation: str,
    response: dict[str, Any],
    scope: dict[str, Any],
    *,
    result_key: str = "result",
) -> dict[str, Any]:
    return {
        "status": "ok",
        "backend": BACKEND_NAME,
        "resource": resource,
        "operation": operation,
        "scope": scope,
        result_key: response,
    }


def _scope(ctx_obj: dict[str, Any]) -> dict[str, Any]:
    runtime = resolve_runtime_values(ctx_obj)
    return {
        "api_base_url": runtime["api_base_url"],
        "service_id": runtime["service_id"],
        "incident_id": runtime["incident_id"],
        "escalation_policy_id": runtime["escalation_policy_id"],
        "urgency": runtime["urgency"],
        "title": runtime["title"],
        "description": runtime["description"],
    }


def incident_list_result(
    ctx_obj: dict[str, Any],
    *,
    limit: int = 25,
    statuses: list[str] | None = None,
    service_id: str | None = None,
) -> dict[str, Any]:
    client = create_client(ctx_obj)
    response = client.list_incidents(limit=limit, statuses=statuses, service_id=service_id)
    return _collection_result("incident", "incident.list", response, response["items"], _scope(ctx_obj))


def incident_get_result(ctx_obj: dict[str, Any], incident_id: str) -> dict[str, Any]:
    client = create_client(ctx_obj)
    response = client.get_incident(incident_id)
    return _single_result("incident", "incident.get", response, _scope(ctx_obj))


def service_list_result(ctx_obj: dict[str, Any], *, limit: int = 25) -> dict[str, Any]:
    client = create_client(ctx_obj)
    response = client.list_services(limit=limit)
    return _collection_result("service", "service.list", response, response["items"], _scope(ctx_obj))


def service_get_result(ctx_obj: dict[str, Any], service_id: str) -> dict[str, Any]:
    client = create_client(ctx_obj)
    response = client.get_service(service_id)
    return _single_result("service", "service.get", response, _scope(ctx_obj))


def escalation_policy_list_result(ctx_obj: dict[str, Any], *, limit: int = 25) -> dict[str, Any]:
    client = create_client(ctx_obj)
    response = client.list_escalation_policies(limit=limit)
    return _collection_result(
        "escalation_policy",
        "escalation_policy.list",
        response,
        response["items"],
        _scope(ctx_obj),
    )


def on_call_list_result(
    ctx_obj: dict[str, Any],
    *,
    limit: int = 25,
    escalation_policy_id: str | None = None,
) -> dict[str, Any]:
    client = create_client(ctx_obj)
    response = client.list_on_calls(limit=limit, escalation_policy_id=escalation_policy_id)
    return _collection_result("on_call", "on_call.list", response, response["items"], _scope(ctx_obj))


def alert_list_result(ctx_obj: dict[str, Any], *, limit: int = 25, incident_id: str | None = None) -> dict[str, Any]:
    client = create_client(ctx_obj)
    response = client.list_alerts(limit=limit, incident_id=incident_id)
    return _collection_result("alert", "alert.list", response, response["items"], _scope(ctx_obj))


def scaffold_write_command(command_id: str, ctx_obj: dict[str, Any], *, details: dict[str, Any]) -> dict[str, Any]:
    return {
        "status": "scaffolded",
        "backend": BACKEND_NAME,
        "tool": TOOL_NAME,
        "command": command_id,
        "scope": _scope(ctx_obj),
        "details": details,
        "note": f"{command_id} is scaffolded but not implemented yet",
    }


def run_read_command(command_id: str, ctx_obj: dict[str, Any], **kwargs: Any) -> dict[str, Any]:
    if command_id == "incident.list":
        return incident_list_result(
            ctx_obj,
            limit=int(kwargs.get("limit") or 25),
            statuses=kwargs.get("statuses"),
            service_id=kwargs.get("service_id"),
        )
    if command_id == "incident.get":
        return incident_get_result(ctx_obj, str(kwargs["incident_id"]))
    if command_id == "service.list":
        return service_list_result(ctx_obj, limit=int(kwargs.get("limit") or 25))
    if command_id == "service.get":
        return service_get_result(ctx_obj, str(kwargs["service_id"]))
    if command_id == "escalation_policy.list":
        return escalation_policy_list_result(ctx_obj, limit=int(kwargs.get("limit") or 25))
    if command_id == "on_call.list":
        return on_call_list_result(
            ctx_obj,
            limit=int(kwargs.get("limit") or 25),
            escalation_policy_id=kwargs.get("escalation_policy_id"),
        )
    if command_id == "alert.list":
        return alert_list_result(
            ctx_obj,
            limit=int(kwargs.get("limit") or 25),
            incident_id=kwargs.get("incident_id"),
        )
    if command_id == "capabilities":
        return capabilities_snapshot()
    if command_id == "config.show":
        return config_snapshot(ctx_obj)
    if command_id == "health":
        return health_snapshot(ctx_obj)
    if command_id == "doctor":
        return doctor_snapshot(ctx_obj)
    raise CliError(code="UNKNOWN_COMMAND", message=f"Unknown read command: {command_id}", exit_code=2)
