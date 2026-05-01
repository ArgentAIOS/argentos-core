from pathlib import Path

TOOL_NAME = "aos-slack"
BACKEND = "slack-web-api"
MANIFEST_SCHEMA_VERSION = "1.0.0"
MODE_ORDER = ["readonly", "write", "full", "admin"]
PERMISSIONS_PATH = Path(__file__).resolve().parents[2] / "permissions.json"

CONNECTOR_LABEL = "Slack"
CONNECTOR_CATEGORY = "general"
CONNECTOR_CATEGORIES = ["general", "messaging", "team-collaboration"]
CONNECTOR_RESOURCES = ["message", "channel", "mention", "reaction", "people"]

DEFAULT_BOT_TOKEN_ENV = "SLACK_BOT_TOKEN"
LEGACY_BOT_TOKEN_ENV = "AOS_SLACK_BOT_TOKEN"
DEFAULT_APP_TOKEN_ENV = "SLACK_APP_TOKEN"
LEGACY_APP_TOKEN_ENV = "AOS_SLACK_APP_TOKEN"
DEFAULT_WORKSPACE_ENV = "SLACK_WORKSPACE"
LEGACY_WORKSPACE_ENV = "AOS_SLACK_WORKSPACE"
DEFAULT_TEAM_ID_ENV = "SLACK_TEAM_ID"
LEGACY_TEAM_ID_ENV = "AOS_SLACK_TEAM_ID"
DEFAULT_CHANNEL_ID_ENV = "SLACK_CHANNEL_ID"
DEFAULT_THREAD_TS_ENV = "SLACK_THREAD_TS"
DEFAULT_USER_ID_ENV = "SLACK_USER_ID"

READ_SCOPES = ["channels:read", "channels:history", "search:read", "users:read", "reactions:read"]
WRITE_SCOPES = ["chat:write"]

CONNECTOR_AUTH = {
    "kind": "service-key",
    "required": True,
    "service_keys": [DEFAULT_BOT_TOKEN_ENV],
    "optional_service_keys": [
        DEFAULT_APP_TOKEN_ENV,
        DEFAULT_WORKSPACE_ENV,
        DEFAULT_TEAM_ID_ENV,
        DEFAULT_CHANNEL_ID_ENV,
        DEFAULT_THREAD_TS_ENV,
        DEFAULT_USER_ID_ENV,
    ],
    "interactive_setup": [
        "Create or install a Slack app for the target workspace.",
        "Add SLACK_BOT_TOKEN in operator-controlled API Keys before enabling live reads or replies.",
        "Use local SLACK_BOT_TOKEN environment variables only as a harness fallback when operator service keys are unavailable.",
        "Scoped service-key entries must be injected by the operator runtime and are not bypassed with local env.",
        "Grant the bot the read scopes it needs: channels:read, search:read, users:read, and reactions:read.",
        "Add groups:read too if you expect channel.list --include-private to inspect private channels.",
        "Add chat:write if you plan to use message.reply.",
        "Optional: pin SLACK_WORKSPACE, SLACK_TEAM_ID, SLACK_CHANNEL_ID, SLACK_THREAD_TS, and SLACK_USER_ID in operator-controlled API Keys when workers need stable Slack scope defaults.",
        "Optional: add SLACK_APP_TOKEN only for future Socket Mode wiring; this connector does not advertise event-ingestion commands today.",
        "Keep live_write_smoke_tested=false unless a real operator Slack workspace smoke test verifies writes.",
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
        "id": "health.check",
        "summary": "Workflow-compatible alias for connector health",
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
        "id": "message.send",
        "summary": "Send a Slack message to a channel or thread",
        "required_mode": "write",
        "supports_json": True,
        "resource": "message",
        "action_class": "write",
    },
    {
        "id": "message.history",
        "summary": "Read recent Slack channel message history",
        "required_mode": "readonly",
        "supports_json": True,
        "resource": "message",
        "action_class": "read",
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
