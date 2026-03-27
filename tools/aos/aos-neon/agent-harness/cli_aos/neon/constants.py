from __future__ import annotations

from pathlib import Path

TOOL_NAME = "aos-neon"
BACKEND_NAME = "neon-api"
NEON_API_KEY_ENV = "NEON_API_KEY"
NEON_CONNECTION_STRING_ENV = "NEON_CONNECTION_STRING"
NEON_PROJECT_ID_ENV = "NEON_PROJECT_ID"
NEON_BRANCH_ENV = "NEON_BRANCH"
NEON_API_BASE = "https://console.neon.tech/api/v2"

MODE_ORDER = ["readonly", "write", "full", "admin"]
HARNESS_ROOT = Path(__file__).resolve().parents[2]
CONNECTOR_PATH = HARNESS_ROOT.parent / "connector.json"
PERMISSIONS_PATH = HARNESS_ROOT / "permissions.json"
