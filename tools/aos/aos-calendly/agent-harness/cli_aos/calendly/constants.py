from __future__ import annotations

from pathlib import Path

TOOL_NAME = "aos-calendly"
BACKEND_NAME = "calendly-api"
CALENDLY_API_KEY_ENV = "CALENDLY_API_KEY"
CALENDLY_EVENT_TYPE_UUID_ENV = "CALENDLY_EVENT_TYPE_UUID"
CALENDLY_EVENT_UUID_ENV = "CALENDLY_EVENT_UUID"

MODE_ORDER = ["readonly", "write", "full", "admin"]
HARNESS_ROOT = Path(__file__).resolve().parents[2]
CONNECTOR_PATH = HARNESS_ROOT.parent / "connector.json"
PERMISSIONS_PATH = HARNESS_ROOT / "permissions.json"
