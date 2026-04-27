from __future__ import annotations

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
from .service_keys import service_key_details


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
    api_url_env = ZAPIER_API_URL_ENV
    api_key_env = ZAPIER_API_KEY_ENV
    webhook_base_url_env = ZAPIER_WEBHOOK_BASE_URL_ENV

    api_url = service_key_details(api_url_env, ctx_obj)
    api_key = service_key_details(api_key_env, ctx_obj)
    webhook_base_url = service_key_details(webhook_base_url_env, ctx_obj)
    workspace_name = service_key_details(ZAPIER_WORKSPACE_NAME_ENV, ctx_obj)
    zap_id = service_key_details(ZAPIER_ZAP_ID_ENV, ctx_obj)
    zap_name = service_key_details(ZAPIER_ZAP_NAME_ENV, ctx_obj)
    zap_status = service_key_details(ZAPIER_ZAP_STATUS_ENV, ctx_obj)

    return {
        "backend": BACKEND_NAME,
        "api_url_env": api_url_env,
        "api_key_env": api_key_env,
        "webhook_base_url_env": webhook_base_url_env,
        "api_url_source": api_url["source"],
        "api_key_source": api_key["source"],
        "webhook_base_url_source": webhook_base_url["source"],
        "api_url": api_url["value"] or None,
        "api_url_present": _present(api_url["value"]),
        "api_url_usable": api_url["usable"],
        "api_url_redacted": _redact(api_url["value"]),
        "api_key": api_key["value"] or None,
        "api_key_present": _present(api_key["value"]),
        "api_key_usable": api_key["usable"],
        "api_key_redacted": _redact(api_key["value"]),
        "webhook_base_url": webhook_base_url["value"] or None,
        "webhook_base_url_present": _present(webhook_base_url["value"]),
        "webhook_base_url_usable": webhook_base_url["usable"],
        "webhook_base_url_redacted": _redact(webhook_base_url["value"]),
        "workspace_name": workspace_name["value"] or None,
        "workspace_name_source": workspace_name["source"] if workspace_name["present"] else None,
        "zap_id": zap_id["value"] or None,
        "zap_id_source": zap_id["source"] if zap_id["present"] else None,
        "zap_name": zap_name["value"] or None,
        "zap_name_source": zap_name["source"] if zap_name["present"] else None,
        "zap_status": zap_status["value"] or None,
        "zap_status_source": zap_status["source"] if zap_status["present"] else None,
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
            "api_url_usable": runtime["api_url_usable"],
            "api_url_redacted": runtime["api_url_redacted"],
            "api_url_source": runtime["api_url_source"],
            "api_key_env": runtime["api_key_env"],
            "api_key_present": runtime["api_key_present"],
            "api_key_usable": runtime["api_key_usable"],
            "api_key_redacted": runtime["api_key_redacted"],
            "api_key_source": runtime["api_key_source"],
            "webhook_base_url_env": runtime["webhook_base_url_env"],
            "webhook_base_url_present": runtime["webhook_base_url_present"],
            "webhook_base_url_usable": runtime["webhook_base_url_usable"],
            "webhook_base_url_redacted": runtime["webhook_base_url_redacted"],
            "webhook_base_url_source": runtime["webhook_base_url_source"],
            "resolution_order": ["operator-context", "service-keys", "process.env"],
        },
        "runtime": {
            "workspace_name": runtime["workspace_name"],
            "workspace_name_source": runtime["workspace_name_source"],
            "zap_id": runtime["zap_id"],
            "zap_id_source": runtime["zap_id_source"],
            "zap_name": runtime["zap_name"],
            "zap_name_source": runtime["zap_name_source"],
            "zap_status": runtime["zap_status"],
            "zap_status_source": runtime["zap_status_source"],
            "auth_resolution": "operator_service_keys_first_env_fallback_only_when_unmanaged",
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
