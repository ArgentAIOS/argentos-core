from __future__ import annotations

from pathlib import Path

TOOL_NAME = "aos-hootsuite"
BACKEND_NAME = "hootsuite-rest-api"
CONNECTOR_LABEL = "Hootsuite"
CONNECTOR_CATEGORY = "marketing-publishing"
CONNECTOR_CATEGORIES = ("marketing-publishing", "social-publishing", "service-ops")
CONNECTOR_RESOURCES = ("member", "organization", "social_profile", "team", "message")
DEFAULT_BASE_URL = "https://platform.hootsuite.com"
MODE_ORDER = ("readonly", "write", "full", "admin")
PERMISSIONS_PATH = Path(__file__).resolve().parents[2] / "permissions.json"
CONNECTOR_PATH = Path(__file__).resolve().parents[3] / "connector.json"
