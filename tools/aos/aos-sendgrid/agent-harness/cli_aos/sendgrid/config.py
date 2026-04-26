from __future__ import annotations

import os
from .service_keys import service_key_env
from typing import Any

from .constants import (
    BACKEND_NAME,
    SENDGRID_API_KEY_ENV,
    SENDGRID_FROM_EMAIL_ENV,
    SENDGRID_LIST_ID_ENV,
    SENDGRID_TEMPLATE_ID_ENV,
)


def _mask(value: str | None) -> str | None:
    if not value:
        return None
    if len(value) <= 8:
        return "*" * len(value)
    return f"{value[:4]}***{value[-4:]}"


def resolve_runtime_values(ctx_obj: dict[str, Any]) -> dict[str, Any]:
    api_key_env = ctx_obj.get("api_key_env") or SENDGRID_API_KEY_ENV
    from_email_env = ctx_obj.get("from_email_env") or SENDGRID_FROM_EMAIL_ENV
    template_id_env = ctx_obj.get("template_id_env") or SENDGRID_TEMPLATE_ID_ENV
    list_id_env = ctx_obj.get("list_id_env") or SENDGRID_LIST_ID_ENV

    api_key = (service_key_env(api_key_env) or "").strip()
    from_email = (service_key_env(from_email_env) or "").strip()
    template_id = (service_key_env(template_id_env) or "").strip()
    list_id = (service_key_env(list_id_env) or "").strip()

    return {
        "backend": BACKEND_NAME,
        "api_key_env": api_key_env,
        "from_email_env": from_email_env,
        "template_id_env": template_id_env,
        "list_id_env": list_id_env,
        "api_key": api_key,
        "from_email": from_email,
        "template_id": template_id,
        "list_id": list_id,
        "api_key_present": bool(api_key),
        "from_email_present": bool(from_email),
        "template_id_present": bool(template_id),
        "list_id_present": bool(list_id),
    }


def config_snapshot(ctx_obj: dict[str, Any]) -> dict[str, Any]:
    runtime = resolve_runtime_values(ctx_obj)
    live_ready = runtime["api_key_present"]
    from .runtime import probe_runtime

    probe = probe_runtime(ctx_obj) if live_ready else {
        "ok": False,
        "code": "SKIPPED",
        "message": "SendGrid probe skipped until SENDGRID_API_KEY is configured",
        "details": {"skipped": True},
    }
    return {
        "summary": "SendGrid connector configuration snapshot.",
        "backend": BACKEND_NAME,
        "runtime": {
            "implementation_mode": "live_read_write",
            "live_read_available": runtime["api_key_present"],
            "write_bridge_available": runtime["api_key_present"],
            "probe": probe,
        },
        "auth": {
            "api_key_env": runtime["api_key_env"],
            "api_key_present": runtime["api_key_present"],
            "api_key_preview": _mask(runtime["api_key"]),
        },
        "scope": {
            "workerFields": ["to", "from", "subject", "body", "template_id"],
            "from_email": runtime["from_email"] or None,
            "template_id": runtime["template_id"] or None,
            "list_id": runtime["list_id"] or None,
        },
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
