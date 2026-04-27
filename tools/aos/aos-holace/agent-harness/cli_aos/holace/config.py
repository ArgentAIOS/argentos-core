from __future__ import annotations

from typing import Any

from .constants import BACKEND_NAME, CONNECTOR_CATEGORIES, CONNECTOR_CATEGORY, CONNECTOR_LABEL, CONNECTOR_RESOURCES
from .service_keys import service_key_details

SERVICE_KEY_NAMES = (
    "HOLACE_API_KEY",
    "HOLACE_API_BASE_URL",
    "HOLACE_ATTORNEY_ID",
    "HOLACE_CASE_ID",
    "HOLACE_CLIENT_ID",
    "HOLACE_DOCUMENT_ID",
    "HOLACE_SETTLEMENT_ID",
    "HOLACE_CASE_TYPE",
    "HOLACE_STATUTE_STATE",
)


def _detail(name: str, ctx_obj: dict[str, Any] | None) -> dict[str, Any]:
    return service_key_details(name, ctx_obj)


def resolve_runtime_values(ctx_obj: dict[str, Any] | None = None) -> dict[str, Any]:
    ctx_obj = ctx_obj or {}
    details = {name: _detail(name, ctx_obj) for name in SERVICE_KEY_NAMES}
    return {
        "backend": BACKEND_NAME,
        "api_key": details["HOLACE_API_KEY"]["value"],
        "api_base_url": details["HOLACE_API_BASE_URL"]["value"].rstrip("/"),
        "attorney_id": details["HOLACE_ATTORNEY_ID"]["value"],
        "case_id": details["HOLACE_CASE_ID"]["value"],
        "client_id": details["HOLACE_CLIENT_ID"]["value"],
        "document_id": details["HOLACE_DOCUMENT_ID"]["value"],
        "settlement_id": details["HOLACE_SETTLEMENT_ID"]["value"],
        "case_type": details["HOLACE_CASE_TYPE"]["value"],
        "statute_state": details["HOLACE_STATUTE_STATE"]["value"],
        "details": details,
        "service_keys": ["HOLACE_API_KEY", "HOLACE_API_BASE_URL"],
        "optional_scope_service_keys": [
            "HOLACE_ATTORNEY_ID",
            "HOLACE_CASE_ID",
            "HOLACE_CLIENT_ID",
            "HOLACE_DOCUMENT_ID",
            "HOLACE_SETTLEMENT_ID",
            "HOLACE_CASE_TYPE",
            "HOLACE_STATUTE_STATE",
        ],
    }


def _redact(value: str) -> str:
    return "<redacted>" if value else ""


def redacted_config_snapshot(ctx_obj: dict[str, Any] | None = None) -> dict[str, Any]:
    runtime = resolve_runtime_values(ctx_obj)
    details = runtime["details"]
    return {
        "backend": runtime["backend"],
        "api_base_url": runtime["api_base_url"],
        "api_base_url_source": details["HOLACE_API_BASE_URL"]["source"],
        "api_key": _redact(runtime["api_key"]),
        "api_key_source": details["HOLACE_API_KEY"]["source"],
        "attorney_id": runtime["attorney_id"],
        "attorney_id_source": details["HOLACE_ATTORNEY_ID"]["source"],
        "case_id": runtime["case_id"],
        "case_id_source": details["HOLACE_CASE_ID"]["source"],
        "client_id": runtime["client_id"],
        "client_id_source": details["HOLACE_CLIENT_ID"]["source"],
        "document_id": runtime["document_id"],
        "document_id_source": details["HOLACE_DOCUMENT_ID"]["source"],
        "settlement_id": runtime["settlement_id"],
        "settlement_id_source": details["HOLACE_SETTLEMENT_ID"]["source"],
        "case_type": runtime["case_type"],
        "case_type_source": details["HOLACE_CASE_TYPE"]["source"],
        "statute_state": runtime["statute_state"],
        "statute_state_source": details["HOLACE_STATUTE_STATE"]["source"],
    }


def config_snapshot(ctx_obj: dict[str, Any] | None = None) -> dict[str, Any]:
    runtime = resolve_runtime_values(ctx_obj)
    command_defaults = {
        "case.list": {"selection_surface": "case", "args": ["HOLACE_ATTORNEY_ID", "HOLACE_CLIENT_ID", "HOLACE_CASE_TYPE"], "limit": 25},
        "case.get": {"selection_surface": "case", "args": ["HOLACE_CASE_ID"]},
        "case.timeline": {"selection_surface": "case", "args": ["HOLACE_CASE_ID"]},
        "client.list": {"selection_surface": "client", "limit": 50},
        "client.get": {"selection_surface": "client", "args": ["HOLACE_CLIENT_ID"]},
        "document.list": {"selection_surface": "document", "args": ["HOLACE_CASE_ID"], "limit": 25},
        "document.get": {"selection_surface": "document", "args": ["HOLACE_DOCUMENT_ID"]},
        "deadline.list": {"selection_surface": "deadline", "args": ["HOLACE_CASE_ID"], "limit": 20},
        "deadline.check_statute": {"selection_surface": "deadline", "args": ["HOLACE_STATUTE_STATE", "HOLACE_CASE_TYPE"]},
        "settlement.list": {"selection_surface": "settlement", "args": ["HOLACE_CASE_ID"], "limit": 10},
        "settlement.get": {"selection_surface": "settlement", "args": ["HOLACE_SETTLEMENT_ID"]},
        "settlement.tracker": {"selection_surface": "settlement"},
        "billing.list": {"selection_surface": "billing", "args": ["HOLACE_CASE_ID"], "limit": 25},
        "communication.list": {"selection_surface": "communication", "args": ["HOLACE_CASE_ID"], "limit": 25},
        "report.case_status": {"selection_surface": "report", "args": ["HOLACE_CASE_ID"]},
        "report.pipeline": {"selection_surface": "report", "args": ["HOLACE_ATTORNEY_ID"]},
    }
    return {
        "tool": "aos-holace",
        "backend": BACKEND_NAME,
        "auth": {
            "kind": "service-key",
            "service_keys": list(runtime["service_keys"]),
            "required_service_keys_present": {
                "HOLACE_API_KEY": runtime["details"]["HOLACE_API_KEY"]["present"],
                "HOLACE_API_BASE_URL": runtime["details"]["HOLACE_API_BASE_URL"]["present"],
            },
            "service_key_sources": {
                "HOLACE_API_KEY": runtime["details"]["HOLACE_API_KEY"]["source"],
                "HOLACE_API_BASE_URL": runtime["details"]["HOLACE_API_BASE_URL"]["source"],
            },
            "local_env_fallback": True,
        },
        "runtime": {
            "implementation_mode": "live_read_only",
            "command_defaults": command_defaults,
            "write_bridge_available": False,
            "scaffold_only": False,
        },
        "scope": redacted_config_snapshot(ctx_obj),
        "connector": {
            "label": CONNECTOR_LABEL,
            "category": CONNECTOR_CATEGORY,
            "categories": list(CONNECTOR_CATEGORIES),
            "resources": list(CONNECTOR_RESOURCES),
        },
    }
