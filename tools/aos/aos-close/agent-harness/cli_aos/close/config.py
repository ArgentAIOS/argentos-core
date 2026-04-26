from __future__ import annotations

from typing import Any

from .constants import (
    BACKEND_NAME,
    CLOSE_API_KEY_ENV,
    CLOSE_CONTACT_ID_ENV,
    CLOSE_LEAD_ID_ENV,
    CLOSE_OPPORTUNITY_ID_ENV,
)
from .service_keys import resolve_service_key, service_key_env


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
    opportunity_id_env = ctx_obj.get("opportunity_id_env") or CLOSE_OPPORTUNITY_ID_ENV

    service_key_value = (resolve_service_key(key_env) or "").strip() if key_env == CLOSE_API_KEY_ENV else ""
    env_value = (service_key_env(key_env, "") or "").strip()
    api_key = env_value
    if service_key_value:
        auth_source = "service_key"
    elif api_key:
        auth_source = "env"
    else:
        auth_source = "missing"

    lead_id = (service_key_env(lead_id_env, "") or "").strip()
    contact_id = (service_key_env(contact_id_env, "") or "").strip()
    opportunity_id = (service_key_env(opportunity_id_env, "") or "").strip()

    return {
        "backend": BACKEND_NAME,
        "key_env": key_env,
        "lead_id_env": lead_id_env,
        "contact_id_env": contact_id_env,
        "opportunity_id_env": opportunity_id_env,
        "api_key": api_key,
        "auth_source": auth_source,
        "lead_id": lead_id,
        "contact_id": contact_id,
        "opportunity_id": opportunity_id,
        "api_key_present": bool(api_key),
        "lead_id_present": bool(lead_id),
        "contact_id_present": bool(contact_id),
        "opportunity_id_present": bool(opportunity_id),
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
            "implementation_mode": "live_read_with_live_crm_writes_and_scaffolded_outreach",
            "live_read_available": live_ready,
            "write_bridge_available": live_ready,
            "probe": probe,
        },
        "auth": {
            "key_env": runtime["key_env"],
            "api_key_present": runtime["api_key_present"],
            "api_key_preview": _mask(runtime["api_key"]),
            "api_key_source": runtime["auth_source"],
        },
        "scope": {
            "workerFields": ["lead_id", "contact_id", "opportunity_id", "query", "status", "assignee"],
            "lead_id": runtime["lead_id"] or None,
            "contact_id": runtime["contact_id"] or None,
            "opportunity_id": runtime["opportunity_id"] or None,
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
            "lead.create": "live",
            "lead.update": "live",
            "contact.create": "live",
            "opportunity.create": "live",
            "activity.create": "live",
            "task.create": "live",
            "email.send": "scaffold_only",
            "sms.send": "scaffold_only",
            "call.create": "scaffold_only",
            "scaffold_only": False,
        },
    }
