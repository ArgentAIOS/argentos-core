from __future__ import annotations

MODE_ORDER = ["readonly", "write", "full", "admin"]
MANIFEST_SCHEMA_VERSION = "1.0.0"
TOOL_NAME = "aos-pagerduty"
BACKEND_NAME = "pagerduty-api"
DEFAULT_API_BASE_URL = "https://api.pagerduty.com"

PAGERDUTY_API_KEY_ENV = "PAGERDUTY_API_KEY"
PAGERDUTY_BASE_URL_ENV = "PAGERDUTY_BASE_URL"
PAGERDUTY_SERVICE_ID_ENV = "PAGERDUTY_SERVICE_ID"
PAGERDUTY_INCIDENT_ID_ENV = "PAGERDUTY_INCIDENT_ID"
PAGERDUTY_ESCALATION_POLICY_ID_ENV = "PAGERDUTY_ESCALATION_POLICY_ID"
PAGERDUTY_URGENCY_ENV = "PAGERDUTY_URGENCY"
PAGERDUTY_TITLE_ENV = "PAGERDUTY_TITLE"
PAGERDUTY_DESCRIPTION_ENV = "PAGERDUTY_DESCRIPTION"

CONNECTOR_DESCRIPTOR = {
    "label": "PagerDuty",
    "category": "it-operations",
    "categories": ["it-operations", "incident-management", "monitoring-alerting"],
    "resources": ["incident", "service", "escalation_policy", "on_call", "alert", "change_event"],
}

AUTH_DESCRIPTOR = {
    "kind": "service-key",
    "required": True,
    "service_keys": [PAGERDUTY_API_KEY_ENV],
    "interactive_setup": [
        "Create a PagerDuty REST API key in Settings > API Access Keys.",
        f"Add {PAGERDUTY_API_KEY_ENV} in API Keys before enabling live reads.",
        f"Optional scope env vars: {PAGERDUTY_SERVICE_ID_ENV}, {PAGERDUTY_INCIDENT_ID_ENV}, {PAGERDUTY_ESCALATION_POLICY_ID_ENV}.",
        "Write commands are scaffolded until PagerDuty write workflows are approved.",
    ],
}

SCOPE_DESCRIPTOR = {
    "kind": "incident-management",
    "summary": "Scope workers by incident, service, escalation policy, urgency, and ticket text.",
    "fields": [
        {
            "id": "service_id",
            "label": "Service ID",
            "required": False,
            "applies_to": ["incident.list", "incident.create", "service.get", "alert.list", "change_event.create"],
            "example": "PABC123",
        },
        {
            "id": "incident_id",
            "label": "Incident ID",
            "required": False,
            "applies_to": ["incident.get", "incident.acknowledge", "incident.resolve", "alert.list"],
            "example": "P1234XYZ",
        },
        {
            "id": "escalation_policy_id",
            "label": "Escalation Policy ID",
            "required": False,
            "applies_to": ["escalation_policy.list", "incident.create", "on_call.list"],
            "example": "PESC456",
        },
        {
            "id": "urgency",
            "label": "Urgency",
            "required": False,
            "applies_to": ["incident.create"],
            "example": "high",
        },
        {
            "id": "title",
            "label": "Title",
            "required": False,
            "applies_to": ["incident.create"],
            "example": "Database connection pool exhausted",
        },
        {
            "id": "description",
            "label": "Description",
            "required": False,
            "applies_to": ["incident.create", "change_event.create"],
            "example": "Primary DB connection pool at 100% capacity",
        },
    ],
    "command_defaults": {
        "incident.list": {"limit": 25, "statuses": ["triggered", "acknowledged"]},
        "incident.get": {"incident_id_env": PAGERDUTY_INCIDENT_ID_ENV},
        "incident.create": {
            "service_id_env": PAGERDUTY_SERVICE_ID_ENV,
            "urgency_env": PAGERDUTY_URGENCY_ENV,
            "title_env": PAGERDUTY_TITLE_ENV,
            "description_env": PAGERDUTY_DESCRIPTION_ENV,
        },
        "incident.acknowledge": {"incident_id_env": PAGERDUTY_INCIDENT_ID_ENV},
        "incident.resolve": {"incident_id_env": PAGERDUTY_INCIDENT_ID_ENV},
        "service.list": {"limit": 25},
        "service.get": {"service_id_env": PAGERDUTY_SERVICE_ID_ENV},
        "escalation_policy.list": {"limit": 25},
        "on_call.list": {"limit": 25, "escalation_policy_id_env": PAGERDUTY_ESCALATION_POLICY_ID_ENV},
        "alert.list": {"limit": 25, "incident_id_env": PAGERDUTY_INCIDENT_ID_ENV},
        "change_event.create": {"service_id_env": PAGERDUTY_SERVICE_ID_ENV, "description_env": PAGERDUTY_DESCRIPTION_ENV},
    },
}
