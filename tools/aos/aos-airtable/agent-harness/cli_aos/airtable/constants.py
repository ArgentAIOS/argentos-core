from pathlib import Path

TOOL_NAME = "aos-airtable"
BACKEND_NAME = "airtable-rest-api"
MANIFEST_SCHEMA_VERSION = "1.0.0"
MODE_ORDER = ["readonly", "write", "full", "admin"]
PERMISSIONS_PATH = Path(__file__).resolve().parents[2] / "permissions.json"

CONNECTOR_LABEL = "Airtable"
CONNECTOR_CATEGORY = "data-ops"
CONNECTOR_CATEGORIES = ["data-ops", "spreadsheet-database", "ops-automation"]
CONNECTOR_RESOURCES = ["base", "table", "record", "field", "view"]

DEFAULT_API_TOKEN_ENV = "AIRTABLE_API_TOKEN"
LEGACY_API_TOKEN_ENV = "AOS_AIRTABLE_API_TOKEN"
DEFAULT_BASE_ID_ENV = "AIRTABLE_BASE_ID"
LEGACY_BASE_ID_ENV = "AOS_AIRTABLE_BASE_ID"
DEFAULT_WORKSPACE_ID_ENV = "AIRTABLE_WORKSPACE_ID"
LEGACY_WORKSPACE_ID_ENV = "AOS_AIRTABLE_WORKSPACE_ID"
DEFAULT_TABLE_NAME_ENV = "AIRTABLE_TABLE_NAME"
LEGACY_TABLE_NAME_ENV = "AOS_AIRTABLE_TABLE_NAME"
DEFAULT_API_BASE_URL_ENV = "AIRTABLE_API_BASE_URL"

CONNECTOR_AUTH = {
    "kind": "service-key",
    "required": True,
    "service_keys": [DEFAULT_API_TOKEN_ENV, DEFAULT_BASE_ID_ENV],
    "interactive_setup": [
        "Create a dedicated Airtable personal access token for the target workspace.",
        "Grant the token access to the base this worker should operate on.",
        "Add AIRTABLE_API_TOKEN and AIRTABLE_BASE_ID in API Keys.",
        "Optionally set AIRTABLE_TABLE_NAME to pin a default table scope for worker commands.",
        "Keep table scope narrow before enabling write mode for record mutations.",
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
        "summary": "Report connector setup and readiness status",
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
        "id": "base.list",
        "summary": "List Airtable bases visible to the configured token",
        "required_mode": "readonly",
        "supports_json": True,
        "resource": "base",
        "action_class": "read",
    },
    {
        "id": "base.read",
        "summary": "Read Airtable base metadata",
        "required_mode": "readonly",
        "supports_json": True,
        "resource": "base",
        "action_class": "read",
    },
    {
        "id": "table.list",
        "summary": "List tables in the configured Airtable base",
        "required_mode": "readonly",
        "supports_json": True,
        "resource": "table",
        "action_class": "read",
    },
    {
        "id": "table.read",
        "summary": "Read Airtable table metadata",
        "required_mode": "readonly",
        "supports_json": True,
        "resource": "table",
        "action_class": "read",
    },
    {
        "id": "record.list",
        "summary": "List records from a table",
        "required_mode": "readonly",
        "supports_json": True,
        "resource": "record",
        "action_class": "read",
    },
    {
        "id": "record.search",
        "summary": "Search records in a table",
        "required_mode": "readonly",
        "supports_json": True,
        "resource": "record",
        "action_class": "read",
    },
    {
        "id": "record.read",
        "summary": "Read a single record",
        "required_mode": "readonly",
        "supports_json": True,
        "resource": "record",
        "action_class": "read",
    },
    {
        "id": "record.create",
        "summary": "Create a record",
        "required_mode": "write",
        "supports_json": True,
        "resource": "record",
        "action_class": "write",
    },
    {
        "id": "record.update",
        "summary": "Update a record",
        "required_mode": "write",
        "supports_json": True,
        "resource": "record",
        "action_class": "write",
    },
]
