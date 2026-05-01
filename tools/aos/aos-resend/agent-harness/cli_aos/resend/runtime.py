from __future__ import annotations

import json
from typing import Any

from .client import ResendApiError, ResendClient
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
            "domains.list": True,
            "audiences.list": True,
            "contacts.list": True,
        },
        "write_support": {
            "email.send": True,
            "email.batch_send": True,
            "domains.verify": True,
            "audiences.create": True,
            "contacts.create": True,
            "contacts.remove": True,
        },
    }


def create_client(ctx_obj: dict[str, Any]) -> ResendClient:
    runtime = resolve_runtime_values(ctx_obj)
    if not runtime["api_key_present"]:
        raise CliError(
            code="RESEND_SETUP_REQUIRED",
            message="Resend connector is missing the required API key",
            exit_code=4,
            details={"missing_keys": [runtime["api_key_env"]]},
        )
    return ResendClient(api_key=runtime["api_key"])


def probe_runtime(ctx_obj: dict[str, Any]) -> dict[str, Any]:
    runtime = resolve_runtime_values(ctx_obj)
    if not runtime["api_key_present"]:
        return {
            "ok": False,
            "code": "RESEND_SETUP_REQUIRED",
            "message": "Resend connector is missing the required API key",
            "details": {"missing_keys": [runtime["api_key_env"]], "live_backend_available": False},
        }
    try:
        client = create_client(ctx_obj)
        domains = client.verify_api_key()
    except CliError as err:
        return {"ok": False, "code": err.code, "message": err.message, "details": err.details}
    except ResendApiError as err:
        code = "RESEND_AUTH_FAILED" if err.status_code in {401, 403} else "RESEND_API_ERROR"
        return {
            "ok": False,
            "code": code,
            "message": err.message,
            "details": {**(err.details or {}), "status_code": err.status_code, "live_backend_available": False},
        }
    return {
        "ok": True,
        "code": "OK",
        "message": "Resend live runtime is ready",
        "details": {"live_backend_available": True, "domains": domains},
    }


def health_snapshot(ctx_obj: dict[str, Any]) -> dict[str, Any]:
    runtime = resolve_runtime_values(ctx_obj)
    probe = probe_runtime(ctx_obj)
    status = "ready" if probe["ok"] else ("needs_setup" if probe["code"] == "RESEND_SETUP_REQUIRED" else "degraded")
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
            "audience_id": runtime["audience_id"] or None,
            "domain_id": runtime["domain_id"] or None,
        },
        "checks": [
            {"name": "required_env", "ok": runtime["api_key_present"], "details": {"missing_keys": [] if runtime["api_key_present"] else [runtime["api_key_env"]]}},
            {"name": "live_backend", "ok": bool(probe.get("ok")), "details": probe.get("details", {})},
        ],
        "runtime_ready": bool(probe.get("ok")),
        "probe": probe,
        "next_steps": [
            f"Set {runtime['api_key_env']} in API Keys.",
            "Optionally pin RESEND_FROM_EMAIL, RESEND_AUDIENCE_ID, and RESEND_DOMAIN_ID to stabilize worker-flow scope pickers.",
        ],
    }


def doctor_snapshot(ctx_obj: dict[str, Any]) -> dict[str, Any]:
    runtime = resolve_runtime_values(ctx_obj)
    probe = probe_runtime(ctx_obj)
    live = bool(probe.get("ok"))
    return {
        "status": "ready" if live else ("needs_setup" if probe.get("code") == "RESEND_SETUP_REQUIRED" else "degraded"),
        "summary": "Resend connector diagnostics.",
        "runtime": {
            "implementation_mode": "live_read_write",
            "command_readiness": {
                "email.send": live,
                "email.batch_send": live,
                "domains.list": live,
                "domains.verify": live,
                "audiences.list": live,
                "audiences.create": live,
                "contacts.list": live and runtime["audience_id_present"],
                "contacts.create": live and runtime["audience_id_present"],
                "contacts.remove": live and runtime["audience_id_present"],
            },
            "from_email_present": runtime["from_email_present"],
            "audience_id_present": runtime["audience_id_present"],
            "domain_id_present": runtime["domain_id_present"],
        },
        "checks": [
            {"name": "required_env", "ok": runtime["api_key_present"]},
            {"name": "live_backend", "ok": live, "details": probe.get("details", {})},
        ],
        "supported_read_commands": [
            "domains.list",
            "audiences.list",
            "contacts.list",
        ],
        "supported_write_commands": [
            "email.send", "email.batch_send",
            "domains.verify",
            "audiences.create",
            "contacts.create", "contacts.remove",
        ],
        "next_steps": [
            f"Set {runtime['api_key_env']} in API Keys.",
            "Use domains.list to confirm verified sending domains.",
            "Pin RESEND_FROM_EMAIL before using email.send or email.batch_send.",
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

def email_send_result(ctx_obj: dict[str, Any], *, to: str, subject: str, html: str) -> dict[str, Any]:
    runtime = resolve_runtime_values(ctx_obj)
    from_email = _require_arg(runtime["from_email"], code="RESEND_FROM_REQUIRED", message="From email is required (set RESEND_FROM_EMAIL)", detail_key="env", detail_value=runtime["from_email_env"])
    client = create_client(ctx_obj)
    result = client.send_email(to=to, from_email=from_email, subject=subject, html=html)
    return {"status": "live_write", "backend": BACKEND_NAME, "summary": f"Email sent to {to}.", "result": result}


def email_batch_send_result(ctx_obj: dict[str, Any], *, to_list: list[str], subject: str, html: str) -> dict[str, Any]:
    runtime = resolve_runtime_values(ctx_obj)
    from_email = _require_arg(runtime["from_email"], code="RESEND_FROM_REQUIRED", message="From email is required (set RESEND_FROM_EMAIL)", detail_key="env", detail_value=runtime["from_email_env"])
    client = create_client(ctx_obj)
    emails = [{"from": from_email, "to": [addr], "subject": subject, "html": html} for addr in to_list]
    result = client.batch_send(emails=emails)
    return {"status": "live_write", "backend": BACKEND_NAME, "summary": f"Batch sent to {len(to_list)} recipient(s).", "result": result}


def email_create_draft_result(ctx_obj: dict[str, Any], *, to: str, subject: str, html: str) -> dict[str, Any]:
    runtime = resolve_runtime_values(ctx_obj)
    from_email = runtime["from_email"]
    draft = {
        "from": from_email,
        "to": [to],
        "subject": subject,
        "html": html,
    }
    return {
        "status": "local_preview",
        "backend": BACKEND_NAME,
        "summary": f"Prepared local Resend draft for {to}; no email was sent.",
        "draft": draft,
        "runtime_ready": bool(runtime["api_key"]),
        "missing_keys": [] if runtime["api_key"] else [runtime["api_key_env"]],
    }


# ── Domains ────────────────────────────────────────────────────

def domains_list_result(ctx_obj: dict[str, Any]) -> dict[str, Any]:
    client = create_client(ctx_obj)
    payload = client.list_domains()
    domains = payload.get("domains", [])
    items = [
        {"id": str(d.get("id", "")), "label": str(d.get("name", d.get("id", "Domain"))), "subtitle": d.get("status"), "kind": "domain"}
        for d in domains if isinstance(d, dict)
    ]
    return {
        "status": "live_read", "backend": BACKEND_NAME,
        "summary": f"Returned {len(domains)} Resend domain{'s' if len(domains) != 1 else ''}.",
        "domains": domains, "domain_count": len(domains),
        "picker": _picker(items, kind="domain"),
    }


def domains_verify_result(ctx_obj: dict[str, Any], *, domain_id: str | None) -> dict[str, Any]:
    runtime = resolve_runtime_values(ctx_obj)
    resolved = _require_arg(domain_id or runtime["domain_id"], code="RESEND_DOMAIN_REQUIRED", message="Domain ID is required", detail_key="env", detail_value=runtime["domain_id_env"])
    client = create_client(ctx_obj)
    result = client.verify_domain(resolved)
    return {"status": "live_write", "backend": BACKEND_NAME, "summary": f"Verification triggered for domain {resolved}.", "result": result}


# ── Audiences ──────────────────────────────────────────────────

def audiences_list_result(ctx_obj: dict[str, Any]) -> dict[str, Any]:
    client = create_client(ctx_obj)
    payload = client.list_audiences()
    audiences = payload.get("audiences", [])
    items = [
        {"id": str(a.get("id", "")), "label": str(a.get("name", a.get("id", "Audience"))), "kind": "audience"}
        for a in audiences if isinstance(a, dict)
    ]
    return {
        "status": "live_read", "backend": BACKEND_NAME,
        "summary": f"Returned {len(audiences)} Resend audience{'s' if len(audiences) != 1 else ''}.",
        "audiences": audiences, "audience_count": len(audiences),
        "picker": _picker(items, kind="audience"),
    }


def audiences_create_result(ctx_obj: dict[str, Any], *, name: str) -> dict[str, Any]:
    client = create_client(ctx_obj)
    result = client.create_audience(name=name)
    return {"status": "live_write", "backend": BACKEND_NAME, "summary": f"Audience '{name}' created.", "result": result}


# ── Contacts ───────────────────────────────────────────────────

def contacts_list_result(ctx_obj: dict[str, Any], *, audience_id: str | None) -> dict[str, Any]:
    runtime = resolve_runtime_values(ctx_obj)
    resolved = _require_arg(audience_id or runtime["audience_id"], code="RESEND_AUDIENCE_REQUIRED", message="Audience ID is required", detail_key="env", detail_value=runtime["audience_id_env"])
    client = create_client(ctx_obj)
    payload = client.list_contacts(audience_id=resolved)
    contacts = payload.get("contacts", [])
    items = [
        {"id": str(c.get("id", "")), "label": str(c.get("email", c.get("id", "Contact"))), "kind": "contact"}
        for c in contacts if isinstance(c, dict)
    ]
    return {
        "status": "live_read", "backend": BACKEND_NAME,
        "summary": f"Returned {len(contacts)} contact{'s' if len(contacts) != 1 else ''} in audience {resolved}.",
        "audience_id": resolved, "contacts": contacts, "contact_count": len(contacts),
        "picker": _picker(items, kind="contact"),
    }


def contacts_create_result(ctx_obj: dict[str, Any], *, audience_id: str | None, email: str, first_name: str | None, last_name: str | None) -> dict[str, Any]:
    runtime = resolve_runtime_values(ctx_obj)
    resolved = _require_arg(audience_id or runtime["audience_id"], code="RESEND_AUDIENCE_REQUIRED", message="Audience ID is required", detail_key="env", detail_value=runtime["audience_id_env"])
    client = create_client(ctx_obj)
    result = client.create_contact(audience_id=resolved, email=email, first_name=first_name, last_name=last_name)
    return {"status": "live_write", "backend": BACKEND_NAME, "summary": f"Contact {email} created in audience {resolved}.", "result": result}


def contacts_remove_result(ctx_obj: dict[str, Any], *, audience_id: str | None, contact_id: str) -> dict[str, Any]:
    runtime = resolve_runtime_values(ctx_obj)
    resolved = _require_arg(audience_id or runtime["audience_id"], code="RESEND_AUDIENCE_REQUIRED", message="Audience ID is required", detail_key="env", detail_value=runtime["audience_id_env"])
    client = create_client(ctx_obj)
    result = client.remove_contact(audience_id=resolved, contact_id=contact_id)
    return {"status": "live_write", "backend": BACKEND_NAME, "summary": f"Contact {contact_id} removed from audience {resolved}.", "result": result}
