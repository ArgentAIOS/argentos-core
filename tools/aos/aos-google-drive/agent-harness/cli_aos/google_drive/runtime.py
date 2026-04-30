from __future__ import annotations

import json
from typing import Any

from .client import GoogleDriveApiError, GoogleDriveClient
from .config import config_snapshot, resolve_runtime_values
from .constants import (
    BACKEND_NAME,
    CONNECTOR_PATH,
    DEFAULT_EXPORT_DOCX_MIME,
    DEFAULT_EXPORT_PDF_MIME,
)
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
    read_support = {}
    write_support = {}
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


def create_client(ctx_obj: dict[str, Any]) -> GoogleDriveClient:
    runtime = resolve_runtime_values(ctx_obj)
    if not runtime["credentials_present"]:
        missing = [
            env
            for env, present in [
                (runtime["client_id_env"], runtime["client_id_present"]),
                (runtime["client_secret_env"], runtime["client_secret_present"]),
                (runtime["refresh_token_env"], runtime["refresh_token_present"]),
            ]
            if not present
        ]
        raise CliError(
            code="GOOGLE_DRIVE_SETUP_REQUIRED",
            message="Google Drive connector is missing required OAuth credentials",
            exit_code=4,
            details={"missing_keys": missing},
        )
    return GoogleDriveClient(
        client_id=runtime["client_id"],
        client_secret=runtime["client_secret"],
        refresh_token=runtime["refresh_token"],
        base_url=runtime["base_url"],
    )


def probe_runtime(ctx_obj: dict[str, Any]) -> dict[str, Any]:
    runtime = resolve_runtime_values(ctx_obj)
    if not runtime["credentials_present"]:
        missing = [
            env
            for env, present in [
                (runtime["client_id_env"], runtime["client_id_present"]),
                (runtime["client_secret_env"], runtime["client_secret_present"]),
                (runtime["refresh_token_env"], runtime["refresh_token_present"]),
            ]
            if not present
        ]
        return {
            "ok": False,
            "code": "GOOGLE_DRIVE_SETUP_REQUIRED",
            "message": "Google Drive connector is missing required OAuth credentials",
            "details": {"missing_keys": missing, "live_backend_available": False},
        }
    try:
        client = create_client(ctx_obj)
        files = client.list_files(limit=1)
    except CliError as err:
        return {"ok": False, "code": err.code, "message": err.message, "details": err.details}
    except GoogleDriveApiError as err:
        code = "GOOGLE_DRIVE_AUTH_FAILED" if err.status_code in {401, 403} else "GOOGLE_DRIVE_API_ERROR"
        return {
            "ok": False,
            "code": code,
            "message": err.message,
            "details": {**(err.details or {}), "status_code": err.status_code, "live_backend_available": False},
        }
    return {
        "ok": True,
        "code": "OK",
        "message": "Google Drive live runtime is ready",
        "details": {"live_backend_available": True, "file_count": files["count"], "sample_files": [item["id"] for item in files["files"][:1]]},
    }


def health_snapshot(ctx_obj: dict[str, Any]) -> dict[str, Any]:
    runtime = resolve_runtime_values(ctx_obj)
    probe = probe_runtime(ctx_obj)
    status = "ready" if probe["ok"] else ("needs_setup" if probe["code"] == "GOOGLE_DRIVE_SETUP_REQUIRED" else "degraded")
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
            "client_id_env": runtime["client_id_env"],
            "client_id_present": runtime["client_id_present"],
            "client_secret_env": runtime["client_secret_env"],
            "client_secret_present": runtime["client_secret_present"],
            "refresh_token_env": runtime["refresh_token_env"],
            "refresh_token_present": runtime["refresh_token_present"],
            "service_keys": runtime.get("service_keys", []),
            "operator_service_keys": runtime.get("service_keys", []),
            "sources": runtime.get("sources", {}),
            "development_fallback": runtime.get("service_keys", []),
        },
        "scope": {
            "base_url": runtime["base_url"],
            "folder_id": runtime["folder_id"] or None,
            "file_id": runtime["file_id"] or None,
            "mime_type": runtime["mime_type"] or None,
            "query": runtime["query"] or None,
        },
        "checks": [
            {"name": "required_env", "ok": runtime["credentials_present"], "details": {"missing_keys": [] if runtime["credentials_present"] else probe.get("details", {}).get("missing_keys", [])}},
            {"name": "live_backend", "ok": bool(probe.get("ok")), "details": probe.get("details", {})},
        ],
        "runtime_ready": bool(probe.get("ok")),
        "live_backend_available": bool(probe.get("ok")),
        "live_read_available": bool(probe.get("ok")),
        "write_bridge_available": False,
        "scaffold_only": False,
        "probe": probe,
        "next_steps": [
            f"Set {runtime['client_id_env']}, {runtime['client_secret_env']}, and {runtime['refresh_token_env']} in operator-controlled API Keys.",
            f"Optionally set {runtime['folder_id_env']} and {runtime['file_id_env']} for defaults.",
            "Use file.list to confirm the connected account is reachable.",
            "Do not advertise Google Drive write commands until live write workflows and approval policy are implemented.",
        ],
    }


def doctor_snapshot(ctx_obj: dict[str, Any]) -> dict[str, Any]:
    runtime = resolve_runtime_values(ctx_obj)
    probe = probe_runtime(ctx_obj)
    ready = bool(probe.get("ok"))
    return {
        "status": "ready" if ready else ("needs_setup" if probe.get("code") == "GOOGLE_DRIVE_SETUP_REQUIRED" else "degraded"),
        "summary": "Google Drive connector diagnostics.",
        "runtime": {
            "implementation_mode": "live_read_only",
            "command_readiness": {
                "file.list": ready,
                "file.get": ready,
                "folder.list": ready,
                "share.list": ready,
                "export.pdf": ready,
                "export.docx": ready,
                "search.query": ready,
            },
            "folder_id_present": runtime["folder_id_present"],
            "file_id_present": runtime["file_id_present"],
            "mime_type_present": runtime["mime_type_present"],
        },
        "checks": [
            {"name": "required_env", "ok": runtime["credentials_present"]},
            {"name": "live_backend", "ok": ready, "details": probe.get("details", {})},
        ],
        "supported_read_commands": ["file.list", "file.get", "folder.list", "share.list", "export.pdf", "export.docx", "search.query"],
        "supported_write_commands": [],
        "next_steps": [
            f"Set {runtime['client_id_env']}, {runtime['client_secret_env']}, and {runtime['refresh_token_env']} to enable live calls.",
            f"Set {runtime['file_id_env']} and {runtime['folder_id_env']} for stable worker defaults.",
            "Use health to confirm OAuth and Drive access.",
            "Do not advertise Google Drive write commands until live write workflows and approval policy are implemented.",
        ],
    }


def file_list_result(ctx_obj: dict[str, Any], *, limit: int, folder_id: str | None = None, mime_type: str | None = None) -> dict[str, Any]:
    runtime = resolve_runtime_values(ctx_obj)
    client = create_client(ctx_obj)
    files = client.list_files(
        limit=limit,
        folder_id=folder_id or runtime["folder_id"] or None,
        mime_type=mime_type or runtime["mime_type"] or None,
    )
    picker_items = [{"value": item["id"], "label": item["name"] or item["id"], "subtitle": item.get("mimeType"), "selected": False} for item in files["files"]]
    return {"status": "live_read", "backend": BACKEND_NAME, "summary": f"Listed {files['count']} file(s).", "files": files, "picker": _picker(picker_items, kind="file"), "scope_preview": _scope_preview("file.list", "file", {"limit": limit})}


def file_get_result(ctx_obj: dict[str, Any], *, file_id: str | None) -> dict[str, Any]:
    runtime = resolve_runtime_values(ctx_obj)
    resolved_file_id = _require_arg(file_id or runtime["file_id"], code="GOOGLE_DRIVE_FILE_ID_REQUIRED", message="file_id is required", detail_key="env", detail_value=runtime["file_id_env"])
    client = create_client(ctx_obj)
    file = client.get_file(resolved_file_id)
    return {"status": "live_read", "backend": BACKEND_NAME, "summary": f"Read file {file.get('name') or resolved_file_id}.", "file": file, "scope_preview": _scope_preview("file.get", "file", {"file_id": resolved_file_id})}


def folder_list_result(ctx_obj: dict[str, Any], *, limit: int, folder_id: str | None = None) -> dict[str, Any]:
    runtime = resolve_runtime_values(ctx_obj)
    client = create_client(ctx_obj)
    folders = client.list_folders(limit=limit, folder_id=folder_id or runtime["folder_id"] or None)
    picker_items = [{"value": item["id"], "label": item["name"] or item["id"], "subtitle": item.get("mimeType"), "selected": False} for item in folders["files"]]
    return {"status": "live_read", "backend": BACKEND_NAME, "summary": f"Listed {folders['count']} folder(s).", "folders": folders, "picker": _picker(picker_items, kind="folder"), "scope_preview": _scope_preview("folder.list", "folder", {"limit": limit})}


def share_list_result(ctx_obj: dict[str, Any], *, file_id: str | None) -> dict[str, Any]:
    runtime = resolve_runtime_values(ctx_obj)
    resolved_file_id = _require_arg(file_id or runtime["file_id"], code="GOOGLE_DRIVE_FILE_ID_REQUIRED", message="file_id is required", detail_key="env", detail_value=runtime["file_id_env"])
    client = create_client(ctx_obj)
    permissions = client.list_permissions(file_id=resolved_file_id)
    picker_items = [{"value": item["id"], "label": item.get("emailAddress") or item["id"], "subtitle": item.get("role"), "selected": False} for item in permissions["permissions"]]
    return {"status": "live_read", "backend": BACKEND_NAME, "summary": f"Listed {permissions['count']} permission(s).", "permissions": permissions, "picker": _picker(picker_items, kind="permission"), "scope_preview": _scope_preview("share.list", "share", {"file_id": resolved_file_id})}


def export_pdf_result(ctx_obj: dict[str, Any], *, file_id: str | None) -> dict[str, Any]:
    runtime = resolve_runtime_values(ctx_obj)
    resolved_file_id = _require_arg(file_id or runtime["file_id"], code="GOOGLE_DRIVE_FILE_ID_REQUIRED", message="file_id is required", detail_key="env", detail_value=runtime["file_id_env"])
    client = create_client(ctx_obj)
    export = client.export_file(file_id=resolved_file_id, mime_type=DEFAULT_EXPORT_PDF_MIME)
    return {"status": "live_read", "backend": BACKEND_NAME, "summary": f"Exported file {resolved_file_id} as PDF.", "export": export, "scope_preview": _scope_preview("export.pdf", "file", {"file_id": resolved_file_id})}


def export_docx_result(ctx_obj: dict[str, Any], *, file_id: str | None) -> dict[str, Any]:
    runtime = resolve_runtime_values(ctx_obj)
    resolved_file_id = _require_arg(file_id or runtime["file_id"], code="GOOGLE_DRIVE_FILE_ID_REQUIRED", message="file_id is required", detail_key="env", detail_value=runtime["file_id_env"])
    client = create_client(ctx_obj)
    export = client.export_file(file_id=resolved_file_id, mime_type=DEFAULT_EXPORT_DOCX_MIME)
    return {"status": "live_read", "backend": BACKEND_NAME, "summary": f"Exported file {resolved_file_id} as DOCX.", "export": export, "scope_preview": _scope_preview("export.docx", "file", {"file_id": resolved_file_id})}


def search_query_result(ctx_obj: dict[str, Any], *, query_text: str | None, limit: int) -> dict[str, Any]:
    runtime = resolve_runtime_values(ctx_obj)
    resolved_query = _require_arg(query_text or runtime["query"], code="GOOGLE_DRIVE_QUERY_REQUIRED", message="query is required", detail_key="env", detail_value=runtime["query_env"])
    client = create_client(ctx_obj)
    results = client.search_files(query_text=resolved_query, limit=limit)
    picker_items = [{"value": item["id"], "label": item["name"] or item["id"], "subtitle": item.get("mimeType"), "selected": False} for item in results["files"]]
    return {"status": "live_read", "backend": BACKEND_NAME, "summary": f"Search returned {results['count']} file(s).", "results": results, "picker": _picker(picker_items, kind="file"), "scope_preview": _scope_preview("search.query", "file", {"query": resolved_query})}


def config_show_result(ctx_obj: dict[str, Any]) -> dict[str, Any]:
    return config_snapshot(ctx_obj, probe=probe_runtime(ctx_obj))
