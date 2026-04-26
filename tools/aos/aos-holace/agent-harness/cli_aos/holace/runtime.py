from __future__ import annotations

import json
from typing import Any

from . import __version__
from .client import HolaceApiError, HolaceClient
from .config import config_snapshot, resolve_runtime_values, redacted_config_snapshot
from .constants import BACKEND_NAME, CONNECTOR_CATEGORIES, CONNECTOR_CATEGORY, CONNECTOR_LABEL, CONNECTOR_PATH, CONNECTOR_RESOURCES, MODE_ORDER, READ_COMMANDS
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
    return {
        "path": str(CONNECTOR_PATH),
        "valid_json": True,
        "command_count": len(manifest.get("commands", [])),
    }


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


def _picker_items(items: list[Any], *, kind: str, label_keys: tuple[str, ...], subtitle_keys: tuple[str, ...] = ()) -> list[dict[str, Any]]:
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


def create_client(ctx_obj: dict[str, Any] | None = None) -> HolaceClient:
    runtime = resolve_runtime_values(ctx_obj)
    missing = [name for name in ("HOLACE_API_KEY", "HOLACE_API_BASE_URL") if not runtime["details"][name]["present"]]
    if missing:
        raise ConnectorError(
            code="HOLACE_SERVICE_KEYS_REQUIRED",
            message="HOLACE_API_KEY and HOLACE_API_BASE_URL service keys are required for HoLaCe live reads.",
            details={"missing_service_keys": missing},
        )
    return HolaceClient(api_key=runtime["api_key"], base_url=runtime["api_base_url"])


def _required(value: str, *, code: str, message: str, env: str) -> str:
    if value:
        return value
    raise ConnectorError(code=code, message=message, details={"service_key": env})


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
    missing = [name for name in ("HOLACE_API_KEY", "HOLACE_API_BASE_URL") if not runtime["details"][name]["present"]]
    if missing:
        return {"ok": False, "details": {"missing_keys": missing, "reason": "required service keys missing"}}
    try:
        client = HolaceClient(api_key=runtime["api_key"], base_url=runtime["api_base_url"])
        cases = _as_list(client.list_cases(limit=1), "cases", "data", "items")
        clients = _as_list(client.list_clients(limit=1), "clients", "data", "items")
        return {"ok": True, "details": {"case_count_sample": len(cases), "client_count_sample": len(clients)}}
    except HolaceApiError as err:
        return {"ok": False, "details": {"error": err.as_dict()}}


def health_snapshot(ctx_obj: dict[str, Any]) -> dict[str, Any]:
    runtime = resolve_runtime_values(ctx_obj)
    probe = probe_live_read(runtime)
    required_ready = runtime["details"]["HOLACE_API_KEY"]["present"] and runtime["details"]["HOLACE_API_BASE_URL"]["present"]
    live_ready = bool(probe.get("ok"))
    if not required_ready:
        status = "needs_setup"
        summary = "Configure HOLACE_API_KEY and HOLACE_API_BASE_URL in operator-controlled service keys before live HoLaCe reads."
        next_steps = [
            "Set HOLACE_API_KEY in operator-controlled service keys.",
            "Set HOLACE_API_BASE_URL to the firm HoLaCe API host in operator-controlled service keys.",
            "Use local HOLACE_* environment variables only as development harness fallback.",
        ]
    elif not live_ready:
        status = "degraded"
        summary = "HoLaCe service keys are present, but the live read probe failed."
        next_steps = ["Verify the HoLaCe API base URL and key.", "Confirm the API key has case and client read scopes."]
    else:
        status = "ready"
        summary = "HoLaCe credentials and API reachability are ready for the sampled case/client read probe."
        next_steps = [
            "Use read-only commands, and tenant-smoke each resource family before advertising production readiness for that family.",
            "Document, deadline, settlement, billing, communication, and report commands are implemented but not separately tenant-smoked in this repo.",
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
            "required_service_keys": ["HOLACE_API_KEY", "HOLACE_API_BASE_URL"],
            "missing_service_keys": [name for name in ("HOLACE_API_KEY", "HOLACE_API_BASE_URL") if not runtime["details"][name]["present"]],
            "service_key_sources": {
                "HOLACE_API_KEY": runtime["details"]["HOLACE_API_KEY"]["source"],
                "HOLACE_API_BASE_URL": runtime["details"]["HOLACE_API_BASE_URL"]["source"],
            },
            "local_env_fallback": True,
        },
        "probe": probe,
        "next_steps": next_steps,
    }


def doctor_snapshot(ctx_obj: dict[str, Any]) -> dict[str, Any]:
    runtime = resolve_runtime_values(ctx_obj)
    return {
        "health": health_snapshot(ctx_obj),
        "config": redacted_config_snapshot(ctx_obj),
        "manifest": _manifest_status(),
        "runtime": {
            "implementation_mode": "live_read_only",
            "supported_read_commands": list(READ_COMMANDS),
            "write_bridge_available": False,
            "tenant_smoke_tested": False,
            "sampled_probe_commands": ["case.list", "client.list"],
        },
    }


def case_list_result(ctx_obj: dict[str, Any], *, attorney_id: str | None = None, client_id: str | None = None, case_type: str | None = None, limit: int = 25) -> dict[str, Any]:
    runtime = resolve_runtime_values(ctx_obj)
    client = create_client(ctx_obj)
    payload = client.list_cases(attorney_id=attorney_id or runtime["attorney_id"], client_id=client_id or runtime["client_id"], case_type=case_type or runtime["case_type"], limit=limit)
    cases = _as_list(payload, "cases", "data", "items")
    return {"cases": cases, "case_count": len(cases), "raw": payload, "picker": {"kind": "case", "items": _picker_items(cases, kind="case", label_keys=("title", "name", "case_number"), subtitle_keys=("client_name", "status"))}, "scope_preview": _scope_preview(command_id="case.list", selection_surface="case", attorney_id=attorney_id or runtime["attorney_id"], client_id=client_id or runtime["client_id"], case_type=case_type or runtime["case_type"], limit=limit)}


def case_get_result(ctx_obj: dict[str, Any], case_id: str | None = None) -> dict[str, Any]:
    runtime = resolve_runtime_values(ctx_obj)
    resolved = _required((case_id or runtime["case_id"]).strip(), code="HOLACE_CASE_ID_REQUIRED", message="A case ID is required.", env="HOLACE_CASE_ID")
    return {"case": create_client(ctx_obj).get_case(resolved), "scope_preview": _scope_preview(command_id="case.get", selection_surface="case", case_id=resolved)}


def case_timeline_result(ctx_obj: dict[str, Any], case_id: str | None = None) -> dict[str, Any]:
    runtime = resolve_runtime_values(ctx_obj)
    resolved = _required((case_id or runtime["case_id"]).strip(), code="HOLACE_CASE_ID_REQUIRED", message="A case ID is required.", env="HOLACE_CASE_ID")
    return {"timeline": create_client(ctx_obj).case_timeline(resolved), "scope_preview": _scope_preview(command_id="case.timeline", selection_surface="case", case_id=resolved)}


def client_list_result(ctx_obj: dict[str, Any], *, limit: int = 50) -> dict[str, Any]:
    payload = create_client(ctx_obj).list_clients(limit=limit)
    clients = _as_list(payload, "clients", "data", "items")
    return {"clients": clients, "client_count": len(clients), "raw": payload, "picker": {"kind": "client", "items": _picker_items(clients, kind="client", label_keys=("name", "full_name", "email"), subtitle_keys=("email", "phone"))}, "scope_preview": _scope_preview(command_id="client.list", selection_surface="client", limit=limit)}


def client_get_result(ctx_obj: dict[str, Any], client_id: str | None = None) -> dict[str, Any]:
    runtime = resolve_runtime_values(ctx_obj)
    resolved = _required((client_id or runtime["client_id"]).strip(), code="HOLACE_CLIENT_ID_REQUIRED", message="A client ID is required.", env="HOLACE_CLIENT_ID")
    return {"client": create_client(ctx_obj).get_client(resolved), "scope_preview": _scope_preview(command_id="client.get", selection_surface="client", client_id=resolved)}


def document_list_result(ctx_obj: dict[str, Any], *, case_id: str | None = None, limit: int = 25) -> dict[str, Any]:
    runtime = resolve_runtime_values(ctx_obj)
    payload = create_client(ctx_obj).list_documents(case_id=case_id or runtime["case_id"], limit=limit)
    documents = _as_list(payload, "documents", "data", "items")
    return {"documents": documents, "document_count": len(documents), "raw": payload, "picker": {"kind": "document", "items": _picker_items(documents, kind="document", label_keys=("title", "name", "filename"), subtitle_keys=("type", "status"))}, "scope_preview": _scope_preview(command_id="document.list", selection_surface="document", case_id=case_id or runtime["case_id"], limit=limit)}


def document_get_result(ctx_obj: dict[str, Any], document_id: str | None = None) -> dict[str, Any]:
    runtime = resolve_runtime_values(ctx_obj)
    resolved = _required((document_id or runtime["document_id"]).strip(), code="HOLACE_DOCUMENT_ID_REQUIRED", message="A document ID is required.", env="HOLACE_DOCUMENT_ID")
    return {"document": create_client(ctx_obj).get_document(resolved), "scope_preview": _scope_preview(command_id="document.get", selection_surface="document", document_id=resolved)}


def deadline_list_result(ctx_obj: dict[str, Any], *, case_id: str | None = None, limit: int = 20) -> dict[str, Any]:
    runtime = resolve_runtime_values(ctx_obj)
    payload = create_client(ctx_obj).list_deadlines(case_id=case_id or runtime["case_id"], limit=limit)
    deadlines = _as_list(payload, "deadlines", "data", "items")
    return {"deadlines": deadlines, "deadline_count": len(deadlines), "raw": payload, "picker": {"kind": "deadline", "items": _picker_items(deadlines, kind="deadline", label_keys=("title", "name", "type"), subtitle_keys=("due_date", "status"))}, "scope_preview": _scope_preview(command_id="deadline.list", selection_surface="deadline", case_id=case_id or runtime["case_id"], limit=limit)}


def deadline_statute_result(ctx_obj: dict[str, Any], *, state: str | None = None, case_type: str | None = None) -> dict[str, Any]:
    runtime = resolve_runtime_values(ctx_obj)
    resolved_state = _required((state or runtime["statute_state"]).strip(), code="HOLACE_STATUTE_STATE_REQUIRED", message="A state is required for statute lookup.", env="HOLACE_STATUTE_STATE")
    resolved_case_type = case_type or runtime["case_type"]
    return {"statute": create_client(ctx_obj).check_statute(state=resolved_state, case_type=resolved_case_type), "scope_preview": _scope_preview(command_id="deadline.check_statute", selection_surface="deadline", state=resolved_state, case_type=resolved_case_type)}


def settlement_list_result(ctx_obj: dict[str, Any], *, case_id: str | None = None, limit: int = 10) -> dict[str, Any]:
    runtime = resolve_runtime_values(ctx_obj)
    payload = create_client(ctx_obj).list_settlements(case_id=case_id or runtime["case_id"], limit=limit)
    settlements = _as_list(payload, "settlements", "data", "items")
    return {"settlements": settlements, "settlement_count": len(settlements), "raw": payload, "picker": {"kind": "settlement", "items": _picker_items(settlements, kind="settlement", label_keys=("title", "status", "amount"), subtitle_keys=("case_id", "date"))}, "scope_preview": _scope_preview(command_id="settlement.list", selection_surface="settlement", case_id=case_id or runtime["case_id"], limit=limit)}


def settlement_get_result(ctx_obj: dict[str, Any], settlement_id: str | None = None) -> dict[str, Any]:
    runtime = resolve_runtime_values(ctx_obj)
    resolved = _required((settlement_id or runtime["settlement_id"]).strip(), code="HOLACE_SETTLEMENT_ID_REQUIRED", message="A settlement ID is required.", env="HOLACE_SETTLEMENT_ID")
    return {"settlement": create_client(ctx_obj).get_settlement(resolved), "scope_preview": _scope_preview(command_id="settlement.get", selection_surface="settlement", settlement_id=resolved)}


def settlement_tracker_result(ctx_obj: dict[str, Any]) -> dict[str, Any]:
    return {"tracker": create_client(ctx_obj).settlement_tracker(), "scope_preview": _scope_preview(command_id="settlement.tracker", selection_surface="settlement")}


def billing_list_result(ctx_obj: dict[str, Any], *, case_id: str | None = None, limit: int = 25) -> dict[str, Any]:
    runtime = resolve_runtime_values(ctx_obj)
    payload = create_client(ctx_obj).list_billing(case_id=case_id or runtime["case_id"], limit=limit)
    entries = _as_list(payload, "billing", "invoices", "data", "items")
    return {"billing": entries, "billing_count": len(entries), "raw": payload, "scope_preview": _scope_preview(command_id="billing.list", selection_surface="billing", case_id=case_id or runtime["case_id"], limit=limit)}


def communication_list_result(ctx_obj: dict[str, Any], *, case_id: str | None = None, limit: int = 25) -> dict[str, Any]:
    runtime = resolve_runtime_values(ctx_obj)
    payload = create_client(ctx_obj).list_communications(case_id=case_id or runtime["case_id"], limit=limit)
    communications = _as_list(payload, "communications", "data", "items")
    return {"communications": communications, "communication_count": len(communications), "raw": payload, "scope_preview": _scope_preview(command_id="communication.list", selection_surface="communication", case_id=case_id or runtime["case_id"], limit=limit)}


def report_case_status_result(ctx_obj: dict[str, Any], *, case_id: str | None = None) -> dict[str, Any]:
    runtime = resolve_runtime_values(ctx_obj)
    return {"report": create_client(ctx_obj).case_status_report(case_id=case_id or runtime["case_id"]), "scope_preview": _scope_preview(command_id="report.case_status", selection_surface="report", case_id=case_id or runtime["case_id"])}


def report_pipeline_result(ctx_obj: dict[str, Any], *, attorney_id: str | None = None) -> dict[str, Any]:
    runtime = resolve_runtime_values(ctx_obj)
    return {"report": create_client(ctx_obj).pipeline_report(attorney_id=attorney_id or runtime["attorney_id"]), "scope_preview": _scope_preview(command_id="report.pipeline", selection_surface="report", attorney_id=attorney_id or runtime["attorney_id"])}
