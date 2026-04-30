from __future__ import annotations

import os
from .service_keys import service_key_env
from typing import Any

from .constants import (
    BACKEND_NAME,
    NEON_API_KEY_ENV,
    NEON_BRANCH_ENV,
    NEON_CONNECTION_STRING_ENV,
    NEON_PROJECT_ID_ENV,
)


def _mask(value: str | None) -> str | None:
    if not value:
        return None
    if len(value) <= 8:
        return "*" * len(value)
    return f"{value[:4]}***{value[-4:]}"


def _mask_connection_string(value: str | None) -> str | None:
    """Mask password in postgresql://user:pass@host/db."""
    if not value:
        return None
    if "://" not in value or "@" not in value:
        return _mask(value)
    try:
        scheme_rest = value.split("://", 1)
        user_pass_rest = scheme_rest[1].split("@", 1)
        user_pass = user_pass_rest[0]
        host_db = user_pass_rest[1]
        if ":" in user_pass:
            user = user_pass.split(":", 1)[0]
            return f"{scheme_rest[0]}://{user}:***@{host_db}"
        return f"{scheme_rest[0]}://{user_pass}:***@{host_db}"
    except (IndexError, ValueError):
        return _mask(value)


def resolve_runtime_values(ctx_obj: dict[str, Any]) -> dict[str, Any]:
    api_key_env = ctx_obj.get("api_key_env") or NEON_API_KEY_ENV
    conn_env = ctx_obj.get("conn_env") or NEON_CONNECTION_STRING_ENV
    project_id_env = ctx_obj.get("project_id_env") or NEON_PROJECT_ID_ENV
    branch_env = ctx_obj.get("branch_env") or NEON_BRANCH_ENV

    api_key = (service_key_env(api_key_env) or "").strip()
    connection_string = (service_key_env(conn_env) or "").strip()
    project_id = (service_key_env(project_id_env) or "").strip()
    branch = (service_key_env(branch_env) or "").strip()

    return {
        "backend": BACKEND_NAME,
        "api_key_env": api_key_env,
        "conn_env": conn_env,
        "project_id_env": project_id_env,
        "branch_env": branch_env,
        "api_key": api_key,
        "connection_string": connection_string,
        "project_id": project_id,
        "branch": branch,
        "api_key_present": bool(api_key),
        "conn_present": bool(connection_string),
        "project_id_present": bool(project_id),
        "branch_present": bool(branch),
    }


def config_snapshot(ctx_obj: dict[str, Any]) -> dict[str, Any]:
    runtime = resolve_runtime_values(ctx_obj)
    sql_ready = runtime["conn_present"]
    branch_ready = runtime["api_key_present"] and runtime["project_id_present"]
    command_defaults = {
        "sql.query": {"selection_surface": "sql", "limit": 100},
        "sql.execute": {"selection_surface": "sql"},
        "branch.list": {"selection_surface": "branch"},
        "branch.create": {"selection_surface": "branch"},
        "branch.delete": {"selection_surface": "branch"},
        "project.info": {"selection_surface": "project"},
    }
    from .runtime import probe_runtime

    probe = probe_runtime(ctx_obj) if sql_ready else {
        "ok": False,
        "code": "SKIPPED",
        "message": "Neon probe skipped until connection string is configured",
        "details": {"skipped": True},
    }
    return {
        "summary": "Neon connector configuration snapshot.",
        "backend": BACKEND_NAME,
        "runtime": {
            "implementation_mode": "live_read_write",
            "live_read_available": sql_ready,
            "write_bridge_available": sql_ready,
            "branch_management_available": branch_ready,
            "command_defaults": command_defaults,
            "probe": probe,
        },
        "auth": {
            "api_key_env": runtime["api_key_env"],
            "api_key_present": runtime["api_key_present"],
            "api_key_preview": _mask(runtime["api_key"]),
            "conn_env": runtime["conn_env"],
            "conn_present": runtime["conn_present"],
            "conn_preview": _mask_connection_string(runtime["connection_string"]),
            "project_id_env": runtime["project_id_env"],
            "project_id_present": runtime["project_id_present"],
        },
        "scope": {
            "workerFields": ["connection_string", "query", "branch"],
            "branch": runtime["branch"] or None,
            "project_id": runtime["project_id"] or None,
        },
        "read_support": {
            "project.info": branch_ready,
            "sql.query": sql_ready,
            "branch.list": branch_ready,
        },
        "write_support": {
            "sql.execute": sql_ready,
            "branch.create": branch_ready,
            "branch.delete": branch_ready,
        },
    }
