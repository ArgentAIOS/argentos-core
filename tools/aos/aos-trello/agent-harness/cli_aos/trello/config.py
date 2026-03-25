from __future__ import annotations

import os
from typing import Any

from . import __version__
from .constants import (
    BACKEND_NAME,
    COMMAND_SPECS,
    CONNECTOR_AUTH,
    CONNECTOR_CATEGORY,
    CONNECTOR_CATEGORIES,
    CONNECTOR_LABEL,
    CONNECTOR_RESOURCES,
    DEFAULT_API_BASE_URL,
    DEFAULT_API_BASE_URL_ENV,
    DEFAULT_API_KEY_ENV,
    DEFAULT_BOARD_ID_ENV,
    DEFAULT_CARD_ID_ENV,
    DEFAULT_LIST_ID_ENV,
    DEFAULT_MEMBER_ID_ENV,
    DEFAULT_TOKEN_ENV,
    TOOL_NAME,
)


def _env(*names: str) -> str:
    for name in names:
        value = os.getenv(name, "").strip()
        if value:
            return value
    return ""


def _redact(value: str | None, *, keep: int = 4) -> str:
    if not value:
        return ""
    if len(value) <= keep:
        return "*" * len(value)
    return f"{value[:2]}...{value[-keep:]}"


def _command_defaults_template() -> dict[str, dict[str, Any]]:
    return {
        "member.list": {"selection_surface": "board", "args": [DEFAULT_BOARD_ID_ENV]},
        "member.read": {"selection_surface": "member", "args": [DEFAULT_MEMBER_ID_ENV]},
        "board.read": {"selection_surface": "board", "args": [DEFAULT_BOARD_ID_ENV]},
        "list.list": {"selection_surface": "board", "args": [DEFAULT_BOARD_ID_ENV]},
        "list.read": {"selection_surface": "list", "args": [DEFAULT_LIST_ID_ENV]},
        "card.list": {"selection_surface": "list", "args": [DEFAULT_LIST_ID_ENV]},
        "card.read": {"selection_surface": "card", "args": [DEFAULT_CARD_ID_ENV]},
        "card.create_draft": {"selection_surface": "list", "args": [DEFAULT_LIST_ID_ENV]},
        "card.update_draft": {"selection_surface": "card", "args": [DEFAULT_CARD_ID_ENV]},
    }


def _command_defaults(board_id: str, member_id: str, list_id: str, card_id: str) -> dict[str, dict[str, Any]]:
    defaults: dict[str, dict[str, Any]] = {}
    if board_id:
        defaults["member.list"] = {"selection_surface": "board", "args": [board_id]}
        defaults["board.read"] = {"selection_surface": "board", "args": [board_id]}
        defaults["list.list"] = {"selection_surface": "board", "args": [board_id]}
    if member_id:
        defaults["member.read"] = {"selection_surface": "member", "args": [member_id]}
    if list_id:
        defaults["list.read"] = {"selection_surface": "list", "args": [list_id]}
        defaults["card.list"] = {"selection_surface": "list", "args": [list_id]}
        defaults["card.create_draft"] = {"selection_surface": "list", "args": [list_id]}
    if card_id:
        defaults["card.read"] = {"selection_surface": "card", "args": [card_id]}
        defaults["card.update_draft"] = {"selection_surface": "card", "args": [card_id]}
    return defaults


def _picker_scopes() -> dict[str, Any]:
    return {
        "account": {
            "kind": "account",
            "selection_surface": "account",
            "resource": "trello.account",
            "source_command": "account.read",
            "source_fields": ["id", "full_name", "username", "initials", "avatar_url"],
        },
        "member": {
            "kind": "member",
            "selection_surface": "member",
            "resource": "trello.member",
            "source_command": "member.list",
            "source_fields": ["id", "full_name", "username", "initials", "avatar_url"],
        },
        "board": {
            "kind": "board",
            "selection_surface": "board",
            "resource": "trello.board",
            "source_command": "board.list",
            "source_fields": ["id", "name", "closed", "url", "short_url"],
        },
        "list": {
            "kind": "list",
            "selection_surface": "list",
            "resource": "trello.list",
            "source_command": "list.list",
            "source_fields": ["id", "name", "closed", "board_id", "url"],
        },
        "card": {
            "kind": "card",
            "selection_surface": "card",
            "resource": "trello.card",
            "source_command": "card.list",
            "source_fields": ["id", "name", "closed", "board_id", "list_id", "url"],
        },
    }


def resolve_runtime_values(ctx_obj: dict[str, Any]) -> dict[str, Any]:
    api_key = _env(DEFAULT_API_KEY_ENV)
    token = _env(DEFAULT_TOKEN_ENV)
    board_id = _env(DEFAULT_BOARD_ID_ENV)
    member_id = _env(DEFAULT_MEMBER_ID_ENV)
    list_id = _env(DEFAULT_LIST_ID_ENV)
    card_id = _env(DEFAULT_CARD_ID_ENV)
    api_base_url = _env(DEFAULT_API_BASE_URL_ENV) or DEFAULT_API_BASE_URL

    configured = {
        DEFAULT_API_KEY_ENV: bool(api_key),
        DEFAULT_TOKEN_ENV: bool(token),
        DEFAULT_BOARD_ID_ENV: bool(board_id),
        DEFAULT_MEMBER_ID_ENV: bool(member_id),
        DEFAULT_LIST_ID_ENV: bool(list_id),
        DEFAULT_CARD_ID_ENV: bool(card_id),
        DEFAULT_API_BASE_URL_ENV: bool(os.getenv(DEFAULT_API_BASE_URL_ENV, "").strip()),
    }
    missing_keys = [name for name in (DEFAULT_API_KEY_ENV, DEFAULT_TOKEN_ENV) if not configured[name]]
    auth_ready = bool(api_key and token)
    live_backend_ready = auth_ready
    command_defaults = _command_defaults(board_id, member_id, list_id, card_id)
    command_defaults_template = _command_defaults_template()
    read_support = {
        "account.read": auth_ready,
        "member.list": auth_ready and bool(board_id),
        "member.read": auth_ready,
        "board.list": auth_ready,
        "board.read": auth_ready and bool(board_id),
        "list.list": auth_ready and bool(board_id),
        "list.read": auth_ready and bool(list_id),
        "card.list": auth_ready and bool(list_id),
        "card.read": auth_ready and bool(card_id),
    }
    write_support = {
        "card.create_draft": False,
        "card.update_draft": False,
    }

    return {
        "tool": TOOL_NAME,
        "version": __version__,
        "backend": BACKEND_NAME,
        "label": CONNECTOR_LABEL,
        "category": CONNECTOR_CATEGORY,
        "categories": CONNECTOR_CATEGORIES,
        "resources": CONNECTOR_RESOURCES,
        "auth": {
            "kind": CONNECTOR_AUTH["kind"],
            "required": CONNECTOR_AUTH["required"],
            "service_keys": list(CONNECTOR_AUTH["service_keys"]),
            "configured": configured,
            "missing_keys": missing_keys,
            "redacted": {
                DEFAULT_API_KEY_ENV: _redact(api_key),
                DEFAULT_TOKEN_ENV: _redact(token),
                DEFAULT_BOARD_ID_ENV: _redact(board_id),
                DEFAULT_MEMBER_ID_ENV: _redact(member_id),
                DEFAULT_LIST_ID_ENV: _redact(list_id),
                DEFAULT_CARD_ID_ENV: _redact(card_id),
                DEFAULT_API_BASE_URL_ENV: _redact(api_base_url),
            },
            "interactive_setup": list(CONNECTOR_AUTH["interactive_setup"]),
        },
        "runtime": {
            "api_base_url": api_base_url.rstrip("/"),
            "auth_ready": auth_ready,
            "live_backend_ready": live_backend_ready,
            "live_read_ready": live_backend_ready,
            "implementation_mode": "live_read_first_with_scaffolded_writes" if auth_ready else "configuration_only",
            "board_id": board_id,
            "board_id_present": bool(board_id),
            "member_id": member_id,
            "member_id_present": bool(member_id),
            "list_id": list_id,
            "list_id_present": bool(list_id),
            "card_id": card_id,
            "card_id_present": bool(card_id),
            "command_defaults_ready": bool(command_defaults),
            "command_defaults": command_defaults,
            "command_defaults_template": command_defaults_template,
            "picker_scopes": _picker_scopes(),
            "read_support": read_support,
            "write_support": write_support,
        },
        "read_support": read_support,
        "write_support": write_support,
        "context": {
            "board_id": board_id,
            "member_id": member_id,
            "list_id": list_id,
            "card_id": card_id,
        },
        "scope": {
            "board_id": board_id,
            "member_id": member_id,
            "list_id": list_id,
            "card_id": card_id,
            "commandDefaults": command_defaults,
            "commandDefaultsTemplate": command_defaults_template,
            "pickerScopes": _picker_scopes(),
        },
    }


def redacted_config_snapshot() -> dict[str, Any]:
    config = resolve_runtime_values({})
    return {
        "tool": config["tool"],
        "version": config["version"],
        "backend": config["backend"],
        "label": config["label"],
        "category": config["category"],
        "categories": config["categories"],
        "resources": config["resources"],
        "auth": config["auth"],
        "runtime": config["runtime"],
        "read_support": config["read_support"],
        "write_support": config["write_support"],
        "scope": config["scope"],
        "context": {
            "board_id_present": bool(config["context"]["board_id"]),
            "member_id_present": bool(config["context"]["member_id"]),
            "list_id_present": bool(config["context"]["list_id"]),
            "card_id_present": bool(config["context"]["card_id"]),
        },
        "supported_commands": [spec["id"] for spec in COMMAND_SPECS],
    }
