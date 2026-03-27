from __future__ import annotations

import os
from typing import Any

from .constants import (
    AUTH_DESCRIPTOR,
    CONNECTOR_DESCRIPTOR,
    DEFAULT_API_BASE_URL,
    PAGERDUTY_API_KEY_ENV,
    PAGERDUTY_BASE_URL_ENV,
    PAGERDUTY_DESCRIPTION_ENV,
    PAGERDUTY_ESCALATION_POLICY_ID_ENV,
    PAGERDUTY_INCIDENT_ID_ENV,
    PAGERDUTY_SERVICE_ID_ENV,
    PAGERDUTY_TITLE_ENV,
    PAGERDUTY_URGENCY_ENV,
    SCOPE_DESCRIPTOR,
)


def _present(value: str | None) -> bool:
    return bool(value and value.strip())


def resolve_runtime_values(ctx_obj: dict[str, Any]) -> dict[str, Any]:
    api_key_env = ctx_obj.get("api_key_env") or PAGERDUTY_API_KEY_ENV
    base_url_env = ctx_obj.get("base_url_env") or PAGERDUTY_BASE_URL_ENV
    service_id_env = ctx_obj.get("service_id_env") or PAGERDUTY_SERVICE_ID_ENV
    incident_id_env = ctx_obj.get("incident_id_env") or PAGERDUTY_INCIDENT_ID_ENV
    escalation_policy_id_env = ctx_obj.get("escalation_policy_id_env") or PAGERDUTY_ESCALATION_POLICY_ID_ENV
    urgency_env = ctx_obj.get("urgency_env") or PAGERDUTY_URGENCY_ENV
    title_env = ctx_obj.get("title_env") or PAGERDUTY_TITLE_ENV
    description_env = ctx_obj.get("description_env") or PAGERDUTY_DESCRIPTION_ENV

    api_key = os.getenv(api_key_env) or None
    base_url = os.getenv(base_url_env) or None
    service_id = os.getenv(service_id_env) or None
    incident_id = os.getenv(incident_id_env) or None
    escalation_policy_id = os.getenv(escalation_policy_id_env) or None
    urgency = os.getenv(urgency_env) or None
    title = os.getenv(title_env) or None
    description = os.getenv(description_env) or None

    return {
        "backend": "pagerduty-api",
        "api_base_url": (base_url or DEFAULT_API_BASE_URL).rstrip("/"),
        "api_key_env": api_key_env,
        "base_url_env": base_url_env,
        "service_id_env": service_id_env,
        "incident_id_env": incident_id_env,
        "escalation_policy_id_env": escalation_policy_id_env,
        "urgency_env": urgency_env,
        "title_env": title_env,
        "description_env": description_env,
        "api_key_present": _present(api_key),
        "account_alias": ctx_obj.get("account_alias") or None,
        "service_id": service_id.strip() if service_id and service_id.strip() else None,
        "incident_id": incident_id.strip() if incident_id and incident_id.strip() else None,
        "escalation_policy_id": (
            escalation_policy_id.strip() if escalation_policy_id and escalation_policy_id.strip() else None
        ),
        "urgency": urgency.strip() if urgency and urgency.strip() else None,
        "title": title.strip() if title and title.strip() else None,
        "description": description.strip() if description and description.strip() else None,
        "verbose": bool(ctx_obj.get("verbose")),
        "connector": CONNECTOR_DESCRIPTOR,
        "auth": AUTH_DESCRIPTOR,
        "scope": SCOPE_DESCRIPTOR,
    }


def config_snapshot(ctx_obj: dict[str, Any]) -> dict[str, Any]:
    runtime = resolve_runtime_values(ctx_obj)
    from .runtime import probe_runtime

    probe = probe_runtime(ctx_obj) if runtime["api_key_present"] else None
    if probe is None:
        probe = {
            "ok": False,
            "code": "SKIPPED",
            "message": "PagerDuty probe skipped until PAGERDUTY_API_KEY is configured",
            "details": {"skipped": True},
        }
    command_defaults = {
        "incident.list": {"service_id": runtime["service_id"], "limit": 25},
        "incident.get": {"incident_id": runtime["incident_id"]},
        "incident.create": {
            "service_id": runtime["service_id"],
            "urgency": runtime["urgency"],
            "title": runtime["title"],
            "description": runtime["description"],
        },
        "incident.acknowledge": {"incident_id": runtime["incident_id"]},
        "incident.resolve": {"incident_id": runtime["incident_id"]},
        "service.list": {"limit": 25},
        "service.get": {"service_id": runtime["service_id"]},
        "escalation_policy.list": {"limit": 25},
        "on_call.list": {"escalation_policy_id": runtime["escalation_policy_id"], "limit": 25},
        "alert.list": {"incident_id": runtime["incident_id"], "limit": 25},
        "change_event.create": {"service_id": runtime["service_id"], "description": runtime["description"]},
    }
    return {
        "status": "ok",
        "summary": "PagerDuty connector configuration snapshot.",
        "backend": "pagerduty-api",
        "connector": CONNECTOR_DESCRIPTOR,
        "scope": SCOPE_DESCRIPTOR,
        "auth": {
            "api_key_env": runtime["api_key_env"],
            "api_key_present": runtime["api_key_present"],
            "base_url_env": runtime["base_url_env"],
            "service_id_env": runtime["service_id_env"],
            "incident_id_env": runtime["incident_id_env"],
            "escalation_policy_id_env": runtime["escalation_policy_id_env"],
            "urgency_env": runtime["urgency_env"],
            "title_env": runtime["title_env"],
            "description_env": runtime["description_env"],
        },
        "runtime": {
            "api_base_url": runtime["api_base_url"],
            "service_id": runtime["service_id"],
            "incident_id": runtime["incident_id"],
            "escalation_policy_id": runtime["escalation_policy_id"],
            "urgency": runtime["urgency"],
            "title": runtime["title"],
            "description": runtime["description"],
            "command_defaults": command_defaults,
            "runtime_ready": bool(probe and probe["ok"]),
            "api_probe": probe,
        },
    }
