from __future__ import annotations

MODE_ORDER = ["readonly", "write", "full", "admin"]
MANIFEST_SCHEMA_VERSION = "1.0.0"
TOOL_NAME = "aos-notion"
BACKEND_NAME = "notion-api"
DEFAULT_NOTION_VERSION = "2022-06-28"

NOTION_TOKEN_ENV = "NOTION_TOKEN"
NOTION_VERSION_ENV = "NOTION_VERSION"
NOTION_WORKSPACE_ENV = "NOTION_WORKSPACE_ID"

CONNECTOR_DESCRIPTOR = {
    "label": "Notion",
    "category": "productivity-suite",
    "categories": ["productivity-suite", "knowledge-base", "notes"],
    "resources": ["database", "page", "block", "search"],
}

AUTH_DESCRIPTOR = {
    "kind": "service-key",
    "required": True,
    "service_keys": [NOTION_TOKEN_ENV],
    "interactive_setup": [
        "Create a Notion internal integration for the workspace you want this worker to use.",
        "Share the target databases and pages with that integration before enabling any worker-visible commands.",
        f"Add {NOTION_TOKEN_ENV} in API Keys; optionally set {NOTION_VERSION_ENV} if you want to pin a specific Notion API release.",
        "Live reads and writes are enabled now; write commands execute against the live Notion API.",
    ],
}

SCOPED_COMMANDS = ["database.list", "database.query", "page.read", "page.create", "page.update", "block.read", "block.append", "search.query"]
