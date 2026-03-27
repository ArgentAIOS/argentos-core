from __future__ import annotations

import os
from typing import Any

from .constants import (
    BACKEND_NAME,
    CLOSE_API_KEY_ENV,
    CLOSE_CONTACT_ID_ENV,
    CLOSE_LEAD_ID_ENV,
)


def _mask(value: str | None) -> str | None:
    if not value:
        return None
    if len(value) <= 8:
        return "*" * len(value)
    return f"{value[:4]}***{value[-4:]}"


def resolve_runtime_values(ctx_obj: dict[str, Any]) -> dict[str, Any]:
    key_env = ctx_obj.get("key_env") or CLOSE_API_KEY_ENV
    lead_id_env = ctx_obj.get("lead_id_env") or CLOSE_LEAD_ID_ENV
    contact_id_env = ctx_obj.get("contact_id_env") or CLOSE_CONTACT_ID_ENV

    api_key = (os.getenv(key_env) or "").strip()
    lead_id = (os.getenv(lead_id_env) or "").strip()
    contact_id = (os.getenv(contact_id_env) or "").strip()

    return {
        "backend": BACKEND_NAME,
        "key_env": key_env,
        "lead_id_env": lead_id_env,
        "contact_id_env": contact_id_env,
        "api_key": api_key,
        "lead_id": lead_id,
        "contact_id": contact_id,
        "api_key_present": bool(api_key),
        "lead_id_present": bool(lead_id),
        "contact_id_present": bool(contact_id),
    }


def config_snapshot(ctx_obj: dict[str, Any]) -> dict[str, Any]:
    runtime = resolve_runtime_values(ctx_obj)
    live_ready = runtime["api_key_present"]

    from .runtime import probe_runtime

    probe = probe_runtime(ctx_obj) if live_ready else {
        "ok": False,
        "code": "SKIPPED",
        "message": "Close probe skipped until CLOSE_API_KEY is configured",
        "details": {"skipped": True},
    }
    return {
        "summary": "Close connector configuration snapshot.",
        "backend": BACKEND_NAME,
        "runtime": {
            "implementation_mode": "live_read_with_scaffolded_writes",
            "live_read_available": live_ready,
            "write_bridge_available": False,
            "probe": probe,
        },
        "auth": {
            "key_env": runtime["key_env"],
            "api_key_present": runtime["api_key_present"],
            "api_key_preview": _mask(runtime["api_key"]),
        },
        "scope": {
            "workerFields": ["lead_id", "contact_id", "query", "status", "assignee"],
            "lead_id": runtime["lead_id"] or None,
            "contact_id": runtime["contact_id"] or None,
        },
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
            "scaffold_only": True,
        },
    }
