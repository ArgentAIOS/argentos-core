from pathlib import Path

MODE_ORDER = ["readonly", "write", "full", "admin"]
PERMISSIONS_PATH = Path(__file__).resolve().parents[2] / "permissions.json"
MANIFEST_SCHEMA_VERSION = "1.0.0"

DEFAULT_BASE_URL = "https://api.hubapi.com"
DEFAULT_ACCESS_TOKEN_ENV = "HUBSPOT_ACCESS_TOKEN"
LEGACY_ACCESS_TOKEN_ENV = "AOS_HUBSPOT_ACCESS_TOKEN"
DEFAULT_PORTAL_ID_ENV = "HUBSPOT_PORTAL_ID"
LEGACY_PORTAL_ID_ENV = "AOS_HUBSPOT_PORTAL_ID"
DEFAULT_ACCOUNT_ALIAS_ENV = "HUBSPOT_ACCOUNT_ALIAS"
LEGACY_ACCOUNT_ALIAS_ENV = "AOS_HUBSPOT_ACCOUNT_ALIAS"
DEFAULT_APP_ID_ENV = "HUBSPOT_APP_ID"
LEGACY_APP_ID_ENV = "AOS_HUBSPOT_APP_ID"
DEFAULT_WEBHOOK_SECRET_ENV = "HUBSPOT_WEBHOOK_SECRET"
LEGACY_WEBHOOK_SECRET_ENV = "AOS_HUBSPOT_WEBHOOK_SECRET"

CONNECTOR_DESCRIPTOR = {
    "label": "HubSpot",
    "category": "crm-revenue",
    "categories": ["crm-revenue", "marketing-publishing", "service-ops"],
    "resources": ["contact", "company", "deal", "ticket", "note", "owner", "pipeline"],
}

AUTH_DESCRIPTOR = {
    "kind": "oauth-service-key",
    "required": True,
    "service_keys": [DEFAULT_ACCESS_TOKEN_ENV, DEFAULT_PORTAL_ID_ENV],
    "interactive_setup": [
        "Create a HubSpot app or private app for the target portal.",
        "Add HUBSPOT_ACCESS_TOKEN and HUBSPOT_PORTAL_ID in operator-controlled service keys for the portal you want this worker to use.",
        "Use local HUBSPOT_* environment variables only as harness fallback when operator service keys are unavailable.",
        "Legacy AOS_HUBSPOT_* variable names are still accepted for backward compatibility.",
        "Restrict pipelines, owners, teams, and ticket queues before enabling write actions.",
    ],
}

COMMAND_SPECS = [
    {
        "id": "capabilities",
        "summary": "Describe the connector manifest",
        "required_mode": "readonly",
        "supports_json": True,
        "resource": "connector",
        "action_class": "read",
    },
    {
        "id": "health",
        "summary": "Report connector health and setup readiness",
        "required_mode": "readonly",
        "supports_json": True,
        "resource": "connector",
        "action_class": "read",
    },
    {
        "id": "config.show",
        "summary": "Show redacted connector configuration",
        "required_mode": "readonly",
        "supports_json": True,
        "resource": "connector",
        "action_class": "read",
    },
    {
        "id": "doctor",
        "summary": "Run connector diagnostics",
        "required_mode": "readonly",
        "supports_json": True,
        "resource": "connector",
        "action_class": "read",
    },
    {
        "id": "owner.list",
        "summary": "List HubSpot owners",
        "required_mode": "readonly",
        "supports_json": True,
        "resource": "owner",
        "action_class": "read",
    },
    {
        "id": "owner.assign",
        "summary": "Assign a HubSpot owner",
        "required_mode": "write",
        "supports_json": True,
        "resource": "owner",
        "action_class": "write",
    },
    {
        "id": "pipeline.list",
        "summary": "List HubSpot pipelines",
        "required_mode": "readonly",
        "supports_json": True,
        "resource": "pipeline",
        "action_class": "read",
    },
    {
        "id": "contact.list",
        "summary": "List HubSpot contacts",
        "required_mode": "readonly",
        "supports_json": True,
        "resource": "contact",
        "action_class": "read",
    },
    {
        "id": "contact.search",
        "summary": "Search HubSpot contacts",
        "required_mode": "readonly",
        "supports_json": True,
        "resource": "contact",
        "action_class": "read",
    },
    {
        "id": "contact.read",
        "summary": "Read a HubSpot contact",
        "required_mode": "readonly",
        "supports_json": True,
        "resource": "contact",
        "action_class": "read",
    },
    {
        "id": "contact.create",
        "summary": "Create a HubSpot contact",
        "required_mode": "write",
        "supports_json": True,
        "resource": "contact",
        "action_class": "write",
    },
    {
        "id": "contact.update",
        "summary": "Update a HubSpot contact",
        "required_mode": "write",
        "supports_json": True,
        "resource": "contact",
        "action_class": "write",
    },
    {
        "id": "company.list",
        "summary": "List HubSpot companies",
        "required_mode": "readonly",
        "supports_json": True,
        "resource": "company",
        "action_class": "read",
    },
    {
        "id": "company.search",
        "summary": "Search HubSpot companies",
        "required_mode": "readonly",
        "supports_json": True,
        "resource": "company",
        "action_class": "read",
    },
    {
        "id": "company.read",
        "summary": "Read a HubSpot company",
        "required_mode": "readonly",
        "supports_json": True,
        "resource": "company",
        "action_class": "read",
    },
    {
        "id": "company.create",
        "summary": "Create a HubSpot company",
        "required_mode": "write",
        "supports_json": True,
        "resource": "company",
        "action_class": "write",
    },
    {
        "id": "company.update",
        "summary": "Update a HubSpot company",
        "required_mode": "write",
        "supports_json": True,
        "resource": "company",
        "action_class": "write",
    },
    {
        "id": "deal.list",
        "summary": "List HubSpot deals",
        "required_mode": "readonly",
        "supports_json": True,
        "resource": "deal",
        "action_class": "read",
    },
    {
        "id": "deal.search",
        "summary": "Search HubSpot deals",
        "required_mode": "readonly",
        "supports_json": True,
        "resource": "deal",
        "action_class": "read",
    },
    {
        "id": "deal.read",
        "summary": "Read a HubSpot deal",
        "required_mode": "readonly",
        "supports_json": True,
        "resource": "deal",
        "action_class": "read",
    },
    {
        "id": "deal.create",
        "summary": "Create a HubSpot deal",
        "required_mode": "write",
        "supports_json": True,
        "resource": "deal",
        "action_class": "write",
    },
    {
        "id": "deal.update_stage",
        "summary": "Update a HubSpot deal stage",
        "required_mode": "full",
        "supports_json": True,
        "resource": "deal",
        "action_class": "write",
    },
    {
        "id": "ticket.list",
        "summary": "List HubSpot tickets",
        "required_mode": "readonly",
        "supports_json": True,
        "resource": "ticket",
        "action_class": "read",
    },
    {
        "id": "ticket.search",
        "summary": "Search HubSpot tickets",
        "required_mode": "readonly",
        "supports_json": True,
        "resource": "ticket",
        "action_class": "read",
    },
    {
        "id": "ticket.read",
        "summary": "Read a HubSpot ticket",
        "required_mode": "readonly",
        "supports_json": True,
        "resource": "ticket",
        "action_class": "read",
    },
    {
        "id": "ticket.create",
        "summary": "Create a HubSpot ticket",
        "required_mode": "write",
        "supports_json": True,
        "resource": "ticket",
        "action_class": "write",
    },
    {
        "id": "ticket.update_status",
        "summary": "Update a HubSpot ticket status",
        "required_mode": "write",
        "supports_json": True,
        "resource": "ticket",
        "action_class": "write",
    },
    {
        "id": "note.create",
        "summary": "Create a HubSpot note",
        "required_mode": "write",
        "supports_json": True,
        "resource": "note",
        "action_class": "write",
    },
]

OBJECT_ENDPOINTS = {
    "contact": "contacts",
    "company": "companies",
    "deal": "deals",
    "note": "notes",
    "ticket": "tickets",
}

DEFAULT_PROPERTIES = {
    "contact": ["email", "firstname", "lastname", "phone", "jobtitle", "hs_object_id"],
    "company": ["name", "domain", "phone", "city", "state", "country", "hs_object_id"],
    "deal": ["dealname", "dealstage", "pipeline", "amount", "closedate", "hubspot_owner_id"],
    "ticket": ["subject", "hs_pipeline", "hs_pipeline_stage", "hubspot_owner_id", "content"],
}

NOTE_ASSOCIATION_TYPE_IDS = {
    "contact": 202,
    "company": 190,
    "deal": 214,
    "ticket": 228,
}
