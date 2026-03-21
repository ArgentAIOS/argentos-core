from __future__ import annotations

import json

from .constants import CONNECTOR_PATH, MODE_ORDER, PERMISSIONS_PATH
from .errors import CliError


def load_permissions_manifest() -> dict:
    return json.loads(PERMISSIONS_PATH.read_text())


def load_connector_manifest() -> dict:
    return json.loads(CONNECTOR_PATH.read_text())


def permission_map() -> dict[str, str]:
    return load_permissions_manifest().get("permissions", {})


def mode_allows(actual: str, required: str) -> bool:
    return MODE_ORDER.index(actual) >= MODE_ORDER.index(required)


def require_mode(actual_mode: str, command_id: str) -> None:
    required = permission_map().get(command_id, "admin")
    if mode_allows(actual_mode, required):
        return
    raise CliError(
        code="PERMISSION_DENIED",
        message=f"Command requires mode={required}",
        exit_code=3,
        details={"required_mode": required, "actual_mode": actual_mode},
    )
