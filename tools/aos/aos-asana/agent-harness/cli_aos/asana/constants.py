from __future__ import annotations

from pathlib import Path

TOOL_NAME = "aos-asana"
BACKEND_NAME = "asana-api"
DEFAULT_BASE_URL = "https://app.asana.com/api/1.0"
DEFAULT_TIMEOUT_SECONDS = 20
MODE_ORDER = ["readonly", "write", "full", "admin"]
IMPLEMENTATION_MODE = "live_read_write"
LIVE_READ_SURFACES = ["project", "task", "section", "comment", "portfolio", "search"]
LIVE_WRITE_SURFACES = ["task.create", "task.update", "comment.create"]

ENV_ACCESS_TOKEN = "ASANA_ACCESS_TOKEN"
ENV_BASE_URL = "ASANA_BASE_URL"
ENV_WORKSPACE_GID = "ASANA_WORKSPACE_GID"
ENV_PROJECT_GID = "ASANA_PROJECT_GID"
ENV_TASK_GID = "ASANA_TASK_GID"


def harness_root() -> Path:
    return Path(__file__).resolve().parents[2]


def connector_root() -> Path:
    return Path(__file__).resolve().parents[3]


CONNECTOR_PATH = connector_root() / "connector.json"
PERMISSIONS_PATH = harness_root() / "permissions.json"
