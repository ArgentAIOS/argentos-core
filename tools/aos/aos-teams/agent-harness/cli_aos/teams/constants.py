from __future__ import annotations

import json
from pathlib import Path

TOOL_NAME = "aos-teams"
BACKEND_NAME = "microsoft-graph"
MODE_ORDER = ["readonly", "write", "full", "admin"]
MANIFEST_SCHEMA_VERSION = "1.0.0"

CONNECTOR_PATH = Path(__file__).resolve().parents[3] / "connector.json"
PERMISSIONS_PATH = Path(__file__).resolve().parents[2] / "permissions.json"

_MANIFEST = json.loads(CONNECTOR_PATH.read_text())

CONNECTOR_LABEL = _MANIFEST["connector"]["label"]
CONNECTOR_CATEGORY = _MANIFEST["connector"]["category"]
CONNECTOR_CATEGORIES = _MANIFEST["connector"]["categories"]
CONNECTOR_RESOURCES = _MANIFEST["connector"]["resources"]
CONNECTOR_AUTH = _MANIFEST["auth"]
