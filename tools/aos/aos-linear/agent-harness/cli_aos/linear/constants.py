from __future__ import annotations

from pathlib import Path

TOOL_NAME = "aos-linear"
MANIFEST_SCHEMA_VERSION = "1.0.0"
CONNECTOR_LABEL = "Linear"
CONNECTOR_CATEGORY = "project-management"
CONNECTOR_CATEGORIES = ["project-management", "issue-tracking", "workflow"]
CONNECTOR_RESOURCES = ["issues", "projects", "workflow-states"]
MODE_ORDER = ["readonly", "write", "full", "admin"]
DEFAULT_LINEAR_API_URL = "https://api.linear.app/graphql"
DEFAULT_LINEAR_API_KEY_ENV = "LINEAR_API_KEY"
DEFAULT_LINEAR_TEAM_KEY = "WEB"
DEFAULT_LINEAR_TEAM_KEY_ENV = "LINEAR_TEAM_KEY"
DEFAULT_LINEAR_TEAM_ID_ENV = "LINEAR_TEAM_ID"
DEFAULT_LINEAR_ORG_ENV = "LINEAR_ORGANIZATION_URL"
PERMISSIONS_PATH = Path(__file__).resolve().parents[2] / "permissions.json"
CONNECTOR_AUTH = {
    "kind": "service-key",
    "required": True,
    "service_keys": [DEFAULT_LINEAR_API_KEY_ENV],
    "interactive_setup": [
        "Preferred: add LINEAR_API_KEY in ArgentOS API Keys.",
        "Optional: set LINEAR_TEAM_KEY or LINEAR_TEAM_ID to scope create/update operations to a specific team.",
        "This connector talks to Linear GraphQL at https://api.linear.app/graphql and is intended for project and issue management.",
    ],
}
COMMAND_SPECS = [
    {
        "id": "health",
        "summary": "Check Linear runtime readiness",
        "required_mode": "readonly",
        "supports_json": True,
        "resource": "projects",
        "action_class": "read",
    },
    {
        "id": "doctor",
        "summary": "Run Linear runtime diagnostics",
        "required_mode": "readonly",
        "supports_json": True,
        "resource": "projects",
        "action_class": "read",
    },
    {
        "id": "config.show",
        "summary": "Show redacted Linear connector config",
        "required_mode": "readonly",
        "supports_json": True,
        "resource": "projects",
        "action_class": "read",
    },
    {
        "id": "list-projects",
        "summary": "List Linear projects with issue counts",
        "required_mode": "readonly",
        "supports_json": True,
        "resource": "projects",
        "action_class": "read",
    },
    {
        "id": "list-issues",
        "summary": "List Linear issues with project, status, or assignee filters",
        "required_mode": "readonly",
        "supports_json": True,
        "resource": "issues",
        "action_class": "read",
    },
    {
        "id": "create-issue",
        "summary": "Create a Linear issue",
        "required_mode": "write",
        "supports_json": True,
        "resource": "issues",
        "action_class": "write",
    },
    {
        "id": "update-issue",
        "summary": "Update a Linear issue",
        "required_mode": "write",
        "supports_json": True,
        "resource": "issues",
        "action_class": "write",
    },
    {
        "id": "search",
        "summary": "Search Linear issues",
        "required_mode": "readonly",
        "supports_json": True,
        "resource": "issues",
        "action_class": "read",
    },
    {
        "id": "get-issue",
        "summary": "Get a Linear issue by identifier",
        "required_mode": "readonly",
        "supports_json": True,
        "resource": "issues",
        "action_class": "read",
    },
]
