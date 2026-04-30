from __future__ import annotations

import os
from typing import Any

from .constants import (
    AUTH_DESCRIPTOR,
    CONNECTOR_DESCRIPTOR,
    DEFAULT_API_BASE_URL,
    DEFAULT_EVENTS_API_BASE_URL,
    PAGERDUTY_API_KEY_ENV,
    PAGERDUTY_BASE_URL_ENV,
    PAGERDUTY_DESCRIPTION_ENV,
    PAGERDUTY_ESCALATION_POLICY_ID_ENV,
    PAGERDUTY_EVENTS_ROUTING_KEY_ENV,
    PAGERDUTY_FROM_EMAIL_ENV,
    PAGERDUTY_INCIDENT_ID_ENV,
    PAGERDUTY_RESOLUTION_ENV,
    PAGERDUTY_SERVICE_ID_ENV,
    PAGERDUTY_SUMMARY_ENV,
    PAGERDUTY_TITLE_ENV,
    PAGERDUTY_URGENCY_ENV,
    SCOPE_DESCRIPTOR,
)
from .service_keys import resolve_service_key


def _present(value: str | None) -> bool:
    return bool(value and value.strip())


def resolve_runtime_values(ctx_obj: dict[str, Any]) -> dict[str, Any]:
    api_key_env = ctx_obj.get("api_key_env") or PAGERDUTY_API_KEY_ENV
    base_url_env = ctx_obj.get("base_url_env") or PAGERDUTY_BASE_URL_ENV
    events_routing_key_env = ctx_obj.get("events_routing_key_env") or PAGERDUTY_EVENTS_ROUTING_KEY_ENV
    from_email_env = ctx_obj.get("from_email_env") or PAGERDUTY_FROM_EMAIL_ENV
    service_id_env = ctx_obj.get("service_id_env") or PAGERDUTY_SERVICE_ID_ENV
    incident_id_env = ctx_obj.get("incident_id_env") or PAGERDUTY_INCIDENT_ID_ENV
    escalation_policy_id_env = ctx_obj.get("escalation_policy_id_env") or PAGERDUTY_ESCALATION_POLICY_ID_ENV
    urgency_env = ctx_obj.get("urgency_env") or PAGERDUTY_URGENCY_ENV
    title_env = ctx_obj.get("title_env") or PAGERDUTY_TITLE_ENV
    description_env = ctx_obj.get("description_env") or PAGERDUTY_DESCRIPTION_ENV
    resolution_env = ctx_obj.get("resolution_env") or PAGERDUTY_RESOLUTION_ENV
    summary_env = ctx_obj.get("summary_env") or PAGERDUTY_SUMMARY_ENV

    api_key = resolve_service_key(ctx_obj, api_key_env)
    events_routing_key = resolve_service_key(ctx_obj, events_routing_key_env)
    base_url = os.getenv(base_url_env) or None
    from_email = os.getenv(from_email_env) or None
    service_id = os.getenv(service_id_env) or None
    incident_id = os.getenv(incident_id_env) or None
    escalation_policy_id = os.getenv(escalation_policy_id_env) or None
    urgency = os.getenv(urgency_env) or None
    title = os.getenv(title_env) or None
    description = os.getenv(description_env) or None
    resolution = os.getenv(resolution_env) or None
    summary = os.getenv(summary_env) or None

    return {
        "backend": "pagerduty-api",
        "api_base_url": (base_url or DEFAULT_API_BASE_URL).rstrip("/"),
        "events_api_base_url": DEFAULT_EVENTS_API_BASE_URL.rstrip("/"),
        "api_key_env": api_key_env,
        "base_url_env": base_url_env,
        "events_routing_key_env": events_routing_key_env,
        "from_email_env": from_email_env,
        "service_id_env": service_id_env,
        "incident_id_env": incident_id_env,
        "escalation_policy_id_env": escalation_policy_id_env,
        "urgency_env": urgency_env,
        "title_env": title_env,
        "description_env": description_env,
        "resolution_env": resolution_env,
        "summary_env": summary_env,
        "api_key": api_key["value"],
        "api_key_present": api_key["present"],
        "api_key_source": api_key["source"],
        "events_routing_key": events_routing_key["value"],
        "events_routing_key_present": events_routing_key["present"],
        "events_routing_key_source": events_routing_key["source"],
        "from_email": from_email.strip() if from_email and from_email.strip() else None,
        "from_email_present": _present(from_email),
        "account_alias": ctx_obj.get("account_alias") or None,
        "service_id": service_id.strip() if service_id and service_id.strip() else None,
        "incident_id": incident_id.strip() if incident_id and incident_id.strip() else None,
        "escalation_policy_id": (
            escalation_policy_id.strip() if escalation_policy_id and escalation_policy_id.strip() else None
        ),
        "urgency": urgency.strip() if urgency and urgency.strip() else None,
        "title": title.strip() if title and title.strip() else None,
        "description": description.strip() if description and description.strip() else None,
        "resolution": resolution.strip() if resolution and resolution.strip() else None,
        "summary": summary.strip() if summary and summary.strip() else None,
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
            "message": f"PagerDuty probe skipped until {runtime['api_key_env']} is configured",
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
            "from_email": runtime["from_email"],
        },
        "incident.acknowledge": {"incident_id": runtime["incident_id"], "from_email": runtime["from_email"]},
        "incident.resolve": {
            "incident_id": runtime["incident_id"],
            "from_email": runtime["from_email"],
            "resolution": runtime["resolution"],
        },
        "service.list": {"limit": 25},
        "service.get": {"service_id": runtime["service_id"]},
        "escalation_policy.list": {"limit": 25},
        "on_call.list": {"escalation_policy_id": runtime["escalation_policy_id"], "limit": 25},
        "alert.list": {"incident_id": runtime["incident_id"], "limit": 25},
        "change_event.create": {
            "summary": runtime["summary"] or runtime["title"],
            "description": runtime["description"],
        },
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
            "api_key_source": runtime["api_key_source"],
            "base_url_env": runtime["base_url_env"],
            "events_routing_key_env": runtime["events_routing_key_env"],
            "events_routing_key_present": runtime["events_routing_key_present"],
            "events_routing_key_source": runtime["events_routing_key_source"],
            "from_email_env": runtime["from_email_env"],
            "from_email_present": runtime["from_email_present"],
            "service_id_env": runtime["service_id_env"],
            "incident_id_env": runtime["incident_id_env"],
            "escalation_policy_id_env": runtime["escalation_policy_id_env"],
            "urgency_env": runtime["urgency_env"],
            "title_env": runtime["title_env"],
            "description_env": runtime["description_env"],
            "resolution_env": runtime["resolution_env"],
            "summary_env": runtime["summary_env"],
        },
        "runtime": {
            "api_base_url": runtime["api_base_url"],
            "events_api_base_url": runtime["events_api_base_url"],
            "from_email": runtime["from_email"],
            "service_id": runtime["service_id"],
            "incident_id": runtime["incident_id"],
            "escalation_policy_id": runtime["escalation_policy_id"],
            "urgency": runtime["urgency"],
            "title": runtime["title"],
            "description": runtime["description"],
            "resolution": runtime["resolution"],
            "summary": runtime["summary"],
            "command_defaults": command_defaults,
            "runtime_ready": bool(probe and probe["ok"]),
            "api_probe": probe,
        },
    }
