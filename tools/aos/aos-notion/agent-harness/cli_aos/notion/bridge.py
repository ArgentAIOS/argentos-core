from __future__ import annotations

import json
from pathlib import Path
from typing import Any

from . import runtime as runtime_module
from .config import redacted_config_snapshot, resolve_runtime_values
from .constants import BACKEND_NAME, CONNECTOR_DESCRIPTOR, MANIFEST_SCHEMA_VERSION, MODE_ORDER, TOOL_NAME

ROOT_DIR = Path(__file__).resolve().parents[3]
CONNECTOR_PATH = ROOT_DIR / "connector.json"
PERMISSIONS_PATH = ROOT_DIR / "agent-harness" / "permissions.json"


def _load_json(path: Path) -> dict[str, Any]:
    return json.loads(path.read_text())


def _permissions() -> dict[str, str]:
    return _load_json(PERMISSIONS_PATH).get("permissions", {})


def _connector_commands() -> list[dict[str, Any]]:
    return _load_json(CONNECTOR_PATH).get("commands", [])


def capabilities_snapshot() -> dict[str, Any]:
    return {
        "tool": TOOL_NAME,
        "backend": BACKEND_NAME,
        "version": "0.1.0",
        "manifest_schema_version": MANIFEST_SCHEMA_VERSION,
        "modes": MODE_ORDER,
        "connector": CONNECTOR_DESCRIPTOR,
        "auth": _load_json(CONNECTOR_PATH).get("auth", {}),
        "commands": _connector_commands(),
    }


def health_snapshot(ctx_obj: dict[str, Any]) -> dict[str, Any]:
    return runtime_module.health_snapshot(ctx_obj)


def doctor_snapshot(ctx_obj: dict[str, Any]) -> dict[str, Any]:
    return {
        **runtime_module.doctor_snapshot(ctx_obj),
        "config": redacted_config_snapshot(ctx_obj),
        "permissions": sorted(_permissions().keys()),
    }


def config_snapshot(ctx_obj: dict[str, Any]) -> dict[str, Any]:
    return redacted_config_snapshot(ctx_obj)
