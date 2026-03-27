from __future__ import annotations

import os
from typing import Any

from .constants import (
    BACKEND_NAME,
    SUPABASE_ANON_KEY_ENV,
    SUPABASE_BUCKET_ENV,
    SUPABASE_SERVICE_ROLE_KEY_ENV,
    SUPABASE_TABLE_ENV,
    SUPABASE_URL_ENV,
)


def _mask(value: str | None) -> str | None:
    if not value:
        return None
    if len(value) <= 8:
        return "*" * len(value)
    return f"{value[:4]}***{value[-4:]}"


def resolve_runtime_values(ctx_obj: dict[str, Any]) -> dict[str, Any]:
    url_env = ctx_obj.get("url_env") or SUPABASE_URL_ENV
    key_env = ctx_obj.get("key_env") or SUPABASE_SERVICE_ROLE_KEY_ENV
    anon_env = ctx_obj.get("anon_env") or SUPABASE_ANON_KEY_ENV
    table_env = ctx_obj.get("table_env") or SUPABASE_TABLE_ENV
    bucket_env = ctx_obj.get("bucket_env") or SUPABASE_BUCKET_ENV

    project_url = (os.getenv(url_env) or "").strip()
    service_role_key = (os.getenv(key_env) or "").strip()
    anon_key = (os.getenv(anon_env) or "").strip()
    table = (os.getenv(table_env) or "").strip()
    bucket = (os.getenv(bucket_env) or "").strip()

    return {
        "backend": BACKEND_NAME,
        "url_env": url_env,
        "key_env": key_env,
        "anon_env": anon_env,
        "table_env": table_env,
        "bucket_env": bucket_env,
        "project_url": project_url,
        "service_role_key": service_role_key,
        "anon_key": anon_key,
        "table": table,
        "bucket": bucket,
        "url_present": bool(project_url),
        "key_present": bool(service_role_key),
        "anon_key_present": bool(anon_key),
        "table_present": bool(table),
        "bucket_present": bool(bucket),
    }


def config_snapshot(ctx_obj: dict[str, Any]) -> dict[str, Any]:
    runtime = resolve_runtime_values(ctx_obj)
    live_ready = runtime["url_present"] and runtime["key_present"]
    command_defaults = {
        "table.select": {"selection_surface": "table", "limit": 100},
        "table.insert": {"selection_surface": "table"},
        "table.update": {"selection_surface": "table"},
        "table.delete": {"selection_surface": "table"},
        "rpc.call": {"selection_surface": "rpc"},
        "storage.list": {"selection_surface": "storage", "limit": 100},
        "storage.upload": {"selection_surface": "storage"},
        "storage.download": {"selection_surface": "storage"},
    }
    from .runtime import probe_runtime

    probe = probe_runtime(ctx_obj) if live_ready else {
        "ok": False,
        "code": "SKIPPED",
        "message": "Supabase probe skipped until credentials are configured",
        "details": {"skipped": True},
    }
    return {
        "summary": "Supabase connector configuration snapshot.",
        "backend": BACKEND_NAME,
        "runtime": {
            "implementation_mode": "live_read_write",
            "live_read_available": live_ready,
            "write_bridge_available": live_ready,
            "command_defaults": command_defaults,
            "probe": probe,
        },
        "auth": {
            "url_env": runtime["url_env"],
            "url_present": runtime["url_present"],
            "url_preview": _mask(runtime["project_url"]),
            "key_env": runtime["key_env"],
            "key_present": runtime["key_present"],
            "key_preview": _mask(runtime["service_role_key"]),
            "anon_key_env": runtime["anon_env"],
            "anon_key_present": runtime["anon_key_present"],
        },
        "scope": {
            "workerFields": ["project_url", "table", "filter", "rpc_function"],
            "table": runtime["table"] or None,
            "bucket": runtime["bucket"] or None,
        },
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
