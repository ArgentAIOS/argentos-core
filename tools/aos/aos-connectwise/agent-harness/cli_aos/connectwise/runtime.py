from __future__ import annotations

import json
from typing import Any

from .client import ConnectWiseApiError, ConnectWiseClient
from .config import config_snapshot, resolve_runtime_values
from .constants import BACKEND_NAME, CONNECTOR_PATH
from .errors import CliError


LIVE_WRITE_COMMANDS = {
    "ticket.create",
    "company.create",
    "contact.create",
    "time_entry.create",
}
SCAFFOLDED_WRITE_COMMANDS = {"ticket.update"}


def _load_manifest() -> dict[str, Any]:
    return json.loads(CONNECTOR_PATH.read_text())


def _picker(items: list[dict[str, Any]], *, kind: str, label_key: str = "label") -> dict[str, Any]:
    return {"kind": kind, "items": items, "count": len(items), "label_key": label_key}


def _scope_preview(command_id: str, resource: str, extra: dict[str, Any] | None = None) -> dict[str, Any]:
    payload = {"selection_surface": resource, "command_id": command_id, "backend": BACKEND_NAME}
    if extra:
        payload.update(extra)
    return payload


def _require_arg(value: str | None, *, code: str, message: str, detail_key: str, detail_value: str) -> str:
    resolved = (value or "").strip()
    if resolved:
        return resolved
    raise CliError(code=code, message=message, exit_code=4, details={detail_key: detail_value})


def _load_json_arg(value: str | None, *, code: str, message: str, detail_key: str, detail_value: str) -> dict[str, Any]:
    resolved = _require_arg(value, code=code, message=message, detail_key=detail_key, detail_value=detail_value)
    try:
        parsed = json.loads(resolved)
    except json.JSONDecodeError as err:
        raise CliError(code=code, message=message, exit_code=4, details={detail_key: detail_value, "error": str(err)}) from err
    if not isinstance(parsed, dict):
        raise CliError(code=code, message=message, exit_code=4, details={detail_key: detail_value})
    return parsed


def _command_support(command_id: str, required_mode: str) -> bool:
    if required_mode == "readonly":
        return True
    return command_id in LIVE_WRITE_COMMANDS


def _write_result(
    *,
    command_id: str,
    resource: str,
    operation: str,
    summary: str,
    scope: dict[str, Any],
    payload_key: str,
    payload_value: Any,
    inputs: dict[str, Any],
) -> dict[str, Any]:
    return {
        "status": "live_write",
        "backend": BACKEND_NAME,
        "command_id": command_id,
        "resource": resource,
        "operation": operation,
        "executed": True,
        "consequential": True,
        "live_write_available": True,
        "scaffold_only": False,
        "inputs": inputs,
        payload_key: payload_value,
        "scope": scope,
        "scope_preview": _scope_preview(command_id, resource, scope),
        "summary": summary,
    }


def capabilities_snapshot() -> dict[str, Any]:
    manifest = _load_manifest()
    read_support: dict[str, bool] = {}
    write_support: dict[str, bool] = {}
    for command in manifest["commands"]:
        target = read_support if command["required_mode"] == "readonly" else write_support
        target[command["id"]] = _command_support(command["id"], command["required_mode"])
    return {
        "tool": manifest["tool"],
        "backend": manifest["backend"],
        "manifest_schema_version": manifest.get("manifest_schema_version", "1.0.0"),
        "connector": manifest["connector"],
        "auth": manifest["auth"],
        "scope": manifest.get("scope", {}),
        "commands": manifest["commands"],
        "implementation_mode": "live_read_with_partial_live_writes",
        "live_write_commands": sorted(LIVE_WRITE_COMMANDS),
        "scaffolded_write_commands": sorted(SCAFFOLDED_WRITE_COMMANDS),
        "read_support": read_support,
        "write_support": write_support,
    }


def create_client(ctx_obj: dict[str, Any]) -> ConnectWiseClient:
    runtime = resolve_runtime_values(ctx_obj)
    missing: list[str] = []
    if not runtime["company_id_present"]:
        missing.append(runtime["company_id_env"])
    if not runtime["public_key_present"]:
        missing.append(runtime["public_key_env"])
    if not runtime["private_key_present"]:
        missing.append(runtime["private_key_env"])
    if not runtime["site_url_present"]:
        missing.append(runtime["site_url_env"])
    if missing:
        raise CliError(
            code="CONNECTWISE_SETUP_REQUIRED",
            message="ConnectWise connector is missing required credentials",
            exit_code=4,
            details={"missing_keys": missing},
        )
    return ConnectWiseClient(
        company_id=runtime["company_id"],
        public_key=runtime["public_key"],
        private_key=runtime["private_key"],
        site_url=runtime["site_url"],
    )


def probe_runtime(ctx_obj: dict[str, Any]) -> dict[str, Any]:
    runtime = resolve_runtime_values(ctx_obj)
    if not runtime["credentials_present"]:
        missing: list[str] = []
        if not runtime["company_id_present"]:
            missing.append(runtime["company_id_env"])
        if not runtime["public_key_present"]:
            missing.append(runtime["public_key_env"])
        if not runtime["private_key_present"]:
            missing.append(runtime["private_key_env"])
        if not runtime["site_url_present"]:
            missing.append(runtime["site_url_env"])
        return {
            "ok": False,
            "code": "CONNECTWISE_SETUP_REQUIRED",
            "message": "ConnectWise connector is missing required credentials",
            "details": {"missing_keys": missing, "live_backend_available": False},
        }
    try:
        client = create_client(ctx_obj)
        boards = client.health_probe()
    except CliError as err:
        return {"ok": False, "code": err.code, "message": err.message, "details": err.details}
    except ConnectWiseApiError as err:
        code = "CONNECTWISE_AUTH_FAILED" if err.status_code in {401, 403} else "CONNECTWISE_API_ERROR"
        return {
            "ok": False,
            "code": code,
            "message": err.message,
            "details": {**(err.details or {}), "status_code": err.status_code, "live_backend_available": False},
        }
    return {
        "ok": True,
        "code": "OK",
        "message": "ConnectWise live runtime is ready",
        "details": {"live_backend_available": True, "boards": boards},
    }


def health_snapshot(ctx_obj: dict[str, Any]) -> dict[str, Any]:
    runtime = resolve_runtime_values(ctx_obj)
    probe = probe_runtime(ctx_obj)
    live_ready = bool(probe.get("ok"))
    status = "ready" if probe["ok"] else ("needs_setup" if probe["code"] == "CONNECTWISE_SETUP_REQUIRED" else "degraded")
    return {
        "status": status,
        "summary": probe["message"],
        "connector": {
            "backend": BACKEND_NAME,
            "live_backend_available": live_ready,
            "live_read_available": live_ready,
            "write_bridge_available": live_ready and bool(LIVE_WRITE_COMMANDS),
            "scaffold_only": False,
        },
        "auth": {
            "company_id_env": runtime["company_id_env"],
            "company_id_present": runtime["company_id_present"],
            "public_key_env": runtime["public_key_env"],
            "public_key_present": runtime["public_key_present"],
            "private_key_env": runtime["private_key_env"],
            "private_key_present": runtime["private_key_present"],
            "site_url_env": runtime["site_url_env"],
            "site_url_present": runtime["site_url_present"],
        },
        "scope": {
            "board_id": runtime["board_id"] or None,
            "company_id": runtime["company_scope"] or None,
            "ticket_id": runtime["ticket_id"] or None,
            "contact_id": runtime["contact_id"] or None,
            "project_id": runtime["project_id"] or None,
            "configuration_id": runtime["configuration_id"] or None,
        },
        "checks": [
            {
                "name": "required_env",
                "ok": runtime["credentials_present"],
                "details": {"missing_keys": [] if runtime["credentials_present"] else [
                    k for k, present in [
                        (runtime["company_id_env"], runtime["company_id_present"]),
                        (runtime["public_key_env"], runtime["public_key_present"]),
                        (runtime["private_key_env"], runtime["private_key_present"]),
                        (runtime["site_url_env"], runtime["site_url_present"]),
                    ] if not present
                ]},
            },
            {"name": "live_backend", "ok": bool(probe.get("ok")), "details": probe.get("details", {})},
        ],
        "runtime": {
            "implementation_mode": "live_read_with_partial_live_writes",
            "live_write_commands": sorted(LIVE_WRITE_COMMANDS),
            "scaffolded_write_commands": sorted(SCAFFOLDED_WRITE_COMMANDS),
        },
        "runtime_ready": live_ready,
        "probe": probe,
        "next_steps": [
            f"Set {runtime['company_id_env']}, {runtime['public_key_env']}, {runtime['private_key_env']}, and {runtime['site_url_env']} in operator-controlled service keys.",
            "Use ticket.list or board.list to confirm the live backend responds.",
            "Use ticket.create, company.create, contact.create, or time-entry.create only with explicit payload input in write mode.",
        ],
    }


def doctor_snapshot(ctx_obj: dict[str, Any]) -> dict[str, Any]:
    runtime = resolve_runtime_values(ctx_obj)
    probe = probe_runtime(ctx_obj)
    ready = bool(probe.get("ok"))
    return {
        "status": "ready" if ready else ("needs_setup" if probe.get("code") == "CONNECTWISE_SETUP_REQUIRED" else "degraded"),
        "summary": "ConnectWise connector diagnostics.",
        "runtime": {
            "implementation_mode": "live_read_with_partial_live_writes",
            "command_readiness": {
                "ticket.list": ready,
                "ticket.get": ready and bool(runtime["ticket_id"]),
                "ticket.create": ready,
                "ticket.update": False,
                "company.list": ready,
                "company.get": ready and bool(runtime["company_scope"]),
                "company.create": ready,
                "contact.list": ready,
                "contact.get": ready and bool(runtime["contact_id"]),
                "contact.create": ready,
                "project.list": ready,
                "project.get": ready and bool(runtime["project_id"]),
                "board.list": ready,
                "status.list": ready and bool(runtime["board_id"]),
                "member.list": ready,
                "time_entry.create": ready and bool(runtime["ticket_id"]),
                "configuration.list": ready,
                "configuration.get": ready and bool(runtime["configuration_id"]),
            },
            "live_write_commands": sorted(LIVE_WRITE_COMMANDS),
            "scaffolded_write_commands": sorted(SCAFFOLDED_WRITE_COMMANDS),
        },
        "checks": [
            {"name": "required_env", "ok": runtime["credentials_present"]},
            {"name": "live_backend", "ok": ready, "details": probe.get("details", {})},
        ],
        "supported_read_commands": [
            "ticket.list",
            "ticket.get",
            "company.list",
            "company.get",
            "contact.list",
            "contact.get",
            "project.list",
            "project.get",
            "board.list",
            "status.list",
            "member.list",
            "configuration.list",
            "configuration.get",
        ],
        "supported_write_commands": sorted(LIVE_WRITE_COMMANDS),
        "scaffolded_write_commands": [
            "ticket.update",
        ],
        "known_write_commands": [
            "ticket.create",
            "ticket.update",
            "company.create",
            "contact.create",
            "time_entry.create",
        ],
    }


def ticket_list_result(ctx_obj: dict[str, Any], *, board_id: str | None, status: str | None, priority: str | None, limit: int) -> dict[str, Any]:
    runtime = resolve_runtime_values(ctx_obj)
    client = create_client(ctx_obj)
    resolved_board = board_id or runtime["board_id"] or None
    payload = client.list_tickets(board_id=resolved_board, status=status or None, priority=priority, limit=limit)
    tickets = payload.get("tickets", [])
    picker_items = [
        {
            "value": str(item.get("id")),
            "label": str(item.get("summary") or item.get("id")),
            "subtitle": " | ".join(
                str(part) for part in [item.get("status"), item.get("priority"), item.get("company")] if part
            ),
            "selected": False,
        }
        for item in tickets
        if isinstance(item, dict)
    ]
    return {
        "status": "live_read",
        "backend": BACKEND_NAME,
        "summary": f"Listed {len(tickets)} ticket(s).",
        "tickets": tickets,
        "picker": _picker(picker_items, kind="connectwise_ticket"),
        "scope_preview": _scope_preview("ticket.list", "ticket", {"board_id": resolved_board}),
    }


def ticket_get_result(ctx_obj: dict[str, Any], *, ticket_id: str | None) -> dict[str, Any]:
    runtime = resolve_runtime_values(ctx_obj)
    resolved_ticket = ticket_id or runtime["ticket_id"] or None
    if not resolved_ticket:
        raise CliError(code="CONNECTWISE_TICKET_ID_REQUIRED", message="ticket_id is required", exit_code=4, details={"env": runtime["ticket_id_env"]})
    client = create_client(ctx_obj)
    ticket = client.get_ticket(resolved_ticket)
    return {
        "status": "live_read",
        "backend": BACKEND_NAME,
        "summary": f"Fetched ticket {resolved_ticket}.",
        "ticket": ticket,
        "scope_preview": _scope_preview("ticket.get", "ticket", {"ticket_id": resolved_ticket}),
    }


def ticket_create_result(ctx_obj: dict[str, Any], *, payload: dict[str, Any]) -> dict[str, Any]:
    client = create_client(ctx_obj)
    ticket = client.create_ticket(payload)
    ticket_id = ticket.get("id")
    ticket_label = ticket.get("summary") or ticket_id or "ticket"
    return _write_result(
        command_id="ticket.create",
        resource="ticket",
        operation="create",
        summary=f"Created ConnectWise ticket {ticket_label}.",
        scope={"ticket_id": ticket_id},
        payload_key="ticket",
        payload_value=ticket,
        inputs={"payload": payload},
    )


def company_list_result(ctx_obj: dict[str, Any], *, limit: int) -> dict[str, Any]:
    client = create_client(ctx_obj)
    payload = client.list_companies(limit=limit)
    companies = payload.get("companies", [])
    picker_items = [
        {
            "value": str(item.get("id")),
            "label": str(item.get("name") or item.get("id")),
            "subtitle": str(item.get("raw", {}).get("type") or ""),
            "selected": False,
        }
        for item in companies
        if isinstance(item, dict)
    ]
    return {
        "status": "live_read",
        "backend": BACKEND_NAME,
        "summary": f"Listed {len(companies)} company(s).",
        "companies": companies,
        "picker": _picker(picker_items, kind="connectwise_company"),
        "scope_preview": _scope_preview("company.list", "company", {}),
    }


def company_get_result(ctx_obj: dict[str, Any], *, company_id: str | None) -> dict[str, Any]:
    runtime = resolve_runtime_values(ctx_obj)
    resolved = company_id or runtime["company_scope"] or None
    if not resolved:
        raise CliError(code="CONNECTWISE_COMPANY_ID_REQUIRED", message="company_id is required", exit_code=4, details={"env": runtime["company_scope_env"]})
    client = create_client(ctx_obj)
    company = client.get_company(resolved)
    return {
        "status": "live_read",
        "backend": BACKEND_NAME,
        "summary": f"Fetched company {resolved}.",
        "company": company,
        "scope_preview": _scope_preview("company.get", "company", {"company_id": resolved}),
    }


def company_create_result(ctx_obj: dict[str, Any], *, payload: dict[str, Any]) -> dict[str, Any]:
    client = create_client(ctx_obj)
    company = client.create_company(payload)
    company_id = company.get("id")
    company_label = company.get("name") or company_id or "company"
    return _write_result(
        command_id="company.create",
        resource="company",
        operation="create",
        summary=f"Created ConnectWise company {company_label}.",
        scope={"company_id": company_id},
        payload_key="company",
        payload_value=company,
        inputs={"payload": payload},
    )


def contact_list_result(ctx_obj: dict[str, Any], *, company_id: str | None, limit: int) -> dict[str, Any]:
    runtime = resolve_runtime_values(ctx_obj)
    client = create_client(ctx_obj)
    resolved_company = company_id or runtime["company_scope"] or None
    payload = client.list_contacts(company_id=resolved_company, limit=limit)
    contacts = payload.get("contacts", [])
    picker_items = [
        {
            "value": str(item.get("id")),
            "label": str(item.get("name") or item.get("id")),
            "subtitle": str(item.get("email") or ""),
            "selected": False,
        }
        for item in contacts
        if isinstance(item, dict)
    ]
    return {
        "status": "live_read",
        "backend": BACKEND_NAME,
        "summary": f"Listed {len(contacts)} contact(s).",
        "contacts": contacts,
        "picker": _picker(picker_items, kind="connectwise_contact"),
        "scope_preview": _scope_preview("contact.list", "contact", {"company_id": resolved_company}),
    }


def contact_get_result(ctx_obj: dict[str, Any], *, contact_id: str | None) -> dict[str, Any]:
    runtime = resolve_runtime_values(ctx_obj)
    resolved = contact_id or runtime["contact_id"] or None
    if not resolved:
        raise CliError(code="CONNECTWISE_CONTACT_ID_REQUIRED", message="contact_id is required", exit_code=4, details={"env": runtime["contact_id_env"]})
    client = create_client(ctx_obj)
    contact = client.get_contact(resolved)
    return {
        "status": "live_read",
        "backend": BACKEND_NAME,
        "summary": f"Fetched contact {resolved}.",
        "contact": contact,
        "scope_preview": _scope_preview("contact.get", "contact", {"contact_id": resolved}),
    }


def contact_create_result(ctx_obj: dict[str, Any], *, payload: dict[str, Any]) -> dict[str, Any]:
    client = create_client(ctx_obj)
    contact = client.create_contact(payload)
    contact_id = contact.get("id")
    contact_label = contact.get("name") or contact.get("email") or contact_id or "contact"
    return _write_result(
        command_id="contact.create",
        resource="contact",
        operation="create",
        summary=f"Created ConnectWise contact {contact_label}.",
        scope={"contact_id": contact_id},
        payload_key="contact",
        payload_value=contact,
        inputs={"payload": payload},
    )


def project_list_result(ctx_obj: dict[str, Any], *, limit: int) -> dict[str, Any]:
    client = create_client(ctx_obj)
    payload = client.list_projects(limit=limit)
    projects = payload.get("projects", [])
    picker_items = [
        {
            "value": str(item.get("id")),
            "label": str(item.get("name") or item.get("id")),
            "subtitle": str(item.get("status") or ""),
            "selected": False,
        }
        for item in projects
        if isinstance(item, dict)
    ]
    return {
        "status": "live_read",
        "backend": BACKEND_NAME,
        "summary": f"Listed {len(projects)} project(s).",
        "projects": projects,
        "picker": _picker(picker_items, kind="connectwise_project"),
        "scope_preview": _scope_preview("project.list", "project", {}),
    }


def project_get_result(ctx_obj: dict[str, Any], *, project_id: str | None) -> dict[str, Any]:
    runtime = resolve_runtime_values(ctx_obj)
    resolved = project_id or runtime["project_id"] or None
    if not resolved:
        raise CliError(code="CONNECTWISE_PROJECT_ID_REQUIRED", message="project_id is required", exit_code=4, details={"env": runtime["project_id_env"]})
    client = create_client(ctx_obj)
    project = client.get_project(resolved)
    return {
        "status": "live_read",
        "backend": BACKEND_NAME,
        "summary": f"Fetched project {resolved}.",
        "project": project,
        "scope_preview": _scope_preview("project.get", "project", {"project_id": resolved}),
    }


def board_list_result(ctx_obj: dict[str, Any], *, limit: int) -> dict[str, Any]:
    client = create_client(ctx_obj)
    payload = client.list_boards(limit=limit)
    boards = payload.get("boards", [])
    picker_items = [
        {
            "value": str(item.get("id")),
            "label": str(item.get("name") or item.get("id")),
            "subtitle": " | ".join(str(part) for part in [item.get("location"), item.get("department")] if part),
            "selected": False,
        }
        for item in boards
        if isinstance(item, dict)
    ]
    return {
        "status": "live_read",
        "backend": BACKEND_NAME,
        "summary": f"Listed {len(boards)} board(s).",
        "boards": boards,
        "picker": _picker(picker_items, kind="connectwise_board"),
        "scope_preview": _scope_preview("board.list", "board", {}),
    }


def status_list_result(ctx_obj: dict[str, Any], *, board_id: str | None, limit: int) -> dict[str, Any]:
    runtime = resolve_runtime_values(ctx_obj)
    resolved_board = board_id or runtime["board_id"] or None
    if not resolved_board:
        raise CliError(code="CONNECTWISE_BOARD_ID_REQUIRED", message="board_id is required", exit_code=4, details={"env": runtime["board_id_env"]})
    client = create_client(ctx_obj)
    payload = client.list_statuses(resolved_board, limit=limit)
    statuses = payload.get("statuses", [])
    picker_items = [
        {
            "value": str(item.get("id")),
            "label": str(item.get("name") or item.get("id")),
            "subtitle": str(item.get("raw", {}).get("closed_flag") or ""),
            "selected": False,
        }
        for item in statuses
        if isinstance(item, dict)
    ]
    return {
        "status": "live_read",
        "backend": BACKEND_NAME,
        "summary": f"Listed {len(statuses)} status(es).",
        "statuses": statuses,
        "picker": _picker(picker_items, kind="connectwise_status"),
        "scope_preview": _scope_preview("status.list", "status", {"board_id": resolved_board}),
    }


def member_list_result(ctx_obj: dict[str, Any], *, limit: int) -> dict[str, Any]:
    client = create_client(ctx_obj)
    payload = client.list_members(limit=limit)
    members = payload.get("members", [])
    picker_items = [
        {
            "value": str(item.get("id")),
            "label": str(item.get("name") or item.get("id")),
            "subtitle": str(item.get("email") or ""),
            "selected": False,
        }
        for item in members
        if isinstance(item, dict)
    ]
    return {
        "status": "live_read",
        "backend": BACKEND_NAME,
        "summary": f"Listed {len(members)} member(s).",
        "members": members,
        "picker": _picker(picker_items, kind="connectwise_member"),
        "scope_preview": _scope_preview("member.list", "member", {}),
    }


def time_entry_create_result(ctx_obj: dict[str, Any], *, ticket_id: str | None, payload: dict[str, Any]) -> dict[str, Any]:
    runtime = resolve_runtime_values(ctx_obj)
    resolved_ticket = ticket_id or runtime["ticket_id"] or None
    if not resolved_ticket:
        raise CliError(code="CONNECTWISE_TICKET_ID_REQUIRED", message="ticket_id is required", exit_code=4, details={"env": runtime["ticket_id_env"]})
    client = create_client(ctx_obj)
    time_entry = client.create_time_entry(resolved_ticket, payload)
    return _write_result(
        command_id="time_entry.create",
        resource="time_entry",
        operation="create",
        summary=f"Created ConnectWise time entry on ticket {resolved_ticket}.",
        scope={"ticket_id": resolved_ticket},
        payload_key="time_entry",
        payload_value=time_entry,
        inputs={"ticket_id": resolved_ticket, "payload": payload},
    )


def configuration_list_result(ctx_obj: dict[str, Any], *, company_id: str | None, limit: int) -> dict[str, Any]:
    runtime = resolve_runtime_values(ctx_obj)
    client = create_client(ctx_obj)
    resolved_company = company_id or runtime["company_scope"] or None
    payload = client.list_configurations(company_id=resolved_company, limit=limit)
    configurations = payload.get("configurations", [])
    picker_items = [
        {
            "value": str(item.get("id")),
            "label": str(item.get("name") or item.get("id")),
            "subtitle": str(item.get("raw", {}).get("type") or ""),
            "selected": False,
        }
        for item in configurations
        if isinstance(item, dict)
    ]
    return {
        "status": "live_read",
        "backend": BACKEND_NAME,
        "summary": f"Listed {len(configurations)} configuration(s).",
        "configurations": configurations,
        "picker": _picker(picker_items, kind="connectwise_configuration"),
        "scope_preview": _scope_preview("configuration.list", "configuration", {"company_id": resolved_company}),
    }


def configuration_get_result(ctx_obj: dict[str, Any], *, configuration_id: str | None) -> dict[str, Any]:
    runtime = resolve_runtime_values(ctx_obj)
    resolved = configuration_id or runtime["configuration_id"] or None
    if not resolved:
        raise CliError(code="CONNECTWISE_CONFIGURATION_ID_REQUIRED", message="configuration_id is required", exit_code=4, details={"env": runtime["configuration_id_env"]})
    client = create_client(ctx_obj)
    configuration = client.get_configuration(resolved)
    return {
        "status": "live_read",
        "backend": BACKEND_NAME,
        "summary": f"Fetched configuration {resolved}.",
        "configuration": configuration,
        "scope_preview": _scope_preview("configuration.get", "configuration", {"configuration_id": resolved}),
    }


def scaffold_write_result(command_id: str) -> dict[str, Any]:
    return {
        "command_id": command_id,
        "status": "scaffolded",
        "write_bridge_available": False,
        "scaffold_only": True,
    }
