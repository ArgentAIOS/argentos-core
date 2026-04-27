from __future__ import annotations

import json
from typing import Any

from .client import BoxApiError, BoxClient
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
        target = read_support if command["required_mode"] == "readonly" else write_support
        target[command["id"]] = True
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


def create_client(ctx_obj: dict[str, Any]) -> BoxClient:
    runtime = resolve_runtime_values(ctx_obj)
    if not runtime["access_token_present"]:
        raise CliError(code="BOX_SETUP_REQUIRED", message="Box connector is missing required credentials", exit_code=4, details={"missing_keys": [runtime["access_token_env"]]})
    return BoxClient(access_token=runtime["access_token"])


def probe_runtime(ctx_obj: dict[str, Any]) -> dict[str, Any]:
    runtime = resolve_runtime_values(ctx_obj)
    if not runtime["access_token_present"]:
        return {"ok": False, "code": "BOX_SETUP_REQUIRED", "message": "Box connector is missing required credentials", "details": {"missing_keys": [runtime["access_token_env"]], "live_backend_available": False}}
    try:
        client = create_client(ctx_obj)
        folder = client.get_folder(runtime["folder_id"] or "0")
    except CliError as err:
        return {"ok": False, "code": err.code, "message": err.message, "details": err.details}
    except BoxApiError as err:
        code = "BOX_AUTH_FAILED" if err.status_code in {401, 403} else "BOX_API_ERROR"
        return {"ok": False, "code": code, "message": err.message, "details": {**(err.details or {}), "status_code": err.status_code, "live_backend_available": False}}
    return {"ok": True, "code": "OK", "message": "Box live runtime is ready", "details": {"live_backend_available": True, "folder": folder}}


def health_snapshot(ctx_obj: dict[str, Any]) -> dict[str, Any]:
    runtime = resolve_runtime_values(ctx_obj)
    probe = probe_runtime(ctx_obj)
    status = "ready" if probe["ok"] else ("needs_setup" if probe["code"] == "BOX_SETUP_REQUIRED" else "degraded")
    return {
        "status": status,
        "summary": probe["message"],
        "connector": {"backend": BACKEND_NAME, "live_backend_available": bool(probe.get("ok")), "live_read_available": bool(probe.get("ok")), "write_bridge_available": False, "scaffold_only": False},
        "auth": {
            "access_token_env": runtime["access_token_env"],
            "access_token_present": runtime["access_token_present"],
            "client_id_present": bool(runtime["client_id"]),
            "client_secret_present": bool(runtime["client_secret"]),
            "jwt_config_present": bool(runtime["jwt_config"]),
            "service_keys": runtime["service_keys"],
            "operator_service_keys": runtime["service_keys"],
            "sources": runtime["sources"],
        },
        "scope": {"folder_id": runtime["folder_id"], "file_id": runtime["file_id"] or None},
        "checks": [
            {"name": "required_env", "ok": runtime["access_token_present"], "details": {"missing_keys": [] if runtime["access_token_present"] else [runtime["access_token_env"]]}},
            {"name": "live_backend", "ok": bool(probe.get("ok")), "details": probe.get("details", {})},
        ],
        "runtime_ready": bool(probe.get("ok")),
        "probe": probe,
        "next_steps": [
            f"Set {runtime['access_token_env']} in API Keys.",
            f"Optionally set {runtime['folder_id_env']} and {runtime['file_id_env']} for default scope.",
            "Use file.list or folder.get to confirm the live backend responds.",
            "Do not advertise Box write actions until a write bridge and approval policy are verified.",
        ],
    }


def doctor_snapshot(ctx_obj: dict[str, Any]) -> dict[str, Any]:
    runtime = resolve_runtime_values(ctx_obj)
    probe = probe_runtime(ctx_obj)
    ready = bool(probe.get("ok"))
    return {
        "status": "ready" if ready else ("needs_setup" if probe.get("code") == "BOX_SETUP_REQUIRED" else "degraded"),
        "summary": "Box connector diagnostics.",
        "runtime": {
            "implementation_mode": "live_read_only",
            "command_readiness": {
                "file.list": ready,
                "file.get": ready,
                "file.download": ready,
                "folder.list": ready,
                "folder.get": ready,
                "collaboration.list": ready,
                "search.query": ready,
                "metadata.get": ready and bool(runtime["file_id"]),
            },
        },
        "checks": [
            {"name": "required_env", "ok": runtime["access_token_present"]},
            {"name": "live_backend", "ok": ready, "details": probe.get("details", {})},
        ],
        "supported_read_commands": ["file.list", "file.get", "file.download", "folder.list", "folder.get", "collaboration.list", "search.query", "metadata.get"],
        "supported_write_commands": [],
        "next_steps": [
            f"Set {runtime['access_token_env']} in API Keys.",
            f"Optionally set {runtime['folder_id_env']}, {runtime['file_id_env']}, and {runtime['query_env']} for default scope.",
            "Do not advertise Box write actions until a write bridge and approval policy are verified.",
        ],
    }


def file_list_result(ctx_obj: dict[str, Any], *, folder_id: str | None, limit: int) -> dict[str, Any]:
    runtime = resolve_runtime_values(ctx_obj)
    resolved_folder = folder_id or runtime["folder_id"] or "0"
    client = create_client(ctx_obj)
    listing = client.list_folder_items(resolved_folder, limit=limit)
    files = [item for item in listing["items"] if item.get("type") == "file"]
    picker_items = [{"value": item["id"], "label": item["name"], "subtitle": item.get("type"), "selected": False} for item in files]
    return {"status": "live_read", "backend": BACKEND_NAME, "summary": f"Listed {len(files)} file(s) in folder {resolved_folder}.", "files": files, "picker": _picker(picker_items, kind="box_file"), "scope_preview": _scope_preview("file.list", "file", {"folder_id": resolved_folder})}


def file_get_result(ctx_obj: dict[str, Any], *, file_id: str | None) -> dict[str, Any]:
    runtime = resolve_runtime_values(ctx_obj)
    resolved_file_id = _require_arg(file_id or runtime["file_id"], code="BOX_FILE_ID_REQUIRED", message="file_id is required", detail_key="env", detail_value=runtime["file_id_env"])
    client = create_client(ctx_obj)
    file_item = client.get_file(resolved_file_id)
    return {"status": "live_read", "backend": BACKEND_NAME, "summary": f"Fetched file {resolved_file_id}.", "file": file_item, "scope_preview": _scope_preview("file.get", "file", {"file_id": resolved_file_id})}


def file_download_result(ctx_obj: dict[str, Any], *, file_id: str | None) -> dict[str, Any]:
    runtime = resolve_runtime_values(ctx_obj)
    resolved_file_id = _require_arg(file_id or runtime["file_id"], code="BOX_FILE_ID_REQUIRED", message="file_id is required", detail_key="env", detail_value=runtime["file_id_env"])
    client = create_client(ctx_obj)
    download = client.download_file(resolved_file_id)
    return {"status": "live_read", "backend": BACKEND_NAME, "summary": f"Downloaded file {resolved_file_id}.", "download": download, "scope_preview": _scope_preview("file.download", "file", {"file_id": resolved_file_id})}


def folder_list_result(ctx_obj: dict[str, Any], *, folder_id: str | None, limit: int) -> dict[str, Any]:
    runtime = resolve_runtime_values(ctx_obj)
    resolved_folder = folder_id or runtime["folder_id"] or "0"
    client = create_client(ctx_obj)
    listing = client.list_folder_items(resolved_folder, limit=limit)
    picker_items = [{"value": item["id"], "label": item["name"], "subtitle": item.get("type"), "selected": False} for item in listing["items"]]
    return {"status": "live_read", "backend": BACKEND_NAME, "summary": f"Listed {len(listing['items'])} item(s) in folder {resolved_folder}.", "items": listing["items"], "picker": _picker(picker_items, kind="box_folder_item"), "scope_preview": _scope_preview("folder.list", "folder", {"folder_id": resolved_folder})}


def folder_get_result(ctx_obj: dict[str, Any], *, folder_id: str | None) -> dict[str, Any]:
    runtime = resolve_runtime_values(ctx_obj)
    resolved_folder = folder_id or runtime["folder_id"] or "0"
    client = create_client(ctx_obj)
    folder = client.get_folder(resolved_folder)
    return {"status": "live_read", "backend": BACKEND_NAME, "summary": f"Fetched folder {resolved_folder}.", "folder": folder, "scope_preview": _scope_preview("folder.get", "folder", {"folder_id": resolved_folder})}


def collaboration_list_result(ctx_obj: dict[str, Any], *, folder_id: str | None) -> dict[str, Any]:
    runtime = resolve_runtime_values(ctx_obj)
    resolved_folder = folder_id or runtime["folder_id"] or "0"
    client = create_client(ctx_obj)
    listing = client.list_collaborations(resolved_folder)
    picker_items = [{"value": item["id"], "label": item["role"], "subtitle": str(item.get("accessible_by", {}).get("login") or item.get("status")), "selected": False} for item in listing["entries"]]
    return {"status": "live_read", "backend": BACKEND_NAME, "summary": f"Listed {len(listing['entries'])} collaboration(s).", "collaborations": listing["entries"], "picker": _picker(picker_items, kind="box_collaboration"), "scope_preview": _scope_preview("collaboration.list", "collaboration", {"folder_id": resolved_folder})}


def search_query_result(ctx_obj: dict[str, Any], *, query_text: str | None, limit: int) -> dict[str, Any]:
    runtime = resolve_runtime_values(ctx_obj)
    resolved_query = _require_arg(query_text or runtime["query"], code="BOX_QUERY_REQUIRED", message="query is required", detail_key="env", detail_value=runtime["query_env"])
    client = create_client(ctx_obj)
    search = client.search(query_text=resolved_query, limit=limit)
    picker_items = [{"value": item["id"], "label": item["name"], "subtitle": item.get("type"), "selected": False} for item in search["entries"]]
    return {"status": "live_read", "backend": BACKEND_NAME, "summary": f"Found {len(search['entries'])} item(s).", "results": search["entries"], "picker": _picker(picker_items, kind="box_search_result"), "scope_preview": _scope_preview("search.query", "file", {"query": resolved_query})}


def metadata_get_result(ctx_obj: dict[str, Any], *, file_id: str | None) -> dict[str, Any]:
    runtime = resolve_runtime_values(ctx_obj)
    resolved_file_id = _require_arg(file_id or runtime["file_id"], code="BOX_FILE_ID_REQUIRED", message="file_id is required", detail_key="env", detail_value=runtime["file_id_env"])
    client = create_client(ctx_obj)
    metadata = client.get_metadata(file_id=resolved_file_id)
    return {"status": "live_read", "backend": BACKEND_NAME, "summary": f"Fetched metadata for file {resolved_file_id}.", "metadata": metadata, "scope_preview": _scope_preview("metadata.get", "file", {"file_id": resolved_file_id})}


def config_show_result(ctx_obj: dict[str, Any]) -> dict[str, Any]:
    return config_snapshot(ctx_obj, probe=probe_runtime(ctx_obj))
