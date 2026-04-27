from __future__ import annotations

from typing import Any

from .client import AirtableClient
from .config import redacted_config_snapshot, runtime_config
from .constants import COMMAND_SPECS, MANIFEST_SCHEMA_VERSION, MODE_ORDER, TOOL_NAME


def capabilities_snapshot() -> dict[str, Any]:
    config = runtime_config()
    scope = dict(config["scope"])
    scope["commandDefaults"] = config["scope"]["commandDefaultsTemplate"]
    return {
        "tool": TOOL_NAME,
        "version": config["version"],
        "manifest_schema_version": MANIFEST_SCHEMA_VERSION,
        "backend": "airtable-rest-api",
        "modes": MODE_ORDER,
        "connector": {
            "label": "Airtable",
            "category": "data-ops",
            "categories": ["data-ops", "spreadsheet-database", "ops-automation"],
            "resources": ["base", "table", "record", "field", "view"],
        },
        "auth": config["auth"],
        "runtime": config["runtime"],
        "read_support": config["read_support"],
        "write_support": config["write_support"],
        "scope": scope,
        "commands": COMMAND_SPECS,
    }


def _scope_preview(config: dict[str, Any], *, command_id: str, inputs: dict[str, Any], details: dict[str, Any]) -> dict[str, Any]:
    resolved_base_id = str(
        inputs.get("base_id")
        or details.get("base_id")
        or (details.get("picker", {}) if isinstance(details.get("picker"), dict) else {}).get("base_id")
        or (details.get("base", {}) if isinstance(details.get("base"), dict) else {}).get("id")
        or config["context"]["base_id"]
        or ""
    ).strip()
    resolved_table_name = str(
        inputs.get("table_name")
        or inputs.get("table")
        or details.get("table_name")
        or (details.get("picker", {}) if isinstance(details.get("picker"), dict) else {}).get("selected_table_name")
        or (details.get("table", {}) if isinstance(details.get("table"), dict) else {}).get("name")
        or (details.get("table", {}) if isinstance(details.get("table"), dict) else {}).get("id")
        or config["context"]["table_name"]
        or ""
    ).strip()
    preview: dict[str, Any] = {
        "command_id": command_id,
        "base_id": resolved_base_id or None,
        "table_name": resolved_table_name or None,
        "workspace_id": config["context"]["workspace_id"] or None,
        "command_default": config["scope"]["commandDefaults"].get(command_id),
        "table_scope": {
            "base_id": resolved_base_id or None,
            "table_name": resolved_table_name or None,
            "record_readiness": {
                "record.list": bool(resolved_base_id and resolved_table_name),
                "record.search": bool(resolved_base_id and resolved_table_name),
                "record.read": bool(resolved_base_id and resolved_table_name),
            },
        },
    }
    if "picker" in details:
        preview["picker"] = details["picker"]
    if "base" in details and isinstance(details["base"], dict):
        preview["base"] = {
            "id": details["base"].get("id"),
            "table_count": details["base"].get("table_count"),
        }
    if "table" in details and isinstance(details["table"], dict):
        preview["table"] = {
            "id": details["table"].get("id"),
            "name": details["table"].get("name"),
        }
    if "record" in details and isinstance(details["record"], dict):
        preview["record"] = {
            "id": details["record"].get("id"),
        }
    return preview


def _health_checks(config: dict[str, Any]) -> list[dict[str, Any]]:
    runtime = config["runtime"]
    read_support = config["read_support"]
    write_support = config["write_support"]
    return [
        {
            "name": "auth",
            "ok": runtime["auth_ready"],
            "details": {
                "missing_keys": list(config["auth"]["missing_keys"]),
                "base_discovery_ready": runtime["base_discovery_ready"],
                "base_scoped_read_ready": runtime["base_scoped_read_ready"],
                "table_name_present": runtime["table_name_present"],
            },
        },
        {
            "name": "table_scope",
            "ok": runtime["table_name_present"],
            "optional": True,
            "details": {
                "table_name_present": runtime["table_name_present"],
                "command_defaults_ready": runtime["command_defaults_ready"],
            },
        },
        {
            "name": "read_paths",
            "ok": runtime["base_discovery_ready"],
            "details": read_support,
        },
        {
            "name": "write_paths",
            "ok": write_support["live_writes_enabled"],
            "details": write_support,
        },
    ]


def health_snapshot(ctx_obj: dict[str, Any]) -> dict[str, Any]:
    config = runtime_config(ctx_obj)
    runtime = config["runtime"]
    if not runtime["auth_ready"]:
        return {
            "status": "needs_setup",
            "backend": config["backend"],
            "summary": "Airtable live reads need AIRTABLE_API_TOKEN before any read path can run",
            "checks": _health_checks(config),
            "implementation_mode": runtime["implementation_mode"],
            "live_backend_ready": False,
            "base_discovery_ready": False,
            "base_scoped_read_ready": False,
            "write_ready": False,
            "context": {
                "base_id_present": bool(config["context"]["base_id"]),
                "table_name_present": bool(config["context"]["table_name"]),
                "workspace_id_present": bool(config["context"]["workspace_id"]),
            },
        }
    if not runtime["base_scoped_read_ready"]:
        return {
            "status": "partial_ready",
            "backend": config["backend"],
            "summary": "Base discovery is live, but base-scoped reads need AIRTABLE_BASE_ID",
            "checks": _health_checks(config),
            "implementation_mode": runtime["implementation_mode"],
            "live_backend_ready": True,
            "base_discovery_ready": True,
            "base_scoped_read_ready": False,
            "write_ready": False,
            "context": {
                "base_id_present": bool(config["context"]["base_id"]),
                "table_name_present": bool(config["context"]["table_name"]),
                "workspace_id_present": bool(config["context"]["workspace_id"]),
            },
        }
    return {
        "status": "ready",
        "backend": config["backend"],
        "summary": "Airtable live reads and write-mode record mutations are ready",
        "checks": _health_checks(config),
        "implementation_mode": runtime["implementation_mode"],
        "live_backend_ready": True,
        "base_discovery_ready": True,
        "base_scoped_read_ready": True,
        "write_ready": runtime["live_write_ready"],
        "context": {
            "base_id_present": bool(config["context"]["base_id"]),
            "table_name_present": bool(config["context"]["table_name"]),
            "workspace_id_present": bool(config["context"]["workspace_id"]),
        },
    }


def doctor_snapshot(ctx_obj: dict[str, Any]) -> dict[str, Any]:
    config = runtime_config(ctx_obj)
    runtime = config["runtime"]
    setup_ready = runtime["auth_ready"]
    fully_ready = runtime["base_scoped_read_ready"]
    return {
        "status": "ready" if fully_ready else "partial_ready" if setup_ready else "needs_setup",
        "backend": config["backend"],
        "summary": "Airtable connector is live-read capable with write-mode record mutations",
        "runtime_ready": setup_ready,
        "checks": [
            {
                "name": "setup",
                "ok": setup_ready,
                "details": {
                    "missing_keys": list(config["auth"]["missing_keys"]),
                    "base_discovery_ready": runtime["base_discovery_ready"],
                    "base_scoped_read_ready": runtime["base_scoped_read_ready"],
                    "table_name_present": bool(config["context"]["table_name"]),
                    "live_writes_enabled": runtime["live_write_ready"],
                },
            },
            {
                "name": "read_paths",
                "ok": runtime["base_discovery_ready"],
                "details": {
                    "read_support": config["read_support"],
                    "implementation_mode": runtime["implementation_mode"],
                },
            },
            {
                "name": "table_scope",
                "ok": runtime["table_name_present"],
                "details": {
                    "command_defaults_ready": runtime["command_defaults_ready"],
                },
            },
            {
                "name": "write_paths",
                "ok": runtime["live_write_ready"],
                "details": config["write_support"],
            },
        ],
        "runtime": config["runtime"],
        "context": config["context"],
        "scope": config["scope"],
    }


def live_write_result(
    ctx_obj: dict[str, Any],
    *,
    command_id: str,
    resource: str,
    operation: str,
    inputs: dict[str, Any],
    fetcher: Any,
) -> dict[str, Any]:
    config = runtime_config(ctx_obj)
    client = AirtableClient.from_config(config)
    details = fetcher(client)
    scope_preview = details.pop("scope_preview", None)
    return {
        "status": "live_write",
        "backend": config["backend"],
        "command_id": command_id,
        "resource": resource,
        "operation": operation,
        "implemented": True,
        "executed": True,
        "consequential": True,
        "implementation_mode": config["runtime"]["implementation_mode"],
        "inputs": inputs,
        "scope": {
            "base_id": config["context"]["base_id"],
            "table_name": config["context"]["table_name"],
            "workspace_id": config["context"]["workspace_id"],
            "commandDefaults": config["scope"]["commandDefaults"],
            "commandDefaultsTemplate": config["scope"]["commandDefaultsTemplate"],
            "preview": scope_preview or _scope_preview(config, command_id=command_id, inputs=inputs, details=details),
        },
        "read_support": config["read_support"],
        "write_support": config["write_support"],
        "summary": details.pop("summary", f"{command_id} completed"),
        **details,
    }


def live_read_result(
    ctx_obj: dict[str, Any],
    *,
    command_id: str,
    resource: str,
    operation: str,
    inputs: dict[str, Any],
    fetcher: Any,
    consequential: bool = False,
) -> dict[str, Any]:
    config = runtime_config(ctx_obj)
    client = AirtableClient.from_config(config)
    details = fetcher(client)
    scope_preview = details.pop("scope_preview", None)
    return {
        "status": "live_read",
        "backend": config["backend"],
        "command_id": command_id,
        "resource": resource,
        "operation": operation,
        "implemented": True,
        "executed": True,
        "consequential": consequential,
        "implementation_mode": config["runtime"]["implementation_mode"],
        "inputs": inputs,
        "scope": {
            "base_id": config["context"]["base_id"],
            "table_name": config["context"]["table_name"],
            "workspace_id": config["context"]["workspace_id"],
            "commandDefaults": config["scope"]["commandDefaults"],
            "commandDefaultsTemplate": config["scope"]["commandDefaultsTemplate"],
            "preview": scope_preview or _scope_preview(config, command_id=command_id, inputs=inputs, details=details),
        },
        "read_support": config["read_support"],
        "write_support": config["write_support"],
        "summary": details.pop("summary", f"{command_id} completed"),
        **details,
    }


def config_snapshot(ctx_obj: dict[str, Any]) -> dict[str, Any]:
    return redacted_config_snapshot(ctx_obj)
