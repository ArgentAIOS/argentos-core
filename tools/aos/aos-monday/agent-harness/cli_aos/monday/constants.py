from __future__ import annotations

from pathlib import Path

MODE_ORDER = ["readonly", "write", "full", "admin"]
MANIFEST_SCHEMA_VERSION = "1.0.0"
TOOL_NAME = "aos-monday"
BACKEND_NAME = "monday-api"
DEFAULT_MONDAY_API_URL = "https://api.monday.com/v2"
DEFAULT_MONDAY_API_VERSION = "2026-01"

MONDAY_TOKEN_ENV = "MONDAY_TOKEN"
MONDAY_API_VERSION_ENV = "MONDAY_API_VERSION"
MONDAY_API_URL_ENV = "MONDAY_API_URL"
MONDAY_WORKSPACE_ENV = "MONDAY_WORKSPACE_ID"
MONDAY_BOARD_ENV = "MONDAY_BOARD_ID"

HARNESS_ROOT = Path(__file__).resolve().parents[2]
CONNECTOR_PATH = HARNESS_ROOT.parent / "connector.json"
PERMISSIONS_PATH = HARNESS_ROOT / "permissions.json"

CONNECTOR_DESCRIPTOR = {
    "label": "Monday.com",
    "category": "productivity-suite",
    "categories": ["productivity-suite", "project-management", "work-management"],
    "resources": ["account", "board", "workspace", "item", "update"],
}

AUTH_DESCRIPTOR = {
    "kind": "service-key",
    "required": True,
    "service_keys": [MONDAY_TOKEN_ENV],
    "interactive_setup": [
        "Create or copy a monday.com personal API token from the Developer Center.",
        f"Add {MONDAY_TOKEN_ENV} in API Keys before enabling any worker-visible commands.",
        f"Optionally set {MONDAY_API_VERSION_ENV} to pin a stable monday API version; the scaffold defaults to the current stable release.",
        "Share the boards and workspaces you want this worker to read with the account that owns the token.",
        "Live reads are enabled now; keep item.create, item.update, and update.create scaffolded until a live write bridge is implemented.",
    ],
}

GLOBAL_COMMAND_SPECS = [
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
]

COMMAND_SPECS = [
    {
        "id": "account.read",
        "summary": "Read the authenticated monday account",
        "required_mode": "readonly",
        "supports_json": True,
        "resource": "account",
        "action_class": "read",
    },
    {
        "id": "workspace.list",
        "summary": "List monday workspaces",
        "required_mode": "readonly",
        "supports_json": True,
        "resource": "workspace",
        "action_class": "read",
    },
    {
        "id": "board.list",
        "summary": "List monday boards",
        "required_mode": "readonly",
        "supports_json": True,
        "resource": "board",
        "action_class": "read",
    },
    {
        "id": "board.read",
        "summary": "Read a monday board with item and update previews",
        "required_mode": "readonly",
        "supports_json": True,
        "resource": "board",
        "action_class": "read",
    },
    {
        "id": "item.read",
        "summary": "Read a monday item",
        "required_mode": "readonly",
        "supports_json": True,
        "resource": "item",
        "action_class": "read",
    },
    {
        "id": "update.list",
        "summary": "List monday updates",
        "required_mode": "readonly",
        "supports_json": True,
        "resource": "update",
        "action_class": "read",
    },
    {
        "id": "item.create",
        "summary": "Create a monday item",
        "required_mode": "write",
        "supports_json": True,
        "resource": "item",
        "action_class": "write",
    },
    {
        "id": "item.update",
        "summary": "Update a monday item",
        "required_mode": "write",
        "supports_json": True,
        "resource": "item",
        "action_class": "write",
    },
    {
        "id": "update.create",
        "summary": "Create a monday update",
        "required_mode": "write",
        "supports_json": True,
        "resource": "update",
        "action_class": "write",
    },
]

WRITE_COMMAND_IDS = {
    "item.create",
    "item.update",
    "update.create",
}
