from __future__ import annotations

from pathlib import Path

TOOL_NAME = "aos-dart"
BACKEND_NAME = "dart-api"
DEFAULT_BASE_URL = "https://app.itsdart.com/api/v0"
DEFAULT_TIMEOUT_SECONDS = 20
MODE_ORDER = ["readonly", "write", "full", "admin"]
IMPLEMENTATION_MODE = "live_read_write"
LIVE_READ_SURFACES = ["dartboard", "task", "doc", "comment", "property"]
LIVE_WRITE_SURFACES = ["task.create", "task.update", "task.delete", "doc.create", "comment.create"]

ENV_API_KEY = "DART_API_KEY"
ENV_BASE_URL = "DART_BASE_URL"
ENV_DARTBOARD_ID = "DART_DARTBOARD_ID"
ENV_TASK_ID = "DART_TASK_ID"
ENV_DOC_ID = "DART_DOC_ID"


def harness_root() -> Path:
    return Path(__file__).resolve().parents[2]


def connector_root() -> Path:
    return Path(__file__).resolve().parents[3]


CONNECTOR_PATH = connector_root() / "connector.json"
PERMISSIONS_PATH = harness_root() / "permissions.json"
