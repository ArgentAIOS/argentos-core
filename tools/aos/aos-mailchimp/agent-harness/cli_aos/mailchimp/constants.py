from __future__ import annotations

from pathlib import Path

TOOL_NAME = "aos-mailchimp"
MANIFEST_SCHEMA_VERSION = "1.0.0"

CONNECTOR_LABEL = "Mailchimp"
CONNECTOR_CATEGORY = "marketing-publishing"
CONNECTOR_CATEGORIES = ["marketing-publishing", "crm-revenue"]
CONNECTOR_RESOURCES = ["account", "audience", "campaign", "member"]

MODE_ORDER = ["readonly", "write", "full", "admin"]

DEFAULT_API_KEY_ENV = "MAILCHIMP_API_KEY"
LEGACY_API_KEY_ENV = "AOS_MAILCHIMP_API_KEY"
DEFAULT_SERVER_PREFIX_ENV = "MAILCHIMP_SERVER_PREFIX"
LEGACY_SERVER_PREFIX_ENV = "AOS_MAILCHIMP_SERVER_PREFIX"

PERMISSIONS_PATH = Path(__file__).resolve().parents[2] / "permissions.json"
CONNECTOR_PATH = Path(__file__).resolve().parents[3] / "connector.json"

DEFAULT_TIMEOUT_SECONDS = 20

CONNECTOR_AUTH = {
    "kind": "service-key",
    "required": True,
    "service_keys": [
        DEFAULT_API_KEY_ENV,
    ],
    "interactive_setup": [
        "Create a Mailchimp API key in the target account.",
        "Set MAILCHIMP_API_KEY, or the legacy AOS_MAILCHIMP_API_KEY, in the worker environment.",
        "Optionally set MAILCHIMP_SERVER_PREFIX if you want to override the datacenter inferred from the API key suffix.",
    ],
}

