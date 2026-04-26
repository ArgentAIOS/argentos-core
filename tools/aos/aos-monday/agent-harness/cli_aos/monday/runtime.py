from __future__ import annotations

from collections import Counter
from datetime import date, datetime
import json
from typing import Any

from .client import MondayApiError, MondayClient
from .config import redacted_config_snapshot, resolve_runtime_values
from .constants import BACKEND_NAME
from .errors import CliError


def _parse_iso_date(value: str | None) -> date | None:
    if not value:
        return None
    return datetime.strptime(value, "%Y-%m-%d").date()


def _present(value: Any) -> bool:
    return bool(value)


def _compact_preview(labels: list[str], *, empty_text: str, limit: int = 3) -> str:
    filtered = [label for label in labels if label][:limit]
    if not filtered:
        return empty_text
    if len(labels) > limit:
        filtered.append(f"+{len(labels) - limit} more")
    return ", ".join(filtered)


def _result_types(items: list[dict[str, Any]]) -> dict[str, int]:
    counts = Counter()
    for item in items:
        if isinstance(item, dict):
            counts[str(item.get("__typename") or item.get("type") or item.get("kind") or "unknown")] += 1
    return dict(sorted(counts.items()))


def _scope_metadata(*, kind: str, preview: str, label: str | None = None, scope_id: str | None = None, **extra: Any) -> dict[str, Any]:
    scope: dict[str, Any] = {"kind": kind, "preview": preview}
    if label is not None:
        scope["label"] = label
    if scope_id is not None:
        scope["id"] = scope_id
    scope.update(extra)
    return scope


def _item_preview(item: dict[str, Any]) -> str:
    item_id = str(item.get("id") or "")
    title = str(item.get("name") or item_id or "unknown")
    return title


def create_client(ctx_obj: dict[str, Any]) -> MondayClient:
    runtime = resolve_runtime_values(ctx_obj)
    if not runtime["token_present"]:
        raise CliError(
            code="MONDAY_SETUP_REQUIRED",
            message="MONDAY_TOKEN is not configured",
            exit_code=4,
            details={"missing_keys": [runtime["token_env"]]},
        )
    return MondayClient(
        token=str(runtime["token"] or ""),
        api_version=str(runtime["api_version"]),
        api_url=str(runtime["api_url"]),
    )


def probe_runtime(ctx_obj: dict[str, Any]) -> dict[str, Any]:
    runtime = resolve_runtime_values(ctx_obj)
    if not runtime["token_present"]:
        return {
            "ok": False,
            "code": "MONDAY_SETUP_REQUIRED",
            "message": "MONDAY_TOKEN is not configured",
            "details": {
                "env": runtime["token_env"],
                "live_backend_available": False,
                "probe_mode": "setup-required",
            },
        }

    try:
        client = create_client(ctx_obj)
        user = client.me()
    except CliError as err:
        return {
            "ok": False,
            "code": err.code,
            "message": err.message,
            "details": {
                **err.details,
                "live_backend_available": False,
                "probe_mode": "setup-required",
            },
        }
    except MondayApiError as err:
        return {
            "ok": False,
            "code": err.code,
            "message": err.message,
            "details": {
                "status_code": err.status_code,
                "error_details": err.details or {},
                "live_backend_available": False,
                "probe_mode": "live-read",
            },
        }

    return {
        "ok": True,
        "code": "OK",
        "message": "Monday live read runtime is ready",
        "details": {
            "probe_mode": "live-read",
            "live_backend_available": True,
            "runtime_ready": True,
            "token_present": True,
            "current_user": user,
        },
    }


def health_snapshot(ctx_obj: dict[str, Any]) -> dict[str, Any]:
    runtime = resolve_runtime_values(ctx_obj)
    probe = probe_runtime(ctx_obj)
    if not runtime["token_present"]:
        status = "needs_setup"
        summary = "Monday runtime needs MONDAY_TOKEN before live read commands can run."
        next_steps = [f"Set {runtime['token_env']} to a monday personal API token."]
    elif probe["ok"]:
        status = "ready"
        summary = "Monday live read runtime is ready."
        next_steps = [
            "Share the target boards and workspaces with the token owner.",
            "Run write commands in write mode or higher; item.create, item.update, and update.create execute live monday mutations.",
        ]
    else:
        status = "degraded"
        summary = str(probe["message"])
        next_steps = [
            "Check the monday token and account access.",
            "Verify the target boards and workspaces are visible to the token owner.",
            "Run write commands in write mode or higher; item.create, item.update, and update.create execute live monday mutations.",
        ]

    return {
        "status": status,
        "summary": summary,
        "connector": {
            "backend": BACKEND_NAME,
            "live_backend_available": bool(probe.get("ok")),
            "live_read_available": bool(probe.get("ok")),
            "write_bridge_available": bool(probe.get("ok")),
            "write_paths_scaffolded": False,
        },
        "auth": {
            "token_env": runtime["token_env"],
            "token_present": runtime["token_present"],
            "api_version_env": runtime["api_version_env"],
            "api_version_present": runtime["api_version_present"],
            "api_url_env": runtime["api_url_env"],
            "api_url_present": runtime["api_url_present"],
        },
        "checks": [
            {
                "name": "required_env",
                "ok": runtime["token_present"],
                "details": {"missing_keys": [] if runtime["token_present"] else [runtime["token_env"]]},
            },
            {
                "name": "live_backend",
                "ok": bool(probe.get("ok")),
                "details": probe.get("details", {}),
            },
        ],
        "runtime_ready": bool(probe.get("ok")),
        "live_backend_available": bool(probe.get("ok")),
        "live_read_available": bool(probe.get("ok")),
        "write_bridge_available": bool(probe.get("ok")),
        "write_paths_scaffolded": False,
        "probe": probe,
        "next_steps": next_steps,
    }


def doctor_snapshot(ctx_obj: dict[str, Any]) -> dict[str, Any]:
    runtime = resolve_runtime_values(ctx_obj)
    probe = probe_runtime(ctx_obj)
    setup_complete = runtime["token_present"]
    live_ready = bool(probe.get("ok"))
    next_steps = [
        f"Set {runtime['token_env']} in API Keys.",
        "Share the target boards and workspaces with the monday token owner.",
        "Run write commands in write mode or higher; item.create, item.update, and update.create execute live monday mutations.",
    ]
    return {
        "status": "needs_setup" if not setup_complete else ("ready" if live_ready else "degraded"),
        "summary": "Monday connector diagnostics.",
        "runtime_ready": live_ready,
        "live_backend_available": live_ready,
        "live_read_available": live_ready,
        "write_bridge_available": live_ready,
        "write_paths_scaffolded": False,
        "setup_complete": setup_complete,
        "missing_keys": [] if setup_complete else [runtime["token_env"]],
        "next_steps": next_steps,
        "probe": probe,
        "runtime": {
            "api_version": runtime["api_version"],
            "api_url": runtime["api_url"],
            "workspace_id_present": runtime["workspace_id_present"],
            "board_id_present": runtime["board_id_present"],
            "probe_mode": probe["details"].get("probe_mode") if probe.get("details") else "setup-required",
        },
    }


def config_snapshot(ctx_obj: dict[str, Any]) -> dict[str, Any]:
    runtime = resolve_runtime_values(ctx_obj)
    probe = probe_runtime(ctx_obj)
    return redacted_config_snapshot(
        ctx_obj,
        runtime_ready=bool(probe.get("ok")),
        live_backend_available=bool(probe.get("ok")),
    )


def _board_preview(board: dict[str, Any], *, limit: int) -> dict[str, Any]:
    items_page = board.get("items_page") or {}
    items = list(items_page.get("items") or [])
    updates = list(board.get("updates") or [])
    item_items = items[:limit]
    update_items = updates[:limit]
    item_labels = [_item_preview(item) for item in item_items]
    update_labels = [str(update.get("body") or update.get("id") or "update") for update in update_items]
    scope_preview = f"Board {board.get('id')}: items {_compact_preview(item_labels, empty_text='none returned')}"
    if update_labels:
        scope_preview = f"{scope_preview}; updates {_compact_preview(update_labels, empty_text='none returned')}"
    return {
        "board": board,
        "items": item_items,
        "updates": update_items,
        "scope_preview": scope_preview,
        "scope": _scope_metadata(kind="board", preview=scope_preview, scope_id=str(board.get("id") or "")),
        "result_types": _result_types(item_items),
    }


def read_account(ctx_obj: dict[str, Any]) -> dict[str, Any]:
    client = create_client(ctx_obj)
    probe_runtime(ctx_obj)
    account = client.me()
    display_name = account.get("name") or account.get("email") or account.get("id") or "monday account"
    summary = f"Connected Monday account: {display_name}"
    return {
        "status": "ok",
        "backend": BACKEND_NAME,
        "command": "account.read",
        "summary": summary,
        "scope_preview": summary,
        "scope": _scope_metadata(kind="account", preview=summary, label=display_name, scope_id=str(account.get("id") or "")),
        "account": account,
    }


def list_workspaces(ctx_obj: dict[str, Any], *, limit: int) -> dict[str, Any]:
    client = create_client(ctx_obj)
    probe_runtime(ctx_obj)
    workspaces = client.list_workspaces()[:limit]
    labels = [str(workspace.get("name") or workspace.get("id") or "workspace") for workspace in workspaces]
    scope_preview = f"Workspaces: {_compact_preview(labels, empty_text='none returned')}"
    return {
        "status": "ok",
        "backend": BACKEND_NAME,
        "command": "workspace.list",
        "summary": f"Returned {len(workspaces)} accessible monday workspace{'' if len(workspaces) == 1 else 's'}.",
        "scope_preview": scope_preview,
        "scope": _scope_metadata(kind="workspace", preview=scope_preview, label="Accessible workspaces", selection_surface="workspace", item_count=len(workspaces)),
        "items": workspaces,
        "result_types": _result_types(workspaces),
        "limit": limit,
    }


def list_boards(ctx_obj: dict[str, Any], *, limit: int) -> dict[str, Any]:
    client = create_client(ctx_obj)
    probe_runtime(ctx_obj)
    boards = client.list_boards()[:limit]
    labels = [str(board.get("name") or board.get("id") or "board") for board in boards]
    scope_preview = f"Boards: {_compact_preview(labels, empty_text='none returned')}"
    return {
        "status": "ok",
        "backend": BACKEND_NAME,
        "command": "board.list",
        "summary": f"Returned {len(boards)} accessible monday board{'' if len(boards) == 1 else 's'}.",
        "scope_preview": scope_preview,
        "scope": _scope_metadata(kind="board", preview=scope_preview, label="Accessible boards", selection_surface="board", item_count=len(boards)),
        "items": boards,
        "result_types": _result_types(boards),
        "limit": limit,
    }


def read_board(ctx_obj: dict[str, Any], *, board_id: str, limit: int) -> dict[str, Any]:
    client = create_client(ctx_obj)
    probe_runtime(ctx_obj)
    board = client.read_board(board_id, limit=limit)
    if not board:
        raise CliError(
            code="MONDAY_BOARD_NOT_FOUND",
            message=f"Board {board_id} was not returned by the monday API",
            exit_code=5,
            details={"board_id": board_id},
        )
    return {
        "status": "ok",
        "backend": BACKEND_NAME,
        "command": "board.read",
        **_board_preview(board, limit=limit),
    }


def read_item(ctx_obj: dict[str, Any], *, item_id: str) -> dict[str, Any]:
    client = create_client(ctx_obj)
    probe_runtime(ctx_obj)
    item = client.read_item(item_id)
    if not item:
        raise CliError(
            code="MONDAY_ITEM_NOT_FOUND",
            message=f"Item {item_id} was not returned by the monday API",
            exit_code=5,
            details={"item_id": item_id},
        )
    board = item.get("board") or {}
    title = str(item.get("name") or item.get("id") or "item")
    summary = f"Item {item.get('id')}: {title}"
    if board:
        summary = f"{summary} on board {board.get('name') or board.get('id')}"
    return {
        "status": "ok",
        "backend": BACKEND_NAME,
        "command": "item.read",
        "summary": summary,
        "scope_preview": summary,
        "scope": _scope_metadata(kind="item", preview=summary, label=title, scope_id=str(item.get("id") or "")),
        "item": item,
    }


def list_updates(
    ctx_obj: dict[str, Any],
    *,
    limit: int,
    from_date: str | None = None,
    to_date: str | None = None,
) -> dict[str, Any]:
    client = create_client(ctx_obj)
    probe_runtime(ctx_obj)
    updates = client.list_updates(limit=limit)
    parsed_from = _parse_iso_date(from_date)
    parsed_to = _parse_iso_date(to_date)
    if parsed_from or parsed_to:
        filtered: list[dict[str, Any]] = []
        for update in updates:
            created_raw = update.get("created_at")
            if not isinstance(created_raw, str):
                continue
            try:
                created = datetime.fromisoformat(created_raw.replace("Z", "+00:00")).date()
            except ValueError:
                continue
            if parsed_from and created < parsed_from:
                continue
            if parsed_to and created > parsed_to:
                continue
            filtered.append(update)
        updates = filtered
    labels = [str(update.get("body") or update.get("id") or "update") for update in updates]
    scope_preview = f"Updates: {_compact_preview(labels, empty_text='none returned')}"
    return {
        "status": "ok",
        "backend": BACKEND_NAME,
        "command": "update.list",
        "summary": f"Returned {len(updates)} monday update{'' if len(updates) == 1 else 's'}.",
        "scope_preview": scope_preview,
        "scope": _scope_metadata(kind="update", preview=scope_preview, label="Updates", selection_surface="update", item_count=len(updates)),
        "items": updates,
        "result_types": _result_types(updates),
        "limit": limit,
        "from_date": from_date,
        "to_date": to_date,
    }


def _require_text(value: str | None, *, field: str) -> str:
    if value is None or not value.strip():
        raise CliError(
            code="MONDAY_INVALID_INPUT",
            message=f"{field} is required",
            exit_code=2,
            details={"field": field},
        )
    return value.strip()


def _normalize_column_values(value: str | None) -> str | None:
    if value is None or not value.strip():
        return None
    stripped = value.strip()
    try:
        parsed = json.loads(stripped)
    except json.JSONDecodeError as exc:
        raise CliError(
            code="MONDAY_INVALID_COLUMN_VALUES",
            message="column_values must be a JSON object string",
            exit_code=2,
            details={"column_values": stripped[:200]},
        ) from exc
    if not isinstance(parsed, dict):
        raise CliError(
            code="MONDAY_INVALID_COLUMN_VALUES",
            message="column_values must be a JSON object",
            exit_code=2,
            details={"type": type(parsed).__name__},
        )
    return json.dumps(parsed, separators=(",", ":"))


def create_item(
    ctx_obj: dict[str, Any],
    *,
    board_id: str,
    item_name: str,
    group_id: str | None = None,
    column_values: str | None = None,
) -> dict[str, Any]:
    client = create_client(ctx_obj)
    board_id = _require_text(board_id, field="board_id")
    item_name = _require_text(item_name, field="item_name")
    normalized_column_values = _normalize_column_values(column_values)
    item = client.create_item(
        board_id=board_id,
        item_name=item_name,
        group_id=group_id.strip() if group_id and group_id.strip() else None,
        column_values=normalized_column_values,
    )
    return {
        "status": "live_write",
        "backend": BACKEND_NAME,
        "command": "item.create",
        "summary": f"Created monday item {item.get('name') or item.get('id') or item_name}.",
        "resource": "item",
        "operation": "create",
        "executed": True,
        "consequential": True,
        "write_bridge_available": True,
        "write_paths_scaffolded": False,
        "scope": _scope_metadata(kind="board", preview=f"Board {board_id}", scope_id=board_id, selection_surface="item"),
        "scope_preview": f"Board {board_id}: created {item.get('name') or item_name}",
        "inputs": {
            "board_id": board_id,
            "item_name": item_name,
            "group_id": group_id,
            "column_values": normalized_column_values,
        },
        "item": item,
    }


def update_item(
    ctx_obj: dict[str, Any],
    *,
    item_id: str,
    board_id: str,
    column_id: str | None = None,
    column_value: str | None = None,
    column_values: str | None = None,
) -> dict[str, Any]:
    client = create_client(ctx_obj)
    item_id = _require_text(item_id, field="item_id")
    board_id = _require_text(board_id, field="board_id")
    normalized_column_values = _normalize_column_values(column_values)
    if normalized_column_values:
        item = client.change_multiple_column_values(
            board_id=board_id,
            item_id=item_id,
            column_values=normalized_column_values,
        )
        operation = "change_multiple_column_values"
    else:
        column_id = _require_text(column_id, field="column_id")
        column_value = _require_text(column_value, field="column_value")
        item = client.change_simple_column_value(
            board_id=board_id,
            item_id=item_id,
            column_id=column_id,
            value=column_value,
        )
        operation = "change_simple_column_value"
    return {
        "status": "live_write",
        "backend": BACKEND_NAME,
        "command": "item.update",
        "summary": f"Updated monday item {item.get('id') or item_id}.",
        "resource": "item",
        "operation": operation,
        "executed": True,
        "consequential": True,
        "write_bridge_available": True,
        "write_paths_scaffolded": False,
        "scope": _scope_metadata(kind="item", preview=f"Item {item_id}", scope_id=item_id, selection_surface="item"),
        "scope_preview": f"Item {item_id}: updated columns",
        "inputs": {
            "board_id": board_id,
            "item_id": item_id,
            "column_id": column_id,
            "column_value": column_value,
            "column_values": normalized_column_values,
        },
        "item": item,
    }


def create_update(ctx_obj: dict[str, Any], *, item_id: str, body: str) -> dict[str, Any]:
    client = create_client(ctx_obj)
    item_id = _require_text(item_id, field="item_id")
    body = _require_text(body, field="body")
    update = client.create_update(item_id=item_id, body=body)
    return {
        "status": "live_write",
        "backend": BACKEND_NAME,
        "command": "update.create",
        "summary": f"Created monday update {update.get('id') or ''} on item {item_id}.",
        "resource": "update",
        "operation": "create",
        "executed": True,
        "consequential": True,
        "write_bridge_available": True,
        "write_paths_scaffolded": False,
        "scope": _scope_metadata(kind="item", preview=f"Item {item_id}", scope_id=item_id, selection_surface="update"),
        "scope_preview": f"Item {item_id}: created update",
        "inputs": {"item_id": item_id, "body": body},
        "update": update,
    }
