from __future__ import annotations

import json
from pathlib import Path
from typing import Any

from .client import PagerDutyApiError, PagerDutyClient
from .config import config_snapshot, resolve_runtime_values
from .constants import BACKEND_NAME, MANIFEST_SCHEMA_VERSION
from .errors import CliError

CONNECTOR_PATH = Path(__file__).resolve().parents[3] / "connector.json"


def _load_manifest() -> dict[str, Any]:
    return json.loads(CONNECTOR_PATH.read_text())


def _strip(value: str | None) -> str | None:
    if value is None:
        return None
    stripped = value.strip()
    return stripped or None


def _missing_auth_error(*, missing_keys: list[str]) -> CliError:
    return CliError(
        code="PAGERDUTY_SETUP_REQUIRED",
        message="PagerDuty connector is missing required credentials",
        exit_code=4,
        details={"missing_keys": missing_keys},
    )


def _require_value(value: str | None, *, argument: str, env_name: str | None = None) -> str:
    resolved = _strip(value)
    if resolved:
        return resolved
    details = {"argument": argument}
    if env_name:
        details["env"] = env_name
    raise CliError(code="MISSING_ARGUMENT", message=f"{argument} is required", exit_code=4, details=details)


def _command_readiness(runtime: dict[str, Any], probe: dict[str, Any]) -> dict[str, bool]:
    rest_ready = bool(probe.get("ok"))
    incident_write_ready = rest_ready and runtime["from_email_present"]
    change_event_ready = runtime["events_routing_key_present"]
    return {
        "incident.list": rest_ready,
        "incident.get": rest_ready,
        "incident.create": incident_write_ready,
        "incident.acknowledge": incident_write_ready,
        "incident.resolve": incident_write_ready,
        "service.list": rest_ready,
        "service.get": rest_ready,
        "escalation_policy.list": rest_ready,
        "on_call.list": rest_ready,
        "alert.list": rest_ready,
        "change_event.create": change_event_ready,
    }


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
    return PagerDutyClient(
        api_key=runtime["api_key"],
        events_routing_key=runtime["events_routing_key"],
        base_url=runtime["api_base_url"],
        events_base_url=runtime["events_api_base_url"],
    )


def probe_runtime(ctx_obj: dict[str, Any]) -> dict[str, Any]:
    runtime = resolve_runtime_values(ctx_obj)
    if not runtime["api_key_present"]:
        return {
            "ok": False,
            "code": "PAGERDUTY_SETUP_REQUIRED",
            "message": "PagerDuty connector is missing required REST API credentials",
            "details": {
                "missing_keys": [runtime["api_key_env"]],
                "live_read_available": True,
                "incident_write_available": True,
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
        "message": "PagerDuty REST runtime is ready",
        "details": {
            "live_read_available": True,
            "incident_write_available": True,
            "incident_count": incidents["count"],
        },
    }


def _scope(ctx_obj: dict[str, Any]) -> dict[str, Any]:
    runtime = resolve_runtime_values(ctx_obj)
    return {
        "api_base_url": runtime["api_base_url"],
        "events_api_base_url": runtime["events_api_base_url"],
        "service_id": runtime["service_id"],
        "incident_id": runtime["incident_id"],
        "escalation_policy_id": runtime["escalation_policy_id"],
        "urgency": runtime["urgency"],
        "title": runtime["title"],
        "summary": runtime["summary"],
        "description": runtime["description"],
        "resolution": runtime["resolution"],
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


def _require_rest_client(ctx_obj: dict[str, Any]) -> tuple[dict[str, Any], PagerDutyClient]:
    runtime = resolve_runtime_values(ctx_obj)
    if not runtime["api_key_present"]:
        raise _missing_auth_error(missing_keys=[runtime["api_key_env"]])
    return runtime, create_client(ctx_obj)


def _require_events_client(ctx_obj: dict[str, Any]) -> tuple[dict[str, Any], PagerDutyClient]:
    runtime = resolve_runtime_values(ctx_obj)
    if not runtime["events_routing_key_present"]:
        raise _missing_auth_error(missing_keys=[runtime["events_routing_key_env"]])
    return runtime, create_client(ctx_obj)


def incident_list_result(
    ctx_obj: dict[str, Any],
    *,
    limit: int = 25,
    statuses: list[str] | None = None,
    service_id: str | None = None,
) -> dict[str, Any]:
    _runtime, client = _require_rest_client(ctx_obj)
    response = client.list_incidents(limit=limit, statuses=statuses, service_id=service_id)
    return _collection_result("incident", "incident.list", response, response["items"], _scope(ctx_obj))


def incident_get_result(ctx_obj: dict[str, Any], incident_id: str) -> dict[str, Any]:
    _runtime, client = _require_rest_client(ctx_obj)
    response = client.get_incident(incident_id)
    return _single_result("incident", "incident.get", response, _scope(ctx_obj))


def incident_create_result(
    ctx_obj: dict[str, Any],
    *,
    service_id: str | None = None,
    title: str | None = None,
    description: str | None = None,
    urgency: str | None = None,
    escalation_policy_id: str | None = None,
    from_email: str | None = None,
) -> dict[str, Any]:
    runtime, client = _require_rest_client(ctx_obj)
    response = client.create_incident(
        from_email=_require_value(from_email or runtime["from_email"], argument="from_email", env_name=runtime["from_email_env"]),
        service_id=_require_value(service_id or runtime["service_id"], argument="service_id", env_name=runtime["service_id_env"]),
        title=_require_value(title or runtime["title"], argument="title", env_name=runtime["title_env"]),
        description=_strip(description) or runtime["description"],
        urgency=_strip(urgency) or runtime["urgency"] or "high",
        escalation_policy_id=_strip(escalation_policy_id) or runtime["escalation_policy_id"],
    )
    return _single_result("incident", "incident.create", response, _scope(ctx_obj))


def incident_acknowledge_result(
    ctx_obj: dict[str, Any],
    *,
    incident_id: str | None = None,
    from_email: str | None = None,
) -> dict[str, Any]:
    runtime, client = _require_rest_client(ctx_obj)
    response = client.manage_incident(
        _require_value(incident_id or runtime["incident_id"], argument="incident_id", env_name=runtime["incident_id_env"]),
        from_email=_require_value(from_email or runtime["from_email"], argument="from_email", env_name=runtime["from_email_env"]),
        status="acknowledged",
    )
    return _single_result("incident", "incident.acknowledge", response, _scope(ctx_obj))


def incident_resolve_result(
    ctx_obj: dict[str, Any],
    *,
    incident_id: str | None = None,
    from_email: str | None = None,
    resolution: str | None = None,
) -> dict[str, Any]:
    runtime, client = _require_rest_client(ctx_obj)
    response = client.manage_incident(
        _require_value(incident_id or runtime["incident_id"], argument="incident_id", env_name=runtime["incident_id_env"]),
        from_email=_require_value(from_email or runtime["from_email"], argument="from_email", env_name=runtime["from_email_env"]),
        status="resolved",
        resolution=_strip(resolution) or runtime["resolution"],
    )
    return _single_result("incident", "incident.resolve", response, _scope(ctx_obj))


def service_list_result(ctx_obj: dict[str, Any], *, limit: int = 25) -> dict[str, Any]:
    _runtime, client = _require_rest_client(ctx_obj)
    response = client.list_services(limit=limit)
    return _collection_result("service", "service.list", response, response["items"], _scope(ctx_obj))


def service_get_result(ctx_obj: dict[str, Any], service_id: str) -> dict[str, Any]:
    _runtime, client = _require_rest_client(ctx_obj)
    response = client.get_service(service_id)
    return _single_result("service", "service.get", response, _scope(ctx_obj))


def escalation_policy_list_result(ctx_obj: dict[str, Any], *, limit: int = 25) -> dict[str, Any]:
    _runtime, client = _require_rest_client(ctx_obj)
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
    _runtime, client = _require_rest_client(ctx_obj)
    response = client.list_on_calls(limit=limit, escalation_policy_id=escalation_policy_id)
    return _collection_result("on_call", "on_call.list", response, response["items"], _scope(ctx_obj))


def alert_list_result(ctx_obj: dict[str, Any], *, limit: int = 25, incident_id: str | None = None) -> dict[str, Any]:
    _runtime, client = _require_rest_client(ctx_obj)
    response = client.list_alerts(limit=limit, incident_id=incident_id)
    return _collection_result("alert", "alert.list", response, response["items"], _scope(ctx_obj))


def change_event_create_result(
    ctx_obj: dict[str, Any],
    *,
    summary: str | None = None,
    description: str | None = None,
    source: str,
) -> dict[str, Any]:
    runtime, client = _require_events_client(ctx_obj)
    response = client.create_change_event(
        summary=_require_value(summary or runtime["summary"] or runtime["title"], argument="summary", env_name=runtime["summary_env"]),
        description=_strip(description) or runtime["description"],
        source=source,
    )
    return _single_result("change_event", "change_event.create", response, _scope(ctx_obj))


def health_snapshot(ctx_obj: dict[str, Any]) -> dict[str, Any]:
    runtime = resolve_runtime_values(ctx_obj)
    probe = probe_runtime(ctx_obj)
    readiness = _command_readiness(runtime, probe)
    if any(readiness.values()):
        status = "ready"
    elif probe["code"] == "PAGERDUTY_AUTH_ERROR":
        status = "degraded"
    else:
        status = "needs_setup"

    if readiness["incident.list"] and readiness["change_event.create"]:
        summary = "PagerDuty connector is ready for live reads, incident writes, and change events."
    elif readiness["incident.list"]:
        summary = "PagerDuty connector is ready for live reads."
    elif readiness["change_event.create"]:
        summary = "PagerDuty connector is ready for change events, but REST commands still need a REST API key."
    else:
        summary = probe["message"]

    next_steps: list[str] = []
    if not runtime["api_key_present"]:
        next_steps.append(f"Provide {runtime['api_key_env']} for REST reads and incident writes.")
    if runtime["api_key_present"] and not runtime["from_email_present"]:
        next_steps.append(f"Set {runtime['from_email_env']} for incident.create, incident.acknowledge, and incident.resolve.")
    if not runtime["events_routing_key_present"]:
        next_steps.append(f"Provide {runtime['events_routing_key_env']} to enable change_event.create.")
    if readiness["incident.list"]:
        next_steps.append("Use incident.list to confirm live REST access.")

    return {
        "status": status,
        "summary": summary,
        "connector": {
            "backend": BACKEND_NAME,
            "live_backend_available": bool(readiness["incident.list"] or readiness["change_event.create"]),
            "live_read_available": True,
            "write_bridge_available": True,
            "scaffold_only": False,
        },
        "auth": {
            "api_key_env": runtime["api_key_env"],
            "api_key_present": runtime["api_key_present"],
            "api_key_source": runtime["api_key_source"],
            "events_routing_key_env": runtime["events_routing_key_env"],
            "events_routing_key_present": runtime["events_routing_key_present"],
            "events_routing_key_source": runtime["events_routing_key_source"],
            "from_email_env": runtime["from_email_env"],
            "from_email_present": runtime["from_email_present"],
            "service_id_env": runtime["service_id_env"],
            "incident_id_env": runtime["incident_id_env"],
            "escalation_policy_id_env": runtime["escalation_policy_id_env"],
        },
        "scope": _scope(ctx_obj),
        "checks": [
            {
                "name": "rest_api_key",
                "ok": runtime["api_key_present"],
                "details": {"missing_keys": [] if runtime["api_key_present"] else [runtime["api_key_env"]]},
            },
            {
                "name": "incident_write_identity",
                "ok": runtime["from_email_present"],
                "details": {"missing_env": [] if runtime["from_email_present"] else [runtime["from_email_env"]]},
            },
            {
                "name": "events_routing_key",
                "ok": runtime["events_routing_key_present"],
                "details": {
                    "missing_keys": [] if runtime["events_routing_key_present"] else [runtime["events_routing_key_env"]]
                },
            },
            {"name": "live_read_probe", "ok": bool(probe.get("ok")), "details": probe.get("details", {})},
        ],
        "runtime_ready": bool(readiness["incident.list"] or readiness["change_event.create"]),
        "live_backend_available": bool(readiness["incident.list"] or readiness["change_event.create"]),
        "live_read_available": True,
        "write_bridge_available": True,
        "scaffold_only": False,
        "command_readiness": readiness,
        "probe": probe,
        "next_steps": next_steps,
    }


def doctor_snapshot(ctx_obj: dict[str, Any]) -> dict[str, Any]:
    runtime = resolve_runtime_values(ctx_obj)
    probe = probe_runtime(ctx_obj)
    readiness = _command_readiness(runtime, probe)
    if any(readiness.values()):
        status = "ready"
    elif probe.get("code") == "PAGERDUTY_AUTH_ERROR":
        status = "degraded"
    else:
        status = "needs_setup"
    return {
        "status": status,
        "summary": "PagerDuty connector diagnostics.",
        "runtime": {
            "implementation_mode": "live_read_live_write",
            "command_readiness": readiness,
            "scaffold_only": False,
        },
        "checks": [
            {"name": "rest_api_key", "ok": runtime["api_key_present"]},
            {"name": "incident_write_identity", "ok": runtime["from_email_present"]},
            {"name": "events_routing_key", "ok": runtime["events_routing_key_present"]},
            {"name": "live_read_probe", "ok": bool(probe.get("ok")), "details": probe.get("details", {})},
        ],
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
