from __future__ import annotations

from pathlib import Path

TOOL_NAME = "aos-close"
BACKEND_NAME = "close-api"
CLOSE_API_KEY_ENV = "CLOSE_API_KEY"
CLOSE_LEAD_ID_ENV = "CLOSE_LEAD_ID"
CLOSE_CONTACT_ID_ENV = "CLOSE_CONTACT_ID"

MODE_ORDER = ["readonly", "write", "full", "admin"]
HARNESS_ROOT = Path(__file__).resolve().parents[2]
CONNECTOR_PATH = HARNESS_ROOT.parent / "connector.json"
PERMISSIONS_PATH = HARNESS_ROOT / "permissions.json"
