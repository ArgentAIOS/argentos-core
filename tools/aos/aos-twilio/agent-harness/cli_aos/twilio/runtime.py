from __future__ import annotations

import json
import os
from .service_keys import service_key_env
from typing import Any

from .client import TwilioApiError, TwilioClient
from .config import config_snapshot, resolve_runtime_values
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
            "sms.list": True,
            "sms.read": True,
            "call.list": True,
            "call.status": True,
            "whatsapp.list": True,
            "lookup.phone": True,
        },
        "write_support": {
            "sms.send": True,
            "call.create": True,
            "whatsapp.send": True,
        },
    }


def create_client(ctx_obj: dict[str, Any]) -> TwilioClient:
    runtime = resolve_runtime_values(ctx_obj)
    missing: list[str] = []
    if not runtime["account_sid_present"]:
        missing.append(runtime["account_sid_env"])
    if not runtime["auth_token_present"]:
        missing.append(runtime["auth_token_env"])
    if missing:
        raise CliError(
            code="TWILIO_SETUP_REQUIRED",
            message="Twilio connector is missing required credentials",
            exit_code=4,
            details={"missing_keys": missing},
        )
    return TwilioClient(account_sid=runtime["account_sid"], auth_token=runtime["auth_token"])


def probe_runtime(ctx_obj: dict[str, Any]) -> dict[str, Any]:
    runtime = resolve_runtime_values(ctx_obj)
    if not runtime["credentials_present"]:
        missing: list[str] = []
        if not runtime["account_sid_present"]:
            missing.append(runtime["account_sid_env"])
        if not runtime["auth_token_present"]:
            missing.append(runtime["auth_token_env"])
        return {
            "ok": False,
            "code": "TWILIO_SETUP_REQUIRED",
            "message": "Twilio connector is missing required credentials",
            "details": {"missing_keys": missing, "live_backend_available": False},
        }
    try:
        client = create_client(ctx_obj)
        account = client.read_account()
    except CliError as err:
        return {"ok": False, "code": err.code, "message": err.message, "details": err.details}
    except TwilioApiError as err:
        code = "TWILIO_AUTH_FAILED" if err.status_code in {401, 403} else "TWILIO_API_ERROR"
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
        "message": "Twilio live runtime is ready",
        "details": {
            "live_backend_available": True,
            "account": account,
            "from_number": runtime["from_number"] or None,
        },
    }


def health_snapshot(ctx_obj: dict[str, Any]) -> dict[str, Any]:
    runtime = resolve_runtime_values(ctx_obj)
    probe = probe_runtime(ctx_obj)
    status = "ready" if probe["ok"] else ("needs_setup" if probe["code"] == "TWILIO_SETUP_REQUIRED" else "degraded")
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
            "account_sid_env": runtime["account_sid_env"],
            "account_sid_present": runtime["account_sid_present"],
            "auth_token_env": runtime["auth_token_env"],
            "auth_token_present": runtime["auth_token_present"],
        },
        "scope": {
            "from_number": runtime["from_number"] or None,
            "to_number": runtime["to_number"] or None,
        },
        "checks": [
            {
                "name": "required_env",
                "ok": runtime["credentials_present"],
                "details": {
                    "missing_keys": (
                        []
                        if runtime["credentials_present"]
                        else [k for k in [runtime["account_sid_env"], runtime["auth_token_env"]] if not service_key_env(k)]
                    )
                },
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
            f"Set {runtime['account_sid_env']} and {runtime['auth_token_env']} in API Keys.",
            f"Set {runtime['from_number_env']} to a Twilio phone number on the account.",
            "For WhatsApp, ensure the from number is WhatsApp-enabled or use the sandbox (+14155238886).",
        ],
    }


def doctor_snapshot(ctx_obj: dict[str, Any]) -> dict[str, Any]:
    runtime = resolve_runtime_values(ctx_obj)
    probe = probe_runtime(ctx_obj)
    return {
        "status": "ready" if probe.get("ok") else ("needs_setup" if probe.get("code") == "TWILIO_SETUP_REQUIRED" else "degraded"),
        "summary": "Twilio connector diagnostics.",
        "runtime": {
            "implementation_mode": "live_read_write",
            "command_readiness": {
                "sms.send": bool(probe.get("ok")) and runtime["from_number_present"],
                "sms.list": bool(probe.get("ok")),
                "sms.read": bool(probe.get("ok")),
                "call.create": bool(probe.get("ok")) and runtime["from_number_present"],
                "call.list": bool(probe.get("ok")),
                "call.status": bool(probe.get("ok")),
                "whatsapp.send": bool(probe.get("ok")) and runtime["from_number_present"],
                "whatsapp.list": bool(probe.get("ok")),
                "lookup.phone": bool(probe.get("ok")),
            },
            "from_number_present": runtime["from_number_present"],
            "to_number_present": runtime["to_number_present"],
        },
        "checks": [
            {"name": "required_env", "ok": runtime["credentials_present"]},
            {"name": "from_number", "ok": runtime["from_number_present"], "details": {"env": runtime["from_number_env"]}},
            {"name": "live_backend", "ok": bool(probe.get("ok")), "details": probe.get("details", {})},
        ],
        "supported_read_commands": [
            "sms.list",
            "sms.read",
            "call.list",
            "call.status",
            "whatsapp.list",
            "lookup.phone",
        ],
        "supported_write_commands": [
            "sms.send",
            "call.create",
            "whatsapp.send",
        ],
        "next_steps": [
            f"Set {runtime['account_sid_env']} and {runtime['auth_token_env']} in API Keys.",
            f"Set {runtime['from_number_env']} to enable send and call commands.",
            "Use health to confirm the live backend is reachable.",
        ],
    }


def _picker(items: list[dict[str, Any]], *, kind: str, label_key: str = "label") -> dict[str, Any]:
    return {"kind": kind, "items": items, "count": len(items), "label_key": label_key}


def _require_arg(value: str | None, *, code: str, message: str, detail_key: str, detail_value: str) -> str:
    resolved = (value or "").strip()
    if resolved:
        return resolved
    raise CliError(code=code, message=message, exit_code=4, details={detail_key: detail_value})


# ── SMS ──────────────────────────────────────────────────────────────

def sms_send_result(
    ctx_obj: dict[str, Any],
    *,
    from_number: str | None,
    to_number: str | None,
    body: str | None,
    status_callback: str | None,
) -> dict[str, Any]:
    runtime = resolve_runtime_values(ctx_obj)
    resolved_from = _require_arg(
        from_number or runtime["from_number"],
        code="TWILIO_FROM_REQUIRED",
        message="From number is required",
        detail_key="env",
        detail_value=runtime["from_number_env"],
    )
    resolved_to = _require_arg(
        to_number or runtime["to_number"],
        code="TWILIO_TO_REQUIRED",
        message="To number is required",
        detail_key="env",
        detail_value=runtime["to_number_env"],
    )
    resolved_body = _require_arg(
        body or runtime["message"],
        code="TWILIO_MESSAGE_REQUIRED",
        message="Message body is required",
        detail_key="env",
        detail_value=runtime["message_env"],
    )
    client = create_client(ctx_obj)
    msg = client.send_sms(
        from_number=resolved_from,
        to_number=resolved_to,
        body=resolved_body,
        status_callback=status_callback or runtime["status_callback"] or None,
    )
    return {
        "status": "live_write",
        "backend": BACKEND_NAME,
        "summary": f"Sent SMS from {resolved_from} to {resolved_to}.",
        "message": msg,
        "scope_preview": {
            "selection_surface": "sms",
            "command_id": "sms.send",
            "from_number": resolved_from,
            "to_number": resolved_to,
        },
    }


def sms_list_result(ctx_obj: dict[str, Any], *, limit: int) -> dict[str, Any]:
    runtime = resolve_runtime_values(ctx_obj)
    client = create_client(ctx_obj)
    payload = client.list_messages(limit=limit, from_number=runtime["from_number"] or None)
    messages = payload.get("messages", [])
    items = [
        {
            "id": str(m.get("sid") or ""),
            "label": f"{m.get('from', '?')} -> {m.get('to', '?')}",
            "subtitle": m.get("status") or m.get("date_sent"),
            "kind": "sms",
        }
        for m in messages
        if isinstance(m, dict)
    ]
    return {
        "status": "live_read",
        "backend": BACKEND_NAME,
        "summary": f"Returned {len(messages)} SMS message{'s' if len(messages) != 1 else ''}.",
        "messages": messages,
        "message_count": len(messages),
        "picker": _picker(items, kind="sms"),
        "scope_preview": {
            "selection_surface": "sms",
            "command_id": "sms.list",
            "from_number": runtime["from_number"] or None,
        },
    }


def sms_read_result(ctx_obj: dict[str, Any], message_sid: str | None) -> dict[str, Any]:
    resolved = _require_arg(
        message_sid,
        code="TWILIO_SID_REQUIRED",
        message="Message SID is required",
        detail_key="arg",
        detail_value="message_sid",
    )
    client = create_client(ctx_obj)
    msg = client.read_message(resolved)
    return {
        "status": "live_read",
        "backend": BACKEND_NAME,
        "summary": f"Read SMS {resolved}.",
        "message": msg,
        "scope_preview": {
            "selection_surface": "sms",
            "command_id": "sms.read",
            "message_sid": resolved,
        },
    }


# ── Voice Calls ──────────────────────────────────────────────────────

def call_create_result(
    ctx_obj: dict[str, Any],
    *,
    from_number: str | None,
    to_number: str | None,
    voice_url: str | None,
    status_callback: str | None,
) -> dict[str, Any]:
    runtime = resolve_runtime_values(ctx_obj)
    resolved_from = _require_arg(
        from_number or runtime["from_number"],
        code="TWILIO_FROM_REQUIRED",
        message="From number is required",
        detail_key="env",
        detail_value=runtime["from_number_env"],
    )
    resolved_to = _require_arg(
        to_number or runtime["to_number"],
        code="TWILIO_TO_REQUIRED",
        message="To number is required",
        detail_key="env",
        detail_value=runtime["to_number_env"],
    )
    resolved_url = voice_url or runtime["voice_url"] or None
    client = create_client(ctx_obj)
    call = client.create_call(
        from_number=resolved_from,
        to_number=resolved_to,
        voice_url=resolved_url if resolved_url and resolved_url.startswith(("http://", "https://")) else None,
        say_text=resolved_url if resolved_url and not resolved_url.startswith(("http://", "https://")) else None,
        status_callback=status_callback or runtime["status_callback"] or None,
    )
    return {
        "status": "live_write",
        "backend": BACKEND_NAME,
        "summary": f"Created call from {resolved_from} to {resolved_to}.",
        "call": call,
        "scope_preview": {
            "selection_surface": "call",
            "command_id": "call.create",
            "from_number": resolved_from,
            "to_number": resolved_to,
        },
    }


def call_list_result(ctx_obj: dict[str, Any], *, limit: int) -> dict[str, Any]:
    client = create_client(ctx_obj)
    payload = client.list_calls(limit=limit)
    calls = payload.get("calls", [])
    items = [
        {
            "id": str(c.get("sid") or ""),
            "label": f"{c.get('from', '?')} -> {c.get('to', '?')}",
            "subtitle": f"{c.get('status', '?')} ({c.get('duration', '?')}s)",
            "kind": "call",
        }
        for c in calls
        if isinstance(c, dict)
    ]
    return {
        "status": "live_read",
        "backend": BACKEND_NAME,
        "summary": f"Returned {len(calls)} call{'s' if len(calls) != 1 else ''}.",
        "calls": calls,
        "call_count": len(calls),
        "picker": _picker(items, kind="call"),
        "scope_preview": {
            "selection_surface": "call",
            "command_id": "call.list",
        },
    }


def call_status_result(ctx_obj: dict[str, Any], call_sid: str | None) -> dict[str, Any]:
    resolved = _require_arg(
        call_sid,
        code="TWILIO_SID_REQUIRED",
        message="Call SID is required",
        detail_key="arg",
        detail_value="call_sid",
    )
    client = create_client(ctx_obj)
    call = client.get_call(resolved)
    return {
        "status": "live_read",
        "backend": BACKEND_NAME,
        "summary": f"Call {resolved} status: {call.get('status', 'unknown')}.",
        "call": call,
        "scope_preview": {
            "selection_surface": "call",
            "command_id": "call.status",
            "call_sid": resolved,
        },
    }


# ── WhatsApp ─────────────────────────────────────────────────────────

def whatsapp_send_result(
    ctx_obj: dict[str, Any],
    *,
    from_number: str | None,
    to_number: str | None,
    body: str | None,
    status_callback: str | None,
) -> dict[str, Any]:
    runtime = resolve_runtime_values(ctx_obj)
    resolved_from = _require_arg(
        from_number or runtime["from_number"],
        code="TWILIO_FROM_REQUIRED",
        message="From number is required",
        detail_key="env",
        detail_value=runtime["from_number_env"],
    )
    resolved_to = _require_arg(
        to_number or runtime["to_number"],
        code="TWILIO_TO_REQUIRED",
        message="To number is required",
        detail_key="env",
        detail_value=runtime["to_number_env"],
    )
    resolved_body = _require_arg(
        body or runtime["message"],
        code="TWILIO_MESSAGE_REQUIRED",
        message="Message body is required",
        detail_key="env",
        detail_value=runtime["message_env"],
    )
    client = create_client(ctx_obj)
    msg = client.send_whatsapp(
        from_number=resolved_from,
        to_number=resolved_to,
        body=resolved_body,
        status_callback=status_callback or runtime["status_callback"] or None,
    )
    return {
        "status": "live_write",
        "backend": BACKEND_NAME,
        "summary": f"Sent WhatsApp from {resolved_from} to {resolved_to}.",
        "message": msg,
        "scope_preview": {
            "selection_surface": "whatsapp",
            "command_id": "whatsapp.send",
            "from_number": resolved_from,
            "to_number": resolved_to,
        },
    }


def whatsapp_list_result(ctx_obj: dict[str, Any], *, limit: int) -> dict[str, Any]:
    runtime = resolve_runtime_values(ctx_obj)
    client = create_client(ctx_obj)
    payload = client.list_whatsapp_messages(limit=limit, from_number=runtime["from_number"] or None)
    messages = payload.get("messages", [])
    items = [
        {
            "id": str(m.get("sid") or ""),
            "label": f"{m.get('from', '?')} -> {m.get('to', '?')}",
            "subtitle": m.get("status") or m.get("date_sent"),
            "kind": "whatsapp",
        }
        for m in messages
        if isinstance(m, dict)
    ]
    return {
        "status": "live_read",
        "backend": BACKEND_NAME,
        "summary": f"Returned {len(messages)} WhatsApp message{'s' if len(messages) != 1 else ''}.",
        "messages": messages,
        "message_count": len(messages),
        "picker": _picker(items, kind="whatsapp"),
        "scope_preview": {
            "selection_surface": "whatsapp",
            "command_id": "whatsapp.list",
            "from_number": runtime["from_number"] or None,
        },
    }


# ── Lookup ───────────────────────────────────────────────────────────

def lookup_phone_result(ctx_obj: dict[str, Any], phone_number: str | None) -> dict[str, Any]:
    runtime = resolve_runtime_values(ctx_obj)
    resolved = _require_arg(
        phone_number or runtime["to_number"],
        code="TWILIO_PHONE_REQUIRED",
        message="Phone number is required for lookup",
        detail_key="env",
        detail_value=runtime["to_number_env"],
    )
    client = create_client(ctx_obj)
    info = client.lookup_phone(resolved)
    return {
        "status": "live_read",
        "backend": BACKEND_NAME,
        "summary": f"Looked up {resolved}: {info.get('carrier_type', 'unknown')} ({info.get('carrier_name', 'unknown')}).",
        "lookup": info,
        "scope_preview": {
            "selection_surface": "lookup",
            "command_id": "lookup.phone",
            "phone_number": resolved,
        },
    }
