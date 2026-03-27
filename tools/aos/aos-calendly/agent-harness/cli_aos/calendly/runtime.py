from __future__ import annotations

import json
from typing import Any

from .client import CalendlyApiError, CalendlyClient
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
            "events.list": True,
            "events.get": True,
            "event_types.list": True,
            "event_types.get": True,
            "invitees.list": True,
            "availability.get": True,
        },
        "write_support": {
            "events.cancel": "scaffold_only",
            "scheduling_links.create": "scaffold_only",
        },
    }


def create_client(ctx_obj: dict[str, Any]) -> CalendlyClient:
    runtime = resolve_runtime_values(ctx_obj)
    if not runtime["api_key_present"]:
        raise CliError(
            code="CALENDLY_SETUP_REQUIRED",
            message="Calendly connector is missing the required API key",
            exit_code=4,
            details={"missing_keys": [runtime["api_key_env"]]},
        )
    return CalendlyClient(api_key=runtime["api_key"])


def _get_user_uri(ctx_obj: dict[str, Any]) -> str:
    client = create_client(ctx_obj)
    user = client.get_current_user()
    uri = user.get("uri")
    if not uri:
        raise CliError(
            code="CALENDLY_USER_NOT_FOUND",
            message="Could not resolve Calendly user URI",
            exit_code=5,
            details={"user": user},
        )
    return uri


def probe_runtime(ctx_obj: dict[str, Any]) -> dict[str, Any]:
    runtime = resolve_runtime_values(ctx_obj)
    if not runtime["api_key_present"]:
        return {
            "ok": False,
            "code": "CALENDLY_SETUP_REQUIRED",
            "message": "Calendly connector is missing the required API key",
            "details": {"missing_keys": [runtime["api_key_env"]], "live_backend_available": False},
        }
    try:
        client = create_client(ctx_obj)
        user = client.get_current_user()
    except CliError as err:
        return {"ok": False, "code": err.code, "message": err.message, "details": err.details}
    except CalendlyApiError as err:
        code = "CALENDLY_AUTH_FAILED" if err.status_code in {401, 403} else "CALENDLY_API_ERROR"
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
        "message": "Calendly live read runtime is ready",
        "details": {
            "live_backend_available": True,
            "user": user,
        },
    }


def health_snapshot(ctx_obj: dict[str, Any]) -> dict[str, Any]:
    runtime = resolve_runtime_values(ctx_obj)
    probe = probe_runtime(ctx_obj)
    status = "ready" if probe["ok"] else ("needs_setup" if probe["code"] == "CALENDLY_SETUP_REQUIRED" else "degraded")
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
            "api_key_env": runtime["api_key_env"],
            "api_key_present": runtime["api_key_present"],
        },
        "scope": {
            "event_type_uuid": runtime["event_type_uuid"] or None,
            "event_uuid": runtime["event_uuid"] or None,
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
        "probe": probe,
        "next_steps": [
            f"Set {runtime['api_key_env']} to a Calendly personal access token.",
            "Optionally pin CALENDLY_EVENT_TYPE_UUID to stabilize event type scope.",
        ],
    }


def doctor_snapshot(ctx_obj: dict[str, Any]) -> dict[str, Any]:
    runtime = resolve_runtime_values(ctx_obj)
    probe = probe_runtime(ctx_obj)
    return {
        "status": "ready" if probe.get("ok") else ("needs_setup" if probe.get("code") == "CALENDLY_SETUP_REQUIRED" else "degraded"),
        "summary": "Calendly connector diagnostics.",
        "runtime": {
            "implementation_mode": "live_read_with_scaffolded_writes",
            "command_readiness": {
                "events.list": bool(probe.get("ok")),
                "events.get": bool(probe.get("ok")),
                "events.cancel": False,
                "event_types.list": bool(probe.get("ok")),
                "event_types.get": bool(probe.get("ok")),
                "invitees.list": bool(probe.get("ok")),
                "availability.get": bool(probe.get("ok")),
                "scheduling_links.create": False,
            },
            "event_type_uuid_present": runtime["event_type_uuid_present"],
            "event_uuid_present": runtime["event_uuid_present"],
        },
        "checks": [
            {"name": "required_env", "ok": runtime["api_key_present"]},
            {"name": "live_backend", "ok": bool(probe.get("ok")), "details": probe.get("details", {})},
            {"name": "write_commands", "ok": True, "details": {"mode": "scaffold_only"}},
        ],
        "supported_read_commands": [
            "events.list",
            "events.get",
            "event_types.list",
            "event_types.get",
            "invitees.list",
            "availability.get",
        ],
        "scaffolded_commands": ["events.cancel", "scheduling_links.create"],
        "next_steps": [
            f"Set {runtime['api_key_env']} to a Calendly personal access token.",
            "Use event_types.list to discover available event types before scoping workers.",
            "Decide whether events.cancel and scheduling_links.create should gain a write bridge.",
        ],
    }


def _picker(items: list[dict[str, Any]], *, kind: str, label_key: str = "label") -> dict[str, Any]:
    return {"kind": kind, "items": items, "count": len(items), "label_key": label_key}


def event_types_list_result(ctx_obj: dict[str, Any], *, limit: int) -> dict[str, Any]:
    user_uri = _get_user_uri(ctx_obj)
    client = create_client(ctx_obj)
    payload = client.list_event_types(user_uri=user_uri, count=limit)
    event_types = payload.get("event_types", [])
    items = [
        {
            "id": str(item.get("uri") or ""),
            "label": str(item.get("name") or item.get("slug") or "Event Type"),
            "subtitle": f"{item.get('duration_minutes') or '?'}min, {'active' if item.get('active') else 'inactive'}",
            "kind": "event_type",
        }
        for item in event_types
        if isinstance(item, dict)
    ]
    return {
        "status": "live_read",
        "backend": BACKEND_NAME,
        "summary": f"Returned {len(event_types)} Calendly event type{'s' if len(event_types) != 1 else ''}.",
        "event_types": event_types,
        "event_type_count": len(event_types),
        "picker": _picker(items, kind="event_type"),
        "scope_preview": {
            "selection_surface": "event_type",
            "command_id": "event_types.list",
        },
    }


def event_types_get_result(ctx_obj: dict[str, Any], uuid: str | None) -> dict[str, Any]:
    runtime = resolve_runtime_values(ctx_obj)
    resolved = (uuid or runtime["event_type_uuid"] or "").strip()
    if not resolved:
        raise CliError(
            code="CALENDLY_EVENT_TYPE_REQUIRED",
            message="Event type UUID is required",
            exit_code=4,
            details={"env": runtime["event_type_uuid_env"]},
        )
    client = create_client(ctx_obj)
    event_type = client.get_event_type(resolved)
    return {
        "status": "live_read",
        "backend": BACKEND_NAME,
        "summary": f"Read Calendly event type {resolved}.",
        "event_type": event_type,
        "scope_preview": {
            "selection_surface": "event_type",
            "command_id": "event_types.get",
            "event_type_uuid": resolved,
        },
    }


def events_list_result(
    ctx_obj: dict[str, Any],
    *,
    limit: int,
    start_time: str | None = None,
    end_time: str | None = None,
    status: str | None = None,
) -> dict[str, Any]:
    user_uri = _get_user_uri(ctx_obj)
    client = create_client(ctx_obj)
    payload = client.list_events(
        user_uri=user_uri,
        count=limit,
        min_start_time=start_time,
        max_start_time=end_time,
        status=status,
    )
    events = payload.get("events", [])
    items = [
        {
            "id": str(item.get("uri") or ""),
            "label": str(item.get("name") or "Event"),
            "subtitle": f"{item.get('start_time') or '?'} — {item.get('status') or 'unknown'}",
            "kind": "event",
        }
        for item in events
        if isinstance(item, dict)
    ]
    return {
        "status": "live_read",
        "backend": BACKEND_NAME,
        "summary": f"Returned {len(events)} Calendly event{'s' if len(events) != 1 else ''}.",
        "events": events,
        "event_count": len(events),
        "picker": _picker(items, kind="event"),
        "scope_preview": {
            "selection_surface": "event",
            "command_id": "events.list",
        },
    }


def events_get_result(ctx_obj: dict[str, Any], uuid: str | None) -> dict[str, Any]:
    runtime = resolve_runtime_values(ctx_obj)
    resolved = (uuid or runtime["event_uuid"] or "").strip()
    if not resolved:
        raise CliError(
            code="CALENDLY_EVENT_REQUIRED",
            message="Event UUID is required",
            exit_code=4,
            details={"env": runtime["event_uuid_env"]},
        )
    client = create_client(ctx_obj)
    event = client.get_event(resolved)
    return {
        "status": "live_read",
        "backend": BACKEND_NAME,
        "summary": f"Read Calendly event {resolved}.",
        "event": event,
        "scope_preview": {
            "selection_surface": "event",
            "command_id": "events.get",
            "event_uuid": resolved,
        },
    }


def invitees_list_result(ctx_obj: dict[str, Any], event_uuid: str | None, *, limit: int, email: str | None = None) -> dict[str, Any]:
    runtime = resolve_runtime_values(ctx_obj)
    resolved = (event_uuid or runtime["event_uuid"] or "").strip()
    if not resolved:
        raise CliError(
            code="CALENDLY_EVENT_REQUIRED",
            message="Event UUID is required to list invitees",
            exit_code=4,
            details={"env": runtime["event_uuid_env"]},
        )
    client = create_client(ctx_obj)
    payload = client.list_invitees(resolved, count=limit, email=email)
    invitees = payload.get("invitees", [])
    items = [
        {
            "id": str(item.get("uri") or ""),
            "label": str(item.get("name") or item.get("email") or "Invitee"),
            "subtitle": item.get("email") or item.get("status") or None,
            "kind": "invitee",
        }
        for item in invitees
        if isinstance(item, dict)
    ]
    return {
        "status": "live_read",
        "backend": BACKEND_NAME,
        "summary": f"Returned {len(invitees)} invitee{'s' if len(invitees) != 1 else ''}.",
        "event_uuid": resolved,
        "invitees": invitees,
        "invitee_count": len(invitees),
        "picker": _picker(items, kind="invitee"),
        "scope_preview": {
            "selection_surface": "invitee",
            "command_id": "invitees.list",
            "event_uuid": resolved,
        },
    }


def availability_get_result(ctx_obj: dict[str, Any], event_type_uuid: str | None, *, start_time: str | None = None, end_time: str | None = None) -> dict[str, Any]:
    runtime = resolve_runtime_values(ctx_obj)
    resolved = (event_type_uuid or runtime["event_type_uuid"] or "").strip()
    if not resolved:
        raise CliError(
            code="CALENDLY_EVENT_TYPE_REQUIRED",
            message="Event type UUID is required for availability lookup",
            exit_code=4,
            details={"env": runtime["event_type_uuid_env"]},
        )
    client = create_client(ctx_obj)
    payload = client.get_availability(resolved, start_time=start_time, end_time=end_time)
    return {
        "status": "live_read",
        "backend": BACKEND_NAME,
        "summary": f"Returned {payload.get('slot_count', 0)} available slot{'s' if payload.get('slot_count', 0) != 1 else ''}.",
        "event_type_uuid": resolved,
        "slots": payload.get("slots", []),
        "slot_count": payload.get("slot_count", 0),
        "scope_preview": {
            "selection_surface": "availability",
            "command_id": "availability.get",
            "event_type_uuid": resolved,
        },
    }


def scaffold_write_result(ctx_obj: dict[str, Any], *, command_id: str, inputs: dict[str, Any]) -> dict[str, Any]:
    runtime = resolve_runtime_values(ctx_obj)
    return {
        "status": "scaffold_write_only",
        "backend": BACKEND_NAME,
        "summary": f"{command_id} is scaffolded and does not perform live Calendly writes yet.",
        "command": command_id,
        "inputs": inputs,
        "scope_preview": {
            "selection_surface": "event",
            "event_type_uuid": runtime["event_type_uuid"] or None,
            "event_uuid": runtime["event_uuid"] or None,
        },
        "next_step": "Keep Calendly write actions disabled until approval and safety rules are defined.",
    }
