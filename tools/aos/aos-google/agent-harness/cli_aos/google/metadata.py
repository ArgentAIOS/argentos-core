from __future__ import annotations

import json
from copy import deepcopy
from functools import lru_cache
from pathlib import Path

from .constants import CONNECTOR_PATH, MANIFEST_SCHEMA_VERSION, MODE_ORDER, PERMISSIONS_PATH
from .errors import CliError


def _load_json(path: Path) -> dict:
    try:
        data = json.loads(path.read_text())
    except FileNotFoundError as exc:
        raise CliError(
            code="INVALID_CONFIGURATION",
            message=f"Missing manifest: {path}",
            exit_code=5,
        ) from exc
    except json.JSONDecodeError as exc:
        raise CliError(
            code="INVALID_CONFIGURATION",
            message=f"Invalid JSON in manifest: {path}",
            exit_code=5,
        ) from exc

    if not isinstance(data, dict):
        raise CliError(
            code="INVALID_CONFIGURATION",
            message=f"Manifest must be a JSON object: {path}",
            exit_code=5,
        )
    return data


@lru_cache(maxsize=1)
def load_connector_manifest() -> dict:
    return _load_json(CONNECTOR_PATH)


@lru_cache(maxsize=1)
def load_permissions_manifest() -> dict:
    return _load_json(PERMISSIONS_PATH)


def connector_tool() -> str:
    return str(load_connector_manifest().get("tool", "aos-google"))


def connector_backend() -> str:
    return str(load_connector_manifest().get("backend", "gws"))


def manifest_schema_version() -> str:
    return str(load_connector_manifest().get("manifest_schema_version", MANIFEST_SCHEMA_VERSION))


def connector_section() -> dict:
    manifest = load_connector_manifest()
    connector = manifest.get("connector")
    if not isinstance(connector, dict):
        raise CliError(
            code="INVALID_CONFIGURATION",
            message="Connector manifest is missing a connector block",
            exit_code=5,
    )
    return deepcopy(connector)


def connector_scope() -> dict | None:
    manifest = load_connector_manifest()
    scope = manifest.get("scope")
    if scope is None:
        return None
    if not isinstance(scope, dict):
        raise CliError(
            code="INVALID_CONFIGURATION",
            message="Connector manifest scope must be an object when provided",
            exit_code=5,
        )
    return deepcopy(scope)


def connector_auth() -> dict:
    manifest = load_connector_manifest()
    auth = manifest.get("auth")
    if not isinstance(auth, dict):
        raise CliError(
            code="INVALID_CONFIGURATION",
            message="Connector manifest is missing auth metadata",
            exit_code=5,
        )
    return deepcopy(auth)


def connector_commands() -> list[dict]:
    manifest = load_connector_manifest()
    commands = manifest.get("commands", [])
    if not isinstance(commands, list):
        raise CliError(
            code="INVALID_CONFIGURATION",
            message="Connector manifest commands must be a list",
            exit_code=5,
        )
    normalized: list[dict] = []
    for command in commands:
        if not isinstance(command, dict):
            raise CliError(
                code="INVALID_CONFIGURATION",
                message="Connector manifest commands must contain objects",
                exit_code=5,
            )
        normalized.append(deepcopy(command))
    return normalized


def permission_map() -> dict[str, str]:
    manifest = load_permissions_manifest()
    permissions = manifest.get("permissions", {})
    if not isinstance(permissions, dict):
        raise CliError(
            code="INVALID_CONFIGURATION",
            message="Permissions manifest must contain an object under permissions",
            exit_code=5,
        )
    normalized: dict[str, str] = {}
    for command_id, mode in permissions.items():
        normalized[str(command_id)] = str(mode)
    return normalized


def validate_connector_permissions() -> None:
    permissions = permission_map()
    missing: list[str] = []
    mismatched: list[dict[str, str]] = []
    invalid_modes: list[dict[str, str]] = []

    for command in connector_commands():
        command_id = str(command.get("id", "")).strip()
        required_mode = str(command.get("required_mode", "")).strip()
        if not command_id:
            raise CliError(
                code="INVALID_CONFIGURATION",
                message="Connector command is missing an id",
                exit_code=5,
            )
        if required_mode not in MODE_ORDER:
            invalid_modes.append({"command": command_id, "required_mode": required_mode})
            continue
        manifest_mode = permissions.get(command_id)
        if manifest_mode is None:
            missing.append(command_id)
            continue
        if manifest_mode != required_mode:
            mismatched.append(
                {
                    "command": command_id,
                    "manifest_required_mode": required_mode,
                    "permissions_required_mode": manifest_mode,
                }
            )

    if missing or mismatched or invalid_modes:
        raise CliError(
            code="INVALID_CONFIGURATION",
            message="Connector metadata does not match permissions metadata",
            exit_code=5,
            details={
                "missing_permissions": missing,
                "mismatched_modes": mismatched,
                "invalid_required_modes": invalid_modes,
            },
        )


def capabilities_payload(version: str) -> dict:
    validate_connector_permissions()
    return {
        "tool": connector_tool(),
        "backend": connector_backend(),
        "version": version,
        "manifest_schema_version": manifest_schema_version(),
        "modes": MODE_ORDER,
        "connector": connector_section(),
        "scope": connector_scope(),
        "auth": connector_auth(),
        "commands": connector_commands(),
    }
