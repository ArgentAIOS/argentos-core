from pathlib import Path

TOOL_NAME = "aos-trello"
BACKEND_NAME = "trello-rest-api"
MANIFEST_SCHEMA_VERSION = "1.0.0"
MODE_ORDER = ["readonly", "write", "full", "admin"]
PERMISSIONS_PATH = Path(__file__).resolve().parents[2] / "permissions.json"
CONNECTOR_PATH = Path(__file__).resolve().parents[2].parent / "connector.json"

CONNECTOR_LABEL = "Trello"
CONNECTOR_CATEGORY = "project-management"
CONNECTOR_CATEGORIES = ["project-management", "task-tracking", "collaboration"]
CONNECTOR_RESOURCES = ["account", "member", "board", "list", "card"]

DEFAULT_API_KEY_ENV = "TRELLO_API_KEY"
DEFAULT_TOKEN_ENV = "TRELLO_TOKEN"
DEFAULT_BOARD_ID_ENV = "TRELLO_BOARD_ID"
DEFAULT_MEMBER_ID_ENV = "TRELLO_MEMBER_ID"
DEFAULT_LIST_ID_ENV = "TRELLO_LIST_ID"
DEFAULT_CARD_ID_ENV = "TRELLO_CARD_ID"
DEFAULT_API_BASE_URL_ENV = "TRELLO_API_BASE_URL"
DEFAULT_API_BASE_URL = "https://api.trello.com/1"

CONNECTOR_AUTH = {
    "kind": "service-key",
    "required": True,
    "service_keys": [DEFAULT_API_KEY_ENV, DEFAULT_TOKEN_ENV],
    "interactive_setup": [
        "Create or choose a Trello API key and user token for the workspace this worker should use.",
        f"Add {DEFAULT_API_KEY_ENV} and {DEFAULT_TOKEN_ENV} in API Keys before enabling live reads.",
        f"Optionally set {DEFAULT_BOARD_ID_ENV}, {DEFAULT_LIST_ID_ENV}, {DEFAULT_CARD_ID_ENV}, and {DEFAULT_MEMBER_ID_ENV} to pin stable worker scope defaults.",
        "Keep card.create_draft and card.update_draft scaffolded until a live Trello write bridge is implemented.",
        "This connector is live-read-first and reports Trello API failures instead of masking them.",
    ],
}

COMMAND_SPECS = [
    {
        "id": "account.read",
        "summary": "Read the connected Trello account",
        "required_mode": "readonly",
        "supports_json": True,
        "resource": "account",
        "action_class": "read",
    },
    {
        "id": "capabilities",
        "summary": "Describe the connector manifest",
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
        "id": "health",
        "summary": "Report connector health and setup readiness",
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
        "id": "member.list",
        "summary": "List members on a Trello board",
        "required_mode": "readonly",
        "supports_json": True,
        "resource": "member",
        "action_class": "read",
    },
    {
        "id": "member.read",
        "summary": "Read a Trello member",
        "required_mode": "readonly",
        "supports_json": True,
        "resource": "member",
        "action_class": "read",
    },
    {
        "id": "board.list",
        "summary": "List boards visible to the connected member",
        "required_mode": "readonly",
        "supports_json": True,
        "resource": "board",
        "action_class": "read",
    },
    {
        "id": "board.read",
        "summary": "Read a Trello board",
        "required_mode": "readonly",
        "supports_json": True,
        "resource": "board",
        "action_class": "read",
    },
    {
        "id": "list.list",
        "summary": "List lists on a Trello board",
        "required_mode": "readonly",
        "supports_json": True,
        "resource": "list",
        "action_class": "read",
    },
    {
        "id": "list.read",
        "summary": "Read a Trello list",
        "required_mode": "readonly",
        "supports_json": True,
        "resource": "list",
        "action_class": "read",
    },
    {
        "id": "card.list",
        "summary": "List cards in a Trello list",
        "required_mode": "readonly",
        "supports_json": True,
        "resource": "card",
        "action_class": "read",
    },
    {
        "id": "card.read",
        "summary": "Read a Trello card",
        "required_mode": "readonly",
        "supports_json": True,
        "resource": "card",
        "action_class": "read",
    },
    {
        "id": "card.create_draft",
        "summary": "Create a draft card payload",
        "required_mode": "write",
        "supports_json": True,
        "resource": "card",
        "action_class": "write",
    },
    {
        "id": "card.update_draft",
        "summary": "Update a draft card payload",
        "required_mode": "write",
        "supports_json": True,
        "resource": "card",
        "action_class": "write",
    },
]
