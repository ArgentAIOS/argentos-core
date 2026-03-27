from __future__ import annotations

from pathlib import Path

TOOL_NAME = "aos-firecrawl"
MANIFEST_SCHEMA_VERSION = "1.0.0"
CONNECTOR_LABEL = "Firecrawl"
CONNECTOR_CATEGORY = "knowledge-docs"
CONNECTOR_CATEGORIES = ["knowledge-docs", "web-content", "research"]
CONNECTOR_RESOURCES = ["page", "scrape"]
MODE_ORDER = ["readonly", "write", "full", "admin"]
DEFAULT_PROXY_BASE_URL = "http://127.0.0.1:9242"
DEFAULT_FIRECRAWL_BASE_URL = "https://api.firecrawl.dev"
DEFAULT_FIRECRAWL_API_KEY_ENV = "FIRECRAWL_API_KEY"
LEGACY_FIRECRAWL_API_KEY_ENV = "AOS_FIRECRAWL_API_KEY"
DEFAULT_PROXY_BASE_URL_ENV = "ARGENT_DASHBOARD_API_URL"
LEGACY_PROXY_BASE_URL_ENV = "AOS_FIRECRAWL_PROXY_BASE_URL"
PERMISSIONS_PATH = Path(__file__).resolve().parents[2] / "permissions.json"
CONNECTOR_AUTH = {
    "kind": "service-key",
    "required": False,
    "service_keys": [DEFAULT_FIRECRAWL_API_KEY_ENV],
    "interactive_setup": [
        "Preferred: add FIRECRAWL_API_KEY in ArgentOS API Keys so the dashboard proxy can resolve it.",
        "Optional: export FIRECRAWL_API_KEY directly for direct API fallback.",
        "The proxy endpoint is /api/proxy/fetch/firecrawl on the local dashboard API server.",
    ],
}
COMMAND_SPECS = [
    {
        "id": "health",
        "summary": "Check Firecrawl runtime readiness",
        "required_mode": "readonly",
        "supports_json": True,
        "resource": "page",
        "action_class": "read",
    },
    {
        "id": "doctor",
        "summary": "Run Firecrawl runtime diagnostics",
        "required_mode": "readonly",
        "supports_json": True,
        "resource": "page",
        "action_class": "read",
    },
    {
        "id": "config.show",
        "summary": "Show redacted Firecrawl connector config",
        "required_mode": "readonly",
        "supports_json": True,
        "resource": "page",
        "action_class": "read",
    },
    {
        "id": "scrape",
        "summary": "Scrape readable content from a public URL",
        "required_mode": "readonly",
        "supports_json": True,
        "resource": "scrape",
        "action_class": "read",
    },
]
