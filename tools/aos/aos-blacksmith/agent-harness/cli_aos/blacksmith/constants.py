from __future__ import annotations

from pathlib import Path

TOOL_NAME = "aos-blacksmith"
BACKEND_NAME = "blacksmith-api"

BLACKSMITH_API_KEY_ENV = "BLACKSMITH_API_KEY"
BLACKSMITH_API_BASE_URL_ENV = "BLACKSMITH_API_BASE_URL"
BLACKSMITH_REPO_ENV = "BLACKSMITH_REPO"
BLACKSMITH_RUN_ID_ENV = "BLACKSMITH_RUN_ID"
BLACKSMITH_WORKFLOW_NAME_ENV = "BLACKSMITH_WORKFLOW_NAME"
BLACKSMITH_DATE_RANGE_ENV = "BLACKSMITH_DATE_RANGE"

DEFAULT_API_BASE_URL = "https://api.blacksmith.sh/v1"
MODE_ORDER = ["readonly", "write", "full", "admin"]

HARNESS_ROOT = Path(__file__).resolve().parents[2]
CONNECTOR_PATH = HARNESS_ROOT.parent / "connector.json"
PERMISSIONS_PATH = HARNESS_ROOT / "permissions.json"
