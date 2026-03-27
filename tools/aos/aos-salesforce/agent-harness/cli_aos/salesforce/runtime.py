from __future__ import annotations

import json
from typing import Any

from .client import SalesforceApiError, SalesforceClient
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
            "account.list": True,
            "account.get": True,
            "task.list": True,
            "report.run": True,
            "search.soql": True,
        },
        "write_support": {
            "lead.create": "live",
            "lead.update": "live",
            "contact.create": "live",
            "opportunity.create": "live",
            "opportunity.update": "live",
            "task.create": "live",
        },
    }


def create_client(ctx_obj: dict[str, Any]) -> SalesforceClient:
    runtime = resolve_runtime_values(ctx_obj)
    missing = []
    if not runtime["access_token_present"]:
        missing.append(runtime["token_env"])
    if not runtime["instance_url_present"]:
        missing.append(runtime["instance_env"])
    if missing:
        raise CliError(
            code="SALESFORCE_SETUP_REQUIRED",
            message="Salesforce connector is missing required credentials",
            exit_code=4,
            details={"missing_keys": missing},
        )
    return SalesforceClient(access_token=runtime["access_token"], instance_url=runtime["instance_url"])


def probe_runtime(ctx_obj: dict[str, Any]) -> dict[str, Any]:
    runtime = resolve_runtime_values(ctx_obj)
    if not runtime["access_token_present"] or not runtime["instance_url_present"]:
        missing = []
        if not runtime["access_token_present"]:
            missing.append(runtime["token_env"])
        if not runtime["instance_url_present"]:
            missing.append(runtime["instance_env"])
        return {
            "ok": False,
            "code": "SALESFORCE_SETUP_REQUIRED",
            "message": "Salesforce connector is missing required credentials",
            "details": {"missing_keys": missing, "live_backend_available": False},
        }
    try:
        client = create_client(ctx_obj)
        limits = client.probe()
    except CliError as err:
        return {"ok": False, "code": err.code, "message": err.message, "details": err.details}
    except SalesforceApiError as err:
        code = "SALESFORCE_AUTH_FAILED" if err.status_code in {401, 403} else "SALESFORCE_API_ERROR"
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
        "message": "Salesforce live read runtime is ready",
        "details": {
            "live_backend_available": True,
            "instance_url": runtime["instance_url"],
        },
    }


def _write_error(err: SalesforceApiError, *, operation: str) -> CliError:
    code = "SALESFORCE_AUTH_FAILED" if err.status_code in {401, 403} else "SALESFORCE_API_ERROR"
    message = err.message if err.status_code not in {401, 403} else f"Salesforce {operation} failed because the token lacks access"
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
    status = "ready" if probe["ok"] else ("needs_setup" if probe["code"] == "SALESFORCE_SETUP_REQUIRED" else "degraded")
    return {
        "status": status,
        "summary": probe["message"],
        "connector": {
            "backend": BACKEND_NAME,
            "live_backend_available": bool(probe.get("ok")),
            "live_read_available": bool(probe.get("ok")),
            "write_bridge_available": True,
            "scaffold_only": False,
        },
        "auth": {
            "token_env": runtime["token_env"],
            "access_token_present": runtime["access_token_present"],
            "instance_env": runtime["instance_env"],
            "instance_url_present": runtime["instance_url_present"],
        },
        "checks": [
            {
                "name": "required_env",
                "ok": runtime["access_token_present"] and runtime["instance_url_present"],
                "details": {"missing_keys": [k for k, v in [(runtime["token_env"], runtime["access_token_present"]), (runtime["instance_env"], runtime["instance_url_present"])] if not v]},
            },
            {"name": "live_backend", "ok": bool(probe.get("ok")), "details": probe.get("details", {})},
        ],
        "runtime_ready": bool(probe.get("ok")),
        "probe": probe,
        "next_steps": [
            f"Set {runtime['token_env']} and {runtime['instance_env']} in API Keys.",
            "Optionally set SALESFORCE_RECORD_ID and SALESFORCE_REPORT_ID to stabilize worker-flow scope.",
            "Salesforce write commands are now wired to the live API.",
        ],
    }


def doctor_snapshot(ctx_obj: dict[str, Any]) -> dict[str, Any]:
    runtime = resolve_runtime_values(ctx_obj)
    probe = probe_runtime(ctx_obj)
    live = bool(probe.get("ok"))
    return {
        "status": "ready" if live else ("needs_setup" if probe.get("code") == "SALESFORCE_SETUP_REQUIRED" else "degraded"),
        "summary": "Salesforce connector diagnostics.",
        "runtime": {
            "implementation_mode": "live_read_with_live_writes",
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
                "opportunity.update": live,
                "account.list": live,
                "account.get": live,
                "task.list": live,
                "task.create": live,
                "report.run": live,
                "search.soql": live,
            },
            "record_id_present": runtime["record_id_present"],
            "report_id_present": runtime["report_id_present"],
        },
        "checks": [
            {"name": "required_env", "ok": runtime["access_token_present"] and runtime["instance_url_present"]},
            {"name": "live_backend", "ok": live, "details": probe.get("details", {})},
            {"name": "write_commands", "ok": True, "details": {"mode": "live"}},
        ],
        "supported_read_commands": [
            "lead.list", "lead.get", "contact.list", "contact.get",
            "opportunity.list", "opportunity.get", "account.list", "account.get",
            "task.list", "report.run", "search.soql",
        ],
        "scaffolded_commands": [],
        "next_steps": [
            f"Set {runtime['token_env']} and {runtime['instance_env']} in API Keys.",
            "Use lead.list or search.soql to confirm the connected Salesforce org.",
            "Write commands now execute live mutations with the current API token.",
        ],
    }


def _picker(items: list[dict[str, Any]], *, kind: str, label_key: str = "label") -> dict[str, Any]:
    return {"kind": kind, "items": items, "count": len(items), "label_key": label_key}


def _require_arg(value: str | None, *, code: str, message: str, detail_key: str, detail_value: str) -> str:
    resolved = (value or "").strip()
    if resolved:
        return resolved
    raise CliError(code=code, message=message, exit_code=4, details={detail_key: detail_value})


def lead_list_result(ctx_obj: dict[str, Any], *, limit: int) -> dict[str, Any]:
    client = create_client(ctx_obj)
    leads = client.list_leads(limit=limit)
    items = [
        {"id": str(l.get("id") or ""), "label": str(l.get("name") or l.get("email") or l.get("id") or "Lead"), "subtitle": l.get("company"), "kind": "lead"}
        for l in leads
    ]
    return {
        "status": "live_read",
        "backend": BACKEND_NAME,
        "summary": f"Returned {len(leads)} Salesforce lead{'s' if len(leads) != 1 else ''}.",
        "leads": leads,
        "lead_count": len(leads),
        "picker": _picker(items, kind="lead"),
        "scope_preview": {"selection_surface": "lead", "command_id": "lead.list"},
    }


def lead_get_result(ctx_obj: dict[str, Any], record_id: str | None) -> dict[str, Any]:
    runtime = resolve_runtime_values(ctx_obj)
    resolved = _require_arg(record_id or runtime["record_id"], code="SALESFORCE_RECORD_REQUIRED", message="Record ID is required", detail_key="env", detail_value=runtime["record_id_env"])
    client = create_client(ctx_obj)
    lead = client.get_lead(resolved)
    return {
        "status": "live_read",
        "backend": BACKEND_NAME,
        "summary": f"Read Salesforce lead {resolved}.",
        "lead": lead,
        "scope_preview": {"selection_surface": "lead", "command_id": "lead.get", "record_id": resolved},
    }


def contact_list_result(ctx_obj: dict[str, Any], *, limit: int) -> dict[str, Any]:
    client = create_client(ctx_obj)
    contacts = client.list_contacts(limit=limit)
    items = [
        {"id": str(c.get("id") or ""), "label": str(c.get("name") or c.get("email") or c.get("id") or "Contact"), "subtitle": c.get("email"), "kind": "contact"}
        for c in contacts
    ]
    return {
        "status": "live_read",
        "backend": BACKEND_NAME,
        "summary": f"Returned {len(contacts)} Salesforce contact{'s' if len(contacts) != 1 else ''}.",
        "contacts": contacts,
        "contact_count": len(contacts),
        "picker": _picker(items, kind="contact"),
        "scope_preview": {"selection_surface": "contact", "command_id": "contact.list"},
    }


def contact_get_result(ctx_obj: dict[str, Any], record_id: str | None) -> dict[str, Any]:
    runtime = resolve_runtime_values(ctx_obj)
    resolved = _require_arg(record_id or runtime["record_id"], code="SALESFORCE_RECORD_REQUIRED", message="Record ID is required", detail_key="env", detail_value=runtime["record_id_env"])
    client = create_client(ctx_obj)
    contact = client.get_contact(resolved)
    return {
        "status": "live_read",
        "backend": BACKEND_NAME,
        "summary": f"Read Salesforce contact {resolved}.",
        "contact": contact,
        "scope_preview": {"selection_surface": "contact", "command_id": "contact.get", "record_id": resolved},
    }


def opportunity_list_result(ctx_obj: dict[str, Any], *, limit: int) -> dict[str, Any]:
    client = create_client(ctx_obj)
    opps = client.list_opportunities(limit=limit)
    items = [
        {"id": str(o.get("id") or ""), "label": str(o.get("name") or o.get("id") or "Opportunity"), "subtitle": o.get("stage"), "kind": "opportunity"}
        for o in opps
    ]
    return {
        "status": "live_read",
        "backend": BACKEND_NAME,
        "summary": f"Returned {len(opps)} Salesforce opportunit{'ies' if len(opps) != 1 else 'y'}.",
        "opportunities": opps,
        "opportunity_count": len(opps),
        "picker": _picker(items, kind="opportunity"),
        "scope_preview": {"selection_surface": "opportunity", "command_id": "opportunity.list"},
    }


def opportunity_get_result(ctx_obj: dict[str, Any], record_id: str | None) -> dict[str, Any]:
    runtime = resolve_runtime_values(ctx_obj)
    resolved = _require_arg(record_id or runtime["record_id"], code="SALESFORCE_RECORD_REQUIRED", message="Record ID is required", detail_key="env", detail_value=runtime["record_id_env"])
    client = create_client(ctx_obj)
    opp = client.get_opportunity(resolved)
    return {
        "status": "live_read",
        "backend": BACKEND_NAME,
        "summary": f"Read Salesforce opportunity {resolved}.",
        "opportunity": opp,
        "scope_preview": {"selection_surface": "opportunity", "command_id": "opportunity.get", "record_id": resolved},
    }


def account_list_result(ctx_obj: dict[str, Any], *, limit: int) -> dict[str, Any]:
    client = create_client(ctx_obj)
    accounts = client.list_accounts(limit=limit)
    items = [
        {"id": str(a.get("id") or ""), "label": str(a.get("name") or a.get("id") or "Account"), "subtitle": a.get("industry"), "kind": "account"}
        for a in accounts
    ]
    return {
        "status": "live_read",
        "backend": BACKEND_NAME,
        "summary": f"Returned {len(accounts)} Salesforce account{'s' if len(accounts) != 1 else ''}.",
        "accounts": accounts,
        "account_count": len(accounts),
        "picker": _picker(items, kind="account"),
        "scope_preview": {"selection_surface": "account", "command_id": "account.list"},
    }


def account_get_result(ctx_obj: dict[str, Any], record_id: str | None) -> dict[str, Any]:
    runtime = resolve_runtime_values(ctx_obj)
    resolved = _require_arg(record_id or runtime["record_id"], code="SALESFORCE_RECORD_REQUIRED", message="Record ID is required", detail_key="env", detail_value=runtime["record_id_env"])
    client = create_client(ctx_obj)
    account = client.get_account(resolved)
    return {
        "status": "live_read",
        "backend": BACKEND_NAME,
        "summary": f"Read Salesforce account {resolved}.",
        "account": account,
        "scope_preview": {"selection_surface": "account", "command_id": "account.get", "record_id": resolved},
    }


def task_list_result(ctx_obj: dict[str, Any], *, limit: int) -> dict[str, Any]:
    client = create_client(ctx_obj)
    tasks = client.list_tasks(limit=limit)
    items = [
        {"id": str(t.get("id") or ""), "label": str(t.get("subject") or t.get("id") or "Task"), "subtitle": t.get("status"), "kind": "task"}
        for t in tasks
    ]
    return {
        "status": "live_read",
        "backend": BACKEND_NAME,
        "summary": f"Returned {len(tasks)} Salesforce task{'s' if len(tasks) != 1 else ''}.",
        "tasks": tasks,
        "task_count": len(tasks),
        "picker": _picker(items, kind="task"),
        "scope_preview": {"selection_surface": "task", "command_id": "task.list"},
    }


def report_run_result(ctx_obj: dict[str, Any], report_id: str | None) -> dict[str, Any]:
    runtime = resolve_runtime_values(ctx_obj)
    resolved = _require_arg(report_id or runtime["report_id"], code="SALESFORCE_REPORT_REQUIRED", message="Report ID is required", detail_key="env", detail_value=runtime["report_id_env"])
    client = create_client(ctx_obj)
    report = client.run_report(resolved)
    return {
        "status": "live_read",
        "backend": BACKEND_NAME,
        "summary": f"Ran Salesforce report {resolved}.",
        "report": report,
        "scope_preview": {"selection_surface": "report", "command_id": "report.run", "report_id": resolved},
    }


def soql_result(ctx_obj: dict[str, Any], soql: str) -> dict[str, Any]:
    client = create_client(ctx_obj)
    result = client.run_soql(soql)
    records = result.get("records", [])
    return {
        "status": "live_read",
        "backend": BACKEND_NAME,
        "summary": f"SOQL query returned {len(records)} record{'s' if len(records) != 1 else ''}.",
        "result": result,
        "record_count": len(records),
        "scope_preview": {"selection_surface": "search", "command_id": "search.soql"},
    }


def lead_create_result(ctx_obj: dict[str, Any], *, name: str, company: str | None, email: str | None) -> dict[str, Any]:
    client = create_client(ctx_obj)
    try:
        lead = client.create_lead(name=name, company=company, email=email)
    except SalesforceApiError as err:
        raise _write_error(err, operation="lead.create") from err
    return {
        "status": "live_write",
        "backend": BACKEND_NAME,
        "command": "lead.create",
        "summary": f"Created Salesforce lead {lead.get('id') or name}.",
        "lead": lead,
        "inputs": {"name": name, "company": company, "email": email},
        "scope_preview": {"selection_surface": "lead", "command_id": "lead.create"},
    }


def lead_update_result(ctx_obj: dict[str, Any], *, record_id: str) -> dict[str, Any]:
    client = create_client(ctx_obj)
    try:
        current = client.get_lead(record_id)
        lead = client.update_lead(
            record_id,
            fields={
                "LastName": current.get("name") or record_id,
                "Company": current.get("company") or current.get("name") or record_id,
                "Email": current.get("email"),
                "Phone": current.get("phone"),
            },
        )
    except SalesforceApiError as err:
        raise _write_error(err, operation="lead.update") from err
    return {
        "status": "live_write",
        "backend": BACKEND_NAME,
        "command": "lead.update",
        "summary": f"Updated Salesforce lead {record_id}.",
        "lead": lead,
        "inputs": {"record_id": record_id},
        "scope_preview": {"selection_surface": "lead", "command_id": "lead.update", "record_id": record_id},
    }


def contact_create_result(ctx_obj: dict[str, Any], *, last_name: str, email: str | None) -> dict[str, Any]:
    client = create_client(ctx_obj)
    try:
        contact = client.create_contact(last_name=last_name, email=email)
    except SalesforceApiError as err:
        raise _write_error(err, operation="contact.create") from err
    return {
        "status": "live_write",
        "backend": BACKEND_NAME,
        "command": "contact.create",
        "summary": f"Created Salesforce contact {contact.get('id') or last_name}.",
        "contact": contact,
        "inputs": {"last_name": last_name, "email": email},
        "scope_preview": {"selection_surface": "contact", "command_id": "contact.create"},
    }


def opportunity_create_result(
    ctx_obj: dict[str, Any],
    *,
    name: str,
    stage: str | None,
    amount: float | None,
) -> dict[str, Any]:
    client = create_client(ctx_obj)
    try:
        opportunity = client.create_opportunity(name=name, stage=stage, amount=amount)
    except SalesforceApiError as err:
        raise _write_error(err, operation="opportunity.create") from err
    return {
        "status": "live_write",
        "backend": BACKEND_NAME,
        "command": "opportunity.create",
        "summary": f"Created Salesforce opportunity {opportunity.get('id') or name}.",
        "opportunity": opportunity,
        "inputs": {"name": name, "stage": stage, "amount": amount},
        "scope_preview": {"selection_surface": "opportunity", "command_id": "opportunity.create"},
    }


def opportunity_update_result(ctx_obj: dict[str, Any], *, record_id: str) -> dict[str, Any]:
    client = create_client(ctx_obj)
    try:
        current = client.get_opportunity(record_id)
        opp = client.update_opportunity(
            record_id,
            fields={
                "Name": current.get("name") or record_id,
                "StageName": current.get("stage") or "Prospecting",
                "Amount": current.get("amount"),
                "CloseDate": current.get("close_date"),
            },
        )
    except SalesforceApiError as err:
        raise _write_error(err, operation="opportunity.update") from err
    return {
        "status": "live_write",
        "backend": BACKEND_NAME,
        "command": "opportunity.update",
        "summary": f"Updated Salesforce opportunity {record_id}.",
        "opportunity": opp,
        "inputs": {"record_id": record_id},
        "scope_preview": {"selection_surface": "opportunity", "command_id": "opportunity.update", "record_id": record_id},
    }


def task_create_result(ctx_obj: dict[str, Any], *, subject: str) -> dict[str, Any]:
    client = create_client(ctx_obj)
    try:
        task = client.create_task(subject=subject)
    except SalesforceApiError as err:
        raise _write_error(err, operation="task.create") from err
    return {
        "status": "live_write",
        "backend": BACKEND_NAME,
        "command": "task.create",
        "summary": f"Created Salesforce task {task.get('id') or subject}.",
        "task": task,
        "inputs": {"subject": subject},
        "scope_preview": {"selection_surface": "task", "command_id": "task.create"},
    }
