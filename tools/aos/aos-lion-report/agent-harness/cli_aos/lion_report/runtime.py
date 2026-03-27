from __future__ import annotations

import json
from typing import Any

from .client import LionReportApiError, LionReportClient
from .config import config_snapshot, resolve_runtime_values
from .constants import BACKEND_NAME, CONNECTOR_PATH, TOOL_NAME
from .errors import CliError


def _load_manifest() -> dict[str, Any]:
    return json.loads(CONNECTOR_PATH.read_text())


def _picker(items: list[dict[str, Any]], *, kind: str) -> dict[str, Any]:
    return {"kind": kind, "items": items, "count": len(items)}


def _require_arg(value: str | None, *, code: str, message: str, env_name: str) -> str:
    resolved = (value or "").strip()
    if resolved:
        return resolved
    raise CliError(code=code, message=message, exit_code=4, details={"env": env_name})


def capabilities_snapshot() -> dict[str, Any]:
    manifest = _load_manifest()
    read_support: dict[str, bool] = {}
    write_support: dict[str, bool] = {}
    for command in manifest["commands"]:
        target = read_support if command["required_mode"] == "readonly" else write_support
        target[command["id"]] = True
    return {
        "tool": manifest["tool"],
        "backend": manifest["backend"],
        "manifest_schema_version": manifest.get("manifest_schema_version", "1.0.0"),
        "connector": manifest["connector"],
        "auth": manifest["auth"],
        "scope": manifest.get("scope", {}),
        "commands": manifest["commands"],
        "read_support": read_support,
        "write_support": write_support,
    }


def create_client(ctx_obj: dict[str, Any]) -> LionReportClient:
    runtime = resolve_runtime_values(ctx_obj)
    if not runtime["api_key_present"]:
        raise CliError(
            code="LION_REPORT_SETUP_REQUIRED",
            message="LION Report connector is missing required credentials",
            exit_code=4,
            details={"missing_keys": [runtime["api_key_env"]]},
        )
    return LionReportClient(api_key=runtime["api_key"], base_url=runtime["base_url"])


def probe_runtime(ctx_obj: dict[str, Any]) -> dict[str, Any]:
    runtime = resolve_runtime_values(ctx_obj)
    if not runtime["api_key_present"]:
        return {
            "ok": False,
            "code": "LION_REPORT_SETUP_REQUIRED",
            "message": "LION Report connector is missing required credentials",
            "details": {"missing_keys": [runtime["api_key_env"]], "live_backend_available": False},
        }
    try:
        client = create_client(ctx_obj)
        reports = client.list_reports(limit=1)
    except CliError as err:
        return {"ok": False, "code": err.code, "message": err.message, "details": err.details}
    except LionReportApiError as err:
        code = "LION_REPORT_AUTH_FAILED" if err.status_code in {401, 403} else "LION_REPORT_API_ERROR"
        return {
            "ok": False,
            "code": code,
            "message": err.message,
            "details": {**(err.details or {}), "status_code": err.status_code, "live_backend_available": False},
        }
    return {
        "ok": True,
        "code": "OK",
        "message": "LION Report live runtime is ready",
        "details": {"live_backend_available": True, "reports": reports},
    }


def health_snapshot(ctx_obj: dict[str, Any]) -> dict[str, Any]:
    runtime = resolve_runtime_values(ctx_obj)
    probe = probe_runtime(ctx_obj)
    status = "ready" if probe["ok"] else ("needs_setup" if probe["code"] == "LION_REPORT_SETUP_REQUIRED" else "degraded")
    return {
        "status": status,
        "summary": probe["message"],
        "connector": {
            "tool": TOOL_NAME,
            "backend": BACKEND_NAME,
            "live_backend_available": bool(probe["ok"]),
            "live_read_available": bool(probe["ok"]),
            "write_bridge_available": bool(probe["ok"]),
            "scaffold_only": False,
        },
        "auth": {"api_key_env": runtime["api_key_env"], "api_key_present": runtime["api_key_present"]},
        "defaults": {
            "report_id": runtime["report_id"],
            "report_type": runtime["report_type"],
            "data_source": runtime["data_source"],
            "template_id": runtime["template_id"],
        },
        "checks": [
            {"name": "required_env", "ok": runtime["api_key_present"], "details": {"missing_keys": [] if runtime["api_key_present"] else [runtime["api_key_env"]]}},
            {"name": "live_backend", "ok": bool(probe["ok"]), "details": probe.get("details", {})},
        ],
        "runtime_ready": bool(probe["ok"]),
        "probe": probe,
    }


def doctor_snapshot(ctx_obj: dict[str, Any]) -> dict[str, Any]:
    runtime = resolve_runtime_values(ctx_obj)
    probe = probe_runtime(ctx_obj)
    ready = bool(probe["ok"])
    return {
        "status": "ready" if ready else ("needs_setup" if probe["code"] == "LION_REPORT_SETUP_REQUIRED" else "degraded"),
        "summary": "LION Report connector diagnostics.",
        "runtime": {
            "implementation_mode": "live_read_write",
            "command_readiness": {
                "report.list": ready,
                "report.get": ready and bool(runtime["report_id"]),
                "report.generate": ready,
                "report.schedule": ready,
                "data.list_sources": ready,
                "data.query": ready and bool(runtime["data_source"]),
                "data.import": ready,
                "analysis.run": ready,
                "analysis.list": ready,
                "template.list": ready,
                "template.get": ready and bool(runtime["template_id"]),
                "export.pdf": ready and bool(runtime["report_id"]),
                "export.csv": ready and bool(runtime["report_id"]),
                "export.email": ready and bool(runtime["report_id"] and runtime["recipient_email"]),
            },
        },
        "checks": [
            {"name": "required_env", "ok": runtime["api_key_present"]},
            {"name": "live_backend", "ok": ready, "details": probe.get("details", {})},
        ],
        "supported_read_commands": [
            "report.list",
            "report.get",
            "data.list_sources",
            "data.query",
            "analysis.list",
            "template.list",
            "template.get",
            "export.pdf",
            "export.csv",
        ],
        "supported_write_commands": [
            "report.generate",
            "report.schedule",
            "data.import",
            "analysis.run",
            "export.email",
        ],
    }


def report_list_result(ctx_obj: dict[str, Any], *, report_type: str | None, date_range: str | None, limit: int) -> dict[str, Any]:
    client = create_client(ctx_obj)
    payload = client.list_reports(report_type=report_type, date_range=date_range, limit=limit)
    reports = payload.get("reports", _ensure_list(payload.get("items")))
    picker_items = [{"value": item.get("id"), "label": item.get("title") or item.get("name"), "subtitle": item.get("status"), "selected": False} for item in reports if isinstance(item, dict)]
    return {"status": "live_read", "backend": BACKEND_NAME, "summary": f"Listed {len(picker_items)} report(s).", "reports": reports, "picker": _picker(picker_items, kind="lion_report")}


def report_get_result(ctx_obj: dict[str, Any], *, report_id: str | None) -> dict[str, Any]:
    runtime = resolve_runtime_values(ctx_obj)
    resolved_report_id = _require_arg(report_id or runtime["report_id"], code="LION_REPORT_ID_REQUIRED", message="report_id is required", env_name=runtime["report_id_env"])
    client = create_client(ctx_obj)
    report = client.get_report(resolved_report_id)
    return {"status": "live_read", "backend": BACKEND_NAME, "summary": f"Fetched report {resolved_report_id}.", "report": report, "scope_preview": {"command_id": "report.get", "report_id": resolved_report_id}}


def report_generate_result(ctx_obj: dict[str, Any], *, report_type: str | None, template_id: str | None, date_range: str | None, data_source: str | None) -> dict[str, Any]:
    runtime = resolve_runtime_values(ctx_obj)
    client = create_client(ctx_obj)
    payload = {
        "report_type": report_type or runtime["report_type"],
        "template_id": template_id or runtime["template_id"],
        "date_range": date_range or runtime["date_range"],
        "data_source": data_source or runtime["data_source"],
    }
    result = client.generate_report({k: v for k, v in payload.items() if v is not None})
    return {"status": "live_write", "backend": BACKEND_NAME, "summary": "Generated report.", "result": result}


def report_schedule_result(ctx_obj: dict[str, Any], *, report_id: str | None, report_type: str | None, date_range: str | None, data_source: str | None) -> dict[str, Any]:
    runtime = resolve_runtime_values(ctx_obj)
    client = create_client(ctx_obj)
    payload = {
        "report_id": report_id or runtime["report_id"],
        "report_type": report_type or runtime["report_type"],
        "date_range": date_range or runtime["date_range"],
        "data_source": data_source or runtime["data_source"],
    }
    result = client.schedule_report({k: v for k, v in payload.items() if v is not None})
    return {"status": "live_write", "backend": BACKEND_NAME, "summary": "Scheduled report.", "result": result}


def data_sources_result(ctx_obj: dict[str, Any]) -> dict[str, Any]:
    client = create_client(ctx_obj)
    result = client.list_data_sources()
    sources = result.get("sources", _ensure_list(result.get("items")))
    picker_items = [{"value": item.get("id"), "label": item.get("name"), "subtitle": item.get("type"), "selected": False} for item in sources if isinstance(item, dict)]
    return {"status": "live_read", "backend": BACKEND_NAME, "summary": f"Listed {len(picker_items)} data source(s).", "sources": sources, "picker": _picker(picker_items, kind="lion_data_source")}


def data_query_result(ctx_obj: dict[str, Any], *, data_source: str | None, query_text: str | None, date_range: str | None) -> dict[str, Any]:
    runtime = resolve_runtime_values(ctx_obj)
    resolved_source = _require_arg(data_source or runtime["data_source"], code="LION_DATA_SOURCE_REQUIRED", message="data_source is required", env_name=runtime["data_source_env"])
    resolved_query = _require_arg(query_text, code="LION_QUERY_REQUIRED", message="query is required", env_name="query")
    client = create_client(ctx_obj)
    result = client.query_data_source(resolved_source, resolved_query, date_range=date_range or runtime["date_range"])
    return {"status": "live_read", "backend": BACKEND_NAME, "summary": f"Queried data source {resolved_source}.", "result": result}


def data_import_result(ctx_obj: dict[str, Any], *, payload_json: str | None, data_source: str | None) -> dict[str, Any]:
    runtime = resolve_runtime_values(ctx_obj)
    client = create_client(ctx_obj)
    payload = _parse_json(payload_json, "LION_DATA_IMPORT_JSON_INVALID", "payload must be valid JSON", "payload_json")
    if data_source or runtime["data_source"]:
        payload["data_source"] = data_source or runtime["data_source"]
    result = client.import_data(payload)
    return {"status": "live_write", "backend": BACKEND_NAME, "summary": "Imported data.", "result": result}


def analysis_run_result(ctx_obj: dict[str, Any], *, payload_json: str | None) -> dict[str, Any]:
    client = create_client(ctx_obj)
    payload = _parse_json(payload_json, "LION_ANALYSIS_JSON_INVALID", "analysis payload must be valid JSON", "payload_json")
    result = client.run_analysis(payload)
    return {"status": "live_write", "backend": BACKEND_NAME, "summary": "Analysis started.", "result": result}


def analysis_list_result(ctx_obj: dict[str, Any], *, limit: int) -> dict[str, Any]:
    client = create_client(ctx_obj)
    result = client.list_analyses(limit=limit)
    analyses = result.get("analyses", _ensure_list(result.get("items")))
    picker_items = [{"value": item.get("id"), "label": item.get("type") or item.get("name"), "subtitle": item.get("status"), "selected": False} for item in analyses if isinstance(item, dict)]
    return {"status": "live_read", "backend": BACKEND_NAME, "summary": f"Listed {len(picker_items)} analysis record(s).", "analyses": analyses, "picker": _picker(picker_items, kind="lion_analysis")}


def template_list_result(ctx_obj: dict[str, Any], *, limit: int) -> dict[str, Any]:
    client = create_client(ctx_obj)
    result = client.list_templates(limit=limit)
    templates = result.get("templates", _ensure_list(result.get("items")))
    picker_items = [{"value": item.get("id"), "label": item.get("name"), "subtitle": item.get("description"), "selected": False} for item in templates if isinstance(item, dict)]
    return {"status": "live_read", "backend": BACKEND_NAME, "summary": f"Listed {len(picker_items)} template(s).", "templates": templates, "picker": _picker(picker_items, kind="lion_template")}


def template_get_result(ctx_obj: dict[str, Any], *, template_id: str | None) -> dict[str, Any]:
    runtime = resolve_runtime_values(ctx_obj)
    resolved_template_id = _require_arg(template_id or runtime["template_id"], code="LION_TEMPLATE_ID_REQUIRED", message="template_id is required", env_name=runtime["template_id_env"])
    client = create_client(ctx_obj)
    template = client.get_template(resolved_template_id)
    return {"status": "live_read", "backend": BACKEND_NAME, "summary": f"Fetched template {resolved_template_id}.", "template": template}


def export_pdf_result(ctx_obj: dict[str, Any], *, report_id: str | None) -> dict[str, Any]:
    runtime = resolve_runtime_values(ctx_obj)
    resolved_report_id = _require_arg(report_id or runtime["report_id"], code="LION_REPORT_ID_REQUIRED", message="report_id is required", env_name=runtime["report_id_env"])
    client = create_client(ctx_obj)
    result = client.export_pdf(resolved_report_id)
    return {"status": "live_read", "backend": BACKEND_NAME, "summary": f"Exported report {resolved_report_id} as PDF.", "result": result}


def export_csv_result(ctx_obj: dict[str, Any], *, report_id: str | None) -> dict[str, Any]:
    runtime = resolve_runtime_values(ctx_obj)
    resolved_report_id = _require_arg(report_id or runtime["report_id"], code="LION_REPORT_ID_REQUIRED", message="report_id is required", env_name=runtime["report_id_env"])
    client = create_client(ctx_obj)
    result = client.export_csv(resolved_report_id)
    return {"status": "live_read", "backend": BACKEND_NAME, "summary": f"Exported report {resolved_report_id} as CSV.", "result": result}


def export_email_result(ctx_obj: dict[str, Any], *, report_id: str | None, recipient_email: str | None) -> dict[str, Any]:
    runtime = resolve_runtime_values(ctx_obj)
    resolved_report_id = _require_arg(report_id or runtime["report_id"], code="LION_REPORT_ID_REQUIRED", message="report_id is required", env_name=runtime["report_id_env"])
    resolved_email = _require_arg(recipient_email or runtime["recipient_email"], code="LION_RECIPIENT_EMAIL_REQUIRED", message="recipient_email is required", env_name=runtime["recipient_email_env"])
    client = create_client(ctx_obj)
    result = client.export_email(resolved_report_id, resolved_email)
    return {"status": "live_write", "backend": BACKEND_NAME, "summary": f"Emailed report {resolved_report_id} to {resolved_email}.", "result": result}


def _ensure_list(value: Any) -> list[Any]:
    return value if isinstance(value, list) else []


def _parse_json(payload: str | None, code: str, message: str, env_name: str) -> dict[str, Any]:
    resolved = _require_arg(payload, code=code, message=message, env_name=env_name)
    try:
        parsed = json.loads(resolved)
    except json.JSONDecodeError as err:
        raise CliError(code=code, message=message, exit_code=4, details={"env": env_name, "error": str(err)}) from err
    if not isinstance(parsed, dict):
        raise CliError(code=code, message=message, exit_code=4, details={"env": env_name})
    return parsed
