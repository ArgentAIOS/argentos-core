from __future__ import annotations

from pathlib import Path

TOOL_NAME = "aos-wordpress"
MANIFEST_SCHEMA_VERSION = "1.0.0"

CONNECTOR_LABEL = "WordPress"
CONNECTOR_CATEGORY = "marketing-publishing"
CONNECTOR_CATEGORIES = ["marketing-publishing", "knowledge-docs", "web-content"]
CONNECTOR_RESOURCES = ["site", "post", "page", "media", "taxonomy"]

MODE_ORDER = ["readonly", "write", "full", "admin"]

DEFAULT_BASE_URL_ENV = "WORDPRESS_BASE_URL"
LEGACY_BASE_URL_ENV = "AOS_WORDPRESS_BASE_URL"
DEFAULT_USERNAME_ENV = "WORDPRESS_USERNAME"
LEGACY_USERNAME_ENV = "AOS_WORDPRESS_USERNAME"
DEFAULT_APPLICATION_PASSWORD_ENV = "WORDPRESS_APPLICATION_PASSWORD"
LEGACY_APPLICATION_PASSWORD_ENV = "AOS_WORDPRESS_APPLICATION_PASSWORD"

CONNECTOR_AUTH = {
    "kind": "service-key",
    "required": True,
    "service_keys": [
        DEFAULT_BASE_URL_ENV,
        DEFAULT_USERNAME_ENV,
        DEFAULT_APPLICATION_PASSWORD_ENV,
    ],
    "interactive_setup": [
        "Create a dedicated WordPress service user on the target site.",
        "Generate an Application Password for that user.",
        "Add WORDPRESS_BASE_URL, WORDPRESS_USERNAME, and WORDPRESS_APPLICATION_PASSWORD in API Keys.",
        "Restrict post types, status transitions, taxonomy scope, and media usage before going live.",
    ],
}

GLOBAL_COMMAND_SPECS = [
    {
        "id": "health",
        "summary": "Check WordPress connectivity and auth readiness",
        "required_mode": "readonly",
        "supports_json": True,
        "resource": "site",
        "action_class": "read",
    },
    {
        "id": "doctor",
        "summary": "Run a detailed WordPress runtime diagnosis",
        "required_mode": "readonly",
        "supports_json": True,
        "resource": "site",
        "action_class": "read",
    },
    {
        "id": "config.show",
        "summary": "Show redacted WordPress connector config",
        "required_mode": "readonly",
        "supports_json": True,
        "resource": "site",
        "action_class": "read",
    },
]

WORKER_COMMAND_SPECS = [
    {
        "id": "site.read",
        "summary": "Read WordPress site info",
        "required_mode": "readonly",
        "supports_json": True,
        "resource": "site",
        "action_class": "read",
    },
    {
        "id": "post.list",
        "summary": "List posts",
        "required_mode": "readonly",
        "supports_json": True,
        "resource": "post",
        "action_class": "read",
    },
    {
        "id": "post.search",
        "summary": "Search posts",
        "required_mode": "readonly",
        "supports_json": True,
        "resource": "post",
        "action_class": "read",
    },
    {
        "id": "post.read",
        "summary": "Read a post",
        "required_mode": "readonly",
        "supports_json": True,
        "resource": "post",
        "action_class": "read",
    },
    {
        "id": "post.create_draft",
        "summary": "Create a draft post",
        "required_mode": "write",
        "supports_json": True,
        "resource": "post",
        "action_class": "write",
    },
    {
        "id": "post.update_draft",
        "summary": "Update a draft post",
        "required_mode": "write",
        "supports_json": True,
        "resource": "post",
        "action_class": "write",
    },
    {
        "id": "post.schedule",
        "summary": "Schedule a post",
        "required_mode": "write",
        "supports_json": True,
        "resource": "post",
        "action_class": "write",
    },
    {
        "id": "post.publish",
        "summary": "Publish an approved post",
        "required_mode": "write",
        "supports_json": True,
        "resource": "post",
        "action_class": "write",
    },
    {
        "id": "page.list",
        "summary": "List pages",
        "required_mode": "readonly",
        "supports_json": True,
        "resource": "page",
        "action_class": "read",
    },
    {
        "id": "page.search",
        "summary": "Search pages",
        "required_mode": "readonly",
        "supports_json": True,
        "resource": "page",
        "action_class": "read",
    },
    {
        "id": "page.read",
        "summary": "Read a page",
        "required_mode": "readonly",
        "supports_json": True,
        "resource": "page",
        "action_class": "read",
    },
    {
        "id": "page.create_draft",
        "summary": "Create a draft page",
        "required_mode": "write",
        "supports_json": True,
        "resource": "page",
        "action_class": "write",
    },
    {
        "id": "page.update_draft",
        "summary": "Update a draft page",
        "required_mode": "write",
        "supports_json": True,
        "resource": "page",
        "action_class": "write",
    },
    {
        "id": "page.publish",
        "summary": "Publish an approved page",
        "required_mode": "write",
        "supports_json": True,
        "resource": "page",
        "action_class": "write",
    },
    {
        "id": "media.list",
        "summary": "List media items",
        "required_mode": "readonly",
        "supports_json": True,
        "resource": "media",
        "action_class": "read",
    },
    {
        "id": "media.upload",
        "summary": "Upload a media item",
        "required_mode": "write",
        "supports_json": True,
        "resource": "media",
        "action_class": "write",
    },
    {
        "id": "taxonomy.list",
        "summary": "List categories and tags",
        "required_mode": "readonly",
        "supports_json": True,
        "resource": "taxonomy",
        "action_class": "read",
    },
    {
        "id": "taxonomy.assign_terms",
        "summary": "Assign categories or tags",
        "required_mode": "write",
        "supports_json": True,
        "resource": "taxonomy",
        "action_class": "write",
    },
]

COMMAND_SPECS = [*GLOBAL_COMMAND_SPECS, *WORKER_COMMAND_SPECS]

PERMISSIONS_PATH = Path(__file__).resolve().parents[2] / "permissions.json"

RESOURCE_PATHS = {
    "post": "posts",
    "page": "pages",
    "media": "media",
}

TAXONOMY_PATHS = {
    "categories": "categories",
    "tags": "tags",
}

IMPLEMENTED_WRITE_COMMANDS = [
    "post.create_draft",
    "post.update_draft",
    "post.schedule",
    "post.publish",
    "page.create_draft",
    "page.update_draft",
    "page.publish",
]

SCAFFOLDED_WRITE_COMMANDS = [
    "media.upload",
    "taxonomy.assign_terms",
]
