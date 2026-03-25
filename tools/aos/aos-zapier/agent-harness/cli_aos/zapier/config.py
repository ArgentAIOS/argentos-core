from __future__ import annotations

import os
from typing import Any

from .constants import (
    BACKEND_NAME,
    trigger_builder_hints,
    ZAPIER_API_KEY_ENV,
    ZAPIER_API_URL_ENV,
    ZAPIER_WEBHOOK_BASE_URL_ENV,
    ZAPIER_WORKSPACE_NAME_ENV,
    ZAPIER_ZAP_ID_ENV,
    ZAPIER_ZAP_NAME_ENV,
    ZAPIER_ZAP_STATUS_ENV,
)


def _present(value: str | None) -> bool:
    return bool(value and value.strip())


def _redact(value: str | None) -> str | None:
    if value is None:
        return None
    stripped = value.strip()
    if not stripped:
        return None
    if len(stripped) <= 6:
        return "***"
    return f"{stripped[:3]}...{stripped[-3:]}"


def resolve_runtime_values(ctx_obj: dict[str, Any]) -> dict[str, Any]:
    api_url_env = (ctx_obj.get("api_url_env") or ZAPIER_API_URL_ENV).strip() or ZAPIER_API_URL_ENV
    api_key_env = (ctx_obj.get("api_key_env") or ZAPIER_API_KEY_ENV).strip() or ZAPIER_API_KEY_ENV
    webhook_base_url_env = (ctx_obj.get("webhook_base_url_env") or ZAPIER_WEBHOOK_BASE_URL_ENV).strip() or ZAPIER_WEBHOOK_BASE_URL_ENV

    api_url = os.getenv(api_url_env)
    api_key = os.getenv(api_key_env)
    webhook_base_url = os.getenv(webhook_base_url_env)

    workspace_name = os.getenv(ZAPIER_WORKSPACE_NAME_ENV)
    zap_id = os.getenv(ZAPIER_ZAP_ID_ENV)
    zap_name = os.getenv(ZAPIER_ZAP_NAME_ENV)
    zap_status = os.getenv(ZAPIER_ZAP_STATUS_ENV)

    return {
        "backend": BACKEND_NAME,
        "api_url_env": api_url_env,
        "api_key_env": api_key_env,
        "webhook_base_url_env": webhook_base_url_env,
        "api_url": api_url,
        "api_url_present": _present(api_url),
        "api_url_redacted": _redact(api_url),
        "api_key": api_key,
        "api_key_present": _present(api_key),
        "api_key_redacted": _redact(api_key),
        "webhook_base_url": webhook_base_url,
        "webhook_base_url_present": _present(webhook_base_url),
        "webhook_base_url_redacted": _redact(webhook_base_url),
        "workspace_name": workspace_name.strip() if workspace_name and workspace_name.strip() else None,
        "zap_id": zap_id.strip() if zap_id and zap_id.strip() else None,
        "zap_name": zap_name.strip() if zap_name and zap_name.strip() else None,
        "zap_status": zap_status.strip() if zap_status and zap_status.strip() else None,
        "verbose": bool(ctx_obj.get("verbose")),
    }


def redacted_config_snapshot(ctx_obj: dict[str, Any]) -> dict[str, Any]:
    runtime = resolve_runtime_values(ctx_obj)
    from .runtime import probe_runtime

    auth_ready = runtime["api_url_present"] and runtime["api_key_present"]
    probe = probe_runtime(ctx_obj)
    details = probe.get("details", {})
    live_backend_available = bool(details.get("live_read_available"))
    write_bridge_available = bool(details.get("write_bridge_available"))
    runtime_ready = live_backend_available and write_bridge_available
    return {
        "status": "ok",
        "summary": "Zapier connector configuration snapshot.",
        "backend": BACKEND_NAME,
        "auth": {
            "api_url_env": runtime["api_url_env"],
            "api_url_present": runtime["api_url_present"],
            "api_url_redacted": runtime["api_url_redacted"],
            "api_key_env": runtime["api_key_env"],
            "api_key_present": runtime["api_key_present"],
            "api_key_redacted": runtime["api_key_redacted"],
            "webhook_base_url_env": runtime["webhook_base_url_env"],
            "webhook_base_url_present": runtime["webhook_base_url_present"],
            "webhook_base_url_redacted": runtime["webhook_base_url_redacted"],
        },
        "runtime": {
            "workspace_name": runtime["workspace_name"],
            "zap_id": runtime["zap_id"],
            "zap_name": runtime["zap_name"],
            "zap_status": runtime["zap_status"],
            "auth_ready": auth_ready,
            "runtime_ready": runtime_ready,
            "live_backend_available": live_backend_available,
            "live_read_available": live_backend_available,
            "write_bridge_available": write_bridge_available,
            "scaffold_only": False,
        },
        "trigger_builder": trigger_builder_hints(runtime=runtime, probe=probe),
        "api_probe": probe,
    }
