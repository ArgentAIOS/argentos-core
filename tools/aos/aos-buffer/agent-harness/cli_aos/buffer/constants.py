from __future__ import annotations

from pathlib import Path

TOOL_NAME = "aos-buffer"
BACKEND_NAME = "buffer-graphql-api"
MANIFEST_VERSION = "1.0.0"
MODE_ORDER = ["readonly", "write", "full", "admin"]
PERMISSIONS_PATH = Path(__file__).resolve().parents[2] / "permissions.json"
CONNECTOR_PATH = Path(__file__).resolve().parents[3] / "connector.json"

DEFAULT_BASE_URL = "https://api.buffer.com"
DEFAULT_TIMEOUT_SECONDS = 20

ENV_API_KEYS = ("BUFFER_API_KEY", "BUFFER_ACCESS_TOKEN")
ENV_BASE_URL = "BUFFER_BASE_URL"
ENV_ORGANIZATION_ID = "BUFFER_ORGANIZATION_ID"
ENV_CHANNEL_ID = "BUFFER_CHANNEL_ID"
ENV_PROFILE_ID = "BUFFER_PROFILE_ID"
ENV_POST_ID = "BUFFER_POST_ID"
