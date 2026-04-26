from __future__ import annotations

import os
from typing import Any, Callable

from .client import TrelloApiError, TrelloClient
from .config import redacted_config_snapshot, resolve_runtime_values
from .constants import (
    BACKEND_NAME,
    CONNECTOR_PATH,
    DEFAULT_API_KEY_ENV,
    DEFAULT_BOARD_ID_ENV,
    DEFAULT_CARD_ID_ENV,
    DEFAULT_LIST_ID_ENV,
    DEFAULT_MEMBER_ID_ENV,
    DEFAULT_TOKEN_ENV,
    MANIFEST_SCHEMA_VERSION,
    MODE_ORDER,
    TOOL_NAME,
)
from .errors import CliError
from .service_keys import service_key_env


def _load_manifest() -> dict[str, Any]:
    import json

    return json.loads(CONNECTOR_PATH.read_text())


def capabilities_snapshot() -> dict[str, Any]:
    manifest = _load_manifest()
    return {
        "tool": manifest["tool"],
        "backend": manifest["backend"],
        "manifest_schema_version": manifest.get("manifest_schema_version", MANIFEST_SCHEMA_VERSION),
        "connector": manifest["connector"],
        "auth": manifest["auth"],
        "scope": manifest.get("scope", {}),
        "commands": manifest["commands"],
        "modes": MODE_ORDER,
        "read_support": {
            command["id"]: command["action_class"] == "read"
            for command in manifest["commands"]
            if command["id"] not in {"capabilities", "config.show", "health", "doctor"}
        },
        "write_support": {
            command["id"]: True
            for command in manifest["commands"]
            if command["action_class"] == "write"
        },
    }


def config_snapshot(ctx_obj: dict[str, Any]) -> dict[str, Any]:
    return redacted_config_snapshot()


def create_client(ctx_obj: dict[str, Any]) -> TrelloClient:
    runtime = resolve_runtime_values(ctx_obj)
    api_key = (service_key_env(DEFAULT_API_KEY_ENV) or "").strip()
    token = (service_key_env(DEFAULT_TOKEN_ENV) or "").strip()
    if not api_key or not token:
        raise CliError(
            code="TRELLO_SETUP_REQUIRED",
            message="Trello connector is missing the required API key or token",
            exit_code=4,
            details={"missing_keys": list(runtime["auth"]["missing_keys"])},
        )
    return TrelloClient(api_key=api_key, token=token, base_url=runtime["runtime"]["api_base_url"])


def _write_error(err: TrelloApiError, *, operation: str) -> CliError:
    code = "TRELLO_AUTH_FAILED" if err.status_code in {401, 403} else "TRELLO_API_ERROR"
    message = err.message if err.status_code not in {401, 403} else f"Trello {operation} failed because the integration lacks access"
    return CliError(
        code=code,
        message=message,
        exit_code=5 if err.status_code in {401, 403} else 4,
        details={
            "operation": operation,
            "status_code": err.status_code,
            "error_code": err.code,
            "error_details": err.details or {},
        },
    )


def _compact_labels(items: list[dict[str, Any]], *, limit: int = 3) -> str:
    labels = [str(item.get("name") or item.get("full_name") or item.get("username") or item.get("id") or "").strip() for item in items]
    labels = [label for label in labels if label]
    if not labels:
        return ""
    if len(labels) > limit:
        return ", ".join(labels[:limit] + [f"+{len(labels) - limit} more"])
    return ", ".join(labels)


def _picker(items: list[dict[str, Any]], *, kind: str) -> dict[str, Any]:
    return {"kind": kind, "items": items, "count": len(items)}


def _picker_item(
    item: dict[str, Any],
    *,
    kind: str,
    scope_kind: str,
    scope_preview: str,
) -> dict[str, Any]:
    item_id = str(item.get("id") or "")
    label = (
        str(item.get("name") or item.get("full_name") or item.get("username") or item_id or kind)
        .strip()
    )
    payload: dict[str, Any] = {
        "kind": kind,
        "id": item_id or label,
        "label": label,
        "scope_kind": scope_kind,
        "scope_preview": f"{scope_preview} > {label}" if label else scope_preview,
    }
    if item.get("url"):
        payload["url"] = item["url"]
    return payload


def _scope_preview(
    *,
    command_id: str,
    selection_surface: str,
    label: str | None = None,
    scope_id: str | None = None,
    **extra: Any,
) -> dict[str, Any]:
    preview = {
        "command_id": command_id,
        "selection_surface": selection_surface,
    }
    if label is not None:
        preview["label"] = label
    if scope_id is not None:
        preview["id"] = scope_id
    preview.update(extra)
    return preview


def _board_id(ctx_obj: dict[str, Any], value: str | None) -> str:
    runtime = resolve_runtime_values(ctx_obj)
    resolved = (value or runtime["context"]["board_id"] or "").strip()
    if resolved:
        return resolved
    raise CliError(
        code="TRELLO_BOARD_ID_REQUIRED",
        message="A board id is required for this command",
        exit_code=4,
        details={"missing_keys": [DEFAULT_BOARD_ID_ENV]},
    )


def _list_id(ctx_obj: dict[str, Any], value: str | None) -> str:
    runtime = resolve_runtime_values(ctx_obj)
    resolved = (value or runtime["context"]["list_id"] or "").strip()
    if resolved:
        return resolved
    raise CliError(
        code="TRELLO_LIST_ID_REQUIRED",
        message="A list id is required for this command",
        exit_code=4,
        details={"missing_keys": [DEFAULT_LIST_ID_ENV]},
    )


def _card_id(ctx_obj: dict[str, Any], value: str | None) -> str:
    runtime = resolve_runtime_values(ctx_obj)
    resolved = (value or runtime["context"]["card_id"] or "").strip()
    if resolved:
        return resolved
    raise CliError(
        code="TRELLO_CARD_ID_REQUIRED",
        message="A card id is required for this command",
        exit_code=4,
        details={"missing_keys": [DEFAULT_CARD_ID_ENV]},
    )


def _member_id(ctx_obj: dict[str, Any], value: str | None) -> str:
    runtime = resolve_runtime_values(ctx_obj)
    resolved = (value or runtime["context"]["member_id"] or "").strip()
    if resolved:
        return resolved
    return ""


def probe_runtime(ctx_obj: dict[str, Any]) -> dict[str, Any]:
    runtime = resolve_runtime_values(ctx_obj)
    if not runtime["auth"]["configured"][DEFAULT_API_KEY_ENV] or not runtime["auth"]["configured"][DEFAULT_TOKEN_ENV]:
        return {
            "ok": False,
            "code": "TRELLO_SETUP_REQUIRED",
            "message": "Trello connector is missing the required API key or token",
            "details": {
                "missing_keys": list(runtime["auth"]["missing_keys"]),
                "live_backend_available": False,
                "probe_mode": "setup-required",
            },
        }

    try:
        client = create_client(ctx_obj)
        account = client.current_member()
        board = None
        list_item = None
        card = None
        member = None

        board_id = runtime["context"]["board_id"]
        list_id = runtime["context"]["list_id"]
        card_id = runtime["context"]["card_id"]
        member_id = runtime["context"]["member_id"]
        if board_id:
            board = client.read_board(board_id)
        if list_id:
            list_item = client.read_list(list_id)
        if card_id:
            card = client.read_card(card_id)
        if member_id:
            member = client.read_member(member_id)
    except CliError as err:
        return {
            "ok": False,
            "code": err.code,
            "message": err.message,
            "details": {**err.details, "live_backend_available": False, "probe_mode": "setup-required"},
        }
    except TrelloApiError as err:
        code = "TRELLO_AUTH_FAILED" if err.status_code in {401, 403} else "TRELLO_API_ERROR"
        message = (
            "Trello token is configured but the integration cannot access the requested resources"
            if err.status_code in {401, 403}
            else err.message
        )
        return {
            "ok": False,
            "code": code,
            "message": message,
            "details": {
                "status_code": err.status_code,
                "error_code": err.code,
                "error_details": err.details or {},
                "live_backend_available": False,
                "probe_mode": "live-read",
            },
        }

    return {
        "ok": True,
        "code": "OK",
        "message": "Trello live read runtime is ready",
        "details": {
            "probe_mode": "live-read",
            "live_backend_available": True,
            "runtime_ready": True,
            "account": account,
            "board": board,
            "list": list_item,
            "card": card,
            "member": member,
        },
    }


def _health_checks(config: dict[str, Any], probe: dict[str, Any]) -> list[dict[str, Any]]:
    runtime = config["runtime"]
    return [
        {
            "name": "auth",
            "ok": runtime["auth_ready"],
            "details": {
                "missing_keys": list(config["auth"]["missing_keys"]),
                "api_key_present": config["auth"]["configured"][DEFAULT_API_KEY_ENV],
                "token_present": config["auth"]["configured"][DEFAULT_TOKEN_ENV],
            },
        },
        {
            "name": "live_backend",
            "ok": bool(probe.get("ok")),
            "details": probe.get("details", {}),
        },
        {
            "name": "scope_defaults",
            "ok": runtime["command_defaults_ready"],
            "details": {
                "board_id_present": runtime["board_id_present"],
                "member_id_present": runtime["member_id_present"],
                "list_id_present": runtime["list_id_present"],
                "card_id_present": runtime["card_id_present"],
            },
        },
        {
            "name": "write_bridge",
            "ok": runtime["auth_ready"],
            "details": {
                "live_writes_enabled": runtime["auth_ready"],
                "scaffold_only": False,
            },
        },
    ]


def health_snapshot(ctx_obj: dict[str, Any]) -> dict[str, Any]:
    config = resolve_runtime_values(ctx_obj)
    probe = probe_runtime(ctx_obj)
    auth_ready = config["runtime"]["auth_ready"]
    if not auth_ready:
        status = "needs_setup"
        summary = "Trello live reads and writes need TRELLO_API_KEY and TRELLO_TOKEN before any command can run"
    elif probe["ok"]:
        status = "ready"
        summary = "Trello live reads and the existing write command IDs are ready."
    else:
        status = "degraded"
        summary = probe["message"]

    return {
        "status": status,
        "summary": summary,
        "connector": {
            "backend": BACKEND_NAME,
            "live_backend_available": bool(probe.get("ok")),
            "live_read_available": bool(probe.get("ok")),
            "write_bridge_available": auth_ready,
            "scaffold_only": False,
        },
        "auth": config["auth"],
        "scope": {
            "board_id": config["context"]["board_id"] or None,
            "member_id": config["context"]["member_id"] or None,
            "list_id": config["context"]["list_id"] or None,
            "card_id": config["context"]["card_id"] or None,
            "command_defaults_ready": config["runtime"]["command_defaults_ready"],
        },
        "checks": _health_checks(config, probe),
        "implementation_mode": config["runtime"]["implementation_mode"],
        "live_backend_available": bool(probe.get("ok")),
        "live_read_available": bool(probe.get("ok")),
        "write_bridge_available": auth_ready,
        "runtime_ready": bool(probe.get("ok")),
        "probe": probe,
        "next_steps": [
            f"Set {DEFAULT_API_KEY_ENV} and {DEFAULT_TOKEN_ENV} in API Keys.",
            "Optionally pin board, list, card, and member ids to make worker defaults deterministic.",
            "Run card.create_draft and card.update_draft in write mode; both command IDs now perform live Trello writes.",
        ],
    }


def doctor_snapshot(ctx_obj: dict[str, Any]) -> dict[str, Any]:
    config = resolve_runtime_values(ctx_obj)
    probe = probe_runtime(ctx_obj)
    ready = bool(probe.get("ok"))
    status = "ready" if ready else "needs_setup" if config["runtime"]["auth_ready"] is False else "degraded"
    return {
        "status": status,
        "summary": "Trello connector diagnostics.",
        "runtime": {
            "implementation_mode": config["runtime"]["implementation_mode"],
            "auth_ready": config["runtime"]["auth_ready"],
            "command_defaults_ready": config["runtime"]["command_defaults_ready"],
            "command_defaults": config["runtime"]["command_defaults"],
            "read_support": config["read_support"],
            "write_support": config["write_support"],
            "board_id_present": config["runtime"]["board_id_present"],
            "member_id_present": config["runtime"]["member_id_present"],
            "list_id_present": config["runtime"]["list_id_present"],
            "card_id_present": config["runtime"]["card_id_present"],
        },
        "checks": _health_checks(config, probe),
        "supported_read_commands": [
            "account.read",
            "member.list",
            "member.read",
            "board.list",
            "board.read",
            "list.list",
            "list.read",
            "card.list",
            "card.read",
        ],
        "supported_write_commands": ["card.create_draft", "card.update_draft"],
        "next_steps": [
            f"Set {DEFAULT_API_KEY_ENV} and {DEFAULT_TOKEN_ENV} in API Keys.",
            "Use account.read to confirm the connected member before choosing board, list, and card pickers.",
            "Use write mode when executing card.create_draft and card.update_draft; the legacy command IDs are preserved for compatibility.",
        ],
        "probe": probe,
    }


def _picker_preview(labels: list[str], *, empty_text: str, limit: int = 3) -> str:
    if not labels:
        return empty_text
    visible = labels[:limit]
    if len(labels) > limit:
        visible.append(f"+{len(labels) - limit} more")
    return ", ".join(visible)


def account_read_result(ctx_obj: dict[str, Any]) -> dict[str, Any]:
    client = create_client(ctx_obj)
    account = client.current_member()
    name = account.get("full_name") or account.get("username") or account.get("id") or "connected member"
    return {
        "status": "live_read",
        "backend": BACKEND_NAME,
        "summary": f"Read Trello account {name}.",
        "account": account,
        "scope": {"kind": "account", "selection_surface": "account"},
        "scope_preview": _scope_preview(
            command_id="account.read",
            selection_surface="account",
            label=str(name),
            scope_id=str(account.get("id") or ""),
        ),
        "picker": _picker(
            [
                _picker_item(
                    account,
                    kind="member",
                    scope_kind="account",
                    scope_preview="Account",
                )
            ],
            kind="account",
        ),
    }


def member_list_result(ctx_obj: dict[str, Any], *, board_id: str | None, limit: int) -> dict[str, Any]:
    client = create_client(ctx_obj)
    resolved_board_id = _board_id(ctx_obj, board_id)
    members = client.list_board_members(resolved_board_id, limit=limit)
    labels = [str(member.get("full_name") or member.get("username") or member.get("id") or "") for member in members]
    return {
        "status": "live_read",
        "backend": BACKEND_NAME,
        "summary": f"Returned {len(members)} member{'' if len(members) == 1 else 's'} for board {resolved_board_id}.",
        "board_id": resolved_board_id,
        "members": members,
        "member_count": len(members),
        "scope": {"kind": "board", "id": resolved_board_id, "selection_surface": "member"},
        "scope_preview": _scope_preview(
            command_id="member.list",
            selection_surface="member",
            scope_id=resolved_board_id,
            label=_picker_preview(labels, empty_text=f"Board {resolved_board_id} members"),
        ),
        "picker": _picker(
            [
                _picker_item(member, kind="member", scope_kind="board", scope_preview=f"Board {resolved_board_id}")
                for member in members
            ],
            kind="member",
        ),
    }


def member_read_result(ctx_obj: dict[str, Any], *, member_id: str | None) -> dict[str, Any]:
    client = create_client(ctx_obj)
    resolved_member_id = _member_id(ctx_obj, member_id)
    member = client.current_member() if not resolved_member_id else client.read_member(resolved_member_id)
    name = member.get("full_name") or member.get("username") or member.get("id") or "member"
    return {
        "status": "live_read",
        "backend": BACKEND_NAME,
        "summary": f"Read Trello member {name}.",
        "member": member,
        "scope": {"kind": "member", "selection_surface": "member"},
        "scope_preview": _scope_preview(
            command_id="member.read",
            selection_surface="member",
            label=str(name),
            scope_id=str(member.get("id") or resolved_member_id or ""),
        ),
        "picker": _picker(
            [
                _picker_item(member, kind="member", scope_kind="member", scope_preview="Member"),
            ],
            kind="member",
        ),
    }


def board_list_result(ctx_obj: dict[str, Any], *, limit: int) -> dict[str, Any]:
    client = create_client(ctx_obj)
    boards = client.list_boards(limit=limit)
    labels = [str(board.get("name") or board.get("id") or "") for board in boards]
    return {
        "status": "live_read",
        "backend": BACKEND_NAME,
        "summary": f"Returned {len(boards)} board{'' if len(boards) == 1 else 's'}.",
        "boards": boards,
        "board_count": len(boards),
        "scope": {"kind": "account", "selection_surface": "board"},
        "scope_preview": _scope_preview(
            command_id="board.list",
            selection_surface="board",
            label=_picker_preview(labels, empty_text="No boards"),
        ),
        "picker": _picker(
            [
                _picker_item(board, kind="board", scope_kind="account", scope_preview="Boards")
                for board in boards
            ],
            kind="board",
        ),
    }


def board_read_result(ctx_obj: dict[str, Any], *, board_id: str | None) -> dict[str, Any]:
    client = create_client(ctx_obj)
    resolved_board_id = _board_id(ctx_obj, board_id)
    board = client.read_board(resolved_board_id)
    name = board.get("name") or board.get("id") or resolved_board_id
    return {
        "status": "live_read",
        "backend": BACKEND_NAME,
        "summary": f"Read Trello board {name}.",
        "board_id": resolved_board_id,
        "board": board,
        "scope": {"kind": "board", "id": resolved_board_id, "selection_surface": "board"},
        "scope_preview": _scope_preview(
            command_id="board.read",
            selection_surface="board",
            label=str(name),
            scope_id=resolved_board_id,
        ),
        "picker": _picker(
            [
                _picker_item(board, kind="board", scope_kind="board", scope_preview=f"Board {resolved_board_id}")
            ],
            kind="board",
        ),
    }


def list_list_result(ctx_obj: dict[str, Any], *, board_id: str | None) -> dict[str, Any]:
    client = create_client(ctx_obj)
    resolved_board_id = _board_id(ctx_obj, board_id)
    lists = client.list_lists(resolved_board_id)
    labels = [str(list_item.get("name") or list_item.get("id") or "") for list_item in lists]
    return {
        "status": "live_read",
        "backend": BACKEND_NAME,
        "summary": f"Returned {len(lists)} list{'' if len(lists) == 1 else 's'} for board {resolved_board_id}.",
        "board_id": resolved_board_id,
        "lists": lists,
        "list_count": len(lists),
        "scope": {"kind": "board", "id": resolved_board_id, "selection_surface": "list"},
        "scope_preview": _scope_preview(
            command_id="list.list",
            selection_surface="list",
            label=_picker_preview(labels, empty_text=f"Board {resolved_board_id} lists"),
            scope_id=resolved_board_id,
        ),
        "picker": _picker(
            [
                _picker_item(list_item, kind="list", scope_kind="board", scope_preview=f"Board {resolved_board_id}")
                for list_item in lists
            ],
            kind="list",
        ),
    }


def list_read_result(ctx_obj: dict[str, Any], *, list_id: str | None) -> dict[str, Any]:
    client = create_client(ctx_obj)
    resolved_list_id = _list_id(ctx_obj, list_id)
    list_item = client.read_list(resolved_list_id)
    name = list_item.get("name") or list_item.get("id") or resolved_list_id
    return {
        "status": "live_read",
        "backend": BACKEND_NAME,
        "summary": f"Read Trello list {name}.",
        "list_id": resolved_list_id,
        "list": list_item,
        "scope": {"kind": "list", "id": resolved_list_id, "selection_surface": "list"},
        "scope_preview": _scope_preview(
            command_id="list.read",
            selection_surface="list",
            label=str(name),
            scope_id=resolved_list_id,
        ),
        "picker": _picker(
            [
                _picker_item(list_item, kind="list", scope_kind="list", scope_preview=f"List {resolved_list_id}")
            ],
            kind="list",
        ),
    }


def card_list_result(ctx_obj: dict[str, Any], *, list_id: str | None) -> dict[str, Any]:
    client = create_client(ctx_obj)
    resolved_list_id = _list_id(ctx_obj, list_id)
    cards = client.list_cards(resolved_list_id)
    labels = [str(card.get("name") or card.get("id") or "") for card in cards]
    return {
        "status": "live_read",
        "backend": BACKEND_NAME,
        "summary": f"Returned {len(cards)} card{'' if len(cards) == 1 else 's'} for list {resolved_list_id}.",
        "list_id": resolved_list_id,
        "cards": cards,
        "card_count": len(cards),
        "scope": {"kind": "list", "id": resolved_list_id, "selection_surface": "card"},
        "scope_preview": _scope_preview(
            command_id="card.list",
            selection_surface="card",
            label=_picker_preview(labels, empty_text=f"List {resolved_list_id} cards"),
            scope_id=resolved_list_id,
        ),
        "picker": _picker(
            [
                _picker_item(card, kind="card", scope_kind="list", scope_preview=f"List {resolved_list_id}")
                for card in cards
            ],
            kind="card",
        ),
    }


def card_read_result(ctx_obj: dict[str, Any], *, card_id: str | None) -> dict[str, Any]:
    client = create_client(ctx_obj)
    resolved_card_id = _card_id(ctx_obj, card_id)
    card = client.read_card(resolved_card_id)
    name = card.get("name") or card.get("id") or resolved_card_id
    return {
        "status": "live_read",
        "backend": BACKEND_NAME,
        "summary": f"Read Trello card {name}.",
        "card_id": resolved_card_id,
        "card": card,
        "scope": {"kind": "card", "id": resolved_card_id, "selection_surface": "card"},
        "scope_preview": _scope_preview(
            command_id="card.read",
            selection_surface="card",
            label=str(name),
            scope_id=resolved_card_id,
        ),
        "picker": _picker(
            [
                _picker_item(card, kind="card", scope_kind="card", scope_preview=f"Card {resolved_card_id}")
            ],
            kind="card",
        ),
    }


def scaffold_result(
    ctx_obj: dict[str, Any],
    *,
    command_id: str,
    resource: str,
    operation: str,
    inputs: dict[str, Any],
    consequential: bool = False,
) -> dict[str, Any]:
    runtime = resolve_runtime_values(ctx_obj)
    return {
        "status": "scaffold",
        "backend": BACKEND_NAME,
        "command_id": command_id,
        "resource": resource,
        "operation": operation,
        "executed": False,
        "consequential": consequential,
        "live_write_available": False,
        "scaffold_only": True,
        "inputs": inputs,
        "summary": "Write bridge not implemented yet; returning draft payload only.",
        "scope": {
            "kind": resource,
            "selection_surface": runtime["scope"].get("pickerScopes", {}).get(resource, {}).get("selection_surface", resource),
        },
        "scope_preview": _scope_preview(
            command_id=command_id,
            selection_surface=runtime["scope"].get("pickerScopes", {}).get(resource, {}).get("selection_surface", resource),
            label=operation.replace("_", " "),
            scope_id=str(inputs.get("card_id") or inputs.get("list_id") or ""),
        ),
    }


def create_card_result(ctx_obj: dict[str, Any], *, list_id: str | None, name: str, desc: str) -> dict[str, Any]:
    client = create_client(ctx_obj)
    resolved_list_id = _list_id(ctx_obj, list_id)
    try:
        card = client.create_card(list_id=resolved_list_id, name=name, desc=desc)
    except TrelloApiError as err:
        raise _write_error(err, operation="card.create_draft") from err

    card_name = card.get("name") or card.get("id") or name
    return {
        "status": "live_write",
        "backend": BACKEND_NAME,
        "command_id": "card.create_draft",
        "resource": "card",
        "operation": "create",
        "executed": True,
        "consequential": True,
        "live_write_available": True,
        "scaffold_only": False,
        "inputs": {
            "list_id": resolved_list_id,
            "name": name,
            "desc": desc,
        },
        "card": card,
        "scope": {"kind": "list", "id": resolved_list_id, "selection_surface": "card"},
        "scope_preview": _scope_preview(
            command_id="card.create_draft",
            selection_surface="card",
            scope_id=resolved_list_id,
            label=str(card_name),
        ),
        "picker": _picker(
            [
                _picker_item(card, kind="card", scope_kind="list", scope_preview=f"List {resolved_list_id}")
            ],
            kind="card",
        ),
        "summary": f"Created Trello card {card_name}.",
    }


def update_card_result(
    ctx_obj: dict[str, Any],
    *,
    card_id: str | None,
    name: str | None,
    desc: str | None,
) -> dict[str, Any]:
    if name is None and desc is None:
        raise CliError(
            code="TRELLO_UPDATE_REQUIRED",
            message="Provide at least one field to update",
            exit_code=4,
            details={"required_any_of": ["name", "desc"]},
        )

    client = create_client(ctx_obj)
    resolved_card_id = _card_id(ctx_obj, card_id)
    try:
        card = client.update_card(resolved_card_id, name=name, desc=desc)
    except TrelloApiError as err:
        raise _write_error(err, operation="card.update_draft") from err

    card_name = card.get("name") or card.get("id") or resolved_card_id
    return {
        "status": "live_write",
        "backend": BACKEND_NAME,
        "command_id": "card.update_draft",
        "resource": "card",
        "operation": "update",
        "executed": True,
        "consequential": True,
        "live_write_available": True,
        "scaffold_only": False,
        "inputs": {"card_id": resolved_card_id, "name": name, "desc": desc},
        "card": card,
        "scope": {"kind": "card", "id": resolved_card_id, "selection_surface": "card"},
        "scope_preview": _scope_preview(
            command_id="card.update_draft",
            selection_surface="card",
            scope_id=resolved_card_id,
            label=str(card_name),
        ),
        "picker": _picker(
            [
                _picker_item(card, kind="card", scope_kind="card", scope_preview=f"Card {resolved_card_id}")
            ],
            kind="card",
        ),
        "summary": f"Updated Trello card {card_name}.",
    }
