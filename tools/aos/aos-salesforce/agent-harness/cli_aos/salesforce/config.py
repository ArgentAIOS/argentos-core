from __future__ import annotations

import os
from .service_keys import service_key_env
from typing import Any

from .constants import (
    BACKEND_NAME,
    SALESFORCE_ACCESS_TOKEN_ENV,
    SALESFORCE_INSTANCE_URL_ENV,
    SALESFORCE_RECORD_ID_ENV,
    SALESFORCE_REPORT_ID_ENV,
)


def _mask(value: str | None) -> str | None:
    if not value:
        return None
    if len(value) <= 8:
        return "*" * len(value)
    return f"{value[:4]}***{value[-4:]}"


def resolve_runtime_values(ctx_obj: dict[str, Any]) -> dict[str, Any]:
    token_env = ctx_obj.get("token_env") or SALESFORCE_ACCESS_TOKEN_ENV
    instance_env = ctx_obj.get("instance_env") or SALESFORCE_INSTANCE_URL_ENV
    record_id_env = ctx_obj.get("record_id_env") or SALESFORCE_RECORD_ID_ENV
    report_id_env = ctx_obj.get("report_id_env") or SALESFORCE_REPORT_ID_ENV

    access_token = (service_key_env(token_env) or "").strip()
    instance_url = (service_key_env(instance_env) or "").strip()
    record_id = (service_key_env(record_id_env) or "").strip()
    report_id = (service_key_env(report_id_env) or "").strip()

    return {
        "backend": BACKEND_NAME,
        "token_env": token_env,
        "instance_env": instance_env,
        "record_id_env": record_id_env,
        "report_id_env": report_id_env,
        "access_token": access_token,
        "instance_url": instance_url,
        "record_id": record_id,
        "report_id": report_id,
        "access_token_present": bool(access_token),
        "instance_url_present": bool(instance_url),
        "record_id_present": bool(record_id),
        "report_id_present": bool(report_id),
    }


def config_snapshot(ctx_obj: dict[str, Any]) -> dict[str, Any]:
    runtime = resolve_runtime_values(ctx_obj)
    live_ready = runtime["access_token_present"] and runtime["instance_url_present"]

    from .runtime import probe_runtime

    probe = probe_runtime(ctx_obj) if live_ready else {
        "ok": False,
        "code": "SKIPPED",
        "message": "Salesforce probe skipped until credentials are configured",
        "details": {"skipped": True},
    }
    return {
        "summary": "Salesforce connector configuration snapshot.",
        "backend": BACKEND_NAME,
        "runtime": {
            "implementation_mode": "live_read_with_live_writes",
            "live_read_available": live_ready,
            "write_bridge_available": True,
            "probe": probe,
        },
        "auth": {
            "token_env": runtime["token_env"],
            "access_token_present": runtime["access_token_present"],
            "access_token_preview": _mask(runtime["access_token"]),
            "instance_env": runtime["instance_env"],
            "instance_url_present": runtime["instance_url_present"],
            "instance_url": runtime["instance_url"] or None,
        },
        "scope": {
            "workerFields": ["object_type", "record_id", "soql_query", "lead_source"],
            "record_id": runtime["record_id"] or None,
            "report_id": runtime["report_id"] or None,
        },
        "read_support": {
            "lead.list": True,
            "lead.get": True,
            "contact.list": True,
            "contact.get": True,
            "opportunity.list": True,
            "opportunity.get": True,
            "account.list": True,
            "account.get": True,
            "task.list": True,
            "report.run": True,
            "search.soql": True,
        },
        "write_support": {
            "lead.create": "live",
            "lead.update": "live",
            "contact.create": "live",
            "opportunity.create": "live",
            "opportunity.update": "live",
            "task.create": "live",
            "scaffold_only": False,
        },
    }
