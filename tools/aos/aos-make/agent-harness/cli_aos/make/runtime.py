from __future__ import annotations

import json
from typing import Any

from .client import MakeApiError, MakeBridgeClient
from .config import redacted_config_snapshot, resolve_runtime_values
from .constants import (
    BACKEND_NAME,
    CONNECTOR_CATEGORIES,
    CONNECTOR_CATEGORY,
    CONNECTOR_LABEL,
    CONNECTOR_RESOURCES,
    WRITE_COMMAND_IDS,
    trigger_builder_hints,
)
from .errors import ConnectorError


def _client(ctx_obj: dict[str, Any]) -> MakeBridgeClient:
    return MakeBridgeClient.from_runtime(resolve_runtime_values(ctx_obj))


def _missing_keys(runtime: dict[str, Any]) -> list[str]:
    missing: list[str] = []
    if not runtime["api_url_present"]:
        missing.append(runtime["api_url_env"])
    if not runtime["api_key_present"]:
        missing.append(runtime["api_key_env"])
    return missing


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


def _first_text(values: list[Any]) -> str | None:
    for value in values:
        if value is None:
            continue
        if isinstance(value, bool):
            return "true" if value else "false"
        if isinstance(value, (int, float)):
            return str(value)
        text = value if isinstance(value, str) else str(value)
        cleaned = text.strip()
        if cleaned:
            return cleaned
    return None


def _extract_records(payload: Any) -> list[dict[str, Any]]:
    if isinstance(payload, list):
        return [item for item in payload if isinstance(item, dict)]
    if isinstance(payload, dict):
        for key in ("data", "organizations", "teams", "scenarios", "connections", "executions", "runs", "items", "results"):
            value = payload.get(key)
            if isinstance(value, list):
                return [item for item in value if isinstance(item, dict)]
            if isinstance(value, dict):
                nested = value.get("data")
                if isinstance(nested, list):
                    return [item for item in nested if isinstance(item, dict)]
        if any(key in payload for key in ("id", "name", "status", "title")):
            return [payload]
    return []


def _extract_record(payload: Any, *keys: str) -> dict[str, Any] | None:
    if isinstance(payload, dict):
        for key in keys:
            value = payload.get(key)
            if isinstance(value, dict):
                return value
        if any(key in payload for key in ("id", "name", "status", "title")):
            return payload
        data = payload.get("data")
        if isinstance(data, dict):
            return _extract_record(data, *keys) or data
    return None


def _resource_name(record: dict[str, Any], *keys: str) -> str | None:
    return _first_text([record.get(key) for key in keys])


def _status_text(record: dict[str, Any], *keys: str) -> str | None:
    return _first_text([record.get(key) for key in keys])


def _normalize_organization(record: dict[str, Any]) -> dict[str, Any]:
    organization_id = _resource_name(record, "id", "organization_id", "organizationId")
    organization_name = _resource_name(record, "name", "organization_name", "organizationName", "title") or organization_id
    status = _status_text(record, "status", "state")
    return {
        "id": organization_id,
        "name": organization_name,
        "status": status,
        "created_at": record.get("created_at") or record.get("createdAt"),
        "updated_at": record.get("updated_at") or record.get("updatedAt"),
    }


def _normalize_team(record: dict[str, Any]) -> dict[str, Any]:
    team_id = _resource_name(record, "id", "team_id", "teamId")
    team_name = _resource_name(record, "name", "team_name", "teamName", "title") or team_id
    status = _status_text(record, "status", "state")
    return {
        "id": team_id,
        "name": team_name,
        "status": status,
        "organization_name": _resource_name(record, "organization_name", "organizationName"),
    }


def _normalize_scenario(record: dict[str, Any]) -> dict[str, Any]:
    scenario_id = _resource_name(record, "id", "scenario_id", "scenarioId")
    scenario_name = _resource_name(record, "name", "scenario_name", "scenarioName", "title") or scenario_id
    status = _status_text(record, "status", "state", "scenario_status")
    return {
        "id": scenario_id,
        "name": scenario_name,
        "status": status,
        "organization_name": _resource_name(record, "organization_name", "organizationName"),
        "team_name": _resource_name(record, "team_name", "teamName"),
        "last_run_at": record.get("last_run_at") or record.get("lastRunAt"),
    }


def _normalize_connection(record: dict[str, Any]) -> dict[str, Any]:
    connection_id = _resource_name(record, "id", "connection_id", "connectionId")
    connection_name = _resource_name(record, "name", "connection_name", "connectionName", "title") or connection_id
    status = _status_text(record, "status", "state", "connection_status")
    return {
        "id": connection_id,
        "name": connection_name,
        "status": status,
        "organization_name": _resource_name(record, "organization_name", "organizationName"),
    }


def _normalize_execution(record: dict[str, Any]) -> dict[str, Any]:
    execution_id = _resource_name(record, "id", "execution_id", "executionId")
    scenario_id = _resource_name(record, "scenario_id", "scenarioId")
    scenario_name = _resource_name(record, "scenario_name", "scenarioName")
    status = _status_text(record, "status", "state", "result")
    return {
        "id": execution_id,
        "scenario_id": scenario_id,
        "scenario_name": scenario_name,
        "status": status,
        "run_id": _resource_name(record, "run_id", "runId"),
        "started_at": record.get("started_at") or record.get("startedAt"),
        "finished_at": record.get("finished_at") or record.get("finishedAt"),
        "duration_ms": record.get("duration_ms") or record.get("durationMs"),
    }


def _picker_options(resource: str, records: list[dict[str, Any]]) -> list[dict[str, Any]]:
    options: list[dict[str, Any]] = []
    for record in records:
        record_id = record.get("id")
        if not record_id:
            continue
        option: dict[str, Any] = {
            "value": str(record_id),
            "label": str(record.get("name") or record_id),
            "resource": resource,
        }
        subtitle_parts = [record.get("status"), record.get("organization_name"), record.get("team_name")]
        subtitle = " | ".join(str(part) for part in subtitle_parts if part)
        if subtitle:
            option["subtitle"] = subtitle
        options.append(option)
    return options


def _scope_preview(
    command_id: str,
    resource: str,
    runtime: dict[str, Any],
    picker_options: list[dict[str, Any]],
    *,
    operation: str,
    extra: dict[str, Any] | None = None,
) -> dict[str, Any]:
    preview = {
        "command_id": command_id,
        "operation": operation,
        "surface": resource,
        "scaffold_only": False,
        "live_backend_available": True,
        "live_read_available": operation == "read",
        "write_bridge_available": operation == "write",
        "candidate_count": len(picker_options),
        "picker": {"kind": resource, "items": picker_options},
        "organization_name": runtime.get("organization_name"),
        "team_name": runtime.get("team_name"),
        "scenario_name": runtime.get("scenario_name"),
        "connection_name": runtime.get("connection_name"),
    }
    if extra:
        preview.update(extra)
    return preview


def _collection_result(
    *,
    command_id: str,
    resource: str,
    runtime: dict[str, Any],
    records: list[dict[str, Any]],
    normalize,
) -> dict[str, Any]:
    normalized = [normalize(record) for record in records]
    picker_options = _picker_options(resource, normalized)
    return {
        "status": "live",
        "summary": f"Listed {len(normalized)} Make {resource}s.",
        "resource": resource,
        "count": len(normalized),
        "results": normalized,
        "picker_options": picker_options,
        "scope_preview": _scope_preview(command_id, resource, runtime, picker_options, operation="read"),
        "scope": {"preview": _scope_preview(command_id, resource, runtime, picker_options, operation="read")},
        "live_backend_available": True,
        "live_read_available": True,
        "write_bridge_available": True,
        "scaffold_only": False,
    }


def probe_runtime(ctx_obj: dict[str, Any] | None = None) -> dict[str, Any]:
    runtime = resolve_runtime_values(ctx_obj or {})
    missing = _missing_keys(runtime)
    if missing:
        return {
            "ok": False,
            "code": "MAKE_SETUP_REQUIRED",
            "message": "Make bridge configuration is incomplete",
            "details": {"missing_keys": missing, "live_read_available": False, "write_bridge_available": False, "scaffold_only": False},
        }
    try:
        client = _client(ctx_obj or {})
        probe_result = client.probe()
    except MakeApiError as err:
        return {
            "ok": False,
            "code": err.code,
            "message": err.message,
            "details": {
                **(err.details or {}),
                "probe_mode": "live-read",
                "live_read_available": False,
                "write_bridge_available": False,
                "scaffold_only": False,
            },
        }
    endpoint = probe_result.get("endpoint") if isinstance(probe_result, dict) else None
    return {
        "ok": True,
        "code": "OK",
        "message": "Make live read runtime is ready",
        "details": {
            "probe_mode": "live-read",
            "endpoint": endpoint,
            "live_read_available": True,
            "write_bridge_available": True,
            "scaffold_only": False,
        },
    }


def probe_write_runtime(ctx_obj: dict[str, Any] | None = None) -> dict[str, Any]:
    runtime = resolve_runtime_values(ctx_obj or {})
    missing = _missing_keys(runtime)
    if missing:
        return {
            "ok": False,
            "code": "MAKE_SETUP_REQUIRED",
            "message": "Make bridge configuration is incomplete",
            "details": {"missing_keys": missing, "probe_mode": "setup-required", "write_bridge_available": False, "scaffold_only": False},
        }
    try:
        client = _client(ctx_obj or {})
        probe_result = client.probe_trigger(runtime.get("scenario_id"))
    except MakeApiError as err:
        return {
            "ok": False,
            "code": err.code,
            "message": err.message,
            "details": {
                **(err.details or {}),
                "probe_mode": "write-bridge",
                "write_bridge_available": False,
                "scaffold_only": False,
            },
        }
    return {
        "ok": True,
        "code": "OK",
        "message": "Make trigger bridge is ready",
        "details": {
            "probe_mode": "write-bridge",
            "endpoint": probe_result.get("endpoint") if isinstance(probe_result, dict) else None,
            "allow": probe_result.get("allow") if isinstance(probe_result, dict) else None,
            "method": probe_result.get("method") if isinstance(probe_result, dict) else None,
            "write_bridge_available": True,
            "scaffold_only": False,
        },
    }


def health_snapshot(ctx_obj: dict[str, Any]) -> dict[str, Any]:
    runtime = resolve_runtime_values(ctx_obj)
    read_probe = probe_runtime(ctx_obj)
    write_probe = probe_write_runtime(ctx_obj)
    auth_ready = runtime["api_url_present"] and runtime["api_key_present"]
    read_ready = bool(read_probe.get("ok"))
    write_ready = bool(write_probe.get("ok"))
    live_backend_available = read_ready and write_ready
    if not auth_ready:
        status = "needs_setup"
        summary = "Configure MAKE_API_URL, MAKE_API_KEY, and MAKE_WEBHOOK_BASE_URL before using live Make reads and triggers."
        next_steps = [
            f"Set {runtime['api_url_env']} to the target Make API base URL.",
            f"Set {runtime['api_key_env']} to a valid Make API key.",
            f"Set {runtime['webhook_base_url_env']} to the public webhook base used by scenario.trigger.",
        ]
    elif not read_ready:
        status = "degraded"
        summary = "Make API credentials are configured, but the live read probe failed."
        next_steps = [
            f"Verify {runtime['api_url_env']} points to a reachable Make bridge.",
            f"Verify {runtime['api_key_env']} is valid and authorized for live reads.",
        ]
    elif not write_ready:
        status = "partial_ready"
        summary = "Live reads are available, but the scenario trigger bridge is not configured."
        next_steps = [
            f"Set {runtime['webhook_base_url_env']} to the public base used by the trigger bridge.",
            "Use scenario.list, scenario.status, connection.list, and execution.list while the connector remains read-only.",
        ]
    else:
        status = "ready"
        summary = "Make read and trigger bridges are configured and ready."
        next_steps = [
            "Use scenario.list, scenario.status, connection.list, and execution.list for live reads.",
            "Use scenario.trigger and execution.run to post live execution payloads through the bridge.",
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
            "scaffold_only": False,
        },
        "auth": {
            "api_url_env": runtime["api_url_env"],
            "api_url_present": runtime["api_url_present"],
            "api_key_env": runtime["api_key_env"],
            "api_key_present": runtime["api_key_present"],
            "webhook_base_url_env": runtime["webhook_base_url_env"],
            "webhook_base_url_present": runtime["webhook_base_url_present"],
        },
        "checks": [
            {
                "name": "setup",
                "ok": auth_ready,
                "details": {"missing_keys": [] if auth_ready else _missing_keys(runtime)},
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
        "scaffold_only": False,
        "probe": {"read": read_probe, "write": write_probe},
        "next_steps": next_steps,
    }


def doctor_snapshot(ctx_obj: dict[str, Any], *, health: dict[str, Any] | None = None) -> dict[str, Any]:
    health = health or health_snapshot(ctx_obj)
    if health["status"] == "needs_setup":
        recommendations = [
            "Configure the Make API URL, API key, and webhook base URL before handing this connector to a worker.",
            "scenario.list and scenario.status remain available only after the API is reachable.",
        ]
    elif health["status"] == "degraded":
        recommendations = [
            "Fix the Make API connection so the live read path can reach the configured instance.",
            "Verify the trigger bridge base URL if scenario.trigger is also unavailable.",
        ]
    elif health["status"] == "partial_ready":
        recommendations = [
            "Configure the trigger bridge base URL so scenario.trigger can execute live posts.",
            "Use scenario.list, scenario.status, connection.list, and execution.list while the connector remains read-only.",
        ]
    else:
        recommendations = [
            "Use scenario.list, scenario.status, connection.list, execution.list, scenario.trigger, and execution.run as live commands.",
            "Keep the webhook bridge pointed at the trigger workflow you want the Make bridge to execute.",
        ]
    return {**health, "recommendations": recommendations}


def config_snapshot(ctx_obj: dict[str, Any]) -> dict[str, Any]:
    runtime = resolve_runtime_values(ctx_obj)
    read_probe = probe_runtime(ctx_obj)
    write_probe = probe_write_runtime(ctx_obj)
    return redacted_config_snapshot(ctx_obj, probe=read_probe, write_probe=write_probe)


def _resolve_scenario(runtime: dict[str, Any], client: MakeBridgeClient, options: dict[str, str], terms: list[str]) -> dict[str, Any]:
    scenario_id = options.get("scenario_id") or (terms[0] if terms else None) or runtime.get("scenario_id")
    scenario_name = options.get("scenario_name") or runtime.get("scenario_name")
    status = options.get("status") or runtime.get("scenario_status")
    if scenario_id:
        scenario_id = scenario_id.strip()
        if scenario_id.startswith("http://") or scenario_id.startswith("https://"):
            parts = [part for part in scenario_id.rstrip("/").split("/") if part]
            if parts:
                scenario_id = parts[-1]
        return {"scenario_id": scenario_id, "scenario_name": scenario_name or scenario_id, "status": status, "selector": "scenario_id"}
    if scenario_name:
        payload = client.list_scenarios(limit=1000, status=status, organization_name=runtime.get("organization_name"), team_name=runtime.get("team_name"))
        records = _extract_records(payload)
        matches = [record for record in records if _first_text([record.get("name"), record.get("scenario_name")]).casefold() == scenario_name.strip().casefold()]
        if not matches:
            raise ConnectorError("MAKE_SCENARIO_REQUIRED", f"No scenario matched '{scenario_name}'.", 2, details={"scenario_name": scenario_name})
        if len(matches) > 1:
            raise ConnectorError("MAKE_SCENARIO_AMBIGUOUS", f"Multiple scenarios matched '{scenario_name}'.", 2, details={"scenario_name": scenario_name, "match_count": len(matches)})
        record = matches[0]
        return {"scenario_id": _resource_name(record, "id", "scenario_id", "scenarioId"), "scenario_name": _first_text([record.get("name"), record.get("scenario_name")]) or scenario_name, "status": status, "selector": "scenario_name"}
    raise ConnectorError("MAKE_SCENARIO_REQUIRED", "scenario.status requires a scenario_id or scenario_name.", 2, details={"missing_keys": ["MAKE_SCENARIO_ID", "MAKE_SCENARIO_NAME"]})


def _resolve_execution(runtime: dict[str, Any], client: MakeBridgeClient, options: dict[str, str], terms: list[str]) -> dict[str, Any]:
    execution_id = options.get("execution_id") or options.get("run_id") or (terms[0] if terms else None) or runtime.get("execution_id") or runtime.get("run_id")
    status = options.get("status")
    if execution_id:
        execution_id = execution_id.strip()
        if execution_id.startswith("http://") or execution_id.startswith("https://"):
            parts = [part for part in execution_id.rstrip("/").split("/") if part]
            if parts:
                execution_id = parts[-1]
        return {"execution_id": execution_id, "status": status, "selector": "execution_id"}
    raise ConnectorError("MAKE_EXECUTION_REQUIRED", "execution.status requires an execution_id or run_id.", 2, details={"missing_keys": ["MAKE_EXECUTION_ID", "MAKE_RUN_ID"]})


def run_read_command(ctx_obj: dict[str, Any], command_id: str, items: tuple[str, ...]) -> dict[str, Any]:
    runtime = resolve_runtime_values(ctx_obj)
    client = _client(ctx_obj)
    options, terms = _clean_pairs(items)
    if command_id == "organization.list":
        limit = int(options.get("limit", "10") or "10")
        payload = client.list_organizations(limit=limit)
        return _collection_result(command_id=command_id, resource="organization", runtime=runtime, records=_extract_records(payload), normalize=_normalize_organization)
    if command_id == "team.list":
        limit = int(options.get("limit", "10") or "10")
        payload = client.list_teams(limit=limit, organization_name=options.get("organization_name") or runtime.get("organization_name"), organization_id=options.get("organization_id") or runtime.get("organization_id"))
        return _collection_result(command_id=command_id, resource="team", runtime=runtime, records=_extract_records(payload), normalize=_normalize_team)
    if command_id == "scenario.list":
        limit = int(options.get("limit", "10") or "10")
        payload = client.list_scenarios(
            limit=limit,
            status=options.get("status") or runtime.get("scenario_status"),
            organization_name=options.get("organization_name") or runtime.get("organization_name"),
            organization_id=options.get("organization_id") or runtime.get("organization_id"),
            team_name=options.get("team_name") or runtime.get("team_name"),
            team_id=options.get("team_id") or runtime.get("team_id"),
        )
        return _collection_result(command_id=command_id, resource="scenario", runtime=runtime, records=_extract_records(payload), normalize=_normalize_scenario)
    if command_id == "scenario.status":
        target = _resolve_scenario(runtime, client, options, terms)
        payload = client.get_scenario(target["scenario_id"])
        record = _extract_records(payload)
        scenario = _normalize_scenario(record[0] if record else _extract_record(payload, "scenario", "data") or {"id": target["scenario_id"], "name": target["scenario_name"], "status": target.get("status")})
        picker_options = _picker_options("scenario", [scenario])
        return {
            "status": "live",
            "summary": f"Read Make scenario status for {scenario.get('name') or scenario.get('id')}.",
            "scenario": scenario,
            "resolved_target": target,
            "picker_options": picker_options,
            "scope_preview": _scope_preview(command_id, "scenario", runtime, picker_options, operation="read", extra={"scenario": scenario}),
            "scope": {"preview": _scope_preview(command_id, "scenario", runtime, picker_options, operation="read", extra={"scenario": scenario})},
            "live_backend_available": True,
            "live_read_available": True,
            "write_bridge_available": True,
            "scaffold_only": False,
        }
    if command_id == "connection.list":
        limit = int(options.get("limit", "10") or "10")
        payload = client.list_connections(limit=limit, organization_name=options.get("organization_name") or runtime.get("organization_name"), organization_id=options.get("organization_id") or runtime.get("organization_id"))
        return _collection_result(command_id=command_id, resource="connection", runtime=runtime, records=_extract_records(payload), normalize=_normalize_connection)
    if command_id == "execution.list":
        limit = int(options.get("limit", "10") or "10")
        payload = client.list_executions(limit=limit, scenario_id=options.get("scenario_id") or runtime.get("scenario_id"), status=options.get("status"))
        return _collection_result(command_id=command_id, resource="execution", runtime=runtime, records=_extract_records(payload), normalize=_normalize_execution)
    if command_id == "execution.status":
        target = _resolve_execution(runtime, client, options, terms)
        payload = client.get_execution(target["execution_id"])
        records = _extract_records(payload)
        execution = _normalize_execution(records[0] if records else _extract_record(payload, "execution", "data") or {"id": target["execution_id"], "status": target.get("status")})
        picker_options = _picker_options("execution", [execution])
        return {
            "status": "live",
            "summary": f"Read Make execution status for {execution.get('id') or target['execution_id']}.",
            "execution": execution,
            "resolved_target": target,
            "picker_options": picker_options,
            "scope_preview": _scope_preview(command_id, "execution", runtime, picker_options, operation="read", extra={"execution": execution}),
            "scope": {"preview": _scope_preview(command_id, "execution", runtime, picker_options, operation="read", extra={"execution": execution})},
            "live_backend_available": True,
            "live_read_available": True,
            "write_bridge_available": True,
            "scaffold_only": False,
        }
    raise ConnectorError("MAKE_INVALID_USAGE", f"Unknown command: {command_id}", 2)


def run_trigger_command(ctx_obj: dict[str, Any], command_id: str, inputs: dict[str, Any]) -> dict[str, Any]:
    runtime = resolve_runtime_values(ctx_obj)
    missing = _missing_keys(runtime)
    if missing:
        raise ConnectorError("MAKE_SETUP_REQUIRED", "Make bridge configuration is incomplete.", 2, details={"missing_keys": missing})
    client = _client(ctx_obj)
    event = str(inputs.get("event") or "manual").strip() or "manual"
    payload = inputs.get("payload") or {}
    if not isinstance(payload, dict):
        raise ConnectorError("MAKE_INVALID_USAGE", "payload must be a JSON object.", 2, details={"payload_type": type(payload).__name__})
    if command_id == "scenario.trigger":
        scenario_options = {
            "scenario_id": inputs.get("scenario_id") or runtime.get("scenario_id"),
            "scenario_name": inputs.get("scenario_name") or runtime.get("scenario_name"),
            "status": inputs.get("status") or runtime.get("scenario_status"),
        }
        target = _resolve_scenario(runtime, client, scenario_options, [])
    elif command_id == "execution.run":
        scenario_id = inputs.get("scenario_id")
        target = {
            "scenario_id": scenario_id.strip() if isinstance(scenario_id, str) and scenario_id.strip() else None,
            "scenario_name": inputs.get("scenario_name"),
            "status": inputs.get("status"),
            "selector": "scenario_id" if scenario_id else "execution.run",
        }
    else:
        raise ConnectorError("MAKE_INVALID_USAGE", f"Unknown command: {command_id}", 2)
    write_probe = probe_write_runtime(ctx_obj)
    response = client.trigger_scenario(
        target.get("scenario_id"),
        event=event,
        payload=payload,
        organization_name=runtime.get("organization_name"),
        team_name=runtime.get("team_name"),
        connection_id=runtime.get("connection_id"),
    )
    normalized_response = response if isinstance(response, dict) else {"response": response}
    trigger_builder = trigger_builder_hints(runtime=runtime, probe={"details": {"write_probe": write_probe}}, payload=payload, response=normalized_response)
    status_code = int(normalized_response.get("status_code") or 200)
    normalized_ack = {
        "ok": bool(normalized_response.get("ok", 200 <= status_code < 300)),
        "status_code": status_code,
        "response_kind": normalized_response.get("response_kind") or ("json" if isinstance(response, dict) else "text"),
        "execution_id": normalized_response.get("execution_id") or normalized_response.get("id") or normalized_response.get("executionId"),
        "response_status": normalized_response.get("response_status") or normalized_response.get("status") or normalized_response.get("state") or normalized_response.get("result"),
        "summary": normalized_response.get("summary")
        or (
            f"Triggered Make scenario {target.get('scenario_name') or target.get('scenario_id')}."
            if target.get("scenario_id") or target.get("scenario_name")
            else "Triggered Make execution run."
        ),
    }
    return {
        "status": "live",
        "summary": normalized_ack["summary"],
        "command_id": command_id,
        "event": event,
        "scenario": target,
        "payload": payload,
        "response": normalized_response,
        "execution": normalized_ack,
        "run": normalized_ack,
        "trigger_builder": trigger_builder,
        "live_backend_available": True,
        "live_read_available": True,
        "write_bridge_available": True,
        "scaffold_only": False,
    }
