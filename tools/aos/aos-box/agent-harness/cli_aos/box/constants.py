from __future__ import annotations

from pathlib import Path

TOOL_NAME = "aos-box"
BACKEND_NAME = "box-api"

BOX_CLIENT_ID_ENV = "BOX_CLIENT_ID"
BOX_CLIENT_SECRET_ENV = "BOX_CLIENT_SECRET"
BOX_ACCESS_TOKEN_ENV = "BOX_ACCESS_TOKEN"
BOX_JWT_CONFIG_ENV = "BOX_JWT_CONFIG"
BOX_FOLDER_ID_ENV = "BOX_FOLDER_ID"
BOX_FILE_ID_ENV = "BOX_FILE_ID"
BOX_QUERY_ENV = "BOX_QUERY"

DEFAULT_API_BASE_URL = "https://api.box.com/2.0"
MODE_ORDER = ["readonly", "write", "full", "admin"]

HARNESS_ROOT = Path(__file__).resolve().parents[2]
CONNECTOR_PATH = HARNESS_ROOT.parent / "connector.json"
PERMISSIONS_PATH = HARNESS_ROOT / "permissions.json"
