from __future__ import annotations

import os
from .service_keys import service_key_env
from typing import Any

from .constants import (
    BACKEND_NAME,
    TWILIO_ACCOUNT_SID_ENV,
    TWILIO_AUTH_TOKEN_ENV,
    TWILIO_FROM_NUMBER_ENV,
    TWILIO_MESSAGE_ENV,
    TWILIO_STATUS_CALLBACK_ENV,
    TWILIO_TO_NUMBER_ENV,
    TWILIO_VOICE_URL_ENV,
)


def _mask(value: str | None) -> str | None:
    if not value:
        return None
    if len(value) <= 8:
        return "*" * len(value)
    return f"{value[:4]}***{value[-4:]}"


def _picker_candidate(
    *,
    value: str | None,
    label: str,
    subtitle: str | None = None,
    selected: bool = False,
    kind: str | None = None,
) -> dict[str, Any]:
    candidate: dict[str, Any] = {
        "value": value,
        "label": label,
        "selected": selected,
    }
    if subtitle:
        candidate["subtitle"] = subtitle
    if kind:
        candidate["kind"] = kind
    return candidate


def _picker_source(
    *,
    command: str,
    resource: str,
    available: bool,
    kind: str,
    selected: dict[str, Any] | None = None,
) -> dict[str, Any]:
    picker: dict[str, Any] = {
        "mode": "live_read",
        "command": command,
        "resource": resource,
        "available": available,
        "kind": kind,
    }
    if selected is not None:
        picker["selected"] = selected
    return picker


def _scope_picker_preview(
    *,
    surface: str,
    kind: str,
    ready: bool,
    requirements: list[str],
    candidates: list[dict[str, Any]],
    selected: dict[str, Any],
    pickers: dict[str, dict[str, Any]],
) -> dict[str, Any]:
    return {
        "surface": surface,
        "kind": kind,
        "ready": ready,
        "requirements": requirements,
        "mode": "live_read",
        "pickers": pickers,
        "candidates": candidates,
        "selected": selected,
    }


def resolve_runtime_values(ctx_obj: dict[str, Any]) -> dict[str, Any]:
    account_sid_env = ctx_obj.get("account_sid_env") or TWILIO_ACCOUNT_SID_ENV
    auth_token_env = ctx_obj.get("auth_token_env") or TWILIO_AUTH_TOKEN_ENV
    from_number_env = ctx_obj.get("from_number_env") or TWILIO_FROM_NUMBER_ENV
    to_number_env = ctx_obj.get("to_number_env") or TWILIO_TO_NUMBER_ENV
    message_env = ctx_obj.get("message_env") or TWILIO_MESSAGE_ENV
    voice_url_env = ctx_obj.get("voice_url_env") or TWILIO_VOICE_URL_ENV
    status_callback_env = ctx_obj.get("status_callback_env") or TWILIO_STATUS_CALLBACK_ENV

    account_sid = (service_key_env(account_sid_env) or "").strip()
    auth_token = (service_key_env(auth_token_env) or "").strip()
    from_number = (service_key_env(from_number_env) or "").strip()
    to_number = (service_key_env(to_number_env) or "").strip()
    message = (service_key_env(message_env) or "").strip()
    voice_url = (service_key_env(voice_url_env) or "").strip()
    status_callback = (service_key_env(status_callback_env) or "").strip()

    return {
        "backend": BACKEND_NAME,
        "account_sid_env": account_sid_env,
        "auth_token_env": auth_token_env,
        "from_number_env": from_number_env,
        "to_number_env": to_number_env,
        "message_env": message_env,
        "voice_url_env": voice_url_env,
        "status_callback_env": status_callback_env,
        "account_sid": account_sid,
        "auth_token": auth_token,
        "from_number": from_number,
        "to_number": to_number,
        "message": message,
        "voice_url": voice_url,
        "status_callback": status_callback,
        "account_sid_present": bool(account_sid),
        "auth_token_present": bool(auth_token),
        "from_number_present": bool(from_number),
        "to_number_present": bool(to_number),
        "credentials_present": bool(account_sid and auth_token),
    }


def config_snapshot(ctx_obj: dict[str, Any]) -> dict[str, Any]:
    runtime = resolve_runtime_values(ctx_obj)
    live_ready = runtime["credentials_present"]
    command_defaults = {
        "sms.send": {
            "selection_surface": "sms",
            "args": [runtime["from_number"] or runtime["from_number_env"], runtime["to_number"] or runtime["to_number_env"]],
            "message": runtime["message"] or runtime["message_env"],
        },
        "sms.list": {
            "selection_surface": "sms",
            "limit": 20,
        },
        "sms.read": {
            "selection_surface": "sms",
            "args": ["TWILIO_MESSAGE_SID"],
        },
        "call.create": {
            "selection_surface": "call",
            "args": [runtime["from_number"] or runtime["from_number_env"], runtime["to_number"] or runtime["to_number_env"]],
            "voice_url": runtime["voice_url"] or runtime["voice_url_env"],
        },
        "call.list": {
            "selection_surface": "call",
            "limit": 20,
        },
        "call.status": {
            "selection_surface": "call",
            "args": ["TWILIO_CALL_SID"],
        },
        "whatsapp.send": {
            "selection_surface": "whatsapp",
            "args": [runtime["from_number"] or runtime["from_number_env"], runtime["to_number"] or runtime["to_number_env"]],
            "message": runtime["message"] or runtime["message_env"],
        },
        "whatsapp.list": {
            "selection_surface": "whatsapp",
            "limit": 20,
        },
        "lookup.phone": {
            "selection_surface": "lookup",
            "args": [runtime["to_number"] or runtime["to_number_env"]],
        },
    }
    picker_scopes = {
        "sms": _scope_picker_preview(
            surface="sms",
            kind="sms_scope",
            ready=live_ready,
            requirements=[runtime["account_sid_env"], runtime["auth_token_env"]],
            pickers={
                "sms": _picker_source(
                    command="sms.list",
                    resource="message",
                    available=live_ready,
                    kind="sms",
                    selected={"from_number": runtime["from_number"] or None},
                ),
            },
            candidates=[
                _picker_candidate(
                    value=runtime["from_number"] or None,
                    label=runtime["from_number"] or "(unset from number)",
                    subtitle="SMS sender",
                    selected=runtime["from_number_present"],
                    kind="sms",
                ),
            ],
            selected={"from_number": runtime["from_number"] or None},
        ),
        "call": _scope_picker_preview(
            surface="call",
            kind="call_scope",
            ready=live_ready,
            requirements=[runtime["account_sid_env"], runtime["auth_token_env"]],
            pickers={
                "call": _picker_source(
                    command="call.list",
                    resource="call",
                    available=live_ready,
                    kind="call",
                    selected={"from_number": runtime["from_number"] or None},
                ),
            },
            candidates=[
                _picker_candidate(
                    value=runtime["from_number"] or None,
                    label=runtime["from_number"] or "(unset from number)",
                    subtitle="Voice caller ID",
                    selected=runtime["from_number_present"],
                    kind="call",
                ),
            ],
            selected={"from_number": runtime["from_number"] or None},
        ),
        "whatsapp": _scope_picker_preview(
            surface="whatsapp",
            kind="whatsapp_scope",
            ready=live_ready,
            requirements=[runtime["account_sid_env"], runtime["auth_token_env"]],
            pickers={
                "whatsapp": _picker_source(
                    command="whatsapp.list",
                    resource="whatsapp_message",
                    available=live_ready,
                    kind="whatsapp",
                    selected={"from_number": runtime["from_number"] or None},
                ),
            },
            candidates=[
                _picker_candidate(
                    value=runtime["from_number"] or None,
                    label=runtime["from_number"] or "(unset from number)",
                    subtitle="WhatsApp sender",
                    selected=runtime["from_number_present"],
                    kind="whatsapp",
                ),
            ],
            selected={"from_number": runtime["from_number"] or None},
        ),
        "lookup": _scope_picker_preview(
            surface="lookup",
            kind="lookup_scope",
            ready=live_ready,
            requirements=[runtime["account_sid_env"], runtime["auth_token_env"]],
            pickers={
                "lookup": _picker_source(
                    command="lookup.phone",
                    resource="phone_number",
                    available=live_ready,
                    kind="lookup",
                ),
            },
            candidates=[],
            selected={},
        ),
    }
    from .runtime import probe_runtime

    probe = probe_runtime(ctx_obj) if runtime["credentials_present"] else {
        "ok": False,
        "code": "SKIPPED",
        "message": "Twilio probe skipped until TWILIO_ACCOUNT_SID and TWILIO_AUTH_TOKEN are configured",
        "details": {"skipped": True},
    }
    return {
        "summary": "Twilio connector configuration snapshot.",
        "backend": BACKEND_NAME,
        "runtime": {
            "implementation_mode": "live_read_write",
            "live_read_available": runtime["credentials_present"],
            "write_bridge_available": runtime["credentials_present"],
            "command_defaults": command_defaults,
            "picker_scopes": picker_scopes,
            "probe": probe,
        },
        "auth": {
            "account_sid_env": runtime["account_sid_env"],
            "account_sid_present": runtime["account_sid_present"],
            "account_sid_preview": _mask(runtime["account_sid"]),
            "auth_token_env": runtime["auth_token_env"],
            "auth_token_present": runtime["auth_token_present"],
            "auth_token_preview": _mask(runtime["auth_token"]),
        },
        "scope": {
            "workerFields": ["from_number", "to_number", "message", "voice_url"],
            "from_number": runtime["from_number"] or None,
            "to_number": runtime["to_number"] or None,
            "commandDefaults": command_defaults,
            "pickerHints": {
                "sms": {
                    "kind": "sms",
                    "selection_surface": "sms",
                    "resource": "twilio.message",
                    "source_command": "sms.list",
                    "source_fields": ["sid", "from", "to", "body", "status", "date_sent", "direction"],
                },
                "call": {
                    "kind": "call",
                    "selection_surface": "call",
                    "resource": "twilio.call",
                    "source_command": "call.list",
                    "source_fields": ["sid", "from", "to", "status", "start_time", "duration", "direction"],
                },
                "whatsapp": {
                    "kind": "whatsapp",
                    "selection_surface": "whatsapp",
                    "resource": "twilio.whatsapp_message",
                    "source_command": "whatsapp.list",
                    "source_fields": ["sid", "from", "to", "body", "status", "date_sent"],
                },
                "lookup": {
                    "kind": "lookup",
                    "selection_surface": "lookup",
                    "resource": "twilio.phone_number",
                    "source_command": "lookup.phone",
                    "source_fields": ["phone_number", "country_code", "carrier", "caller_name", "line_type"],
                },
            },
        },
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
