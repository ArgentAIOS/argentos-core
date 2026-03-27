from __future__ import annotations

import json
from typing import Any

from .client import SupabaseApiError, SupabaseClient
from .config import resolve_runtime_values
from .constants import BACKEND_NAME, CONNECTOR_PATH
from .errors import CliError


def _load_manifest() -> dict[str, Any]:
    return json.loads(CONNECTOR_PATH.read_text())


def capabilities_snapshot() -> dict[str, Any]:
    manifest = _load_manifest()
    return {
        "tool": manifest["tool"],
        "backend": manifest["backend"],
        "manifest_schema_version": manifest.get("manifest_schema_version", "1.0.0"),
        "connector": manifest["connector"],
        "auth": manifest["auth"],
        "scope": manifest.get("scope", {}),
        "commands": manifest["commands"],
        "read_support": {
            "project.info": True,
            "table.select": True,
            "storage.list": True,
            "storage.download": True,
        },
        "write_support": {
            "table.insert": True,
            "table.update": True,
            "table.delete": True,
            "rpc.call": True,
            "storage.upload": True,
        },
    }


def create_client(ctx_obj: dict[str, Any]) -> SupabaseClient:
    runtime = resolve_runtime_values(ctx_obj)
    if not runtime["url_present"]:
        raise CliError(
            code="SUPABASE_SETUP_REQUIRED",
            message="Supabase connector is missing the project URL",
            exit_code=4,
            details={"missing_keys": [runtime["url_env"]]},
        )
    if not runtime["key_present"]:
        raise CliError(
            code="SUPABASE_SETUP_REQUIRED",
            message="Supabase connector is missing the service role key",
            exit_code=4,
            details={"missing_keys": [runtime["key_env"]]},
        )
    return SupabaseClient(project_url=runtime["project_url"], service_role_key=runtime["service_role_key"])


def probe_runtime(ctx_obj: dict[str, Any]) -> dict[str, Any]:
    runtime = resolve_runtime_values(ctx_obj)
    if not runtime["url_present"] or not runtime["key_present"]:
        missing = []
        if not runtime["url_present"]:
            missing.append(runtime["url_env"])
        if not runtime["key_present"]:
            missing.append(runtime["key_env"])
        return {
            "ok": False,
            "code": "SUPABASE_SETUP_REQUIRED",
            "message": "Supabase connector is missing required credentials",
            "details": {"missing_keys": missing, "live_backend_available": False},
        }
    try:
        client = create_client(ctx_obj)
        probe_result = client.probe()
    except CliError as err:
        return {"ok": False, "code": err.code, "message": err.message, "details": err.details}
    except SupabaseApiError as err:
        code = "SUPABASE_AUTH_FAILED" if err.status_code in {401, 403} else "SUPABASE_API_ERROR"
        return {
            "ok": False,
            "code": code,
            "message": err.message,
            "details": {
                **(err.details or {}),
                "status_code": err.status_code,
                "live_backend_available": False,
            },
        }
    return {
        "ok": True,
        "code": "OK",
        "message": "Supabase live runtime is ready",
        "details": {
            "live_backend_available": True,
            "project_url": runtime["project_url"],
        },
    }


def health_snapshot(ctx_obj: dict[str, Any]) -> dict[str, Any]:
    runtime = resolve_runtime_values(ctx_obj)
    probe = probe_runtime(ctx_obj)
    status = "ready" if probe["ok"] else ("needs_setup" if probe["code"] == "SUPABASE_SETUP_REQUIRED" else "degraded")
    return {
        "status": status,
        "summary": probe["message"],
        "connector": {
            "backend": BACKEND_NAME,
            "live_backend_available": bool(probe.get("ok")),
            "live_read_available": bool(probe.get("ok")),
            "write_bridge_available": bool(probe.get("ok")),
            "scaffold_only": False,
        },
        "auth": {
            "url_env": runtime["url_env"],
            "url_present": runtime["url_present"],
            "key_env": runtime["key_env"],
            "key_present": runtime["key_present"],
        },
        "scope": {
            "table": runtime["table"] or None,
            "bucket": runtime["bucket"] or None,
        },
        "checks": [
            {
                "name": "required_env",
                "ok": runtime["url_present"] and runtime["key_present"],
                "details": {
                    "missing_keys": [
                        k for k, present in [
                            (runtime["url_env"], runtime["url_present"]),
                            (runtime["key_env"], runtime["key_present"]),
                        ] if not present
                    ],
                },
            },
            {"name": "live_backend", "ok": bool(probe.get("ok")), "details": probe.get("details", {})},
        ],
        "runtime_ready": bool(probe.get("ok")),
        "live_backend_available": bool(probe.get("ok")),
        "live_read_available": bool(probe.get("ok")),
        "write_bridge_available": bool(probe.get("ok")),
        "scaffold_only": False,
        "probe": probe,
        "next_steps": [
            f"Set {runtime['url_env']} and {runtime['key_env']} in API Keys.",
            "Optionally set SUPABASE_TABLE and SUPABASE_BUCKET to scope default operations.",
        ],
    }


def doctor_snapshot(ctx_obj: dict[str, Any]) -> dict[str, Any]:
    runtime = resolve_runtime_values(ctx_obj)
    probe = probe_runtime(ctx_obj)
    live_ok = bool(probe.get("ok"))
    return {
        "status": "ready" if live_ok else ("needs_setup" if probe.get("code") == "SUPABASE_SETUP_REQUIRED" else "degraded"),
        "summary": "Supabase connector diagnostics.",
        "runtime": {
            "implementation_mode": "live_read_write",
            "command_readiness": {
                "project.info": live_ok,
                "table.select": live_ok,
                "table.insert": live_ok,
                "table.update": live_ok,
                "table.delete": live_ok,
                "rpc.call": live_ok,
                "storage.list": live_ok,
                "storage.upload": live_ok,
                "storage.download": live_ok,
            },
            "table_present": runtime["table_present"],
            "bucket_present": runtime["bucket_present"],
        },
        "checks": [
            {"name": "required_env", "ok": runtime["url_present"] and runtime["key_present"]},
            {"name": "live_backend", "ok": live_ok, "details": probe.get("details", {})},
        ],
        "supported_read_commands": ["project.info", "table.select", "storage.list", "storage.download"],
        "supported_write_commands": ["table.insert", "table.update", "table.delete", "rpc.call", "storage.upload"],
        "next_steps": [
            f"Set {runtime['url_env']} and {runtime['key_env']} in API Keys.",
            "Use project.info to confirm the connected Supabase project.",
            "Use table.select to query rows before enabling write operations.",
        ],
    }


def _require_arg(value: str | None, *, code: str, message: str, detail_key: str, detail_value: str) -> str:
    resolved = (value or "").strip()
    if resolved:
        return resolved
    raise CliError(code=code, message=message, exit_code=4, details={detail_key: detail_value})


def project_info_result(ctx_obj: dict[str, Any]) -> dict[str, Any]:
    runtime = resolve_runtime_values(ctx_obj)
    client = create_client(ctx_obj)
    probe_result = client.probe()
    return {
        "status": "live_read",
        "backend": BACKEND_NAME,
        "summary": f"Supabase project at {runtime['project_url']}.",
        "project_url": runtime["project_url"],
        "probe": probe_result,
        "scope_preview": {
            "selection_surface": "project",
            "command_id": "project.info",
        },
    }


def table_select_result(ctx_obj: dict[str, Any], table: str | None, *, select: str, filter_str: str | None, limit: int) -> dict[str, Any]:
    runtime = resolve_runtime_values(ctx_obj)
    resolved_table = _require_arg(
        table or runtime["table"],
        code="SUPABASE_TABLE_REQUIRED",
        message="Table name is required",
        detail_key="env",
        detail_value=runtime["table_env"],
    )
    client = create_client(ctx_obj)
    rows = client.table_select(resolved_table, select=select, filter_str=filter_str, limit=limit)
    return {
        "status": "live_read",
        "backend": BACKEND_NAME,
        "summary": f"Selected {len(rows)} row{'s' if len(rows) != 1 else ''} from {resolved_table}.",
        "table": resolved_table,
        "rows": rows,
        "row_count": len(rows),
        "scope_preview": {
            "selection_surface": "table",
            "command_id": "table.select",
            "table": resolved_table,
        },
    }


def table_insert_result(ctx_obj: dict[str, Any], table: str | None, *, row_json: str) -> dict[str, Any]:
    runtime = resolve_runtime_values(ctx_obj)
    resolved_table = _require_arg(
        table or runtime["table"],
        code="SUPABASE_TABLE_REQUIRED",
        message="Table name is required",
        detail_key="env",
        detail_value=runtime["table_env"],
    )
    import json as _json
    row = _json.loads(row_json)
    client = create_client(ctx_obj)
    result = client.table_insert(resolved_table, row=row)
    return {
        "status": "live_write",
        "backend": BACKEND_NAME,
        "summary": f"Inserted 1 row into {resolved_table}.",
        "table": resolved_table,
        "inserted": result,
        "scope_preview": {
            "selection_surface": "table",
            "command_id": "table.insert",
            "table": resolved_table,
        },
    }


def table_update_result(ctx_obj: dict[str, Any], table: str | None, *, filter_str: str, updates_json: str) -> dict[str, Any]:
    runtime = resolve_runtime_values(ctx_obj)
    resolved_table = _require_arg(
        table or runtime["table"],
        code="SUPABASE_TABLE_REQUIRED",
        message="Table name is required",
        detail_key="env",
        detail_value=runtime["table_env"],
    )
    import json as _json
    updates = _json.loads(updates_json)
    client = create_client(ctx_obj)
    rows = client.table_update(resolved_table, filter_str=filter_str, updates=updates)
    return {
        "status": "live_write",
        "backend": BACKEND_NAME,
        "summary": f"Updated {len(rows)} row{'s' if len(rows) != 1 else ''} in {resolved_table}.",
        "table": resolved_table,
        "updated": rows,
        "update_count": len(rows),
        "scope_preview": {
            "selection_surface": "table",
            "command_id": "table.update",
            "table": resolved_table,
        },
    }


def table_delete_result(ctx_obj: dict[str, Any], table: str | None, *, filter_str: str) -> dict[str, Any]:
    runtime = resolve_runtime_values(ctx_obj)
    resolved_table = _require_arg(
        table or runtime["table"],
        code="SUPABASE_TABLE_REQUIRED",
        message="Table name is required",
        detail_key="env",
        detail_value=runtime["table_env"],
    )
    client = create_client(ctx_obj)
    rows = client.table_delete(resolved_table, filter_str=filter_str)
    return {
        "status": "live_write",
        "backend": BACKEND_NAME,
        "summary": f"Deleted {len(rows)} row{'s' if len(rows) != 1 else ''} from {resolved_table}.",
        "table": resolved_table,
        "deleted": rows,
        "delete_count": len(rows),
        "scope_preview": {
            "selection_surface": "table",
            "command_id": "table.delete",
            "table": resolved_table,
        },
    }


def rpc_call_result(ctx_obj: dict[str, Any], function_name: str, *, params_json: str | None) -> dict[str, Any]:
    import json as _json
    params = _json.loads(params_json) if params_json else None
    client = create_client(ctx_obj)
    result = client.rpc_call(function_name, params=params)
    return {
        "status": "live_write",
        "backend": BACKEND_NAME,
        "summary": f"Called RPC function {function_name}.",
        "function": function_name,
        "result": result,
        "scope_preview": {
            "selection_surface": "rpc",
            "command_id": "rpc.call",
            "rpc_function": function_name,
        },
    }


def storage_list_result(ctx_obj: dict[str, Any], bucket: str | None, *, prefix: str, limit: int) -> dict[str, Any]:
    runtime = resolve_runtime_values(ctx_obj)
    resolved_bucket = _require_arg(
        bucket or runtime["bucket"],
        code="SUPABASE_BUCKET_REQUIRED",
        message="Storage bucket name is required",
        detail_key="env",
        detail_value=runtime["bucket_env"],
    )
    client = create_client(ctx_obj)
    files = client.storage_list_files(resolved_bucket, prefix=prefix, limit=limit)
    return {
        "status": "live_read",
        "backend": BACKEND_NAME,
        "summary": f"Listed {len(files)} file{'s' if len(files) != 1 else ''} in bucket {resolved_bucket}.",
        "bucket": resolved_bucket,
        "files": files,
        "file_count": len(files),
        "scope_preview": {
            "selection_surface": "storage",
            "command_id": "storage.list",
            "bucket": resolved_bucket,
        },
    }


def storage_download_result(ctx_obj: dict[str, Any], bucket: str | None, *, file_path: str) -> dict[str, Any]:
    runtime = resolve_runtime_values(ctx_obj)
    resolved_bucket = _require_arg(
        bucket or runtime["bucket"],
        code="SUPABASE_BUCKET_REQUIRED",
        message="Storage bucket name is required",
        detail_key="env",
        detail_value=runtime["bucket_env"],
    )
    client = create_client(ctx_obj)
    url = client.storage_download_url(resolved_bucket, file_path)
    return {
        "status": "live_read",
        "backend": BACKEND_NAME,
        "summary": f"Download URL for {file_path} in bucket {resolved_bucket}.",
        "bucket": resolved_bucket,
        "file_path": file_path,
        "download_url": url,
        "scope_preview": {
            "selection_surface": "storage",
            "command_id": "storage.download",
            "bucket": resolved_bucket,
        },
    }
