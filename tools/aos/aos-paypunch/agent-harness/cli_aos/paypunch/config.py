from __future__ import annotations

from typing import Any

from .constants import (
    BACKEND_NAME,
    CONNECTOR_CATEGORIES,
    CONNECTOR_CATEGORY,
    CONNECTOR_LABEL,
    CONNECTOR_RESOURCES,
)
from .service_keys import service_key_details

SERVICE_KEY_NAMES = (
    "PAYPUNCH_API_KEY",
    "PAYPUNCH_API_BASE_URL",
    "PAYPUNCH_TENANT_ID",
    "PAYPUNCH_COMPANY_ID",
    "PAYPUNCH_EMPLOYEE_ID",
    "PAYPUNCH_TIMESHEET_ID",
    "PAYPUNCH_PAY_PERIOD",
)


def _detail(name: str, ctx_obj: dict[str, Any] | None) -> dict[str, Any]:
    return service_key_details(name, ctx_obj)


def resolve_runtime_values(ctx_obj: dict[str, Any] | None = None) -> dict[str, Any]:
    ctx_obj = ctx_obj or {}
    details = {name: _detail(name, ctx_obj) for name in SERVICE_KEY_NAMES}
    return {
        "backend": BACKEND_NAME,
        "api_key": details["PAYPUNCH_API_KEY"]["value"],
        "api_base_url": details["PAYPUNCH_API_BASE_URL"]["value"].rstrip("/"),
        "tenant_id": details["PAYPUNCH_TENANT_ID"]["value"],
        "company_id": details["PAYPUNCH_COMPANY_ID"]["value"],
        "employee_id": details["PAYPUNCH_EMPLOYEE_ID"]["value"],
        "timesheet_id": details["PAYPUNCH_TIMESHEET_ID"]["value"],
        "pay_period": details["PAYPUNCH_PAY_PERIOD"]["value"],
        "details": details,
        "service_keys": ["PAYPUNCH_API_KEY", "PAYPUNCH_API_BASE_URL"],
        "optional_scope_service_keys": [
            "PAYPUNCH_TENANT_ID",
            "PAYPUNCH_COMPANY_ID",
            "PAYPUNCH_EMPLOYEE_ID",
            "PAYPUNCH_TIMESHEET_ID",
            "PAYPUNCH_PAY_PERIOD",
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
        "api_base_url_source": details["PAYPUNCH_API_BASE_URL"]["source"],
        "api_key": _redact(runtime["api_key"]),
        "api_key_source": details["PAYPUNCH_API_KEY"]["source"],
        "tenant_id": runtime["tenant_id"],
        "tenant_id_source": details["PAYPUNCH_TENANT_ID"]["source"],
        "company_id": runtime["company_id"],
        "company_id_source": details["PAYPUNCH_COMPANY_ID"]["source"],
        "employee_id": runtime["employee_id"],
        "employee_id_source": details["PAYPUNCH_EMPLOYEE_ID"]["source"],
        "timesheet_id": runtime["timesheet_id"],
        "timesheet_id_source": details["PAYPUNCH_TIMESHEET_ID"]["source"],
        "pay_period": runtime["pay_period"],
        "pay_period_source": details["PAYPUNCH_PAY_PERIOD"]["source"],
    }


def command_defaults() -> dict[str, dict[str, Any]]:
    return {
        "timesheet.list": {
            "selection_surface": "timesheet",
            "args": ["PAYPUNCH_TENANT_ID", "PAYPUNCH_COMPANY_ID", "PAYPUNCH_EMPLOYEE_ID", "PAYPUNCH_PAY_PERIOD"],
            "limit": 50,
        },
        "timesheet.get": {"selection_surface": "timesheet", "args": ["PAYPUNCH_TIMESHEET_ID"]},
        "employee.list": {"selection_surface": "employee", "args": ["PAYPUNCH_COMPANY_ID"], "limit": 100},
        "employee.get": {"selection_surface": "employee", "args": ["PAYPUNCH_EMPLOYEE_ID"]},
        "company.list": {"selection_surface": "company", "args": ["PAYPUNCH_TENANT_ID"], "limit": 50},
        "company.get": {"selection_surface": "company", "args": ["PAYPUNCH_COMPANY_ID"]},
        "export.quickbooks_iif": {"selection_surface": "export", "args": ["PAYPUNCH_COMPANY_ID", "PAYPUNCH_PAY_PERIOD"]},
        "export.csv": {"selection_surface": "export", "args": ["PAYPUNCH_COMPANY_ID", "PAYPUNCH_PAY_PERIOD"]},
        "pay_period.list": {"selection_surface": "pay_period", "args": ["PAYPUNCH_COMPANY_ID"], "limit": 12},
        "pay_period.current": {"selection_surface": "pay_period", "args": ["PAYPUNCH_COMPANY_ID"]},
        "report.hours_summary": {"selection_surface": "report", "args": ["PAYPUNCH_COMPANY_ID", "PAYPUNCH_PAY_PERIOD"]},
        "report.overtime": {"selection_surface": "report", "args": ["PAYPUNCH_COMPANY_ID", "PAYPUNCH_PAY_PERIOD"]},
    }


def config_snapshot(ctx_obj: dict[str, Any] | None = None) -> dict[str, Any]:
    runtime = resolve_runtime_values(ctx_obj)
    return {
        "tool": "aos-paypunch",
        "backend": BACKEND_NAME,
        "auth": {
            "kind": "service-key",
            "service_keys": list(runtime["service_keys"]),
            "required_service_keys_present": {
                "PAYPUNCH_API_KEY": runtime["details"]["PAYPUNCH_API_KEY"]["present"],
                "PAYPUNCH_API_BASE_URL": runtime["details"]["PAYPUNCH_API_BASE_URL"]["present"],
            },
            "service_key_sources": {
                "PAYPUNCH_API_KEY": runtime["details"]["PAYPUNCH_API_KEY"]["source"],
                "PAYPUNCH_API_BASE_URL": runtime["details"]["PAYPUNCH_API_BASE_URL"]["source"],
            },
            "local_env_fallback": True,
        },
        "runtime": {
            "implementation_mode": "live_read_only",
            "command_defaults": command_defaults(),
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
