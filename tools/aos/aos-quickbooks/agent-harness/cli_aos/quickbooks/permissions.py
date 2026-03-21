from __future__ import annotations

import json

from .constants import CONNECTOR_META_PATH, MODE_ORDER, PERMISSIONS_PATH
from .errors import CliError


def _mode_allows(actual: str, required: str) -> bool:
    return MODE_ORDER.index(actual) >= MODE_ORDER.index(required)


def load_permissions() -> dict[str, str]:
    payload = json.loads(PERMISSIONS_PATH.read_text())
    return payload.get("permissions", {})


def load_connector_manifest() -> dict[str, object]:
    return json.loads(CONNECTOR_META_PATH.read_text())


def require_mode(mode: str, command_id: str) -> None:
    permissions = load_permissions()
    required = permissions.get(command_id, "admin")
    if _mode_allows(mode, required):
        return
    raise CliError(
        code="PERMISSION_DENIED",
        message=f"Command requires mode={required}",
        exit_code=3,
        details={"required_mode": required, "actual_mode": mode},
    )
