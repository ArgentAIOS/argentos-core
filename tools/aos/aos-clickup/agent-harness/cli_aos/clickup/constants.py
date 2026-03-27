from __future__ import annotations

from pathlib import Path

TOOL_NAME = "aos-clickup"
BACKEND_NAME = "clickup-api"
DEFAULT_BASE_URL = "https://api.clickup.com/api/v2"
DEFAULT_TIMEOUT_SECONDS = 20
MODE_ORDER = ["readonly", "write", "full", "admin"]
IMPLEMENTATION_MODE = "live_read_write"
LIVE_READ_SURFACES = ["workspace", "space", "list", "task", "comment", "doc", "time_tracking", "goal"]
LIVE_WRITE_SURFACES = ["task.create", "task.update", "task.delete", "list.create", "comment.create", "doc.create", "time_tracking.create"]

ENV_API_TOKEN = "CLICKUP_API_TOKEN"
ENV_ACCESS_TOKEN = "CLICKUP_ACCESS_TOKEN"
ENV_BASE_URL = "CLICKUP_BASE_URL"
ENV_WORKSPACE_ID = "CLICKUP_WORKSPACE_ID"
ENV_SPACE_ID = "CLICKUP_SPACE_ID"
ENV_LIST_ID = "CLICKUP_LIST_ID"
ENV_TASK_ID = "CLICKUP_TASK_ID"


def harness_root() -> Path:
    return Path(__file__).resolve().parents[2]


def connector_root() -> Path:
    return Path(__file__).resolve().parents[3]


CONNECTOR_PATH = connector_root() / "connector.json"
PERMISSIONS_PATH = harness_root() / "permissions.json"
