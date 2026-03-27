from __future__ import annotations

import json
from typing import Any

from .client import SendGridApiError, SendGridClient
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
            "contacts.list": True,
            "contacts.search": True,
            "lists.list": True,
            "templates.list": True,
            "templates.get": True,
            "stats.global": True,
            "stats.category": True,
        },
        "write_support": {
            "email.send": True,
            "email.send_template": True,
            "contacts.add": True,
            "lists.create": True,
            "lists.add_contacts": True,
        },
    }


def create_client(ctx_obj: dict[str, Any]) -> SendGridClient:
    runtime = resolve_runtime_values(ctx_obj)
    if not runtime["api_key_present"]:
        raise CliError(
            code="SENDGRID_SETUP_REQUIRED",
            message="SendGrid connector is missing the required API key",
            exit_code=4,
            details={"missing_keys": [runtime["api_key_env"]]},
        )
    return SendGridClient(api_key=runtime["api_key"])


def probe_runtime(ctx_obj: dict[str, Any]) -> dict[str, Any]:
    runtime = resolve_runtime_values(ctx_obj)
    if not runtime["api_key_present"]:
        return {
            "ok": False,
            "code": "SENDGRID_SETUP_REQUIRED",
            "message": "SendGrid connector is missing the required API key",
            "details": {"missing_keys": [runtime["api_key_env"]], "live_backend_available": False},
        }
    try:
        client = create_client(ctx_obj)
        scopes = client.verify_api_key()
    except CliError as err:
        return {"ok": False, "code": err.code, "message": err.message, "details": err.details}
    except SendGridApiError as err:
        code = "SENDGRID_AUTH_FAILED" if err.status_code in {401, 403} else "SENDGRID_API_ERROR"
        return {
            "ok": False,
            "code": code,
            "message": err.message,
            "details": {**(err.details or {}), "status_code": err.status_code, "live_backend_available": False},
        }
    return {
        "ok": True,
        "code": "OK",
        "message": "SendGrid live runtime is ready",
        "details": {"live_backend_available": True, "scopes": scopes},
    }


def health_snapshot(ctx_obj: dict[str, Any]) -> dict[str, Any]:
    runtime = resolve_runtime_values(ctx_obj)
    probe = probe_runtime(ctx_obj)
    status = "ready" if probe["ok"] else ("needs_setup" if probe["code"] == "SENDGRID_SETUP_REQUIRED" else "degraded")
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
        },
        "scope": {
            "from_email": runtime["from_email"] or None,
            "template_id": runtime["template_id"] or None,
            "list_id": runtime["list_id"] or None,
        },
        "checks": [
            {"name": "required_env", "ok": runtime["api_key_present"], "details": {"missing_keys": [] if runtime["api_key_present"] else [runtime["api_key_env"]]}},
            {"name": "live_backend", "ok": bool(probe.get("ok")), "details": probe.get("details", {})},
        ],
        "runtime_ready": bool(probe.get("ok")),
        "probe": probe,
        "next_steps": [
            f"Set {runtime['api_key_env']} in API Keys.",
            "Optionally pin SENDGRID_FROM_EMAIL, SENDGRID_TEMPLATE_ID, and SENDGRID_LIST_ID to stabilize worker-flow scope pickers.",
        ],
    }


def doctor_snapshot(ctx_obj: dict[str, Any]) -> dict[str, Any]:
    runtime = resolve_runtime_values(ctx_obj)
    probe = probe_runtime(ctx_obj)
    live = bool(probe.get("ok"))
    return {
        "status": "ready" if live else ("needs_setup" if probe.get("code") == "SENDGRID_SETUP_REQUIRED" else "degraded"),
        "summary": "SendGrid connector diagnostics.",
        "runtime": {
            "implementation_mode": "live_read_write",
            "command_readiness": {
                "email.send": live,
                "email.send_template": live,
                "contacts.list": live,
                "contacts.add": live,
                "contacts.search": live,
                "lists.list": live,
                "lists.create": live,
                "lists.add_contacts": live,
                "templates.list": live,
                "templates.get": live,
                "stats.global": live,
                "stats.category": live,
            },
            "from_email_present": runtime["from_email_present"],
            "template_id_present": runtime["template_id_present"],
            "list_id_present": runtime["list_id_present"],
        },
        "checks": [
            {"name": "required_env", "ok": runtime["api_key_present"]},
            {"name": "live_backend", "ok": live, "details": probe.get("details", {})},
        ],
        "supported_read_commands": [
            "contacts.list", "contacts.search",
            "lists.list",
            "templates.list", "templates.get",
            "stats.global", "stats.category",
        ],
        "supported_write_commands": [
            "email.send", "email.send_template",
            "contacts.add",
            "lists.create", "lists.add_contacts",
        ],
        "next_steps": [
            f"Set {runtime['api_key_env']} in API Keys.",
            "Use health to confirm the connected SendGrid account.",
            "Pin SENDGRID_FROM_EMAIL before using email.send or email.send_template.",
        ],
    }


def _picker(items: list[dict[str, Any]], *, kind: str, label_key: str = "label") -> dict[str, Any]:
    return {"kind": kind, "items": items, "count": len(items), "label_key": label_key}


def _require_arg(value: str | None, *, code: str, message: str, detail_key: str, detail_value: str) -> str:
    resolved = (value or "").strip()
    if resolved:
        return resolved
    raise CliError(code=code, message=message, exit_code=4, details={detail_key: detail_value})


# ── Email ──────────────────────────────────────────────────────

def email_send_result(ctx_obj: dict[str, Any], *, to: str, subject: str, body: str) -> dict[str, Any]:
    runtime = resolve_runtime_values(ctx_obj)
    from_email = _require_arg(runtime["from_email"], code="SENDGRID_FROM_REQUIRED", message="From email is required (set SENDGRID_FROM_EMAIL)", detail_key="env", detail_value=runtime["from_email_env"])
    client = create_client(ctx_obj)
    result = client.send_email(to=to, from_email=from_email, subject=subject, html_body=body)
    return {"status": "live_write", "backend": BACKEND_NAME, "summary": f"Email sent to {to}.", "result": result}


def email_send_template_result(ctx_obj: dict[str, Any], *, to: str, template_id: str | None) -> dict[str, Any]:
    runtime = resolve_runtime_values(ctx_obj)
    from_email = _require_arg(runtime["from_email"], code="SENDGRID_FROM_REQUIRED", message="From email is required (set SENDGRID_FROM_EMAIL)", detail_key="env", detail_value=runtime["from_email_env"])
    resolved_template = _require_arg(template_id or runtime["template_id"], code="SENDGRID_TEMPLATE_REQUIRED", message="Template ID is required", detail_key="env", detail_value=runtime["template_id_env"])
    client = create_client(ctx_obj)
    result = client.send_template_email(to=to, from_email=from_email, template_id=resolved_template)
    return {"status": "live_write", "backend": BACKEND_NAME, "summary": f"Template email sent to {to}.", "result": result}


# ── Contacts ───────────────────────────────────────────────────

def contacts_list_result(ctx_obj: dict[str, Any], *, limit: int) -> dict[str, Any]:
    client = create_client(ctx_obj)
    payload = client.list_contacts(limit=limit)
    contacts = payload.get("contacts", [])
    items = [
        {"id": str(c.get("id", "")), "label": str(c.get("email", c.get("id", "Contact"))), "kind": "contact"}
        for c in contacts if isinstance(c, dict)
    ]
    return {
        "status": "live_read", "backend": BACKEND_NAME,
        "summary": f"Returned {len(contacts)} SendGrid contact{'s' if len(contacts) != 1 else ''}.",
        "contacts": contacts, "contact_count": len(contacts),
        "picker": _picker(items, kind="contact"),
    }


def contacts_add_result(ctx_obj: dict[str, Any], *, email: str, first_name: str | None, last_name: str | None) -> dict[str, Any]:
    runtime = resolve_runtime_values(ctx_obj)
    client = create_client(ctx_obj)
    list_ids = [runtime["list_id"]] if runtime["list_id"] else None
    result = client.add_contact(email=email, first_name=first_name, last_name=last_name, list_ids=list_ids)
    return {"status": "live_write", "backend": BACKEND_NAME, "summary": f"Contact {email} added/updated.", "result": result}


def contacts_search_result(ctx_obj: dict[str, Any], *, query: str, limit: int) -> dict[str, Any]:
    client = create_client(ctx_obj)
    payload = client.search_contacts(query=query, limit=limit)
    contacts = payload.get("contacts", [])
    items = [
        {"id": str(c.get("id", "")), "label": str(c.get("email", c.get("id", "Contact"))), "kind": "contact"}
        for c in contacts if isinstance(c, dict)
    ]
    return {
        "status": "live_read", "backend": BACKEND_NAME,
        "summary": f"Search returned {len(contacts)} contact{'s' if len(contacts) != 1 else ''}.",
        "contacts": contacts, "contact_count": len(contacts),
        "picker": _picker(items, kind="contact"),
    }


# ── Lists ──────────────────────────────────────────────────────

def lists_list_result(ctx_obj: dict[str, Any], *, limit: int) -> dict[str, Any]:
    client = create_client(ctx_obj)
    payload = client.list_lists(limit=limit)
    lists = payload.get("lists", [])
    items = [
        {"id": str(l.get("id", "")), "label": str(l.get("name", l.get("id", "List"))), "subtitle": f"contacts={l.get('contact_count', 'unknown')}", "kind": "list"}
        for l in lists if isinstance(l, dict)
    ]
    return {
        "status": "live_read", "backend": BACKEND_NAME,
        "summary": f"Returned {len(lists)} SendGrid list{'s' if len(lists) != 1 else ''}.",
        "lists": lists, "list_count": len(lists),
        "picker": _picker(items, kind="list"),
    }


def lists_create_result(ctx_obj: dict[str, Any], *, name: str) -> dict[str, Any]:
    client = create_client(ctx_obj)
    result = client.create_list(name=name)
    return {"status": "live_write", "backend": BACKEND_NAME, "summary": f"List '{name}' created.", "result": result}


def lists_add_contacts_result(ctx_obj: dict[str, Any], *, list_id: str | None, contact_ids: list[str]) -> dict[str, Any]:
    runtime = resolve_runtime_values(ctx_obj)
    resolved = _require_arg(list_id or runtime["list_id"], code="SENDGRID_LIST_REQUIRED", message="List ID is required", detail_key="env", detail_value=runtime["list_id_env"])
    client = create_client(ctx_obj)
    result = client.add_contacts_to_list(list_id=resolved, contact_ids=contact_ids)
    return {"status": "live_write", "backend": BACKEND_NAME, "summary": f"Added {len(contact_ids)} contact(s) to list {resolved}.", "result": result}


# ── Templates ──────────────────────────────────────────────────

def templates_list_result(ctx_obj: dict[str, Any], *, limit: int) -> dict[str, Any]:
    client = create_client(ctx_obj)
    payload = client.list_templates(limit=limit)
    templates = payload.get("templates", [])
    items = [
        {"id": str(t.get("id", "")), "label": str(t.get("name", t.get("id", "Template"))), "kind": "template"}
        for t in templates if isinstance(t, dict)
    ]
    return {
        "status": "live_read", "backend": BACKEND_NAME,
        "summary": f"Returned {len(templates)} SendGrid template{'s' if len(templates) != 1 else ''}.",
        "templates": templates, "template_count": len(templates),
        "picker": _picker(items, kind="template"),
    }


def templates_get_result(ctx_obj: dict[str, Any], *, template_id: str | None) -> dict[str, Any]:
    runtime = resolve_runtime_values(ctx_obj)
    resolved = _require_arg(template_id or runtime["template_id"], code="SENDGRID_TEMPLATE_REQUIRED", message="Template ID is required", detail_key="env", detail_value=runtime["template_id_env"])
    client = create_client(ctx_obj)
    template = client.get_template(resolved)
    return {"status": "live_read", "backend": BACKEND_NAME, "summary": f"Read SendGrid template {resolved}.", "template": template}


# ── Stats ──────────────────────────────────────────────────────

def stats_global_result(ctx_obj: dict[str, Any], *, start_date: str) -> dict[str, Any]:
    client = create_client(ctx_obj)
    payload = client.global_stats(start_date=start_date)
    return {"status": "live_read", "backend": BACKEND_NAME, "summary": "Global email statistics.", "stats": payload.get("stats", [])}


def stats_category_result(ctx_obj: dict[str, Any], *, category: str, start_date: str) -> dict[str, Any]:
    client = create_client(ctx_obj)
    payload = client.category_stats(category=category, start_date=start_date)
    return {"status": "live_read", "backend": BACKEND_NAME, "summary": f"Category '{category}' email statistics.", "stats": payload.get("stats", []), "category": category}
