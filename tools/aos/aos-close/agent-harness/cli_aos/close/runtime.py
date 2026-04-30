from __future__ import annotations

import json
from typing import Any

from .client import CloseApiError, CloseClient
from .config import resolve_runtime_values
from .constants import BACKEND_NAME, CONNECTOR_PATH
from .errors import CliError

LIVE_WRITE_COMMANDS = {
    "lead.create",
    "lead.update",
    "contact.create",
    "opportunity.create",
    "activity.create",
    "task.create",
}
SCAFFOLDED_WRITE_COMMANDS = {"email.send", "sms.send", "call.create"}


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
        "read_support": {
            "lead.list": True,
            "lead.get": True,
            "contact.list": True,
            "contact.get": True,
            "opportunity.list": True,
            "opportunity.get": True,
            "activity.list": True,
            "task.list": True,
        },
        "write_support": {
            "lead.create": "live",
            "lead.update": "live",
            "contact.create": "live",
            "opportunity.create": "live",
            "activity.create": "live",
            "task.create": "live",
            "email.send": "scaffold_only",
            "sms.send": "scaffold_only",
            "call.create": "scaffold_only",
        },
    }


def create_client(ctx_obj: dict[str, Any]) -> CloseClient:
    runtime = resolve_runtime_values(ctx_obj)
    if not runtime["api_key_present"]:
        raise CliError(
            code="CLOSE_SETUP_REQUIRED",
            message="Close connector is missing the required API key",
            exit_code=4,
            details={"missing_keys": [runtime["key_env"]]},
        )
    return CloseClient(api_key=runtime["api_key"])


def probe_runtime(ctx_obj: dict[str, Any]) -> dict[str, Any]:
    runtime = resolve_runtime_values(ctx_obj)
    if not runtime["api_key_present"]:
        return {
            "ok": False,
            "code": "CLOSE_SETUP_REQUIRED",
            "message": "Close connector is missing the required API key",
            "details": {
                "missing_keys": [runtime["key_env"]],
                "live_backend_available": False,
                "auth_source": runtime["auth_source"],
            },
        }
    try:
        client = create_client(ctx_obj)
        me = client.probe()
    except CliError as err:
        return {"ok": False, "code": err.code, "message": err.message, "details": err.details}
    except CloseApiError as err:
        code = "CLOSE_AUTH_FAILED" if err.status_code in {401, 403} else "CLOSE_API_ERROR"
        return {
            "ok": False,
            "code": code,
            "message": err.message,
            "details": {
                **(err.details or {}),
                "status_code": err.status_code,
                "live_backend_available": False,
                "auth_source": runtime["auth_source"],
            },
        }
    return {
        "ok": True,
        "code": "OK",
        "message": "Close live read and CRM write runtime is ready",
        "details": {
            "live_backend_available": True,
            "auth_source": runtime["auth_source"],
            "user": f"{me.get('first_name', '')} {me.get('last_name', '')}".strip() or None,
            "org_id": me.get("organization_id"),
        },
    }


def _write_error(err: CloseApiError, *, operation: str) -> CliError:
    code = "CLOSE_AUTH_FAILED" if err.status_code in {401, 403} else "CLOSE_API_ERROR"
    message = err.message if err.status_code not in {401, 403} else f"Close {operation} failed because the API key lacks access"
    return CliError(
        code=code,
        message=message,
        exit_code=5 if err.status_code in {401, 403} else 4,
        details={
            "operation": operation,
            "status_code": err.status_code,
            "error_code": err.code,
            "error_details": err.details or {},
        },
    )


def health_snapshot(ctx_obj: dict[str, Any]) -> dict[str, Any]:
    runtime = resolve_runtime_values(ctx_obj)
    probe = probe_runtime(ctx_obj)
    status = "ready" if probe["ok"] else ("needs_setup" if probe["code"] == "CLOSE_SETUP_REQUIRED" else "degraded")
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
            "key_env": runtime["key_env"],
            "api_key_present": runtime["api_key_present"],
            "api_key_source": runtime["auth_source"],
        },
        "checks": [
            {
                "name": "required_env",
                "ok": runtime["api_key_present"],
                "details": {"missing_keys": [] if runtime["api_key_present"] else [runtime["key_env"]]},
            },
            {"name": "live_backend", "ok": bool(probe.get("ok")), "details": probe.get("details", {})},
            {
                "name": "crm_write_bridge",
                "ok": bool(probe.get("ok")),
                "details": {"live_commands": sorted(LIVE_WRITE_COMMANDS), "scaffolded_commands": sorted(SCAFFOLDED_WRITE_COMMANDS)},
            },
        ],
        "runtime_ready": bool(probe.get("ok")),
        "probe": probe,
        "next_steps": [
            f"Set {runtime['key_env']} in API Keys.",
            "Optionally set CLOSE_LEAD_ID, CLOSE_CONTACT_ID, and CLOSE_OPPORTUNITY_ID to stabilize picker scope.",
            "CRM writes are live; outreach commands remain scaffolded until explicit delivery safeguards are approved.",
        ],
    }


def doctor_snapshot(ctx_obj: dict[str, Any]) -> dict[str, Any]:
    runtime = resolve_runtime_values(ctx_obj)
    probe = probe_runtime(ctx_obj)
    live = bool(probe.get("ok"))
    return {
        "status": "ready" if live else ("needs_setup" if probe.get("code") == "CLOSE_SETUP_REQUIRED" else "degraded"),
        "summary": "Close connector diagnostics.",
        "runtime": {
            "implementation_mode": "live_read_with_live_crm_writes_and_scaffolded_outreach",
            "command_readiness": {
                "lead.list": live,
                "lead.get": live,
                "lead.create": live,
                "lead.update": live,
                "contact.list": live,
                "contact.get": live,
                "contact.create": live,
                "opportunity.list": live,
                "opportunity.get": live,
                "opportunity.create": live,
                "activity.list": live,
                "activity.create": live,
                "task.list": live,
                "task.create": live,
                "email.send": False,
                "sms.send": False,
                "call.create": False,
            },
            "lead_id_present": runtime["lead_id_present"],
            "contact_id_present": runtime["contact_id_present"],
            "opportunity_id_present": runtime["opportunity_id_present"],
            "auth_source": runtime["auth_source"],
        },
        "checks": [
            {"name": "required_env", "ok": runtime["api_key_present"]},
            {"name": "live_backend", "ok": live, "details": probe.get("details", {})},
            {"name": "crm_write_bridge", "ok": live, "details": {"mode": "live"}},
            {"name": "outreach_bridge", "ok": True, "details": {"mode": "scaffold_only"}},
        ],
        "supported_read_commands": [
            "lead.list",
            "lead.get",
            "contact.list",
            "contact.get",
            "opportunity.list",
            "opportunity.get",
            "activity.list",
            "task.list",
        ],
        "scaffolded_commands": sorted(SCAFFOLDED_WRITE_COMMANDS),
        "next_steps": [
            f"Set {runtime['key_env']} in API Keys.",
            "Use lead.list to confirm the connected Close organization.",
            "Only enable outreach commands after message delivery and audit safeguards are defined.",
        ],
    }


def _picker(items: list[dict[str, Any]], *, kind: str, label_key: str = "label") -> dict[str, Any]:
    return {"kind": kind, "items": items, "count": len(items), "label_key": label_key}


def _require_arg(value: str | None, *, code: str, message: str, detail_key: str, detail_value: str) -> str:
    resolved = (value or "").strip()
    if resolved:
        return resolved
    raise CliError(code=code, message=message, exit_code=4, details={detail_key: detail_value})


def lead_list_result(ctx_obj: dict[str, Any], *, limit: int, query: str | None = None) -> dict[str, Any]:
    client = create_client(ctx_obj)
    leads = client.list_leads(limit=limit, query=query)
    items = [
        {"id": str(l.get("id") or ""), "label": str(l.get("display_name") or l.get("id") or "Lead"), "subtitle": l.get("status_label"), "kind": "lead"}
        for l in leads
    ]
    return {
        "status": "live_read",
        "backend": BACKEND_NAME,
        "summary": f"Returned {len(leads)} Close lead{'s' if len(leads) != 1 else ''}.",
        "leads": leads,
        "lead_count": len(leads),
        "picker": _picker(items, kind="lead"),
        "scope_preview": {"selection_surface": "lead", "command_id": "lead.list"},
    }


def lead_get_result(ctx_obj: dict[str, Any], lead_id: str | None) -> dict[str, Any]:
    runtime = resolve_runtime_values(ctx_obj)
    resolved = _require_arg(
        lead_id or runtime["lead_id"],
        code="CLOSE_LEAD_REQUIRED",
        message="Lead ID is required",
        detail_key="env",
        detail_value=runtime["lead_id_env"],
    )
    client = create_client(ctx_obj)
    lead = client.get_lead(resolved)
    return {
        "status": "live_read",
        "backend": BACKEND_NAME,
        "summary": f"Read Close lead {resolved}.",
        "lead": lead,
        "scope_preview": {"selection_surface": "lead", "command_id": "lead.get", "lead_id": resolved},
    }


def lead_create_result(
    ctx_obj: dict[str, Any],
    *,
    name: str,
    status: str | None,
    description: str | None,
    url: str | None,
) -> dict[str, Any]:
    client = create_client(ctx_obj)
    try:
        lead = client.create_lead(name=name, status=status, description=description, url=url)
    except CloseApiError as err:
        raise _write_error(err, operation="lead.create") from err
    return {
        "status": "live_write",
        "backend": BACKEND_NAME,
        "command": "lead.create",
        "summary": f"Created Close lead {lead.get('id') or name}.",
        "lead": lead,
        "inputs": {"name": name, "status": status, "description": description, "url": url},
        "scope_preview": {"selection_surface": "lead", "command_id": "lead.create", "lead_id": lead.get("id")},
    }


def lead_update_result(
    ctx_obj: dict[str, Any],
    *,
    lead_id: str | None,
    name: str | None,
    status: str | None,
    description: str | None,
    url: str | None,
) -> dict[str, Any]:
    runtime = resolve_runtime_values(ctx_obj)
    resolved_lead_id = _require_arg(
        lead_id or runtime["lead_id"],
        code="CLOSE_LEAD_REQUIRED",
        message="Lead ID is required",
        detail_key="env",
        detail_value=runtime["lead_id_env"],
    )
    fields = {key: value for key, value in {"name": name, "status": status, "description": description, "url": url}.items() if value is not None}
    if not fields:
        raise CliError(
            code="CLOSE_UPDATE_FIELDS_REQUIRED",
            message="Provide at least one field to update",
            exit_code=4,
            details={"allowed_fields": ["name", "status", "description", "url"]},
    )
    client = create_client(ctx_obj)
    try:
        lead = client.update_lead(resolved_lead_id, fields=fields)
    except CloseApiError as err:
        raise _write_error(err, operation="lead.update") from err
    return {
        "status": "live_write",
        "backend": BACKEND_NAME,
        "command": "lead.update",
        "summary": f"Updated Close lead {resolved_lead_id}.",
        "lead": lead,
        "inputs": {"lead_id": resolved_lead_id, **fields},
        "scope_preview": {"selection_surface": "lead", "command_id": "lead.update", "lead_id": resolved_lead_id},
    }


def contact_list_result(ctx_obj: dict[str, Any], *, limit: int, lead_id: str | None) -> dict[str, Any]:
    runtime = resolve_runtime_values(ctx_obj)
    resolved_lead_id = (lead_id or runtime["lead_id"] or "").strip() or None
    client = create_client(ctx_obj)
    contacts = client.list_contacts(limit=limit, lead_id=resolved_lead_id)
    items = [
        {"id": str(c.get("id") or ""), "label": str(c.get("name") or c.get("id") or "Contact"), "subtitle": c.get("title"), "kind": "contact"}
        for c in contacts
    ]
    return {
        "status": "live_read",
        "backend": BACKEND_NAME,
        "summary": f"Returned {len(contacts)} Close contact{'s' if len(contacts) != 1 else ''}.",
        "contacts": contacts,
        "contact_count": len(contacts),
        "picker": _picker(items, kind="contact"),
        "scope_preview": {"selection_surface": "contact", "command_id": "contact.list", "lead_id": resolved_lead_id},
    }


def contact_get_result(ctx_obj: dict[str, Any], contact_id: str | None) -> dict[str, Any]:
    runtime = resolve_runtime_values(ctx_obj)
    resolved = _require_arg(
        contact_id or runtime["contact_id"],
        code="CLOSE_CONTACT_REQUIRED",
        message="Contact ID is required",
        detail_key="env",
        detail_value=runtime["contact_id_env"],
    )
    client = create_client(ctx_obj)
    contact = client.get_contact(resolved)
    return {
        "status": "live_read",
        "backend": BACKEND_NAME,
        "summary": f"Read Close contact {resolved}.",
        "contact": contact,
        "scope_preview": {"selection_surface": "contact", "command_id": "contact.get", "contact_id": resolved},
    }


def contact_create_result(
    ctx_obj: dict[str, Any],
    *,
    name: str,
    lead_id: str | None,
    email: str | None,
    phone: str | None,
    title: str | None,
) -> dict[str, Any]:
    runtime = resolve_runtime_values(ctx_obj)
    resolved_lead_id = (lead_id or runtime["lead_id"] or "").strip() or None
    client = create_client(ctx_obj)
    try:
        contact = client.create_contact(name=name, lead_id=resolved_lead_id, email=email, phone=phone, title=title)
    except CloseApiError as err:
        raise _write_error(err, operation="contact.create") from err
    return {
        "status": "live_write",
        "backend": BACKEND_NAME,
        "command": "contact.create",
        "summary": f"Created Close contact {contact.get('id') or name}.",
        "contact": contact,
        "inputs": {"name": name, "lead_id": resolved_lead_id, "email": email, "phone": phone, "title": title},
        "scope_preview": {"selection_surface": "contact", "command_id": "contact.create", "contact_id": contact.get("id"), "lead_id": resolved_lead_id},
    }


def opportunity_list_result(
    ctx_obj: dict[str, Any],
    *,
    limit: int,
    lead_id: str | None,
    status_type: str | None,
) -> dict[str, Any]:
    runtime = resolve_runtime_values(ctx_obj)
    resolved_lead_id = (lead_id or runtime["lead_id"] or "").strip() or None
    resolved_status_type = (status_type or "").strip() or None
    client = create_client(ctx_obj)
    opportunities = client.list_opportunities(limit=limit, lead_id=resolved_lead_id, status_type=resolved_status_type)
    items = [
        {"id": str(o.get("id") or ""), "label": str(o.get("note") or o.get("id") or "Opportunity"), "subtitle": o.get("status_type"), "kind": "opportunity"}
        for o in opportunities
    ]
    return {
        "status": "live_read",
        "backend": BACKEND_NAME,
        "summary": f"Returned {len(opportunities)} Close opportunit{'ies' if len(opportunities) != 1 else 'y'}.",
        "opportunities": opportunities,
        "opportunity_count": len(opportunities),
        "picker": _picker(items, kind="opportunity"),
        "scope_preview": {
            "selection_surface": "opportunity",
            "command_id": "opportunity.list",
            "lead_id": resolved_lead_id,
            "status_type": resolved_status_type,
        },
    }


def opportunity_get_result(ctx_obj: dict[str, Any], opp_id: str | None) -> dict[str, Any]:
    runtime = resolve_runtime_values(ctx_obj)
    resolved = _require_arg(
        opp_id or runtime["opportunity_id"],
        code="CLOSE_OPPORTUNITY_REQUIRED",
        message="Opportunity ID is required",
        detail_key="env",
        detail_value=runtime["opportunity_id_env"],
    )
    client = create_client(ctx_obj)
    opportunity = client.get_opportunity(resolved)
    return {
        "status": "live_read",
        "backend": BACKEND_NAME,
        "summary": f"Read Close opportunity {resolved}.",
        "opportunity": opportunity,
        "scope_preview": {"selection_surface": "opportunity", "command_id": "opportunity.get", "opportunity_id": resolved},
    }


def opportunity_create_result(
    ctx_obj: dict[str, Any],
    *,
    lead_id: str | None,
    note: str | None,
    value: int | None,
    confidence: int | None,
    status_id: str | None,
) -> dict[str, Any]:
    runtime = resolve_runtime_values(ctx_obj)
    resolved_lead_id = _require_arg(
        lead_id or runtime["lead_id"],
        code="CLOSE_LEAD_REQUIRED",
        message="Lead ID is required to create an opportunity safely",
        detail_key="env",
        detail_value=runtime["lead_id_env"],
    )
    client = create_client(ctx_obj)
    try:
        opportunity = client.create_opportunity(
            lead_id=resolved_lead_id,
            note=note,
            value=value,
            confidence=confidence,
            status_id=status_id,
            contact_id=runtime["contact_id"] or None,
        )
    except CloseApiError as err:
        raise _write_error(err, operation="opportunity.create") from err
    return {
        "status": "live_write",
        "backend": BACKEND_NAME,
        "command": "opportunity.create",
        "summary": f"Created Close opportunity {opportunity.get('id') or 'new opportunity'}.",
        "opportunity": opportunity,
        "inputs": {
            "lead_id": resolved_lead_id,
            "note": note,
            "value": value,
            "confidence": confidence,
            "status_id": status_id,
            "contact_id": runtime["contact_id"] or None,
        },
        "scope_preview": {
            "selection_surface": "opportunity",
            "command_id": "opportunity.create",
            "opportunity_id": opportunity.get("id"),
            "lead_id": resolved_lead_id,
        },
    }


def activity_list_result(ctx_obj: dict[str, Any], *, limit: int, lead_id: str | None) -> dict[str, Any]:
    runtime = resolve_runtime_values(ctx_obj)
    resolved_lead_id = (lead_id or runtime["lead_id"] or "").strip() or None
    resolved_contact_id = runtime["contact_id"] or None
    client = create_client(ctx_obj)
    activities = client.list_activities(limit=limit, lead_id=resolved_lead_id, contact_id=resolved_contact_id)
    items = [
        {"id": str(a.get("id") or ""), "label": str(a.get("type") or a.get("id") or "Activity"), "subtitle": a.get("date_created"), "kind": "activity"}
        for a in activities
    ]
    return {
        "status": "live_read",
        "backend": BACKEND_NAME,
        "summary": f"Returned {len(activities)} Close activit{'ies' if len(activities) != 1 else 'y'}.",
        "activities": activities,
        "activity_count": len(activities),
        "picker": _picker(items, kind="activity"),
        "scope_preview": {
            "selection_surface": "activity",
            "command_id": "activity.list",
            "lead_id": resolved_lead_id,
            "contact_id": resolved_contact_id,
        },
    }


def activity_create_result(ctx_obj: dict[str, Any], *, note: str, lead_id: str | None) -> dict[str, Any]:
    runtime = resolve_runtime_values(ctx_obj)
    resolved_lead_id = _require_arg(
        lead_id or runtime["lead_id"],
        code="CLOSE_LEAD_REQUIRED",
        message="Lead ID is required to create a note activity",
        detail_key="env",
        detail_value=runtime["lead_id_env"],
    )
    client = create_client(ctx_obj)
    try:
        activity = client.create_note_activity(lead_id=resolved_lead_id, note=note, contact_id=runtime["contact_id"] or None)
    except CloseApiError as err:
        raise _write_error(err, operation="activity.create") from err
    return {
        "status": "live_write",
        "backend": BACKEND_NAME,
        "command": "activity.create",
        "summary": f"Created Close note activity {activity.get('id') or 'new activity'}.",
        "activity": activity,
        "inputs": {"note": note, "lead_id": resolved_lead_id, "contact_id": runtime["contact_id"] or None},
        "scope_preview": {"selection_surface": "activity", "command_id": "activity.create", "lead_id": resolved_lead_id},
    }


def task_list_result(ctx_obj: dict[str, Any], *, limit: int, lead_id: str | None, assignee: str | None) -> dict[str, Any]:
    runtime = resolve_runtime_values(ctx_obj)
    resolved_lead_id = (lead_id or runtime["lead_id"] or "").strip() or None
    resolved_assignee = (assignee or "").strip() or None
    client = create_client(ctx_obj)
    tasks = client.list_tasks(limit=limit, lead_id=resolved_lead_id, assigned_to=resolved_assignee)
    items = [
        {"id": str(t.get("id") or ""), "label": str(t.get("text") or t.get("id") or "Task"), "subtitle": t.get("due_date"), "kind": "task"}
        for t in tasks
    ]
    return {
        "status": "live_read",
        "backend": BACKEND_NAME,
        "summary": f"Returned {len(tasks)} Close task{'s' if len(tasks) != 1 else ''}.",
        "tasks": tasks,
        "task_count": len(tasks),
        "picker": _picker(items, kind="task"),
        "scope_preview": {
            "selection_surface": "task",
            "command_id": "task.list",
            "lead_id": resolved_lead_id,
            "assigned_to": resolved_assignee,
        },
    }


def task_create_result(
    ctx_obj: dict[str, Any],
    *,
    text: str,
    lead_id: str | None,
    due_date: str | None,
    assignee: str | None,
) -> dict[str, Any]:
    runtime = resolve_runtime_values(ctx_obj)
    resolved_lead_id = _require_arg(
        lead_id or runtime["lead_id"],
        code="CLOSE_LEAD_REQUIRED",
        message="Lead ID is required to create a task",
        detail_key="env",
        detail_value=runtime["lead_id_env"],
    )
    resolved_assignee = (assignee or "").strip() or None
    client = create_client(ctx_obj)
    try:
        task = client.create_task(lead_id=resolved_lead_id, text=text, assigned_to=resolved_assignee, due_date=due_date)
    except CloseApiError as err:
        raise _write_error(err, operation="task.create") from err
    return {
        "status": "live_write",
        "backend": BACKEND_NAME,
        "command": "task.create",
        "summary": f"Created Close task {task.get('id') or text}.",
        "task": task,
        "inputs": {"text": text, "lead_id": resolved_lead_id, "due_date": due_date, "assigned_to": resolved_assignee},
        "scope_preview": {"selection_surface": "task", "command_id": "task.create", "lead_id": resolved_lead_id},
    }


def scaffold_write_result(ctx_obj: dict[str, Any], *, command_id: str, inputs: dict[str, Any]) -> dict[str, Any]:
    runtime = resolve_runtime_values(ctx_obj)
    return {
        "status": "scaffold_write_only",
        "backend": BACKEND_NAME,
        "summary": f"{command_id} remains scaffolded and does not perform live Close outreach yet.",
        "command": command_id,
        "inputs": inputs,
        "scope_preview": {
            "selection_surface": "lead",
            "lead_id": runtime["lead_id"] or None,
            "contact_id": runtime["contact_id"] or None,
            "opportunity_id": runtime["opportunity_id"] or None,
        },
        "next_step": "Outreach commands stay scaffolded until delivery, consent, and audit safeguards are implemented.",
    }
