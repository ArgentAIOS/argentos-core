from __future__ import annotations

import json
from typing import Any

from .client import DropboxApiError, DropboxClient
from .config import config_snapshot, resolve_runtime_values
from .constants import BACKEND_NAME, CONNECTOR_PATH
from .errors import CliError


def _load_manifest() -> dict[str, Any]:
    return json.loads(CONNECTOR_PATH.read_text())


def _scope_preview(command_id: str, resource: str, extra: dict[str, Any] | None = None) -> dict[str, Any]:
    payload = {"selection_surface": resource, "command_id": command_id, "backend": BACKEND_NAME}
    if extra:
        payload.update(extra)
    return payload


def _picker(items: list[dict[str, Any]], *, kind: str, label_key: str = "label") -> dict[str, Any]:
    return {"kind": kind, "items": items, "count": len(items), "label_key": label_key}


def _require_arg(value: str | None, *, code: str, message: str, detail_key: str, detail_value: str) -> str:
    resolved = (value or "").strip()
    if resolved:
        return resolved
    raise CliError(code=code, message=message, exit_code=4, details={detail_key: detail_value})


def capabilities_snapshot() -> dict[str, Any]:
    manifest = _load_manifest()
    read_support: dict[str, bool] = {}
    write_support: dict[str, bool] = {}
    for command in manifest["commands"]:
        if command["required_mode"] == "readonly":
            read_support[command["id"]] = True
        else:
            write_support[command["id"]] = True
    return {
        "tool": manifest["tool"],
        "backend": manifest["backend"],
        "manifest_schema_version": manifest.get("manifest_schema_version", "1.0.0"),
        "connector": manifest["connector"],
        "auth": manifest["auth"],
        "scope": manifest.get("scope", {}),
        "commands": manifest["commands"],
        "read_support": read_support,
        "write_support": write_support,
    }


def create_client(ctx_obj: dict[str, Any]) -> DropboxClient:
    runtime = resolve_runtime_values(ctx_obj)
    missing: list[str] = []
    if not runtime["app_key_present"]:
        missing.append(runtime["app_key_env"])
    if not runtime["app_secret_present"]:
        missing.append(runtime["app_secret_env"])
    if not runtime["refresh_token_present"]:
        missing.append(runtime["refresh_token_env"])
    if missing:
        raise CliError(
            code="DROPBOX_SETUP_REQUIRED",
            message="Dropbox connector is missing required credentials",
            exit_code=4,
            details={"missing_keys": missing},
        )
    return DropboxClient(
        app_key=runtime["app_key"],
        app_secret=runtime["app_secret"],
        refresh_token=runtime["refresh_token"],
        api_base_url=runtime["base_url"],
        content_base_url=runtime["content_url"],
    )


def probe_runtime(ctx_obj: dict[str, Any]) -> dict[str, Any]:
    runtime = resolve_runtime_values(ctx_obj)
    if not runtime["runtime_ready"]:
        missing: list[str] = []
        if not runtime["app_key_present"]:
            missing.append(runtime["app_key_env"])
        if not runtime["app_secret_present"]:
            missing.append(runtime["app_secret_env"])
        if not runtime["refresh_token_present"]:
            missing.append(runtime["refresh_token_env"])
        return {
            "ok": False,
            "code": "DROPBOX_SETUP_REQUIRED",
            "message": "Dropbox connector is missing required credentials",
            "details": {"missing_keys": missing, "live_backend_available": False},
        }
    try:
        client = create_client(ctx_obj)
        account = client.read_account()
        files = client.list_files(path=runtime["path"] or "", limit=1)
    except CliError as err:
        return {"ok": False, "code": err.code, "message": err.message, "details": err.details}
    except DropboxApiError as err:
        code = "DROPBOX_AUTH_FAILED" if err.status_code in {401, 403} else "DROPBOX_API_ERROR"
        return {
            "ok": False,
            "code": code,
            "message": err.message,
            "details": {**(err.details or {}), "status_code": err.status_code, "live_backend_available": False},
        }
    return {
        "ok": True,
        "code": "OK",
        "message": "Dropbox live runtime is ready",
        "details": {
            "live_backend_available": True,
            "account": account,
            "sample_files": [entry["name"] for entry in files["files"][:3]],
        },
    }


def health_snapshot(ctx_obj: dict[str, Any]) -> dict[str, Any]:
    runtime = resolve_runtime_values(ctx_obj)
    probe = probe_runtime(ctx_obj)
    status = "ready" if probe["ok"] else ("needs_setup" if probe["code"] == "DROPBOX_SETUP_REQUIRED" else "degraded")
    return {
        "status": status,
        "summary": probe["message"],
        "connector": {
            "backend": BACKEND_NAME,
            "live_backend_available": bool(probe.get("ok")),
            "live_read_available": bool(probe.get("ok")),
            "write_bridge_available": False,
            "scaffold_only": False,
        },
        "auth": {
            "app_key_env": runtime["app_key_env"],
            "app_key_present": runtime["app_key_present"],
            "app_secret_env": runtime["app_secret_env"],
            "app_secret_present": runtime["app_secret_present"],
            "refresh_token_env": runtime["refresh_token_env"],
            "refresh_token_present": runtime["refresh_token_present"],
            "service_keys": runtime["service_keys"],
            "operator_service_keys": runtime["service_keys"],
            "sources": runtime["sources"],
        },
        "scope": {
            "path": runtime["path"] or None,
            "file_id": runtime["file_id"] or None,
            "query": runtime["query"] or None,
            "cursor": runtime["cursor"] or None,
        },
        "checks": [
            {
                "name": "required_env",
                "ok": runtime["runtime_ready"],
                "details": {
                    "missing_keys": (
                        []
                        if runtime["runtime_ready"]
                        else [
                            key
                            for key, present in [
                                (runtime["app_key_env"], runtime["app_key_present"]),
                                (runtime["app_secret_env"], runtime["app_secret_present"]),
                                (runtime["refresh_token_env"], runtime["refresh_token_present"]),
                            ]
                            if not present
                        ]
                    )
                },
            },
            {"name": "live_backend", "ok": bool(probe.get("ok")), "details": probe.get("details", {})},
        ],
        "runtime_ready": bool(probe.get("ok")),
        "live_backend_available": bool(probe.get("ok")),
        "live_read_available": bool(probe.get("ok")),
        "write_bridge_available": False,
        "scaffold_only": False,
        "probe": probe,
        "next_steps": [
            f"Set {runtime['app_key_env']}, {runtime['app_secret_env']}, and {runtime['refresh_token_env']} in API Keys.",
            f"Optionally set {runtime['path_env']} to scope list and search commands.",
            "Use health to verify the Dropbox token refresh and a live list_folder probe.",
            "Do not advertise Dropbox write actions until a write bridge and approval policy are verified.",
        ],
    }


def doctor_snapshot(ctx_obj: dict[str, Any]) -> dict[str, Any]:
    runtime = resolve_runtime_values(ctx_obj)
    probe = probe_runtime(ctx_obj)
    ready = bool(probe.get("ok"))
    return {
        "status": "ready" if ready else ("needs_setup" if probe.get("code") == "DROPBOX_SETUP_REQUIRED" else "degraded"),
        "summary": "Dropbox connector diagnostics.",
        "runtime": {
            "implementation_mode": "live_read_only",
            "command_readiness": {
                "file.list": ready,
                "file.get": ready,
                "file.download": ready,
                "folder.list": ready,
                "share.list": ready,
                "search.query": ready,
            },
            "path_present": bool(runtime["path"]),
            "file_id_present": bool(runtime["file_id"]),
            "query_present": bool(runtime["query"]),
            "cursor_present": bool(runtime["cursor"]),
        },
        "checks": [
            {"name": "required_env", "ok": runtime["runtime_ready"]},
            {"name": "live_backend", "ok": ready, "details": probe.get("details", {})},
        ],
        "supported_read_commands": [
            "file.list",
            "file.get",
            "file.download",
            "folder.list",
            "share.list",
            "search.query",
        ],
        "supported_write_commands": [],
        "next_steps": [
            f"Set {runtime['app_key_env']}, {runtime['app_secret_env']}, and {runtime['refresh_token_env']} to enable live Dropbox access.",
            f"Set {runtime['path_env']} and {runtime['query_env']} defaults if you want stable worker scope pickers.",
            "Use file.list and search.query to confirm the scoped folder.",
            "Do not advertise Dropbox write actions until a write bridge and approval policy are verified.",
        ],
    }


def _file_items(entries: list[dict[str, Any]]) -> list[dict[str, Any]]:
    items = []
    for entry in entries:
        items.append(
            {
                "value": entry.get("path_display") or entry.get("id"),
                "label": entry.get("name") or entry.get("path_display") or entry.get("id"),
                "subtitle": entry.get("path_display") or entry.get("path_lower"),
                "selected": False,
            }
        )
    return items


def _folder_items(entries: list[dict[str, Any]]) -> list[dict[str, Any]]:
    items = []
    for entry in entries:
        items.append(
            {
                "value": entry.get("path_display") or entry.get("id"),
                "label": entry.get("name") or entry.get("path_display") or entry.get("id"),
                "subtitle": entry.get("path_display") or entry.get("path_lower"),
                "selected": False,
            }
        )
    return items


def file_list_result(ctx_obj: dict[str, Any], *, path: str | None, cursor: str | None, limit: int) -> dict[str, Any]:
    runtime = resolve_runtime_values(ctx_obj)
    client = create_client(ctx_obj)
    resolved_path = path or runtime["path"] or ""
    resolved_cursor = cursor or runtime["cursor"] or None
    payload = client.list_files(path=resolved_path, cursor=resolved_cursor, limit=limit)
    return {
        "status": "live_read",
        "backend": BACKEND_NAME,
        "summary": f"Listed {len(payload['files'])} Dropbox file(s).",
        "files": payload,
        "picker": _picker(_file_items(payload["files"]), kind="file"),
        "scope_preview": _scope_preview("file.list", "file", {"path": resolved_path, "cursor": resolved_cursor}),
    }


def file_get_result(ctx_obj: dict[str, Any], *, path: str | None, file_id: str | None) -> dict[str, Any]:
    runtime = resolve_runtime_values(ctx_obj)
    client = create_client(ctx_obj)
    target = file_id or runtime["file_id"] or path or runtime["path"]
    resolved_target = _require_arg(
        target,
        code="DROPBOX_TARGET_REQUIRED",
        message="file path or file_id is required",
        detail_key="env",
        detail_value=runtime["file_id_env"],
    )
    metadata = client.get_file(path_or_id=resolved_target)
    return {
        "status": "live_read",
        "backend": BACKEND_NAME,
        "summary": f"Read Dropbox file {metadata.get('name') or resolved_target}.",
        "file": metadata,
        "scope_preview": _scope_preview("file.get", "file", {"path_or_id": resolved_target}),
    }


def file_download_result(ctx_obj: dict[str, Any], *, path: str | None, file_id: str | None) -> dict[str, Any]:
    runtime = resolve_runtime_values(ctx_obj)
    client = create_client(ctx_obj)
    target = file_id or runtime["file_id"] or path or runtime["path"]
    resolved_target = _require_arg(
        target,
        code="DROPBOX_TARGET_REQUIRED",
        message="file path or file_id is required",
        detail_key="env",
        detail_value=runtime["file_id_env"],
    )
    result = client.download_file(path_or_id=resolved_target)
    return {
        "status": "live_read",
        "backend": BACKEND_NAME,
        "summary": f"Downloaded Dropbox file {resolved_target}.",
        "download": result,
        "scope_preview": _scope_preview("file.download", "file", {"path_or_id": resolved_target}),
    }


def folder_list_result(ctx_obj: dict[str, Any], *, path: str | None, cursor: str | None, limit: int) -> dict[str, Any]:
    runtime = resolve_runtime_values(ctx_obj)
    client = create_client(ctx_obj)
    resolved_path = path or runtime["path"] or ""
    resolved_cursor = cursor or runtime["cursor"] or None
    payload = client.list_folders(path=resolved_path, cursor=resolved_cursor, limit=limit)
    return {
        "status": "live_read",
        "backend": BACKEND_NAME,
        "summary": f"Listed {len(payload['folders'])} Dropbox folder(s).",
        "folders": payload,
        "picker": _picker(_folder_items(payload["folders"]), kind="folder"),
        "scope_preview": _scope_preview("folder.list", "folder", {"path": resolved_path, "cursor": resolved_cursor}),
    }


def share_list_result(ctx_obj: dict[str, Any], *, path: str | None) -> dict[str, Any]:
    runtime = resolve_runtime_values(ctx_obj)
    client = create_client(ctx_obj)
    resolved_path = _require_arg(
        path or runtime["path"],
        code="DROPBOX_PATH_REQUIRED",
        message="Dropbox path is required",
        detail_key="env",
        detail_value=runtime["path_env"],
    )
    payload = client.list_shared_links(path=resolved_path)
    return {
        "status": "live_read",
        "backend": BACKEND_NAME,
        "summary": f"Listed shared links for {resolved_path}.",
        "share_links": payload,
        "picker": _picker(
            [
                {
                    "value": item.get("url"),
                    "label": item.get("name") or item.get("url"),
                    "subtitle": item.get("path_lower") or item.get("visibility"),
                    "selected": False,
                }
                for item in payload["links"]
            ],
            kind="shared_link",
        ),
        "scope_preview": _scope_preview("share.list", "share", {"path": resolved_path}),
    }


def search_query_result(ctx_obj: dict[str, Any], *, query: str | None, path: str | None, cursor: str | None, limit: int) -> dict[str, Any]:
    runtime = resolve_runtime_values(ctx_obj)
    client = create_client(ctx_obj)
    resolved_query = _require_arg(
        query or runtime["query"],
        code="DROPBOX_QUERY_REQUIRED",
        message="search query is required",
        detail_key="env",
        detail_value=runtime["query_env"],
    )
    resolved_path = path or runtime["path"] or ""
    resolved_cursor = cursor or runtime["cursor"] or None
    payload = client.search(query=resolved_query, path=resolved_path, cursor=resolved_cursor, limit=limit)
    return {
        "status": "live_read",
        "backend": BACKEND_NAME,
        "summary": f"Found {len(payload['matches'])} Dropbox match(es).",
        "search": payload,
        "picker": _picker(_file_items(payload["matches"]), kind="file"),
        "scope_preview": _scope_preview("search.query", "file", {"query": resolved_query, "path": resolved_path, "cursor": resolved_cursor}),
    }


def config_show_result(ctx_obj: dict[str, Any]) -> dict[str, Any]:
    return config_snapshot(ctx_obj, probe=probe_runtime(ctx_obj))
