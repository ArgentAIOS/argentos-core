from __future__ import annotations

import json
from typing import Any

from . import __version__
from .client import PayPunchApiError, PayPunchClient
from .config import command_defaults, config_snapshot, redacted_config_snapshot, resolve_runtime_values
from .constants import (
    BACKEND_NAME,
    CONNECTOR_CATEGORIES,
    CONNECTOR_CATEGORY,
    CONNECTOR_LABEL,
    CONNECTOR_PATH,
    CONNECTOR_RESOURCES,
    MODE_ORDER,
    READ_COMMANDS,
)
from .errors import ConnectorError


def _connector_manifest() -> dict[str, Any]:
    return json.loads(CONNECTOR_PATH.read_text())


def _manifest_status() -> dict[str, Any]:
    try:
        manifest = _connector_manifest()
    except json.JSONDecodeError as err:
        return {
            "path": str(CONNECTOR_PATH),
            "valid_json": False,
            "error": {"message": str(err), "line": err.lineno, "column": err.colno},
        }
    return {"path": str(CONNECTOR_PATH), "valid_json": True, "command_count": len(manifest.get("commands", []))}


def _as_list(payload: dict[str, Any], *keys: str) -> list[Any]:
    for key in keys:
        value = payload.get(key)
        if isinstance(value, list):
            return value
    for value in payload.values():
        if isinstance(value, list):
            return value
    return []


def _pick_text(record: dict[str, Any], *keys: str) -> str:
    for key in keys:
        value = record.get(key)
        if isinstance(value, str) and value.strip():
            return value.strip()
    return ""


def _picker_items(
    items: list[Any],
    *,
    kind: str,
    label_keys: tuple[str, ...],
    subtitle_keys: tuple[str, ...] = (),
) -> list[dict[str, Any]]:
    picker: list[dict[str, Any]] = []
    for item in items:
        if not isinstance(item, dict):
            continue
        value = _pick_text(item, "id", f"{kind}_id", f"{kind}Id")
        if not value:
            continue
        label = _pick_text(item, *label_keys) or value
        option: dict[str, Any] = {"value": value, "label": label, "kind": kind}
        subtitle = _pick_text(item, *subtitle_keys)
        if subtitle:
            option["subtitle"] = subtitle
        picker.append(option)
    return picker


def _scope_preview(*, command_id: str, selection_surface: str, **extra: Any) -> dict[str, Any]:
    return {"command_id": command_id, "selection_surface": selection_surface, **extra}


def create_client(ctx_obj: dict[str, Any] | None = None) -> PayPunchClient:
    runtime = resolve_runtime_values(ctx_obj)
    missing = [
        name
        for name in ("PAYPUNCH_API_KEY", "PAYPUNCH_API_BASE_URL")
        if not runtime["details"][name]["present"]
    ]
    if missing:
        raise ConnectorError(
            code="PAYPUNCH_SERVICE_KEYS_REQUIRED",
            message="PAYPUNCH_API_KEY and PAYPUNCH_API_BASE_URL service keys are required for PayPunch live reads.",
            details={"missing_service_keys": missing},
        )
    return PayPunchClient(api_key=runtime["api_key"], base_url=runtime["api_base_url"])


def _required(value: str, *, code: str, message: str, service_key: str) -> str:
    if value:
        return value
    raise ConnectorError(code=code, message=message, details={"service_key": service_key})


def capabilities_snapshot() -> dict[str, Any]:
    manifest = _connector_manifest()
    return {
        "tool": manifest["tool"],
        "version": __version__,
        "backend": manifest["backend"],
        "manifest_schema_version": manifest.get("manifest_schema_version", "1.0.0"),
        "modes": MODE_ORDER,
        "connector": manifest["connector"],
        "auth": manifest["auth"],
        "scope": manifest.get("scope", {}),
        "commands": manifest["commands"],
        "read_support": {command_id: True for command_id in READ_COMMANDS},
        "write_support": {"live_writes_enabled": False, "scaffold_only": False, "scaffolded_commands": []},
    }


def probe_live_read(runtime: dict[str, Any]) -> dict[str, Any]:
    missing = [
        name
        for name in ("PAYPUNCH_API_KEY", "PAYPUNCH_API_BASE_URL")
        if not runtime["details"][name]["present"]
    ]
    if missing:
        return {"ok": False, "details": {"missing_keys": missing, "reason": "required service keys missing"}}
    try:
        client = PayPunchClient(api_key=runtime["api_key"], base_url=runtime["api_base_url"])
        timesheets = _as_list(client.list_timesheets(limit=1), "timesheets", "data", "items")
        employees = _as_list(client.list_employees(limit=1), "employees", "data", "items")
        return {
            "ok": True,
            "details": {
                "timesheet_count_sample": len(timesheets),
                "employee_count_sample": len(employees),
            },
        }
    except PayPunchApiError as err:
        return {"ok": False, "details": {"error": err.as_dict()}}


def health_snapshot(ctx_obj: dict[str, Any]) -> dict[str, Any]:
    runtime = resolve_runtime_values(ctx_obj)
    probe = probe_live_read(runtime)
    required_ready = (
        runtime["details"]["PAYPUNCH_API_KEY"]["present"]
        and runtime["details"]["PAYPUNCH_API_BASE_URL"]["present"]
    )
    live_ready = bool(probe.get("ok"))
    if not required_ready:
        status = "needs_setup"
        summary = (
            "Configure PAYPUNCH_API_KEY and PAYPUNCH_API_BASE_URL in operator-controlled "
            "service keys before live PayPunch reads."
        )
        next_steps = [
            "Set PAYPUNCH_API_KEY in operator-controlled service keys.",
            "Set PAYPUNCH_API_BASE_URL to the PayPunch API host in operator-controlled service keys.",
            "Use local PAYPUNCH_* environment variables only as development harness fallback.",
        ]
    elif not live_ready:
        status = "degraded"
        summary = "PayPunch service keys are present, but the sampled live read probe failed."
        next_steps = [
            "Verify the PayPunch API base URL and key.",
            "Confirm the API key has timesheet and employee read scopes.",
        ]
    else:
        status = "ready"
        summary = "PayPunch credentials and API reachability are ready for the sampled timesheet/employee read probe."
        next_steps = [
            "Use read-only commands, and tenant-smoke each resource family before advertising production readiness for that family.",
            "Company, pay period, export, and report commands are implemented but not separately tenant-smoked in this repo.",
        ]
    return {
        "status": status,
        "summary": summary,
        "connector": {
            "backend": BACKEND_NAME,
            "label": CONNECTOR_LABEL,
            "category": CONNECTOR_CATEGORY,
            "categories": list(CONNECTOR_CATEGORIES),
            "resources": list(CONNECTOR_RESOURCES),
            "live_backend_available": True,
            "live_backend_probe_ok": live_ready,
            "live_read_available": True,
            "sampled_read_probe_ok": live_ready,
            "write_bridge_available": False,
            "scaffold_only": False,
        },
        "auth": {
            "required_service_keys": ["PAYPUNCH_API_KEY", "PAYPUNCH_API_BASE_URL"],
            "optional_scope_service_keys": [
                "PAYPUNCH_TENANT_ID",
                "PAYPUNCH_COMPANY_ID",
                "PAYPUNCH_EMPLOYEE_ID",
                "PAYPUNCH_TIMESHEET_ID",
                "PAYPUNCH_PAY_PERIOD",
            ],
            "missing_service_keys": [
                name
                for name in ("PAYPUNCH_API_KEY", "PAYPUNCH_API_BASE_URL")
                if not runtime["details"][name]["present"]
            ],
            "service_key_sources": {
                "PAYPUNCH_API_KEY": runtime["details"]["PAYPUNCH_API_KEY"]["source"],
                "PAYPUNCH_API_BASE_URL": runtime["details"]["PAYPUNCH_API_BASE_URL"]["source"],
            },
            "local_env_fallback": True,
        },
        "probe": probe,
        "next_steps": next_steps,
    }


def doctor_snapshot(ctx_obj: dict[str, Any]) -> dict[str, Any]:
    return {
        "health": health_snapshot(ctx_obj),
        "config": redacted_config_snapshot(ctx_obj),
        "manifest": _manifest_status(),
        "runtime": {
            "implementation_mode": "live_read_only",
            "command_defaults": command_defaults(),
            "supported_read_commands": list(READ_COMMANDS),
            "write_bridge_available": False,
            "tenant_smoke_tested": False,
            "sampled_probe_commands": ["timesheet.list", "employee.list"],
        },
    }


def timesheet_list_result(
    ctx_obj: dict[str, Any],
    *,
    tenant_id: str | None = None,
    company_id: str | None = None,
    employee_id: str | None = None,
    pay_period: str | None = None,
    limit: int = 50,
) -> dict[str, Any]:
    runtime = resolve_runtime_values(ctx_obj)
    payload = create_client(ctx_obj).list_timesheets(
        tenant_id=tenant_id or runtime["tenant_id"],
        company_id=company_id or runtime["company_id"],
        employee_id=employee_id or runtime["employee_id"],
        pay_period=pay_period or runtime["pay_period"],
        limit=limit,
    )
    timesheets = _as_list(payload, "timesheets", "data", "items")
    return {
        "timesheets": timesheets,
        "timesheet_count": len(timesheets),
        "raw": payload,
        "picker": {
            "kind": "timesheet",
            "items": _picker_items(
                timesheets,
                kind="timesheet",
                label_keys=("employee_name", "employee", "name"),
                subtitle_keys=("date", "status", "company"),
            ),
        },
        "scope_preview": _scope_preview(
            command_id="timesheet.list",
            selection_surface="timesheet",
            tenant_id=tenant_id or runtime["tenant_id"],
            company_id=company_id or runtime["company_id"],
            employee_id=employee_id or runtime["employee_id"],
            pay_period=pay_period or runtime["pay_period"],
            limit=limit,
        ),
    }


def timesheet_get_result(ctx_obj: dict[str, Any], timesheet_id: str | None = None) -> dict[str, Any]:
    runtime = resolve_runtime_values(ctx_obj)
    resolved = _required(
        (timesheet_id or runtime["timesheet_id"]).strip(),
        code="PAYPUNCH_TIMESHEET_ID_REQUIRED",
        message="A PayPunch timesheet ID is required.",
        service_key="PAYPUNCH_TIMESHEET_ID",
    )
    return {
        "timesheet": create_client(ctx_obj).get_timesheet(resolved),
        "scope_preview": _scope_preview(command_id="timesheet.get", selection_surface="timesheet", timesheet_id=resolved),
    }


def employee_list_result(ctx_obj: dict[str, Any], *, company_id: str | None = None, limit: int = 100) -> dict[str, Any]:
    runtime = resolve_runtime_values(ctx_obj)
    payload = create_client(ctx_obj).list_employees(company_id=company_id or runtime["company_id"], limit=limit)
    employees = _as_list(payload, "employees", "data", "items")
    return {
        "employees": employees,
        "employee_count": len(employees),
        "raw": payload,
        "picker": {
            "kind": "employee",
            "items": _picker_items(employees, kind="employee", label_keys=("name", "employee_name"), subtitle_keys=("role", "status", "company")),
        },
        "scope_preview": _scope_preview(command_id="employee.list", selection_surface="employee", company_id=company_id or runtime["company_id"], limit=limit),
    }


def employee_get_result(ctx_obj: dict[str, Any], employee_id: str | None = None) -> dict[str, Any]:
    runtime = resolve_runtime_values(ctx_obj)
    resolved = _required(
        (employee_id or runtime["employee_id"]).strip(),
        code="PAYPUNCH_EMPLOYEE_ID_REQUIRED",
        message="A PayPunch employee ID is required.",
        service_key="PAYPUNCH_EMPLOYEE_ID",
    )
    return {
        "employee": create_client(ctx_obj).get_employee(resolved),
        "scope_preview": _scope_preview(command_id="employee.get", selection_surface="employee", employee_id=resolved),
    }


def company_list_result(ctx_obj: dict[str, Any], *, tenant_id: str | None = None, limit: int = 50) -> dict[str, Any]:
    runtime = resolve_runtime_values(ctx_obj)
    payload = create_client(ctx_obj).list_companies(tenant_id=tenant_id or runtime["tenant_id"], limit=limit)
    companies = _as_list(payload, "companies", "data", "items")
    return {
        "companies": companies,
        "company_count": len(companies),
        "raw": payload,
        "picker": {
            "kind": "company",
            "items": _picker_items(companies, kind="company", label_keys=("name", "company_name"), subtitle_keys=("employee_count", "pay_schedule")),
        },
        "scope_preview": _scope_preview(command_id="company.list", selection_surface="company", tenant_id=tenant_id or runtime["tenant_id"], limit=limit),
    }


def company_get_result(ctx_obj: dict[str, Any], company_id: str | None = None) -> dict[str, Any]:
    runtime = resolve_runtime_values(ctx_obj)
    resolved = _required(
        (company_id or runtime["company_id"]).strip(),
        code="PAYPUNCH_COMPANY_ID_REQUIRED",
        message="A PayPunch company ID is required.",
        service_key="PAYPUNCH_COMPANY_ID",
    )
    return {
        "company": create_client(ctx_obj).get_company(resolved),
        "scope_preview": _scope_preview(command_id="company.get", selection_surface="company", company_id=resolved),
    }


def export_quickbooks_iif_result(ctx_obj: dict[str, Any], *, company_id: str | None = None, pay_period: str | None = None) -> dict[str, Any]:
    runtime = resolve_runtime_values(ctx_obj)
    return {
        "export": create_client(ctx_obj).export_quickbooks_iif(company_id=company_id or runtime["company_id"], pay_period=pay_period or runtime["pay_period"]),
        "scope_preview": _scope_preview(command_id="export.quickbooks_iif", selection_surface="export", company_id=company_id or runtime["company_id"], pay_period=pay_period or runtime["pay_period"]),
    }


def export_csv_result(ctx_obj: dict[str, Any], *, company_id: str | None = None, pay_period: str | None = None) -> dict[str, Any]:
    runtime = resolve_runtime_values(ctx_obj)
    return {
        "export": create_client(ctx_obj).export_csv(company_id=company_id or runtime["company_id"], pay_period=pay_period or runtime["pay_period"]),
        "scope_preview": _scope_preview(command_id="export.csv", selection_surface="export", company_id=company_id or runtime["company_id"], pay_period=pay_period or runtime["pay_period"]),
    }


def pay_period_list_result(ctx_obj: dict[str, Any], *, company_id: str | None = None, limit: int = 12) -> dict[str, Any]:
    runtime = resolve_runtime_values(ctx_obj)
    payload = create_client(ctx_obj).list_pay_periods(company_id=company_id or runtime["company_id"], limit=limit)
    pay_periods = _as_list(payload, "pay_periods", "payPeriods", "data", "items")
    return {
        "pay_periods": pay_periods,
        "pay_period_count": len(pay_periods),
        "raw": payload,
        "picker": {
            "kind": "pay_period",
            "items": _picker_items(pay_periods, kind="pay_period", label_keys=("label", "name", "id"), subtitle_keys=("start_date", "end_date", "status")),
        },
        "scope_preview": _scope_preview(command_id="pay_period.list", selection_surface="pay_period", company_id=company_id or runtime["company_id"], limit=limit),
    }


def pay_period_current_result(ctx_obj: dict[str, Any], *, company_id: str | None = None) -> dict[str, Any]:
    runtime = resolve_runtime_values(ctx_obj)
    return {
        "pay_period": create_client(ctx_obj).current_pay_period(company_id=company_id or runtime["company_id"]),
        "scope_preview": _scope_preview(command_id="pay_period.current", selection_surface="pay_period", company_id=company_id or runtime["company_id"]),
    }


def report_hours_summary_result(ctx_obj: dict[str, Any], *, company_id: str | None = None, pay_period: str | None = None) -> dict[str, Any]:
    runtime = resolve_runtime_values(ctx_obj)
    return {
        "report": create_client(ctx_obj).hours_summary(company_id=company_id or runtime["company_id"], pay_period=pay_period or runtime["pay_period"]),
        "scope_preview": _scope_preview(command_id="report.hours_summary", selection_surface="report", company_id=company_id or runtime["company_id"], pay_period=pay_period or runtime["pay_period"]),
    }


def report_overtime_result(ctx_obj: dict[str, Any], *, company_id: str | None = None, pay_period: str | None = None) -> dict[str, Any]:
    runtime = resolve_runtime_values(ctx_obj)
    return {
        "report": create_client(ctx_obj).overtime_report(company_id=company_id or runtime["company_id"], pay_period=pay_period or runtime["pay_period"]),
        "scope_preview": _scope_preview(command_id="report.overtime", selection_surface="report", company_id=company_id or runtime["company_id"], pay_period=pay_period or runtime["pay_period"]),
    }
