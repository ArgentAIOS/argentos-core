from __future__ import annotations

import json
from typing import Any

from .client import ClientSyncApiError, ClientSyncClient
from .config import resolve_runtime_values
from .constants import BACKEND_NAME, CONNECTOR_PATH
from .errors import CliError


def _load_manifest() -> dict[str, Any]:
    return json.loads(CONNECTOR_PATH.read_text())


def capabilities_snapshot() -> dict[str, Any]:
    manifest = _load_manifest()
    return {
        "tool": manifest["tool"],
        "backend": manifest["backend"],
        "manifest_schema_version": manifest.get("manifest_schema_version", "1.0.0"),
        "connector": manifest["connector"],
        "auth": manifest["auth"],
        "scope": manifest.get("scope", {}),
        "commands": manifest["commands"],
    }


def create_client(ctx_obj: dict[str, Any]) -> ClientSyncClient:
    runtime = resolve_runtime_values(ctx_obj)
    if not runtime["api_key_present"]:
        raise CliError(
            code="CLIENTSYNC_SETUP_REQUIRED",
            message="ClientSync connector is missing the required API key",
            exit_code=4,
            details={"missing_keys": [runtime["api_key_env"]]},
        )
    return ClientSyncClient(api_key=runtime["api_key"], api_url=runtime["api_url"])


def probe_runtime(ctx_obj: dict[str, Any]) -> dict[str, Any]:
    runtime = resolve_runtime_values(ctx_obj)
    if not runtime["api_key_present"]:
        return {
            "ok": False,
            "code": "CLIENTSYNC_SETUP_REQUIRED",
            "message": "ClientSync connector is missing the required API key",
            "details": {"missing_keys": [runtime["api_key_env"]], "live_backend_available": False},
        }
    try:
        client = create_client(ctx_obj)
        clients = client.list_clients(limit=1)
    except CliError as err:
        return {"ok": False, "code": err.code, "message": err.message, "details": err.details}
    except ClientSyncApiError as err:
        code = "CLIENTSYNC_AUTH_FAILED" if err.status_code in {401, 403} else "CLIENTSYNC_API_ERROR"
        return {
            "ok": False,
            "code": code,
            "message": err.message,
            "details": {
                **(err.details or {}),
                "status_code": err.status_code,
                "live_backend_available": False,
            },
        }
    return {
        "ok": True,
        "code": "OK",
        "message": "ClientSync live runtime is ready",
        "details": {
            "live_backend_available": True,
            "client_count": clients.get("total", len(clients.get("clients", []))),
            "api_url": runtime["api_url"],
        },
    }


def health_snapshot(ctx_obj: dict[str, Any]) -> dict[str, Any]:
    runtime = resolve_runtime_values(ctx_obj)
    probe = probe_runtime(ctx_obj)
    status = "ready" if probe["ok"] else ("needs_setup" if probe["code"] == "CLIENTSYNC_SETUP_REQUIRED" else "degraded")
    return {
        "status": status,
        "summary": probe["message"],
        "connector": {
            "backend": BACKEND_NAME,
            "live_backend_available": bool(probe.get("ok")),
            "live_read_available": bool(probe.get("ok")),
            "write_bridge_available": bool(probe.get("ok")),
            "scaffold_only": False,
        },
        "auth": {
            "api_key_env": runtime["api_key_env"],
            "api_key_present": runtime["api_key_present"],
            "api_url": runtime["api_url"],
            "api_url_source": runtime["api_url_source"],
        },
        "scope": {
            "client_id": runtime["client_id"] or None,
            "ticket_id": runtime["ticket_id"] or None,
            "technician_id": runtime["technician_id"] or None,
            "compliance_id": runtime["compliance_id"] or None,
            "sla_id": runtime["sla_id"] or None,
            "report_type": runtime["report_type"] or None,
        },
        "checks": [
            {
                "name": "required_env",
                "ok": runtime["api_key_present"],
                "details": {"missing_keys": [] if runtime["api_key_present"] else [runtime["api_key_env"]]},
            },
            {"name": "live_backend", "ok": bool(probe.get("ok")), "details": probe.get("details", {})},
        ],
        "runtime_ready": bool(probe.get("ok")),
        "live_backend_available": bool(probe.get("ok")),
        "live_read_available": bool(probe.get("ok")),
        "write_bridge_available": bool(probe.get("ok")),
        "scaffold_only": False,
        "probe": probe,
        "next_steps": [
            f"Set {runtime['api_key_env']} in API Keys.",
            "Optionally set CLIENTSYNC_API_URL for self-hosted instances.",
            "Pin CLIENTSYNC_CLIENT_ID, CLIENTSYNC_TICKET_ID, etc. to stabilize worker-flow scope pickers.",
        ],
    }


def doctor_snapshot(ctx_obj: dict[str, Any]) -> dict[str, Any]:
    runtime = resolve_runtime_values(ctx_obj)
    probe = probe_runtime(ctx_obj)
    live = bool(probe.get("ok"))
    return {
        "status": "ready" if live else ("needs_setup" if probe.get("code") == "CLIENTSYNC_SETUP_REQUIRED" else "degraded"),
        "summary": "ClientSync connector diagnostics.",
        "runtime": {
            "implementation_mode": "live_read_write",
            "command_readiness": {
                "client.list": live,
                "client.get": live,
                "client.create": live,
                "client.update": live,
                "client.portal": live,
                "ticket.list": live,
                "ticket.get": live,
                "ticket.create": live,
                "ticket.update": live,
                "ticket.assign": live,
                "ticket.resolve": live,
                "technician.list": live,
                "technician.get": live,
                "technician.availability": live,
                "compliance.list": live,
                "compliance.get": live,
                "compliance.check": live,
                "compliance.report": live,
                "asset.list": live,
                "asset.get": live,
                "asset.create": live,
                "contract.list": live,
                "contract.get": live,
                "contract.renew": live,
                "analytics.dashboard": live,
                "analytics.client_health": live,
                "analytics.sla_performance": live,
                "report.generate": live,
                "report.list": live,
                "audit.list": live,
                "audit.create": live,
            },
            "client_id_present": runtime["client_id_present"],
            "ticket_id_present": runtime["ticket_id_present"],
            "technician_id_present": runtime["technician_id_present"],
            "compliance_id_present": runtime["compliance_id_present"],
            "sla_id_present": runtime["sla_id_present"],
            "report_type_present": runtime["report_type_present"],
            "api_url": runtime["api_url"],
            "api_url_source": runtime["api_url_source"],
        },
        "checks": [
            {"name": "required_env", "ok": runtime["api_key_present"]},
            {"name": "live_backend", "ok": live, "details": probe.get("details", {})},
        ],
        "supported_read_commands": [
            "client.list", "client.get", "client.portal",
            "ticket.list", "ticket.get",
            "technician.list", "technician.get", "technician.availability",
            "compliance.list", "compliance.get", "compliance.check",
            "asset.list", "asset.get",
            "contract.list", "contract.get",
            "analytics.dashboard", "analytics.client_health", "analytics.sla_performance",
            "report.list", "audit.list",
        ],
        "supported_write_commands": [
            "client.create", "client.update",
            "ticket.create", "ticket.update", "ticket.assign", "ticket.resolve",
            "compliance.report",
            "asset.create",
            "contract.renew",
            "report.generate",
            "audit.create",
        ],
        "next_steps": [
            f"Set {runtime['api_key_env']} in API Keys.",
            "Use client.list to confirm API connectivity before running write operations.",
            "Set CLIENTSYNC_API_URL for self-hosted deployments.",
        ],
    }


def _picker(items: list[dict[str, Any]], *, kind: str, label_key: str = "label") -> dict[str, Any]:
    return {"kind": kind, "items": items, "count": len(items), "label_key": label_key}


def _require_arg(value: str | None, *, code: str, message: str, detail_key: str, detail_value: str) -> str:
    resolved = (value or "").strip()
    if resolved:
        return resolved
    raise CliError(code=code, message=message, exit_code=4, details={detail_key: detail_value})


# --- Client commands ---

def client_list_result(ctx_obj: dict[str, Any], *, limit: int) -> dict[str, Any]:
    client = create_client(ctx_obj)
    payload = client.list_clients(limit=limit)
    clients = payload.get("clients", [])
    items = [
        {
            "id": str(item.get("id") or ""),
            "label": str(item.get("name") or item.get("id") or "Client"),
            "subtitle": item.get("plan") or item.get("status") or None,
            "kind": "client",
        }
        for item in clients
        if isinstance(item, dict)
    ]
    return {
        "status": "live_read",
        "backend": BACKEND_NAME,
        "summary": f"Returned {len(clients)} client{'s' if len(clients) != 1 else ''}.",
        "clients": clients,
        "client_count": len(clients),
        "picker": _picker(items, kind="client"),
        "scope_preview": {"selection_surface": "client", "command_id": "client.list"},
    }


def client_get_result(ctx_obj: dict[str, Any], client_id: str | None) -> dict[str, Any]:
    runtime = resolve_runtime_values(ctx_obj)
    resolved = _require_arg(client_id or runtime["client_id"], code="CLIENTSYNC_CLIENT_REQUIRED", message="Client ID is required", detail_key="env", detail_value=runtime["client_id_env"])
    client = create_client(ctx_obj)
    record = client.get_client(resolved)
    return {
        "status": "live_read",
        "backend": BACKEND_NAME,
        "summary": f"Read client {resolved}.",
        "client": record,
        "scope_preview": {"selection_surface": "client", "command_id": "client.get", "client_id": resolved},
    }


def client_create_result(ctx_obj: dict[str, Any], *, name: str, contact_email: str | None, plan: str | None) -> dict[str, Any]:
    client = create_client(ctx_obj)
    record = client.create_client(name=name, contact_email=contact_email, plan=plan)
    return {
        "status": "live_write",
        "backend": BACKEND_NAME,
        "summary": f"Created client {name}.",
        "client": record,
        "scope_preview": {"selection_surface": "client", "command_id": "client.create"},
    }


def client_update_result(ctx_obj: dict[str, Any], client_id: str | None, *, updates: dict[str, Any]) -> dict[str, Any]:
    runtime = resolve_runtime_values(ctx_obj)
    resolved = _require_arg(client_id or runtime["client_id"], code="CLIENTSYNC_CLIENT_REQUIRED", message="Client ID is required", detail_key="env", detail_value=runtime["client_id_env"])
    client = create_client(ctx_obj)
    record = client.update_client(resolved, updates=updates)
    return {
        "status": "live_write",
        "backend": BACKEND_NAME,
        "summary": f"Updated client {resolved}.",
        "client": record,
        "scope_preview": {"selection_surface": "client", "command_id": "client.update", "client_id": resolved},
    }


def client_portal_result(ctx_obj: dict[str, Any], client_id: str | None) -> dict[str, Any]:
    runtime = resolve_runtime_values(ctx_obj)
    resolved = _require_arg(client_id or runtime["client_id"], code="CLIENTSYNC_CLIENT_REQUIRED", message="Client ID is required", detail_key="env", detail_value=runtime["client_id_env"])
    client = create_client(ctx_obj)
    record = client.get_client_portal(resolved)
    return {
        "status": "live_read",
        "backend": BACKEND_NAME,
        "summary": f"Portal info for client {resolved}.",
        "portal": record,
        "scope_preview": {"selection_surface": "client", "command_id": "client.portal", "client_id": resolved},
    }


# --- Ticket commands ---

def ticket_list_result(ctx_obj: dict[str, Any], *, client_id: str | None, technician_id: str | None, priority: str | None, status: str | None, limit: int) -> dict[str, Any]:
    runtime = resolve_runtime_values(ctx_obj)
    resolved_client = (client_id or runtime["client_id"] or "").strip() or None
    resolved_tech = (technician_id or runtime["technician_id"] or "").strip() or None
    client = create_client(ctx_obj)
    payload = client.list_tickets(client_id=resolved_client, technician_id=resolved_tech, priority=priority, status=status, limit=limit)
    tickets = payload.get("tickets", [])
    items = [
        {
            "id": str(item.get("id") or ""),
            "label": str(item.get("subject") or item.get("id") or "Ticket"),
            "subtitle": f"{item.get('priority', 'normal')} / {item.get('status', 'open')}",
            "kind": "ticket",
        }
        for item in tickets
        if isinstance(item, dict)
    ]
    return {
        "status": "live_read",
        "backend": BACKEND_NAME,
        "summary": f"Returned {len(tickets)} ticket{'s' if len(tickets) != 1 else ''}.",
        "tickets": tickets,
        "ticket_count": len(tickets),
        "picker": _picker(items, kind="ticket"),
        "scope_preview": {"selection_surface": "ticket", "command_id": "ticket.list", "client_id": resolved_client},
    }


def ticket_get_result(ctx_obj: dict[str, Any], ticket_id: str | None) -> dict[str, Any]:
    runtime = resolve_runtime_values(ctx_obj)
    resolved = _require_arg(ticket_id or runtime["ticket_id"], code="CLIENTSYNC_TICKET_REQUIRED", message="Ticket ID is required", detail_key="env", detail_value=runtime["ticket_id_env"])
    client = create_client(ctx_obj)
    record = client.get_ticket(resolved)
    return {
        "status": "live_read",
        "backend": BACKEND_NAME,
        "summary": f"Read ticket {resolved}.",
        "ticket": record,
        "scope_preview": {"selection_surface": "ticket", "command_id": "ticket.get", "ticket_id": resolved},
    }


def ticket_create_result(ctx_obj: dict[str, Any], *, client_id: str, subject: str, description: str | None, priority: str | None) -> dict[str, Any]:
    client = create_client(ctx_obj)
    record = client.create_ticket(client_id=client_id, subject=subject, description=description, priority=priority)
    return {
        "status": "live_write",
        "backend": BACKEND_NAME,
        "summary": f"Created ticket: {subject}.",
        "ticket": record,
        "scope_preview": {"selection_surface": "ticket", "command_id": "ticket.create", "client_id": client_id},
    }


def ticket_update_result(ctx_obj: dict[str, Any], ticket_id: str | None, *, updates: dict[str, Any]) -> dict[str, Any]:
    runtime = resolve_runtime_values(ctx_obj)
    resolved = _require_arg(ticket_id or runtime["ticket_id"], code="CLIENTSYNC_TICKET_REQUIRED", message="Ticket ID is required", detail_key="env", detail_value=runtime["ticket_id_env"])
    client = create_client(ctx_obj)
    record = client.update_ticket(resolved, updates=updates)
    return {
        "status": "live_write",
        "backend": BACKEND_NAME,
        "summary": f"Updated ticket {resolved}.",
        "ticket": record,
        "scope_preview": {"selection_surface": "ticket", "command_id": "ticket.update", "ticket_id": resolved},
    }


def ticket_assign_result(ctx_obj: dict[str, Any], ticket_id: str | None, *, technician_id: str) -> dict[str, Any]:
    runtime = resolve_runtime_values(ctx_obj)
    resolved = _require_arg(ticket_id or runtime["ticket_id"], code="CLIENTSYNC_TICKET_REQUIRED", message="Ticket ID is required", detail_key="env", detail_value=runtime["ticket_id_env"])
    client = create_client(ctx_obj)
    record = client.assign_ticket(resolved, technician_id=technician_id)
    return {
        "status": "live_write",
        "backend": BACKEND_NAME,
        "summary": f"Assigned ticket {resolved} to technician {technician_id}.",
        "ticket": record,
        "scope_preview": {"selection_surface": "ticket", "command_id": "ticket.assign", "ticket_id": resolved, "technician_id": technician_id},
    }


def ticket_resolve_result(ctx_obj: dict[str, Any], ticket_id: str | None, *, resolution: str | None) -> dict[str, Any]:
    runtime = resolve_runtime_values(ctx_obj)
    resolved = _require_arg(ticket_id or runtime["ticket_id"], code="CLIENTSYNC_TICKET_REQUIRED", message="Ticket ID is required", detail_key="env", detail_value=runtime["ticket_id_env"])
    client = create_client(ctx_obj)
    record = client.resolve_ticket(resolved, resolution=resolution)
    return {
        "status": "live_write",
        "backend": BACKEND_NAME,
        "summary": f"Resolved ticket {resolved}.",
        "ticket": record,
        "scope_preview": {"selection_surface": "ticket", "command_id": "ticket.resolve", "ticket_id": resolved},
    }


# --- Technician commands ---

def technician_list_result(ctx_obj: dict[str, Any], *, limit: int) -> dict[str, Any]:
    client = create_client(ctx_obj)
    payload = client.list_technicians(limit=limit)
    techs = payload.get("technicians", [])
    items = [
        {
            "id": str(item.get("id") or ""),
            "label": str(item.get("name") or item.get("email") or item.get("id") or "Technician"),
            "subtitle": item.get("role") or None,
            "kind": "technician",
        }
        for item in techs
        if isinstance(item, dict)
    ]
    return {
        "status": "live_read",
        "backend": BACKEND_NAME,
        "summary": f"Returned {len(techs)} technician{'s' if len(techs) != 1 else ''}.",
        "technicians": techs,
        "technician_count": len(techs),
        "picker": _picker(items, kind="technician"),
        "scope_preview": {"selection_surface": "technician", "command_id": "technician.list"},
    }


def technician_get_result(ctx_obj: dict[str, Any], technician_id: str | None) -> dict[str, Any]:
    runtime = resolve_runtime_values(ctx_obj)
    resolved = _require_arg(technician_id or runtime["technician_id"], code="CLIENTSYNC_TECHNICIAN_REQUIRED", message="Technician ID is required", detail_key="env", detail_value=runtime["technician_id_env"])
    client = create_client(ctx_obj)
    record = client.get_technician(resolved)
    return {
        "status": "live_read",
        "backend": BACKEND_NAME,
        "summary": f"Read technician {resolved}.",
        "technician": record,
        "scope_preview": {"selection_surface": "technician", "command_id": "technician.get", "technician_id": resolved},
    }


def technician_availability_result(ctx_obj: dict[str, Any], technician_id: str | None) -> dict[str, Any]:
    runtime = resolve_runtime_values(ctx_obj)
    resolved = _require_arg(technician_id or runtime["technician_id"], code="CLIENTSYNC_TECHNICIAN_REQUIRED", message="Technician ID is required", detail_key="env", detail_value=runtime["technician_id_env"])
    client = create_client(ctx_obj)
    record = client.get_technician_availability(resolved)
    return {
        "status": "live_read",
        "backend": BACKEND_NAME,
        "summary": f"Availability for technician {resolved}.",
        "availability": record,
        "scope_preview": {"selection_surface": "technician", "command_id": "technician.availability", "technician_id": resolved},
    }


# --- Compliance commands ---

def compliance_list_result(ctx_obj: dict[str, Any], *, limit: int) -> dict[str, Any]:
    client = create_client(ctx_obj)
    payload = client.list_compliance(limit=limit)
    frameworks = payload.get("frameworks", [])
    items = [
        {
            "id": str(item.get("id") or ""),
            "label": str(item.get("framework") or item.get("name") or item.get("id") or "Framework"),
            "subtitle": item.get("status") or None,
            "kind": "compliance",
        }
        for item in frameworks
        if isinstance(item, dict)
    ]
    return {
        "status": "live_read",
        "backend": BACKEND_NAME,
        "summary": f"Returned {len(frameworks)} compliance framework{'s' if len(frameworks) != 1 else ''}.",
        "frameworks": frameworks,
        "framework_count": len(frameworks),
        "picker": _picker(items, kind="compliance"),
        "scope_preview": {"selection_surface": "compliance", "command_id": "compliance.list"},
    }


def compliance_get_result(ctx_obj: dict[str, Any], compliance_id: str | None) -> dict[str, Any]:
    runtime = resolve_runtime_values(ctx_obj)
    resolved = _require_arg(compliance_id or runtime["compliance_id"], code="CLIENTSYNC_COMPLIANCE_REQUIRED", message="Compliance framework ID is required", detail_key="env", detail_value=runtime["compliance_id_env"])
    client = create_client(ctx_obj)
    record = client.get_compliance(resolved)
    return {
        "status": "live_read",
        "backend": BACKEND_NAME,
        "summary": f"Read compliance framework {resolved}.",
        "compliance": record,
        "scope_preview": {"selection_surface": "compliance", "command_id": "compliance.get", "compliance_id": resolved},
    }


def compliance_check_result(ctx_obj: dict[str, Any], *, client_id: str | None, compliance_id: str | None) -> dict[str, Any]:
    runtime = resolve_runtime_values(ctx_obj)
    resolved_client = _require_arg(client_id or runtime["client_id"], code="CLIENTSYNC_CLIENT_REQUIRED", message="Client ID is required for compliance check", detail_key="env", detail_value=runtime["client_id_env"])
    resolved_compliance = _require_arg(compliance_id or runtime["compliance_id"], code="CLIENTSYNC_COMPLIANCE_REQUIRED", message="Compliance framework ID is required", detail_key="env", detail_value=runtime["compliance_id_env"])
    client = create_client(ctx_obj)
    record = client.check_compliance(client_id=resolved_client, compliance_id=resolved_compliance)
    return {
        "status": "live_read",
        "backend": BACKEND_NAME,
        "summary": f"Compliance check {resolved_compliance} for client {resolved_client}.",
        "result": record,
        "scope_preview": {"selection_surface": "compliance", "command_id": "compliance.check", "client_id": resolved_client, "compliance_id": resolved_compliance},
    }


def compliance_report_result(ctx_obj: dict[str, Any], *, client_id: str | None, compliance_id: str | None) -> dict[str, Any]:
    runtime = resolve_runtime_values(ctx_obj)
    resolved_client = _require_arg(client_id or runtime["client_id"], code="CLIENTSYNC_CLIENT_REQUIRED", message="Client ID is required for compliance report", detail_key="env", detail_value=runtime["client_id_env"])
    resolved_compliance = _require_arg(compliance_id or runtime["compliance_id"], code="CLIENTSYNC_COMPLIANCE_REQUIRED", message="Compliance framework ID is required", detail_key="env", detail_value=runtime["compliance_id_env"])
    client = create_client(ctx_obj)
    record = client.generate_compliance_report(client_id=resolved_client, compliance_id=resolved_compliance)
    return {
        "status": "live_write",
        "backend": BACKEND_NAME,
        "summary": f"Generated compliance report {resolved_compliance} for client {resolved_client}.",
        "report": record,
        "scope_preview": {"selection_surface": "compliance", "command_id": "compliance.report", "client_id": resolved_client, "compliance_id": resolved_compliance},
    }


# --- Asset commands ---

def asset_list_result(ctx_obj: dict[str, Any], *, client_id: str | None, limit: int) -> dict[str, Any]:
    runtime = resolve_runtime_values(ctx_obj)
    resolved_client = (client_id or runtime["client_id"] or "").strip() or None
    client = create_client(ctx_obj)
    payload = client.list_assets(client_id=resolved_client, limit=limit)
    assets = payload.get("assets", [])
    items = [
        {
            "id": str(item.get("id") or ""),
            "label": str(item.get("name") or item.get("id") or "Asset"),
            "subtitle": item.get("type") or item.get("serial") or None,
            "kind": "asset",
        }
        for item in assets
        if isinstance(item, dict)
    ]
    return {
        "status": "live_read",
        "backend": BACKEND_NAME,
        "summary": f"Returned {len(assets)} asset{'s' if len(assets) != 1 else ''}.",
        "assets": assets,
        "asset_count": len(assets),
        "picker": _picker(items, kind="asset"),
        "scope_preview": {"selection_surface": "asset", "command_id": "asset.list", "client_id": resolved_client},
    }


def asset_get_result(ctx_obj: dict[str, Any], asset_id: str) -> dict[str, Any]:
    client = create_client(ctx_obj)
    record = client.get_asset(asset_id)
    return {
        "status": "live_read",
        "backend": BACKEND_NAME,
        "summary": f"Read asset {asset_id}.",
        "asset": record,
        "scope_preview": {"selection_surface": "asset", "command_id": "asset.get", "asset_id": asset_id},
    }


def asset_create_result(ctx_obj: dict[str, Any], *, client_id: str, name: str, asset_type: str | None, serial: str | None) -> dict[str, Any]:
    client = create_client(ctx_obj)
    record = client.create_asset(client_id=client_id, name=name, asset_type=asset_type, serial=serial)
    return {
        "status": "live_write",
        "backend": BACKEND_NAME,
        "summary": f"Created asset {name} for client {client_id}.",
        "asset": record,
        "scope_preview": {"selection_surface": "asset", "command_id": "asset.create", "client_id": client_id},
    }


# --- Contract commands ---

def contract_list_result(ctx_obj: dict[str, Any], *, client_id: str | None, limit: int) -> dict[str, Any]:
    runtime = resolve_runtime_values(ctx_obj)
    resolved_client = (client_id or runtime["client_id"] or "").strip() or None
    client = create_client(ctx_obj)
    payload = client.list_contracts(client_id=resolved_client, limit=limit)
    contracts = payload.get("contracts", [])
    items = [
        {
            "id": str(item.get("id") or ""),
            "label": str(item.get("name") or item.get("id") or "Contract"),
            "subtitle": item.get("type") or item.get("end_date") or None,
            "kind": "contract",
        }
        for item in contracts
        if isinstance(item, dict)
    ]
    return {
        "status": "live_read",
        "backend": BACKEND_NAME,
        "summary": f"Returned {len(contracts)} contract{'s' if len(contracts) != 1 else ''}.",
        "contracts": contracts,
        "contract_count": len(contracts),
        "picker": _picker(items, kind="contract"),
        "scope_preview": {"selection_surface": "contract", "command_id": "contract.list", "client_id": resolved_client},
    }


def contract_get_result(ctx_obj: dict[str, Any], contract_id: str) -> dict[str, Any]:
    client = create_client(ctx_obj)
    record = client.get_contract(contract_id)
    return {
        "status": "live_read",
        "backend": BACKEND_NAME,
        "summary": f"Read contract {contract_id}.",
        "contract": record,
        "scope_preview": {"selection_surface": "contract", "command_id": "contract.get", "contract_id": contract_id},
    }


def contract_renew_result(ctx_obj: dict[str, Any], contract_id: str, *, duration_months: int | None) -> dict[str, Any]:
    client = create_client(ctx_obj)
    record = client.renew_contract(contract_id, duration_months=duration_months)
    return {
        "status": "live_write",
        "backend": BACKEND_NAME,
        "summary": f"Renewed contract {contract_id}.",
        "contract": record,
        "scope_preview": {"selection_surface": "contract", "command_id": "contract.renew", "contract_id": contract_id},
    }


# --- Analytics commands ---

def analytics_dashboard_result(ctx_obj: dict[str, Any], *, report_type: str | None, date_range: str | None) -> dict[str, Any]:
    runtime = resolve_runtime_values(ctx_obj)
    resolved_type = (report_type or runtime["report_type"] or "").strip() or None
    client = create_client(ctx_obj)
    record = client.get_analytics_dashboard(report_type=resolved_type, date_range=date_range)
    return {
        "status": "live_read",
        "backend": BACKEND_NAME,
        "summary": "MSP analytics dashboard.",
        "dashboard": record,
        "scope_preview": {"selection_surface": "analytics", "command_id": "analytics.dashboard", "report_type": resolved_type},
    }


def analytics_client_health_result(ctx_obj: dict[str, Any], client_id: str | None) -> dict[str, Any]:
    runtime = resolve_runtime_values(ctx_obj)
    resolved = _require_arg(client_id or runtime["client_id"], code="CLIENTSYNC_CLIENT_REQUIRED", message="Client ID is required for health score", detail_key="env", detail_value=runtime["client_id_env"])
    client = create_client(ctx_obj)
    record = client.get_client_health(resolved)
    return {
        "status": "live_read",
        "backend": BACKEND_NAME,
        "summary": f"Health score for client {resolved}.",
        "health": record,
        "scope_preview": {"selection_surface": "analytics", "command_id": "analytics.client_health", "client_id": resolved},
    }


def analytics_sla_performance_result(ctx_obj: dict[str, Any], *, sla_id: str | None, date_range: str | None) -> dict[str, Any]:
    runtime = resolve_runtime_values(ctx_obj)
    resolved_sla = (sla_id or runtime["sla_id"] or "").strip() or None
    client = create_client(ctx_obj)
    record = client.get_sla_performance(sla_id=resolved_sla, date_range=date_range)
    return {
        "status": "live_read",
        "backend": BACKEND_NAME,
        "summary": "SLA performance metrics.",
        "sla": record,
        "scope_preview": {"selection_surface": "analytics", "command_id": "analytics.sla_performance", "sla_id": resolved_sla},
    }


# --- Report commands ---

def report_generate_result(ctx_obj: dict[str, Any], *, report_type: str, client_id: str | None, date_range: str | None) -> dict[str, Any]:
    client = create_client(ctx_obj)
    record = client.generate_report(report_type=report_type, client_id=client_id, date_range=date_range)
    return {
        "status": "live_write",
        "backend": BACKEND_NAME,
        "summary": f"Generated {report_type} report.",
        "report": record,
        "scope_preview": {"selection_surface": "report", "command_id": "report.generate", "report_type": report_type},
    }


def report_list_result(ctx_obj: dict[str, Any], *, limit: int) -> dict[str, Any]:
    client = create_client(ctx_obj)
    payload = client.list_reports(limit=limit)
    reports = payload.get("reports", [])
    items = [
        {
            "id": str(item.get("id") or ""),
            "label": str(item.get("report_type") or item.get("name") or item.get("id") or "Report"),
            "subtitle": item.get("created") or None,
            "kind": "report",
        }
        for item in reports
        if isinstance(item, dict)
    ]
    return {
        "status": "live_read",
        "backend": BACKEND_NAME,
        "summary": f"Returned {len(reports)} report{'s' if len(reports) != 1 else ''}.",
        "reports": reports,
        "report_count": len(reports),
        "picker": _picker(items, kind="report"),
        "scope_preview": {"selection_surface": "report", "command_id": "report.list"},
    }


# --- Audit commands ---

def audit_list_result(ctx_obj: dict[str, Any], *, date_range: str | None, limit: int) -> dict[str, Any]:
    client = create_client(ctx_obj)
    payload = client.list_audit(date_range=date_range, limit=limit)
    entries = payload.get("entries", [])
    return {
        "status": "live_read",
        "backend": BACKEND_NAME,
        "summary": f"Returned {len(entries)} audit entr{'ies' if len(entries) != 1 else 'y'}.",
        "entries": entries,
        "entry_count": len(entries),
        "scope_preview": {"selection_surface": "audit", "command_id": "audit.list"},
    }


def audit_create_result(ctx_obj: dict[str, Any], *, action: str, resource_type: str, resource_id: str, details: str | None) -> dict[str, Any]:
    client = create_client(ctx_obj)
    record = client.create_audit_entry(action=action, resource_type=resource_type, resource_id=resource_id, details=details)
    return {
        "status": "live_write",
        "backend": BACKEND_NAME,
        "summary": f"Created audit entry: {action} on {resource_type}/{resource_id}.",
        "entry": record,
        "scope_preview": {"selection_surface": "audit", "command_id": "audit.create"},
    }
