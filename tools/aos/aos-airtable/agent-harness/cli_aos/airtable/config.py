from __future__ import annotations

from typing import Any

from . import __version__
from .constants import (
    COMMAND_SPECS,
    CONNECTOR_AUTH,
    CONNECTOR_CATEGORY,
    CONNECTOR_CATEGORIES,
    CONNECTOR_LABEL,
    CONNECTOR_RESOURCES,
    DEFAULT_API_BASE_URL_ENV,
    DEFAULT_API_TOKEN_ENV,
    DEFAULT_BASE_ID_ENV,
    DEFAULT_TABLE_NAME_ENV,
    DEFAULT_WORKSPACE_ID_ENV,
    LEGACY_API_TOKEN_ENV,
    LEGACY_BASE_ID_ENV,
    LEGACY_TABLE_NAME_ENV,
    LEGACY_WORKSPACE_ID_ENV,
    TOOL_NAME,
)
from .service_keys import resolve_named_value


def _resolved(*names: str, ctx_obj: dict[str, Any] | None = None, default: str | None = None) -> dict[str, Any]:
    return resolve_named_value(*names, ctx_obj=ctx_obj, default=default)


def _env(*names: str, ctx_obj: dict[str, Any] | None = None, default: str | None = None) -> str:
    return str(_resolved(*names, ctx_obj=ctx_obj, default=default)["value"] or "")


def _scope_command_defaults_template() -> dict[str, dict[str, Any]]:
    return {
        "base.read": {"args": [DEFAULT_BASE_ID_ENV]},
        "table.read": {"args": [DEFAULT_TABLE_NAME_ENV]},
        "record.list": {"options": {"table": DEFAULT_TABLE_NAME_ENV}},
        "record.search": {"options": {"table": DEFAULT_TABLE_NAME_ENV}},
        "record.read": {"options": {"table": DEFAULT_TABLE_NAME_ENV}},
        "record.create": {"options": {"table": DEFAULT_TABLE_NAME_ENV}},
        "record.update": {"options": {"table": DEFAULT_TABLE_NAME_ENV}},
    }


def _scope_command_defaults(base_id: str, table_name: str) -> dict[str, dict[str, Any]]:
    defaults: dict[str, dict[str, Any]] = {}
    if base_id:
        defaults["base.read"] = {"args": [base_id]}
    if table_name:
        defaults["table.read"] = {"args": [table_name]}
        defaults["record.list"] = {"options": {"table": table_name}}
        defaults["record.search"] = {"options": {"table": table_name}}
        defaults["record.read"] = {"options": {"table": table_name}}
        defaults["record.create"] = {"options": {"table": table_name}}
        defaults["record.update"] = {"options": {"table": table_name}}
    return defaults


def _redact(value: str | None, *, keep: int = 4) -> str:
    if not value:
        return ""
    if len(value) <= keep:
        return "*" * len(value)
    return f"{value[:2]}...{value[-keep:]}"


def _command_readiness(api_token: str, base_id: str, table_name: str) -> dict[str, bool]:
    base_discovery_ready = bool(api_token)
    base_scoped_ready = bool(api_token and base_id)
    table_scoped_ready = bool(api_token and base_id and table_name)
    return {
        "base.list": base_discovery_ready,
        "base.read": base_scoped_ready,
        "table.list": base_scoped_ready,
        "table.read": table_scoped_ready,
        "record.list": table_scoped_ready,
        "record.search": table_scoped_ready,
        "record.read": table_scoped_ready,
        "record.create": table_scoped_ready,
        "record.update": table_scoped_ready,
    }


def runtime_config(ctx_obj: dict[str, Any] | None = None) -> dict[str, Any]:
    api_token_detail = _resolved(DEFAULT_API_TOKEN_ENV, LEGACY_API_TOKEN_ENV, ctx_obj=ctx_obj)
    base_id_detail = _resolved(DEFAULT_BASE_ID_ENV, LEGACY_BASE_ID_ENV, ctx_obj=ctx_obj)
    table_name_detail = _resolved(DEFAULT_TABLE_NAME_ENV, LEGACY_TABLE_NAME_ENV, ctx_obj=ctx_obj)
    workspace_id_detail = _resolved(DEFAULT_WORKSPACE_ID_ENV, LEGACY_WORKSPACE_ID_ENV, ctx_obj=ctx_obj)
    api_base_url_detail = _resolved(DEFAULT_API_BASE_URL_ENV, ctx_obj=ctx_obj, default="https://api.airtable.com/v0")
    api_token = str(api_token_detail["value"] or "")
    base_id = str(base_id_detail["value"] or "")
    table_name = str(table_name_detail["value"] or "")
    workspace_id = str(workspace_id_detail["value"] or "")
    api_base_url = str(api_base_url_detail["value"] or "https://api.airtable.com/v0")

    configured = {
        DEFAULT_API_TOKEN_ENV: bool(api_token),
        DEFAULT_BASE_ID_ENV: bool(base_id),
        DEFAULT_TABLE_NAME_ENV: bool(table_name),
        DEFAULT_WORKSPACE_ID_ENV: bool(workspace_id),
        DEFAULT_API_BASE_URL_ENV: bool(api_base_url_detail["value"]),
    }
    missing_keys = [name for name in (DEFAULT_API_TOKEN_ENV, DEFAULT_BASE_ID_ENV) if not configured[name]]
    auth_ready = bool(api_token)
    base_scoped_ready = bool(api_token and base_id)
    command_defaults = _scope_command_defaults(base_id, table_name)
    command_readiness = _command_readiness(api_token, base_id, table_name)

    return {
        "tool": TOOL_NAME,
        "version": __version__,
        "backend": "airtable-rest-api",
        "label": CONNECTOR_LABEL,
        "category": CONNECTOR_CATEGORY,
        "categories": CONNECTOR_CATEGORIES,
        "resources": CONNECTOR_RESOURCES,
        "auth": {
            "kind": CONNECTOR_AUTH["kind"],
            "required": CONNECTOR_AUTH["required"],
            "service_keys": list(CONNECTOR_AUTH["service_keys"]),
            "optional_service_keys": list(CONNECTOR_AUTH.get("optional_service_keys", [])),
            "configured": configured,
            "missing_keys": missing_keys,
            "sources": {
                DEFAULT_API_TOKEN_ENV: api_token_detail["source"],
                DEFAULT_BASE_ID_ENV: base_id_detail["source"],
                DEFAULT_TABLE_NAME_ENV: table_name_detail["source"],
                DEFAULT_WORKSPACE_ID_ENV: workspace_id_detail["source"],
                DEFAULT_API_BASE_URL_ENV: api_base_url_detail["source"],
            },
            "redacted": {
                DEFAULT_API_TOKEN_ENV: _redact(api_token),
                DEFAULT_BASE_ID_ENV: _redact(base_id),
                DEFAULT_WORKSPACE_ID_ENV: _redact(workspace_id),
                DEFAULT_API_BASE_URL_ENV: _redact(api_base_url),
            },
            "interactive_setup": list(CONNECTOR_AUTH["interactive_setup"]),
        },
        "runtime": {
            "api_base_url": api_base_url.rstrip("/"),
            "base_id": base_id,
            "base_id_present": bool(base_id),
            "table_name": table_name,
            "table_name_present": bool(table_name),
            "workspace_id_present": bool(workspace_id),
            "live_read_ready": auth_ready,
            "base_discovery_ready": auth_ready,
            "base_scoped_read_ready": base_scoped_ready,
            "table_scoped_read_ready": bool(api_token and base_id and table_name),
            "live_write_ready": bool(api_token and base_id),
            "live_write_smoke_tested": False,
            "implementation_mode": "live_read_with_live_writes" if auth_ready else "configuration_only",
            "auth_ready": auth_ready,
            "command_readiness": command_readiness,
            "command_defaults_ready": bool(command_defaults),
        },
        "read_support": command_readiness,
        "write_support": {
            "live_writes_enabled": bool(api_token and base_id),
            "scaffold_only": False,
            "live_write_smoke_tested": False,
        },
        "context": {
            "base_id": base_id,
            "table_name": table_name,
            "workspace_id": workspace_id,
        },
        "scope": {
            "base_id": base_id,
            "table_name": table_name,
            "workspace_id": workspace_id,
            "commandDefaults": command_defaults,
            "commandDefaultsTemplate": _scope_command_defaults_template(),
        },
        "_private": {
            "api_token": api_token,
        },
    }


def redacted_config_snapshot(ctx_obj: dict[str, Any] | None = None) -> dict[str, Any]:
    config = runtime_config(ctx_obj)
    return {
        "tool": config["tool"],
        "version": config["version"],
        "backend": config["backend"],
        "label": config["label"],
        "category": config["category"],
        "categories": config["categories"],
        "resources": config["resources"],
        "auth": config["auth"],
        "runtime": config["runtime"],
        "read_support": config["read_support"],
        "write_support": config["write_support"],
        "scope": config["scope"],
        "context": {
            "base_id_present": bool(config["context"]["base_id"]),
            "table_name_present": bool(config["context"]["table_name"]),
            "workspace_id_present": bool(config["context"]["workspace_id"]),
        },
        "supported_commands": [spec["id"] for spec in COMMAND_SPECS],
    }
