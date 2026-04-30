from __future__ import annotations

MODE_ORDER = ["readonly", "write", "full", "admin"]
MANIFEST_SCHEMA_VERSION = "1.0.0"
TOOL_NAME = "aos-pagerduty"
BACKEND_NAME = "pagerduty-api"
DEFAULT_API_BASE_URL = "https://api.pagerduty.com"
DEFAULT_EVENTS_API_BASE_URL = "https://events.pagerduty.com/v2"

PAGERDUTY_API_KEY_ENV = "PAGERDUTY_API_KEY"
PAGERDUTY_EVENTS_ROUTING_KEY_ENV = "PAGERDUTY_EVENTS_ROUTING_KEY"
PAGERDUTY_BASE_URL_ENV = "PAGERDUTY_BASE_URL"
PAGERDUTY_FROM_EMAIL_ENV = "PAGERDUTY_FROM_EMAIL"
PAGERDUTY_SERVICE_ID_ENV = "PAGERDUTY_SERVICE_ID"
PAGERDUTY_INCIDENT_ID_ENV = "PAGERDUTY_INCIDENT_ID"
PAGERDUTY_ESCALATION_POLICY_ID_ENV = "PAGERDUTY_ESCALATION_POLICY_ID"
PAGERDUTY_URGENCY_ENV = "PAGERDUTY_URGENCY"
PAGERDUTY_TITLE_ENV = "PAGERDUTY_TITLE"
PAGERDUTY_DESCRIPTION_ENV = "PAGERDUTY_DESCRIPTION"
PAGERDUTY_RESOLUTION_ENV = "PAGERDUTY_RESOLUTION"
PAGERDUTY_SUMMARY_ENV = "PAGERDUTY_SUMMARY"
DEFAULT_CHANGE_EVENT_SOURCE = "aos-pagerduty"

CONNECTOR_DESCRIPTOR = {
    "label": "PagerDuty",
    "category": "it-operations",
    "categories": ["it-operations", "incident-management", "monitoring-alerting"],
    "resources": ["incident", "service", "escalation_policy", "on_call", "alert", "change_event"],
}

AUTH_DESCRIPTOR = {
    "kind": "service-key",
    "required": True,
    "service_keys": [PAGERDUTY_API_KEY_ENV, PAGERDUTY_EVENTS_ROUTING_KEY_ENV],
    "interactive_setup": [
        "Create a PagerDuty REST API key in Settings > API Access Keys for reads and incident writes.",
        "Create or copy an Events API v2 integration key for change_event.create.",
        f"Provide {PAGERDUTY_API_KEY_ENV} and/or {PAGERDUTY_EVENTS_ROUTING_KEY_ENV} via operator-controlled service keys, or let the helper fall back to env.",
        f"Set {PAGERDUTY_FROM_EMAIL_ENV} for incident.create, incident.acknowledge, and incident.resolve.",
        f"Optional scope env vars: {PAGERDUTY_SERVICE_ID_ENV}, {PAGERDUTY_INCIDENT_ID_ENV}, {PAGERDUTY_ESCALATION_POLICY_ID_ENV}, {PAGERDUTY_SUMMARY_ENV}, {PAGERDUTY_RESOLUTION_ENV}.",
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
            "applies_to": ["incident.list", "incident.create", "service.get", "alert.list"],
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
        {
            "id": "summary",
            "label": "Summary",
            "required": False,
            "applies_to": ["change_event.create"],
            "example": "Deploy 2026.04.26.1 completed",
        },
        {
            "id": "resolution",
            "label": "Resolution",
            "required": False,
            "applies_to": ["incident.resolve"],
            "example": "Issue mitigated by restarting the DB writer",
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
            "from_email_env": PAGERDUTY_FROM_EMAIL_ENV,
        },
        "incident.acknowledge": {
            "incident_id_env": PAGERDUTY_INCIDENT_ID_ENV,
            "from_email_env": PAGERDUTY_FROM_EMAIL_ENV,
        },
        "incident.resolve": {
            "incident_id_env": PAGERDUTY_INCIDENT_ID_ENV,
            "from_email_env": PAGERDUTY_FROM_EMAIL_ENV,
            "resolution_env": PAGERDUTY_RESOLUTION_ENV,
        },
        "service.list": {"limit": 25},
        "service.get": {"service_id_env": PAGERDUTY_SERVICE_ID_ENV},
        "escalation_policy.list": {"limit": 25},
        "on_call.list": {"limit": 25, "escalation_policy_id_env": PAGERDUTY_ESCALATION_POLICY_ID_ENV},
        "alert.list": {"limit": 25, "incident_id_env": PAGERDUTY_INCIDENT_ID_ENV},
        "change_event.create": {
            "summary_env": PAGERDUTY_SUMMARY_ENV,
            "description_env": PAGERDUTY_DESCRIPTION_ENV,
            "source": DEFAULT_CHANGE_EVENT_SOURCE,
        },
    },
}
