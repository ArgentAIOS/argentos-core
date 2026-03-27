from __future__ import annotations

import os
from typing import Any

from .constants import (
    BACKEND_NAME,
    RESEND_API_KEY_ENV,
    RESEND_AUDIENCE_ID_ENV,
    RESEND_DOMAIN_ID_ENV,
    RESEND_FROM_EMAIL_ENV,
)


def _mask(value: str | None) -> str | None:
    if not value:
        return None
    if len(value) <= 8:
        return "*" * len(value)
    return f"{value[:4]}***{value[-4:]}"


def resolve_runtime_values(ctx_obj: dict[str, Any]) -> dict[str, Any]:
    api_key_env = ctx_obj.get("api_key_env") or RESEND_API_KEY_ENV
    from_email_env = ctx_obj.get("from_email_env") or RESEND_FROM_EMAIL_ENV
    audience_id_env = ctx_obj.get("audience_id_env") or RESEND_AUDIENCE_ID_ENV
    domain_id_env = ctx_obj.get("domain_id_env") or RESEND_DOMAIN_ID_ENV

    api_key = (os.getenv(api_key_env) or "").strip()
    from_email = (os.getenv(from_email_env) or "").strip()
    audience_id = (os.getenv(audience_id_env) or "").strip()
    domain_id = (os.getenv(domain_id_env) or "").strip()

    return {
        "backend": BACKEND_NAME,
        "api_key_env": api_key_env,
        "from_email_env": from_email_env,
        "audience_id_env": audience_id_env,
        "domain_id_env": domain_id_env,
        "api_key": api_key,
        "from_email": from_email,
        "audience_id": audience_id,
        "domain_id": domain_id,
        "api_key_present": bool(api_key),
        "from_email_present": bool(from_email),
        "audience_id_present": bool(audience_id),
        "domain_id_present": bool(domain_id),
    }


def config_snapshot(ctx_obj: dict[str, Any]) -> dict[str, Any]:
    runtime = resolve_runtime_values(ctx_obj)
    live_ready = runtime["api_key_present"]
    from .runtime import probe_runtime

    probe = probe_runtime(ctx_obj) if live_ready else {
        "ok": False,
        "code": "SKIPPED",
        "message": "Resend probe skipped until RESEND_API_KEY is configured",
        "details": {"skipped": True},
    }
    return {
        "summary": "Resend connector configuration snapshot.",
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
            "workerFields": ["to", "from", "subject", "html", "audience_id"],
            "from_email": runtime["from_email"] or None,
            "audience_id": runtime["audience_id"] or None,
            "domain_id": runtime["domain_id"] or None,
        },
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
