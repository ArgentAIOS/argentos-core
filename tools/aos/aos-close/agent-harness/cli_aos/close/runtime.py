from __future__ import annotations

import json
from typing import Any

from .client import CloseApiError, CloseClient
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
            "lead.create": "scaffold_only",
            "lead.update": "scaffold_only",
            "contact.create": "scaffold_only",
            "opportunity.create": "scaffold_only",
            "activity.create": "scaffold_only",
            "task.create": "scaffold_only",
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
            "details": {"missing_keys": [runtime["key_env"]], "live_backend_available": False},
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
            },
        }
    return {
        "ok": True,
        "code": "OK",
        "message": "Close live read runtime is ready",
        "details": {
            "live_backend_available": True,
            "user": me.get("first_name", "") + " " + me.get("last_name", ""),
            "org_id": me.get("organization_id"),
        },
    }


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
            "write_bridge_available": False,
            "scaffold_only": False,
        },
        "auth": {
            "key_env": runtime["key_env"],
            "api_key_present": runtime["api_key_present"],
        },
        "checks": [
            {
                "name": "required_env",
                "ok": runtime["api_key_present"],
                "details": {"missing_keys": [] if runtime["api_key_present"] else [runtime["key_env"]]},
            },
            {"name": "live_backend", "ok": bool(probe.get("ok")), "details": probe.get("details", {})},
        ],
        "runtime_ready": bool(probe.get("ok")),
        "probe": probe,
        "next_steps": [
            f"Set {runtime['key_env']} in API Keys.",
            "Optionally set CLOSE_LEAD_ID and CLOSE_CONTACT_ID to stabilize scope.",
            "Keep Close write and outreach commands scaffolded until mutation workflows are approved.",
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
            "implementation_mode": "live_read_with_scaffolded_writes",
            "command_readiness": {
                "lead.list": live,
                "lead.get": live,
                "lead.create": False,
                "lead.update": False,
                "contact.list": live,
                "contact.get": live,
                "contact.create": False,
                "opportunity.list": live,
                "opportunity.get": live,
                "opportunity.create": False,
                "activity.list": live,
                "activity.create": False,
                "task.list": live,
                "task.create": False,
                "email.send": False,
                "sms.send": False,
                "call.create": False,
            },
            "lead_id_present": runtime["lead_id_present"],
            "contact_id_present": runtime["contact_id_present"],
        },
        "checks": [
            {"name": "required_env", "ok": runtime["api_key_present"]},
            {"name": "live_backend", "ok": live, "details": probe.get("details", {})},
            {"name": "write_commands", "ok": True, "details": {"mode": "scaffold_only"}},
        ],
        "supported_read_commands": [
            "lead.list", "lead.get", "contact.list", "contact.get",
            "opportunity.list", "opportunity.get", "activity.list", "task.list",
        ],
        "scaffolded_commands": [
            "lead.create", "lead.update", "contact.create", "opportunity.create",
            "activity.create", "task.create", "email.send", "sms.send", "call.create",
        ],
        "next_steps": [
            f"Set {runtime['key_env']} in API Keys.",
            "Use lead.list to confirm the connected Close organization.",
            "Decide whether write and outreach commands should remain scaffold-only or gain a write bridge.",
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
    resolved = _require_arg(lead_id or runtime["lead_id"], code="CLOSE_LEAD_REQUIRED", message="Lead ID is required", detail_key="env", detail_value=runtime["lead_id_env"])
    client = create_client(ctx_obj)
    lead = client.get_lead(resolved)
    return {
        "status": "live_read",
        "backend": BACKEND_NAME,
        "summary": f"Read Close lead {resolved}.",
        "lead": lead,
        "scope_preview": {"selection_surface": "lead", "command_id": "lead.get", "lead_id": resolved},
    }


def contact_list_result(ctx_obj: dict[str, Any], *, limit: int) -> dict[str, Any]:
    client = create_client(ctx_obj)
    contacts = client.list_contacts(limit=limit)
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
        "scope_preview": {"selection_surface": "contact", "command_id": "contact.list"},
    }


def contact_get_result(ctx_obj: dict[str, Any], contact_id: str | None) -> dict[str, Any]:
    runtime = resolve_runtime_values(ctx_obj)
    resolved = _require_arg(contact_id or runtime["contact_id"], code="CLOSE_CONTACT_REQUIRED", message="Contact ID is required", detail_key="env", detail_value=runtime["contact_id_env"])
    client = create_client(ctx_obj)
    contact = client.get_contact(resolved)
    return {
        "status": "live_read",
        "backend": BACKEND_NAME,
        "summary": f"Read Close contact {resolved}.",
        "contact": contact,
        "scope_preview": {"selection_surface": "contact", "command_id": "contact.get", "contact_id": resolved},
    }


def opportunity_list_result(ctx_obj: dict[str, Any], *, limit: int) -> dict[str, Any]:
    client = create_client(ctx_obj)
    opps = client.list_opportunities(limit=limit)
    items = [
        {"id": str(o.get("id") or ""), "label": str(o.get("note") or o.get("id") or "Opportunity"), "subtitle": o.get("status_type"), "kind": "opportunity"}
        for o in opps
    ]
    return {
        "status": "live_read",
        "backend": BACKEND_NAME,
        "summary": f"Returned {len(opps)} Close opportunit{'ies' if len(opps) != 1 else 'y'}.",
        "opportunities": opps,
        "opportunity_count": len(opps),
        "picker": _picker(items, kind="opportunity"),
        "scope_preview": {"selection_surface": "opportunity", "command_id": "opportunity.list"},
    }


def opportunity_get_result(ctx_obj: dict[str, Any], opp_id: str | None) -> dict[str, Any]:
    resolved = _require_arg(opp_id, code="CLOSE_OPPORTUNITY_REQUIRED", message="Opportunity ID is required", detail_key="hint", detail_value="Pass opportunity ID as argument")
    client = create_client(ctx_obj)
    opp = client.get_opportunity(resolved)
    return {
        "status": "live_read",
        "backend": BACKEND_NAME,
        "summary": f"Read Close opportunity {resolved}.",
        "opportunity": opp,
        "scope_preview": {"selection_surface": "opportunity", "command_id": "opportunity.get", "opportunity_id": resolved},
    }


def activity_list_result(ctx_obj: dict[str, Any], *, limit: int) -> dict[str, Any]:
    client = create_client(ctx_obj)
    activities = client.list_activities(limit=limit)
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
        "scope_preview": {"selection_surface": "activity", "command_id": "activity.list"},
    }


def task_list_result(ctx_obj: dict[str, Any], *, limit: int) -> dict[str, Any]:
    client = create_client(ctx_obj)
    tasks = client.list_tasks(limit=limit)
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
        "scope_preview": {"selection_surface": "task", "command_id": "task.list"},
    }


def scaffold_write_result(ctx_obj: dict[str, Any], *, command_id: str, inputs: dict[str, Any]) -> dict[str, Any]:
    runtime = resolve_runtime_values(ctx_obj)
    return {
        "status": "scaffold_write_only",
        "backend": BACKEND_NAME,
        "summary": f"{command_id} is scaffolded and does not perform live Close writes yet.",
        "command": command_id,
        "inputs": inputs,
        "scope_preview": {
            "selection_surface": "lead",
            "lead_id": runtime["lead_id"] or None,
            "contact_id": runtime["contact_id"] or None,
        },
        "next_step": "Keep Close write and outreach actions disabled until approval and mutation safeguards are defined.",
    }
