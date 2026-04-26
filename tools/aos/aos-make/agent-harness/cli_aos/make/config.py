from __future__ import annotations

import os
from .service_keys import service_key_env
from typing import Any

from .constants import (
    BACKEND_NAME,
    MAKE_API_KEY_ENV,
    MAKE_API_URL_ENV,
    MAKE_CONNECTION_ID_ENV,
    MAKE_CONNECTION_NAME_ENV,
    MAKE_EXECUTION_ID_ENV,
    MAKE_ORGANIZATION_ID_ENV,
    MAKE_ORGANIZATION_NAME_ENV,
    MAKE_RUN_ID_ENV,
    MAKE_SCENARIO_ID_ENV,
    MAKE_SCENARIO_NAME_ENV,
    MAKE_SCENARIO_STATUS_ENV,
    MAKE_TEAM_ID_ENV,
    MAKE_TEAM_NAME_ENV,
    MAKE_WEBHOOK_BASE_URL_ENV,
    trigger_builder_hints,
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
    api_url_env = (ctx_obj.get("api_url_env") or MAKE_API_URL_ENV).strip() or MAKE_API_URL_ENV
    api_key_env = (ctx_obj.get("api_key_env") or MAKE_API_KEY_ENV).strip() or MAKE_API_KEY_ENV
    webhook_base_url_env = (ctx_obj.get("webhook_base_url_env") or MAKE_WEBHOOK_BASE_URL_ENV).strip() or MAKE_WEBHOOK_BASE_URL_ENV

    api_url = service_key_env(api_url_env)
    api_key = service_key_env(api_key_env)
    webhook_base_url = service_key_env(webhook_base_url_env)

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
        "organization_id": (service_key_env(MAKE_ORGANIZATION_ID_ENV) or "").strip() or None,
        "organization_name": (service_key_env(MAKE_ORGANIZATION_NAME_ENV) or "").strip() or None,
        "team_id": (service_key_env(MAKE_TEAM_ID_ENV) or "").strip() or None,
        "team_name": (service_key_env(MAKE_TEAM_NAME_ENV) or "").strip() or None,
        "scenario_id": (service_key_env(MAKE_SCENARIO_ID_ENV) or "").strip() or None,
        "scenario_name": (service_key_env(MAKE_SCENARIO_NAME_ENV) or "").strip() or None,
        "scenario_status": (service_key_env(MAKE_SCENARIO_STATUS_ENV) or "").strip() or None,
        "connection_id": (service_key_env(MAKE_CONNECTION_ID_ENV) or "").strip() or None,
        "connection_name": (service_key_env(MAKE_CONNECTION_NAME_ENV) or "").strip() or None,
        "execution_id": (service_key_env(MAKE_EXECUTION_ID_ENV) or "").strip() or None,
        "run_id": (service_key_env(MAKE_RUN_ID_ENV) or "").strip() or None,
        "verbose": bool(ctx_obj.get("verbose")),
    }


def _scope_preview(runtime: dict[str, Any]) -> dict[str, Any]:
    return {
        "organization": {
            "id": runtime.get("organization_id"),
            "name": runtime.get("organization_name"),
            "resource": "organization",
        },
        "team": {
            "id": runtime.get("team_id"),
            "name": runtime.get("team_name"),
            "resource": "team",
        },
        "scenario": {
            "id": runtime.get("scenario_id"),
            "name": runtime.get("scenario_name"),
            "status": runtime.get("scenario_status"),
            "resource": "scenario",
        },
        "connection": {
            "id": runtime.get("connection_id"),
            "name": runtime.get("connection_name"),
            "resource": "connection",
        },
        "execution": {
            "id": runtime.get("execution_id"),
            "resource": "execution",
        },
        "run": {
            "id": runtime.get("run_id"),
            "resource": "run",
        },
    }


def redacted_config_snapshot(
    ctx_obj: dict[str, Any],
    *,
    probe: dict[str, Any] | None = None,
    write_probe: dict[str, Any] | None = None,
) -> dict[str, Any]:
    runtime = resolve_runtime_values(ctx_obj)
    api_probe = probe or {
        "ok": False,
        "code": "MAKE_PROBE_SKIPPED",
        "message": "Make live read probe was not run.",
        "details": {"live_read_available": False},
    }
    write_probe = write_probe or {
        "ok": False,
        "code": "MAKE_TRIGGER_PROBE_SKIPPED",
        "message": "Make trigger probe was not run.",
        "details": {"write_bridge_available": False},
    }
    auth_ready = runtime["api_url_present"] and runtime["api_key_present"]
    live_read_available = bool(api_probe.get("ok"))
    write_bridge_available = bool(write_probe.get("ok"))
    live_backend_available = live_read_available and write_bridge_available
    runtime_ready = auth_ready and live_backend_available
    trigger_builder = trigger_builder_hints(
        runtime=runtime,
        probe={"details": {"write_probe": write_probe}},
    )
    return {
        "status": "ok",
        "summary": "Make connector configuration snapshot.",
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
            "organization_id": runtime["organization_id"],
            "organization_name": runtime["organization_name"],
            "team_id": runtime["team_id"],
            "team_name": runtime["team_name"],
            "scenario_id": runtime["scenario_id"],
            "scenario_name": runtime["scenario_name"],
            "scenario_status": runtime["scenario_status"],
            "connection_id": runtime["connection_id"],
            "connection_name": runtime["connection_name"],
            "execution_id": runtime["execution_id"],
            "run_id": runtime["run_id"],
            "auth_ready": auth_ready,
            "runtime_ready": runtime_ready,
            "live_backend_available": live_backend_available,
            "live_read_available": live_read_available,
            "write_bridge_available": write_bridge_available,
            "scaffold_only": False,
            "scope_preview": _scope_preview(runtime),
            "trigger_builder": trigger_builder,
        },
        "scope_preview": _scope_preview(runtime),
        "api_probe": api_probe,
        "write_probe": write_probe,
        "trigger_builder": trigger_builder,
        "runtime_ready": runtime_ready,
        "live_backend_available": live_backend_available,
        "live_read_available": live_read_available,
        "write_bridge_available": write_bridge_available,
        "scaffold_only": False,
    }
