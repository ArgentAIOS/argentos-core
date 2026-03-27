from __future__ import annotations

from collections import Counter
from typing import Any

from .client import NotionApiError, NotionClient
from .config import resolve_runtime_values
from .errors import CliError


def create_client(ctx_obj: dict[str, Any]) -> NotionClient:
    runtime = resolve_runtime_values(ctx_obj)
    if not runtime["token_present"]:
        raise CliError(
            code="NOTION_SETUP_REQUIRED",
            message="NOTION_TOKEN is not configured",
            exit_code=4,
            details={"missing_keys": [runtime["token_env"]]},
        )
    return NotionClient(token=runtime["token"], version=runtime["version"])


def probe_runtime(ctx_obj: dict[str, Any]) -> dict[str, Any]:
    runtime = resolve_runtime_values(ctx_obj)
    if not runtime["token_present"]:
        return {
            "ok": False,
            "code": "NOTION_SETUP_REQUIRED",
            "message": "NOTION_TOKEN is not configured",
            "details": {
                "env": runtime["token_env"],
                "live_backend_available": False,
                "probe_mode": "setup-required",
            },
        }

    try:
        client = create_client(ctx_obj)
        user = client.current_user()
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
    except NotionApiError as err:
        code = "NOTION_AUTH_FAILED" if err.status_code in {401, 403} else "NOTION_API_ERROR"
        message = err.message
        if err.status_code in {401, 403}:
            message = "Notion token is configured but the integration cannot access the workspace or pages"
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
        "message": "Notion live read runtime is ready",
        "details": {
            "probe_mode": "live-read",
            "live_backend_available": True,
            "runtime_ready": True,
            "token_present": True,
            "workspace_id_present": runtime["workspace_id_present"],
            "current_user": user,
        },
    }


def _read_result_base(ctx_obj: dict[str, Any]) -> dict[str, Any]:
    probe = probe_runtime(ctx_obj)
    if not probe.get("ok"):
        raise CliError(
            code=str(probe.get("code") or "NOTION_API_UNAVAILABLE"),
            message=str(probe.get("message") or "Notion read runtime is unavailable"),
            exit_code=5 if probe.get("code") == "NOTION_AUTH_FAILED" else 4,
            details=probe.get("details", {}),
        )
    return probe


def _flatten_text(value: Any) -> str:
    if value is None:
        return ""
    if isinstance(value, str):
        return value.strip()
    if isinstance(value, (int, float, bool)):
        return str(value)
    if isinstance(value, list):
        parts = [_flatten_text(item) for item in value]
        return " ".join(part for part in parts if part)
    if isinstance(value, dict):
        if "plain_text" in value:
            text = _flatten_text(value.get("plain_text"))
            if text:
                return text
        if "text" in value:
            text = _flatten_text(value.get("text"))
            if text:
                return text
        parts = []
        for nested in value.values():
            text = _flatten_text(nested)
            if text:
                parts.append(text)
        return " ".join(parts)
    return str(value).strip()


def _extract_title(item: Any) -> str:
    if not isinstance(item, dict):
        return ""

    for key in ("title", "name"):
        text = _flatten_text(item.get(key))
        if text:
            return text

    properties = item.get("properties")
    if isinstance(properties, dict):
        for prop in properties.values():
            if not isinstance(prop, dict):
                continue
            for key in ("title", "rich_text", "name"):
                text = _flatten_text(prop.get(key))
                if text:
                    return text

    return ""


def _compact_preview(labels: list[str], *, empty_text: str, limit: int = 3) -> str:
    filtered = [label for label in labels if label][:limit]
    if not filtered:
        return empty_text
    if len(labels) > limit:
        filtered.append(f"+{len(labels) - limit} more")
    return ", ".join(filtered)


def _result_type_counts(items: list[dict[str, Any]]) -> dict[str, int]:
    counts = Counter()
    for item in items:
        if isinstance(item, dict):
            counts[str(item.get("object") or "unknown")] += 1
    return dict(sorted(counts.items()))


def _scope_metadata(
    *,
    kind: str,
    preview: str,
    label: str | None = None,
    scope_id: str | None = None,
    selection_surface: str | None = None,
    **extra: Any,
) -> dict[str, Any]:
    scope: dict[str, Any] = {
        "kind": kind,
        "preview": preview,
    }
    if label is not None:
        scope["label"] = label
    if scope_id is not None:
        scope["id"] = scope_id
    if selection_surface is not None:
        scope["selection_surface"] = selection_surface
    scope.update(extra)
    return scope


def _picker_item(
    item: dict[str, Any],
    *,
    scope_kind: str,
    scope_preview: str,
) -> dict[str, Any]:
    item_id = str(item.get("id") or "")
    label = _extract_title(item) or item_id or str(item.get("object") or "unknown")
    picker_item: dict[str, Any] = {
        "kind": str(item.get("object") or "unknown"),
        "id": item_id or label,
        "label": label,
        "scope_preview": f"{scope_preview} > {label}" if label else scope_preview,
        "scope_kind": scope_kind,
    }
    url = item.get("url")
    if isinstance(url, str) and url:
        picker_item["url"] = url
    return picker_item


def health_snapshot(ctx_obj: dict[str, Any]) -> dict[str, Any]:
    runtime = resolve_runtime_values(ctx_obj)
    probe = probe_runtime(ctx_obj)
    if not runtime["token_present"]:
        status = "needs_setup"
        summary = "Notion runtime needs NOTION_TOKEN before live read commands can run."
        next_steps = [f"Set {runtime['token_env']} to a Notion internal integration token."]
    elif probe["ok"]:
        status = "ready"
        summary = "Notion live read runtime is ready."
        next_steps = [
            "Share the target databases and pages with the Notion integration.",
            "Keep write actions scaffolded until a live Notion write bridge exists.",
        ]
    else:
        status = "degraded"
        summary = str(probe["message"])
        next_steps = [
            "Check the Notion token and workspace sharing.",
            "Share the target databases and pages with the integration.",
            "Keep write actions scaffolded until a live Notion write bridge exists.",
        ]

    return {
        "status": status,
        "summary": summary,
        "connector": {
            "backend": "notion-api",
            "live_backend_available": bool(probe.get("ok")),
            "live_read_available": bool(probe.get("ok")),
            "write_bridge_available": False,
            "scaffold_only": False,
        },
        "auth": {
            "token_env": runtime["token_env"],
            "token_present": runtime["token_present"],
            "version_env": runtime["version_env"],
            "workspace_env": runtime["workspace_env"],
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
        "write_bridge_available": False,
        "scaffold_only": False,
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
        "Share the target databases and pages with the Notion integration.",
        "Keep page.create, page.update, and block.append scaffolded until a live write bridge exists.",
    ]
    return {
        "status": "needs_setup" if not setup_complete else ("ready" if live_ready else "degraded"),
        "summary": "Notion connector diagnostics.",
        "runtime_ready": live_ready,
        "live_backend_available": live_ready,
        "live_read_available": live_ready,
        "write_bridge_available": False,
        "scaffold_only": False,
        "setup_complete": setup_complete,
        "missing_keys": [] if setup_complete else [runtime["token_env"]],
        "next_steps": next_steps,
        "probe": probe,
        "runtime": {
            "notion_version": runtime["version"],
            "workspace_id_present": runtime["workspace_id_present"],
            "probe_mode": probe["details"].get("probe_mode") if probe.get("details") else "setup-required",
        },
    }


def config_snapshot(ctx_obj: dict[str, Any]) -> dict[str, Any]:
    runtime = resolve_runtime_values(ctx_obj)
    probe = probe_runtime(ctx_obj)
    return {
        "status": "ok",
        "summary": "Notion connector configuration snapshot.",
        "backend": "notion-api",
        "auth": {
            "token_env": runtime["token_env"],
            "token_present": runtime["token_present"],
            "token_redacted": runtime["token_redacted"],
            "version_env": runtime["version_env"],
            "version_present": runtime["version_present"],
            "workspace_env": runtime["workspace_env"],
            "workspace_id_present": runtime["workspace_id_present"],
        },
        "runtime": {
            "notion_version": runtime["version"],
            "workspace_id": runtime["workspace_id"],
            "runtime_ready": bool(probe.get("ok")),
            "live_backend_available": bool(probe.get("ok")),
            "live_read_available": bool(probe.get("ok")),
            "write_bridge_available": False,
            "scaffold_only": False,
        },
        "probe": probe,
    }


def read_database_list(ctx_obj: dict[str, Any], *, limit: int) -> dict[str, Any]:
    probe = _read_result_base(ctx_obj)
    client = create_client(ctx_obj)
    payload = client.list_databases(limit=limit)
    results = payload["results"]
    picker_items = [_picker_item(item, scope_kind="workspace", scope_preview="Accessible databases") for item in results if isinstance(item, dict)]
    labels = [item["label"] for item in picker_items]
    scope_preview = f"Accessible databases: {_compact_preview(labels, empty_text='none returned')}"
    return {
        "status": "ok",
        "backend": "notion-api",
        "command": "database.list",
        "summary": f"Returned {len(results)} accessible Notion database{'' if len(results) == 1 else 's'}.",
        "scope_preview": scope_preview,
        "scope": _scope_metadata(
            kind="workspace",
            preview=scope_preview,
            label="Accessible databases",
            selection_surface="database",
            item_count=len(picker_items),
            has_more=payload["has_more"],
        ),
        "picker": {
            "scope": _scope_metadata(
                kind="workspace",
                preview=scope_preview,
                label="Accessible databases",
                selection_surface="database",
                item_count=len(picker_items),
                has_more=payload["has_more"],
            ),
            "items": picker_items,
        },
        "limit": limit,
        "results": results,
        "result_types": _result_type_counts(results),
        "has_more": payload["has_more"],
        "next_cursor": payload["next_cursor"],
        "live_backend_available": True,
        "runtime_ready": True,
        "probe": probe,
    }


def read_database_query(
    ctx_obj: dict[str, Any],
    *,
    database_id: str,
    filter_expression: str | None,
    limit: int,
) -> dict[str, Any]:
    probe = _read_result_base(ctx_obj)
    client = create_client(ctx_obj)
    payload = client.query_database(database_id, limit=limit, filter_expression=filter_expression)
    results = payload["results"]
    picker_items = [_picker_item(item, scope_kind="database", scope_preview=f"Database {database_id}") for item in results if isinstance(item, dict)]
    labels = [item["label"] for item in picker_items]
    scope_preview = f"Database {database_id} rows: {_compact_preview(labels, empty_text='none returned')}"
    return {
        "status": "ok",
        "backend": "notion-api",
        "command": "database.query",
        "summary": f"Returned {len(results)} rows from database {database_id}.",
        "scope_preview": scope_preview,
        "scope": _scope_metadata(
            kind="database",
            preview=scope_preview,
            scope_id=database_id,
            selection_surface="page",
            filter_mode=payload["filter_mode"],
            filter_expression=payload["filter_expression"],
            item_count=len(picker_items),
            has_more=payload["has_more"],
        ),
        "picker": {
            "scope": _scope_metadata(
                kind="database",
                preview=scope_preview,
                scope_id=database_id,
                selection_surface="page",
                filter_mode=payload["filter_mode"],
                filter_expression=payload["filter_expression"],
                item_count=len(picker_items),
                has_more=payload["has_more"],
            ),
            "items": picker_items,
        },
        "database_id": database_id,
        "filter_expression": payload["filter_expression"],
        "filter_mode": payload["filter_mode"],
        "limit": limit,
        "results": results,
        "result_types": _result_type_counts(results),
        "has_more": payload["has_more"],
        "next_cursor": payload["next_cursor"],
        "live_backend_available": True,
        "runtime_ready": True,
        "probe": probe,
    }


def read_page(ctx_obj: dict[str, Any], *, page_id: str) -> dict[str, Any]:
    probe = _read_result_base(ctx_obj)
    client = create_client(ctx_obj)
    payload = client.read_page(page_id)
    page = payload["page"]
    page_title = _extract_title(page) or page_id
    parent = page.get("parent") if isinstance(page, dict) else None
    scope_preview = f"Page {page_title}"
    scope = _scope_metadata(
        kind="page",
        preview=scope_preview,
        label=page_title,
        scope_id=page_id,
        selection_surface="page",
        parent_type=parent.get("type") if isinstance(parent, dict) else None,
        database_id=parent.get("database_id") if isinstance(parent, dict) else None,
        parent_page_id=parent.get("page_id") if isinstance(parent, dict) else None,
        block_depth=2,
    )
    return {
        "status": "ok",
        "backend": "notion-api",
        "command": "page.read",
        "summary": f"Read Notion page {page_id}.",
        "scope_preview": scope_preview,
        "scope": scope,
        "picker": {
            "scope": scope,
            "items": [
                {
                    "kind": "page",
                    "id": page_id,
                    "label": page_title,
                    "scope_preview": scope_preview,
                    "scope_kind": "page",
                }
            ],
        },
        "page_id": page_id,
        "page_title": page_title,
        "page": page,
        "blocks": payload["blocks"],
        "live_backend_available": True,
        "runtime_ready": True,
        "probe": probe,
    }


def read_block(ctx_obj: dict[str, Any], *, block_id: str) -> dict[str, Any]:
    probe = _read_result_base(ctx_obj)
    client = create_client(ctx_obj)
    payload = client.read_block(block_id)
    block = payload["block"]
    block_label = _extract_title(block) or block_id
    scope_preview = f"Block tree {block_label}"
    scope = _scope_metadata(
        kind="block",
        preview=scope_preview,
        label=block_label,
        scope_id=block_id,
        selection_surface="block",
        child_count=len(payload["children"]),
    )
    return {
        "status": "ok",
        "backend": "notion-api",
        "command": "block.read",
        "summary": f"Read Notion block tree {block_id}.",
        "scope_preview": scope_preview,
        "scope": scope,
        "picker": {
            "scope": scope,
            "items": [
                {
                    "kind": "block",
                    "id": block_id,
                    "label": block_label,
                    "scope_preview": scope_preview,
                    "scope_kind": "block",
                }
            ],
        },
        "block_id": block_id,
        "block": block,
        "children": payload["children"],
        "live_backend_available": True,
        "runtime_ready": True,
        "probe": probe,
    }


def search_query(ctx_obj: dict[str, Any], *, query: str, limit: int) -> dict[str, Any]:
    probe = _read_result_base(ctx_obj)
    client = create_client(ctx_obj)
    payload = client.search(query=query, limit=limit)
    results = [item for item in payload.get("results", []) if isinstance(item, dict)]
    picker_items = [_picker_item(item, scope_kind="workspace", scope_preview=f"Search {query!r}") for item in results]
    labels = [item["label"] for item in picker_items]
    scope_preview = f"Search {query!r}: {_compact_preview(labels, empty_text='no results')}"
    return {
        "status": "ok",
        "backend": "notion-api",
        "command": "search.query",
        "summary": f"Returned {len(results)} search hits for '{query}'.",
        "scope_preview": scope_preview,
        "scope": _scope_metadata(
            kind="workspace",
            preview=scope_preview,
            label=f"Search {query!r}",
            selection_surface="database,page",
            query=query,
            item_count=len(picker_items),
            has_more=bool(payload.get("has_more")),
        ),
        "picker": {
            "scope": _scope_metadata(
                kind="workspace",
                preview=scope_preview,
                label=f"Search {query!r}",
                selection_surface="database,page",
                query=query,
                item_count=len(picker_items),
                has_more=bool(payload.get("has_more")),
            ),
            "items": picker_items,
        },
        "query": query,
        "limit": limit,
        "results": results[:limit],
        "result_types": _result_type_counts(results[:limit]),
        "has_more": bool(payload.get("has_more")),
        "next_cursor": payload.get("next_cursor"),
        "live_backend_available": True,
        "runtime_ready": True,
        "probe": probe,
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
        "backend": "notion-api",
        "command_id": command_id,
        "resource": resource,
        "operation": operation,
        "executed": False,
        "scaffold_only": True,
        "live_backend_available": False,
        "consequential": consequential,
        "inputs": inputs,
        "setup": {
            "configured": runtime["token_present"],
            "token_present": runtime["token_present"],
            "version": runtime["version"],
            "workspace_id_present": runtime["workspace_id_present"],
        },
        "summary": f"{command_id} is write-scaffolded and does not perform live Notion write calls yet.",
        "next_step": "Keep writes disabled until a live Notion write bridge is implemented.",
    }
