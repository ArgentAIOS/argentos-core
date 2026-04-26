from __future__ import annotations

from typing import Any

from .client import ZapierApiError, ZapierBridgeClient
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


def _client(ctx_obj: dict[str, Any]) -> ZapierBridgeClient:
    return ZapierBridgeClient.from_ctx(ctx_obj)


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
            return "on" if value else "off"
        if isinstance(value, (int, float)):
            return str(value)
        if isinstance(value, str):
            text = value.strip()
            if text:
                return text
        else:
            text = str(value).strip()
            if text:
                return text
    return None


def _is_record_like(value: Any) -> bool:
    if not isinstance(value, dict):
        return False
    keys = {
        "id",
        "name",
        "title",
        "zap_id",
        "zap_name",
        "status",
        "state",
        "enabled",
        "workspace_name",
    }
    return any(key in value for key in keys)


def _extract_records(response: Any) -> list[dict[str, Any]]:
    if isinstance(response, list):
        return [item for item in response if isinstance(item, dict)]
    if isinstance(response, dict):
        for key in ("zaps", "items", "results", "records"):
            value = response.get(key)
            if isinstance(value, list):
                return [item for item in value if isinstance(item, dict)]
            if _is_record_like(value):
                return [value]
        data = response.get("data")
        if isinstance(data, list):
            return [item for item in data if isinstance(item, dict)]
        if _is_record_like(data):
            return [data]
        if isinstance(data, dict):
            for key in ("zaps", "items", "results", "records"):
                value = data.get(key)
                if isinstance(value, list):
                    return [item for item in value if isinstance(item, dict)]
                if _is_record_like(value):
                    return [value]
            for key in ("zap", "item", "result"):
                value = data.get(key)
                if _is_record_like(value):
                    return [value]
            if _is_record_like(data):
                return [data]
        for key in ("zap", "item", "result"):
            value = response.get(key)
            if _is_record_like(value):
                return [value]
        if _is_record_like(response):
            return [response]
    return []


def _normalize_status(record: dict[str, Any]) -> str | None:
    status = _first_text(
        [
            record.get("status"),
            record.get("state"),
            record.get("zap_status"),
            record.get("workflow_state"),
        ]
    )
    if status:
        return status
    enabled = record.get("enabled")
    if isinstance(enabled, bool):
        return "on" if enabled else "off"
    active = record.get("active")
    if isinstance(active, bool):
        return "on" if active else "off"
    return None


def _workspace_name(record: dict[str, Any]) -> str | None:
    workspace = record.get("workspace")
    if isinstance(workspace, dict):
        return _first_text([workspace.get("name"), workspace.get("title"), workspace.get("label"), workspace.get("id")])
    return _first_text([record.get("workspace_name"), record.get("workspace"), record.get("workspace_id")])


def _normalize_zap_record(record: dict[str, Any]) -> dict[str, Any]:
    zap_id = _first_text([record.get("id"), record.get("zap_id"), record.get("zapId"), record.get("uuid")])
    zap_name = _first_text([record.get("name"), record.get("zap_name"), record.get("title"), record.get("label")])
    status = _normalize_status(record)
    workspace_name = _workspace_name(record)
    normalized: dict[str, Any] = {
        "id": zap_id,
        "name": zap_name or zap_id,
        "status": status,
        "workspace_name": workspace_name,
    }
    for field in ("description", "created_at", "updated_at", "last_run_at", "last_updated_at"):
        value = record.get(field)
        if value is not None:
            normalized[field] = value
    if isinstance(record.get("enabled"), bool):
        normalized["enabled"] = record["enabled"]
    if isinstance(record.get("active"), bool):
        normalized["active"] = record["active"]
    if isinstance(record.get("url"), str) and record["url"].strip():
        normalized["url"] = record["url"].strip()
    return normalized


def _picker_options(zaps: list[dict[str, Any]]) -> list[dict[str, Any]]:
    options: list[dict[str, Any]] = []
    for zap in zaps:
        zap_id = zap.get("id")
        if not zap_id:
            continue
        option: dict[str, Any] = {
            "value": str(zap_id),
            "label": str(zap.get("name") or zap_id),
            "resource": "zap.zap",
        }
        subtitle = " | ".join(str(part) for part in [zap.get("status"), zap.get("workspace_name")] if part)
        if subtitle:
            option["subtitle"] = subtitle
        options.append(option)
    return options


def _configured_zap(runtime: dict[str, Any], options: dict[str, str], terms: list[str]) -> dict[str, Any]:
    zap_id = options.get("zap_id") or (terms[0] if terms else None) or runtime.get("zap_id")
    zap_name = options.get("zap_name") or runtime.get("zap_name") or zap_id
    zap_status = options.get("status") or runtime.get("zap_status")
    return {
        "zap_id": zap_id,
        "zap_name": zap_name,
        "zap_status": zap_status,
        "workspace_name": runtime.get("workspace_name"),
    }


def _scope_preview(
    command_id: str,
    *,
    operation: str,
    zap: dict[str, Any],
    picker_options: list[dict[str, Any]],
    live_backend_available: bool,
) -> dict[str, Any]:
    preview = {
        "command_id": command_id,
        "operation": operation,
        "surface": "zap",
        "scaffold_only": False,
        "live_backend_available": live_backend_available,
        "live_read_available": live_backend_available,
        "candidate_count": len(picker_options),
        "picker": {"kind": "zap", "items": picker_options},
        "zap_id": zap.get("zap_id"),
        "zap_name": zap.get("zap_name"),
        "zap_status": zap.get("zap_status"),
        "workspace_name": zap.get("workspace_name"),
    }
    return preview


def _command_summary(action: str, count: int | None = None, status: str | None = None) -> str:
    if action == "list":
        if count == 1:
            base = "Listed 1 Zapier zap"
        elif count is not None:
            base = f"Listed {count} Zapier zaps"
        else:
            base = "Listed Zapier zaps"
        if status:
            return f"{base} (status={status})"
        return base
    if action == "status":
        return "Read Zapier zap status"
    return "Zapier live read"


def _probe_read_runtime(ctx_obj: dict[str, Any]) -> dict[str, Any]:
    runtime = resolve_runtime_values(ctx_obj)
    missing = _missing_keys(runtime)
    if missing:
        return {
            "ok": False,
            "code": "ZAPIER_SETUP_REQUIRED",
            "message": "Zapier bridge configuration is incomplete",
            "details": {
                "missing_keys": missing,
                "probe_mode": "setup-required",
                "live_backend_available": False,
                "live_read_available": False,
                "write_bridge_available": False,
                "scaffold_only": False,
            },
        }

    try:
        client = _client(ctx_obj)
        probe_result = client.probe()
    except ZapierApiError as err:
        return {
            "ok": False,
            "code": err.code,
            "message": err.message,
            "details": {
                **(err.details or {}),
                "probe_mode": "live-read",
                "live_backend_available": False,
                "live_read_available": False,
                "write_bridge_available": False,
                "scaffold_only": False,
            },
        }

    endpoint = None
    if isinstance(probe_result, dict):
        endpoint = probe_result.get("endpoint")
    return {
        "ok": True,
        "code": "OK",
        "message": "Zapier live read runtime is ready",
        "details": {
            "probe_mode": "live-read",
            "endpoint": endpoint,
            "live_backend_available": True,
            "live_read_available": True,
            "write_bridge_available": False,
            "scaffold_only": False,
        },
    }


def _probe_write_runtime(ctx_obj: dict[str, Any]) -> dict[str, Any]:
    runtime = resolve_runtime_values(ctx_obj)
    missing = _missing_keys(runtime)
    if missing:
        return {
            "ok": False,
            "code": "ZAPIER_SETUP_REQUIRED",
            "message": "Zapier bridge configuration is incomplete",
            "details": {
                "missing_keys": missing,
                "probe_mode": "setup-required",
                "write_bridge_available": False,
                "scaffold_only": False,
            },
        }

    try:
        client = _client(ctx_obj)
        probe_result = client.probe_trigger()
    except ZapierApiError as err:
        return {
            "ok": False,
            "code": err.code,
            "message": err.message,
            "details": {
                **(err.details or {}),
                "probe_mode": "live-write",
                "write_bridge_available": False,
                "scaffold_only": False,
            },
        }

    endpoint = None
    allow = None
    if isinstance(probe_result, dict):
        endpoint = probe_result.get("endpoint")
        allow = probe_result.get("allow")
    return {
        "ok": True,
        "code": "OK",
        "message": "Zapier write bridge is ready",
        "details": {
            "probe_mode": "live-write",
            "endpoint": endpoint,
            "allow": allow,
            "write_bridge_available": True,
            "scaffold_only": False,
        },
    }


def probe_runtime(ctx_obj: dict[str, Any]) -> dict[str, Any]:
    read_probe = _probe_read_runtime(ctx_obj)
    write_probe = _probe_write_runtime(ctx_obj)
    read_ready = bool(read_probe.get("ok"))
    write_ready = bool(write_probe.get("ok"))
    if not read_ready and read_probe.get("code") == "ZAPIER_SETUP_REQUIRED":
        return {
            "ok": False,
            "code": "ZAPIER_SETUP_REQUIRED",
            "message": "Zapier bridge configuration is incomplete",
            "details": {
                **read_probe.get("details", {}),
                "probe_mode": "setup-required",
                "live_backend_available": False,
                "live_read_available": False,
                "write_bridge_available": False,
                "scaffold_only": False,
                "read_probe": read_probe,
                "write_probe": write_probe,
            },
        }

    if read_ready and write_ready:
        return {
            "ok": True,
            "code": "OK",
            "message": "Zapier live read/write runtime is ready",
            "details": {
                "probe_mode": "live-read-write",
                "live_backend_available": True,
                "live_read_available": True,
                "write_bridge_available": True,
                "scaffold_only": False,
                "read_probe": read_probe,
                "write_probe": write_probe,
            },
        }

    if read_ready and not write_ready:
        code = write_probe.get("code")
        message = "Zapier live read runtime is ready, but the trigger bridge is unavailable"
    else:
        code = read_probe.get("code")
        message = str(read_probe.get("message") or write_probe.get("message") or "Zapier bridge probe failed")
    return {
        "ok": False,
        "code": str(code or "ZAPIER_BRIDGE_UNAVAILABLE"),
        "message": message,
        "details": {
            "probe_mode": "partial-ready" if read_ready else "write-ready-read-failed",
            "live_backend_available": read_ready,
            "live_read_available": read_ready,
            "write_bridge_available": write_ready,
            "scaffold_only": False,
            "read_probe": read_probe,
            "write_probe": write_probe,
        },
    }


def health_snapshot(ctx_obj: dict[str, Any]) -> dict[str, Any]:
    runtime = resolve_runtime_values(ctx_obj)
    probe = probe_runtime(ctx_obj)
    auth_ready = runtime["api_url_present"] and runtime["api_key_present"]
    missing_keys = _missing_keys(runtime)
    details = probe.get("details", {})
    read_ready = bool(details.get("live_read_available"))
    write_ready = bool(details.get("write_bridge_available"))
    runtime_ready = read_ready and write_ready

    if not auth_ready:
        status = "needs_setup"
        summary = f"Zapier live reads need {runtime['api_url_env']} and {runtime['api_key_env']} before they can run."
        next_steps = [
            f"Set {runtime['api_url_env']} in operator-controlled API Keys first, or local env when running the harness directly.",
            f"Set {runtime['api_key_env']} in operator-controlled API Keys first, or local env when running the harness directly.",
        ]
    elif not read_ready:
        status = "degraded"
        summary = "Zapier bridge is configured, but the live read probe failed."
        next_steps = [
            f"Verify {runtime['api_url_env']} points at a reachable bridge endpoint.",
            f"Verify {runtime['api_key_env']} is accepted by the configured bridge.",
        ]
    elif runtime_ready:
        status = "ready"
        summary = "Zapier live read/write runtime is ready."
        next_steps = [
            "zap.list, zap.status, and zap.trigger use the configured bridge.",
            "Keep the write bridge guarded by `write` mode.",
        ]
    elif read_ready:
        status = "partial_ready"
        summary = "Zapier live reads are ready, but the trigger bridge is unavailable."
        next_steps = [
            "zap.list and zap.status now use the configured bridge.",
            f"Verify the trigger endpoint exposed by {runtime['api_url_env']}.",
        ]
    else:
        status = "degraded"
        summary = "Zapier bridge probe failed."
        next_steps = [
            f"Verify {runtime['api_url_env']} points at a reachable bridge endpoint.",
            f"Verify {runtime['api_key_env']} is accepted by the configured bridge.",
        ]

    return {
        "status": status,
        "summary": summary,
        "backend": BACKEND_NAME,
        "connector": {
            "backend": BACKEND_NAME,
            "label": CONNECTOR_LABEL,
            "category": CONNECTOR_CATEGORY,
            "categories": CONNECTOR_CATEGORIES,
            "resources": CONNECTOR_RESOURCES,
            "live_backend_available": read_ready,
            "live_read_available": read_ready,
            "write_bridge_available": write_ready,
            "scaffold_only": False,
        },
        "auth": {
            "api_url_env": runtime["api_url_env"],
            "api_url_present": runtime["api_url_present"],
            "api_url_source": runtime["api_url_source"],
            "api_key_env": runtime["api_key_env"],
            "api_key_present": runtime["api_key_present"],
            "api_key_source": runtime["api_key_source"],
            "webhook_base_url_env": runtime["webhook_base_url_env"],
            "webhook_base_url_present": runtime["webhook_base_url_present"],
            "webhook_base_url_source": runtime["webhook_base_url_source"],
            "resolution_order": ["service-keys", "process.env"],
        },
        "checks": [
            {
                "name": "setup",
                "ok": auth_ready,
                "details": {
                    "missing_keys": missing_keys,
                    "live_backend_available": read_ready,
                    "live_read_available": read_ready,
                    "write_bridge_available": write_ready,
                },
            },
            {
                "name": "live_read",
                "ok": read_ready,
                "details": details.get("read_probe", {}),
            },
            {
                "name": "write_bridge",
                "ok": write_ready,
                "details": details.get("write_probe", {}),
            },
        ],
        "setup_complete": auth_ready,
        "missing_keys": missing_keys,
        "runtime_ready": runtime_ready,
        "live_backend_available": read_ready,
        "live_read_available": read_ready,
        "write_bridge_available": write_ready,
        "scaffold_only": False,
        "probe": probe,
        "next_steps": next_steps,
    }


def doctor_snapshot(ctx_obj: dict[str, Any]) -> dict[str, Any]:
    runtime = resolve_runtime_values(ctx_obj)
    probe = probe_runtime(ctx_obj)
    auth_ready = runtime["api_url_present"] and runtime["api_key_present"]
    details = probe.get("details", {})
    read_ready = bool(details.get("live_read_available"))
    write_ready = bool(details.get("write_bridge_available"))
    runtime_ready = read_ready and write_ready
    if not auth_ready:
        status = "needs_setup"
    elif runtime_ready:
        status = "ready"
    elif read_ready:
        status = "partial_ready"
    else:
        status = "degraded"

    return {
        "status": status,
        "summary": "Zapier connector diagnostics.",
        "runtime_ready": runtime_ready,
        "live_backend_available": read_ready,
        "live_read_available": read_ready,
        "write_bridge_available": write_ready,
        "scaffold_only": False,
        "setup_complete": auth_ready,
        "missing_keys": _missing_keys(runtime),
        "next_steps": [
            (
                f"Set {runtime['api_url_env']} and {runtime['api_key_env']} in operator-controlled API Keys, or use local env only when running the harness directly."
                if not auth_ready
                else "Confirm the configured bridge answers live read requests and accepts trigger probes."
            ),
            "Keep zap.trigger guarded by write mode and a bridge that accepts POST /trigger.",
        ],
        "probe": probe,
        "runtime": {
            "workspace_name": runtime["workspace_name"],
            "zap_id": runtime["zap_id"],
            "zap_name": runtime["zap_name"],
            "zap_status": runtime["zap_status"],
            "probe_mode": details.get("probe_mode", "live-read"),
            "probe_endpoint": details.get("read_probe", {}).get("details", {}).get("endpoint"),
            "write_probe_endpoint": details.get("write_probe", {}).get("details", {}).get("endpoint"),
        },
        "checks": [
            {
                "name": "setup",
                "ok": auth_ready,
                "details": {
                    "missing_keys": _missing_keys(runtime),
                },
            },
            {
                "name": "live_read",
                "ok": read_ready,
                "details": details.get("read_probe", {}),
            },
            {
                "name": "write_bridge",
                "ok": write_ready,
                "details": details.get("write_probe", {}),
            },
        ],
    }


def config_snapshot(ctx_obj: dict[str, Any]) -> dict[str, Any]:
    return redacted_config_snapshot(ctx_obj)


def _normalize_trigger_response(
    response: Any,
    *,
    request_inputs: dict[str, Any],
    runtime: dict[str, Any],
    probe: dict[str, Any],
) -> dict[str, Any]:
    response_payload = response if isinstance(response, dict) else {"result": response}
    ack_status = _first_text(
        [
            response_payload.get("status"),
            response_payload.get("state"),
            response_payload.get("result"),
            response_payload.get("message"),
        ]
    )
    probe_details = probe.get("details", {})
    read_ready = bool(probe_details.get("live_read_available"))
    write_ready = bool(probe_details.get("write_bridge_available"))
    trigger_builder = trigger_builder_hints(
        runtime=runtime,
        probe=probe,
        payload=request_inputs.get("payload"),
        response=response_payload,
    )
    trigger_builder["request_template"] = {
        "request_method": "POST",
        "workspace_name": runtime["workspace_name"],
        "zap_id": request_inputs["zap_id"],
        "event": request_inputs["event"],
        "payload": request_inputs["payload"],
    }
    return {
        "status": "live",
        "backend": BACKEND_NAME,
        "resource": "zap",
        "operation": "trigger",
        "command_id": "zap.trigger",
        "executed": True,
        "scaffold_only": False,
        "live_backend_available": read_ready,
        "live_read_available": read_ready,
        "write_bridge_available": write_ready,
        "summary": f"Triggered Zapier zap {request_inputs['zap_id']} with event {request_inputs['event']}",
        "inputs": request_inputs,
        "trigger_builder": trigger_builder,
        "request_template": trigger_builder["request_template"],
        "response_normalization": trigger_builder["response_normalization"],
        "response": response_payload,
        "result": response_payload,
        "acknowledged": ack_status or "ok",
        "runtime": {
            "workspace_name": runtime["workspace_name"],
            "zap_id": runtime["zap_id"],
            "zap_name": runtime["zap_name"],
            "zap_status": runtime["zap_status"],
            "auth_ready": runtime["api_url_present"] and runtime["api_key_present"],
            "runtime_ready": read_ready and write_ready,
            "live_backend_available": read_ready,
            "live_read_available": read_ready,
            "write_bridge_available": write_ready,
            "scaffold_only": False,
            "api_probe": probe,
            "trigger_builder": trigger_builder,
        },
    }


def _list_records(
    client: ZapierBridgeClient,
    *,
    runtime: dict[str, Any],
    limit: int,
    status: str | None,
) -> tuple[list[dict[str, Any]], Any]:
    response = client.list_zaps(limit=limit, status=status, workspace_name=runtime["workspace_name"])
    records = [_normalize_zap_record(record) for record in _extract_records(response)]
    return records, response


def _read_target_zap(
    client: ZapierBridgeClient,
    *,
    runtime: dict[str, Any],
    zap_id: str,
    status: str | None,
) -> tuple[dict[str, Any], Any]:
    response = client.get_zap(zap_id, status=status, workspace_name=runtime["workspace_name"])
    records = _extract_records(response)
    if not records:
        raise ZapierApiError(
            code="ZAPIER_ZAP_NOT_FOUND",
            message=f"Configured Zapier bridge returned no zap record for {zap_id}",
            exit_code=6,
            details={"zap_id": zap_id},
        )
    record = _normalize_zap_record(records[0])
    if record.get("id") and record["id"] != zap_id and len(records) == 1:
        record["requested_id"] = zap_id
    return record, response


def _live_read_result(
    *,
    command_id: str,
    runtime: dict[str, Any],
    probe: dict[str, Any],
    operation: str,
    live_payload: Any,
    picker_options: list[dict[str, Any]],
    scope_zap: dict[str, Any],
    summary: str,
    count: int | None = None,
    limit: int | None = None,
) -> dict[str, Any]:
    auth_ready = runtime["api_url_present"] and runtime["api_key_present"]
    payload: dict[str, Any] = {
        "status": "live",
        "backend": BACKEND_NAME,
        "resource": "zap",
        "operation": operation,
        "summary": summary,
        "command_id": command_id,
        "executed": True,
        "scaffold_only": False,
        "live_backend_available": True,
        "live_read_available": True,
        "write_bridge_available": False,
        "runtime": {
            "workspace_name": runtime["workspace_name"],
            "zap_id": runtime["zap_id"],
            "zap_name": runtime["zap_name"],
            "zap_status": runtime["zap_status"],
            "auth_ready": auth_ready,
            "runtime_ready": True,
            "live_backend_available": True,
            "live_read_available": True,
            "write_bridge_available": False,
            "scaffold_only": False,
            "api_probe": probe,
        },
    }
    payload["inputs"] = {
        "workspace_name": runtime["workspace_name"],
        "zap_id": scope_zap.get("zap_id"),
        "zap_name": scope_zap.get("zap_name"),
        "zap_status": scope_zap.get("zap_status"),
    }
    payload["scope"] = {
        "zap": scope_zap,
        "preview": _scope_preview(
            command_id,
            operation=operation,
            zap=scope_zap,
            picker_options=picker_options,
            live_backend_available=True,
        ),
    }
    payload["scope_preview"] = payload["scope"]["preview"]
    payload["picker_options"] = picker_options
    payload["zap_candidates"] = picker_options
    payload["results"] = live_payload
    if count is not None:
        payload["count"] = count
    if limit is not None:
        payload["limit"] = limit
    return payload


def _parse_limit(options: dict[str, str]) -> int:
    raw_value = options.get("limit") or "10"
    try:
        limit = int(raw_value)
    except ValueError as exc:
        raise ConnectorError(
            code="INVALID_INPUT",
            message="limit must be an integer",
            exit_code=2,
            details={"field": "limit", "value": raw_value},
        ) from exc
    if limit < 1:
        raise ConnectorError(
            code="INVALID_INPUT",
            message="limit must be greater than zero",
            exit_code=2,
            details={"field": "limit", "value": raw_value},
        )
    return limit


def run_read_command(command_id: str, items: tuple[str, ...]) -> dict[str, Any]:
    runtime = resolve_runtime_values({})
    options, terms = _clean_pairs(items)
    probe = _probe_read_runtime({})
    if not probe.get("ok"):
        details = probe.get("details", {})
        raise ConnectorError(
            code=str(probe.get("code") or "ZAPIER_READ_UNAVAILABLE"),
            message=str(probe.get("message") or "Zapier live reads are unavailable"),
            exit_code=4 if probe.get("code") == "ZAPIER_SETUP_REQUIRED" else 5,
            details=details,
        )

    client = _client({})
    try:
        if command_id == "zap.list":
            limit = _parse_limit(options)
            status = options.get("status") or runtime.get("zap_status")
            records, response = _list_records(client, runtime=runtime, limit=limit, status=status)
            picker_options = _picker_options(records)
            scope_zap = _configured_zap(runtime, options, terms)
            summary = _command_summary("list", count=len(records), status=status)
            payload = _live_read_result(
                command_id=command_id,
                runtime=runtime,
                probe=probe,
                operation="list",
                live_payload=records,
                picker_options=picker_options,
                scope_zap=scope_zap,
                summary=summary,
                count=len(records),
                limit=limit,
            )
            payload["inputs"].update({"limit": limit, "status": status})
            payload["response"] = response
            return payload

        if command_id == "zap.status":
            status = options.get("status") or runtime.get("zap_status")
            zap_id = options.get("zap_id") or (terms[0] if terms else None) or runtime.get("zap_id")
            if not zap_id:
                raise ZapierApiError(
                    code="ZAPIER_ZAP_ID_REQUIRED",
                    message="zap.status requires a zap_id or ZAPIER_ZAP_ID",
                    exit_code=4,
                    details={"missing_keys": ["zap_id"]},
                )
            record, response = _read_target_zap(client, runtime=runtime, zap_id=zap_id, status=status)
            picker_options = _picker_options([record])
            scope_zap = {
                "zap_id": record.get("id"),
                "zap_name": record.get("name"),
                "zap_status": record.get("status"),
                "workspace_name": record.get("workspace_name") or runtime.get("workspace_name"),
            }
            summary = _command_summary("status")
            payload = _live_read_result(
                command_id=command_id,
                runtime=runtime,
                probe=probe,
                operation="status",
                live_payload=record,
                picker_options=picker_options,
                scope_zap=scope_zap,
                summary=summary,
            )
            payload["inputs"].update({"status": status})
            payload["zap"] = record
            payload["response"] = response
            return payload

    except ZapierApiError as err:
        raise ConnectorError(
            code=err.code,
            message=err.message,
            exit_code=err.exit_code,
            details=err.details or {},
        ) from err

    raise ConnectorError(
        code="UNKNOWN_COMMAND",
        message=f"Unsupported read command: {command_id}",
        exit_code=2,
        details={"command_id": command_id},
    )


def run_write_command(command_id: str, inputs: dict[str, Any]) -> dict[str, Any]:
    if command_id != "zap.trigger":
        raise ConnectorError(
            code="UNKNOWN_COMMAND",
            message=f"Unsupported write command: {command_id}",
            exit_code=2,
            details={"command_id": command_id},
        )

    runtime = resolve_runtime_values({})
    probe = probe_runtime({})
    if not runtime["api_url_present"] or not runtime["api_key_present"]:
        raise ConnectorError(
            code="ZAPIER_SETUP_REQUIRED",
            message="Zapier bridge configuration is incomplete",
            exit_code=4,
            details={
                "missing_keys": _missing_keys(runtime),
                "live_backend_available": False,
                "live_read_available": False,
                "write_bridge_available": False,
            },
        )

    zap_id = str(inputs.get("zap_id") or runtime.get("zap_id") or "").strip()
    if not zap_id:
        raise ConnectorError(
            code="ZAPIER_ZAP_ID_REQUIRED",
            message="zap.trigger requires a zap_id or ZAPIER_ZAP_ID",
            exit_code=4,
            details={"missing_keys": ["zap_id"]},
        )

    event = str(inputs.get("event") or "manual").strip() or "manual"
    payload = inputs.get("payload") or {}
    if not isinstance(payload, dict):
        raise ConnectorError(
            code="INVALID_INPUT",
            message="payload must be a key/value object",
            exit_code=2,
            details={"field": "payload"},
        )

    try:
        client = _client({})
        response = client.trigger_zap(
            zap_id,
            event=event,
            payload=payload,
            workspace_name=runtime.get("workspace_name"),
        )
    except ZapierApiError as err:
        raise ConnectorError(
            code=err.code,
            message=err.message,
            exit_code=err.exit_code,
            details=err.details or {},
        ) from err

    request_inputs = {
        "zap_id": zap_id,
        "event": event,
        "payload": payload,
        "workspace_name": runtime.get("workspace_name"),
    }
    result = _normalize_trigger_response(response, request_inputs=request_inputs, runtime=runtime, probe=probe)
    result["api_probe"] = probe
    result["trigger_builder"]["response_normalization"]["normalized"]["acknowledged"] = result["acknowledged"]
    if isinstance(response, dict):
        result["response"] = response
        result["result"] = response
    return result
