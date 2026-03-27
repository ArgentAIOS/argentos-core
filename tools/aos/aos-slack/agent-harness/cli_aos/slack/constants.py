from pathlib import Path

TOOL_NAME = "aos-slack"
BACKEND = "slack-web-api"
MANIFEST_SCHEMA_VERSION = "1.0.0"
MODE_ORDER = ["readonly", "write", "full", "admin"]
PERMISSIONS_PATH = Path(__file__).resolve().parents[2] / "permissions.json"

CONNECTOR_LABEL = "Slack"
CONNECTOR_CATEGORY = "general"
CONNECTOR_CATEGORIES = ["general", "messaging"]
CONNECTOR_RESOURCES = ["message", "channel", "mention", "reaction", "people"]

DEFAULT_BOT_TOKEN_ENV = "SLACK_BOT_TOKEN"
LEGACY_BOT_TOKEN_ENV = "AOS_SLACK_BOT_TOKEN"
DEFAULT_APP_TOKEN_ENV = "SLACK_APP_TOKEN"
LEGACY_APP_TOKEN_ENV = "AOS_SLACK_APP_TOKEN"

READ_SCOPES = ["channels:read", "search:read", "users:read", "reactions:read"]
WRITE_SCOPES = ["chat:write"]

CONNECTOR_AUTH = {
    "kind": "service-key",
    "required": True,
    "service_keys": [DEFAULT_BOT_TOKEN_ENV],
    "interactive_setup": [
        "Create or install a Slack app for the target workspace.",
        "Add SLACK_BOT_TOKEN in API Keys.",
        "Grant the bot the read scopes it needs: channels:read, search:read, users:read, and reactions:read.",
        "Add chat:write if you plan to use message.reply.",
        "Optional: add SLACK_APP_TOKEN only if you later wire Socket Mode or event ingestion.",
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
        "summary": "Report connector health and backend readiness",
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
        "id": "message.search",
        "summary": "Search Slack messages",
        "required_mode": "readonly",
        "supports_json": True,
        "resource": "message",
        "action_class": "read",
    },
    {
        "id": "message.reply",
        "summary": "Reply in a Slack channel or thread",
        "required_mode": "write",
        "supports_json": True,
        "resource": "message",
        "action_class": "write",
    },
    {
        "id": "channel.list",
        "summary": "List Slack channels visible to the bot",
        "required_mode": "readonly",
        "supports_json": True,
        "resource": "channel",
        "action_class": "read",
    },
    {
        "id": "mention.scan",
        "summary": "Scan for direct mentions of the bot user",
        "required_mode": "readonly",
        "supports_json": True,
        "resource": "mention",
        "action_class": "read",
    },
    {
        "id": "people.list",
        "summary": "List Slack people available as mention targets",
        "required_mode": "readonly",
        "supports_json": True,
        "resource": "people",
        "action_class": "read",
    },
    {
        "id": "reaction.list",
        "summary": "List reactions made by the bot user",
        "required_mode": "readonly",
        "supports_json": True,
        "resource": "reaction",
        "action_class": "read",
    },
]
