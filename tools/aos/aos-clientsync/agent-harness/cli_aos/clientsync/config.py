from __future__ import annotations

import os
from typing import Any

from .constants import (
    BACKEND_NAME,
    DEFAULT_API_URL,
    CLIENTSYNC_API_KEY_ENV,
    CLIENTSYNC_API_URL_ENV,
    CLIENTSYNC_CLIENT_ID_ENV,
    CLIENTSYNC_TICKET_ID_ENV,
    CLIENTSYNC_TECHNICIAN_ID_ENV,
    CLIENTSYNC_COMPLIANCE_ID_ENV,
    CLIENTSYNC_SLA_ID_ENV,
    CLIENTSYNC_REPORT_TYPE_ENV,
)


def _mask(value: str | None) -> str | None:
    if not value:
        return None
    if len(value) <= 8:
        return "*" * len(value)
    return f"{value[:4]}***{value[-4:]}"


def resolve_runtime_values(ctx_obj: dict[str, Any]) -> dict[str, Any]:
    api_key_env = ctx_obj.get("api_key_env") or CLIENTSYNC_API_KEY_ENV
    api_url_env = ctx_obj.get("api_url_env") or CLIENTSYNC_API_URL_ENV
    client_id_env = ctx_obj.get("client_id_env") or CLIENTSYNC_CLIENT_ID_ENV
    ticket_id_env = ctx_obj.get("ticket_id_env") or CLIENTSYNC_TICKET_ID_ENV
    technician_id_env = ctx_obj.get("technician_id_env") or CLIENTSYNC_TECHNICIAN_ID_ENV
    compliance_id_env = ctx_obj.get("compliance_id_env") or CLIENTSYNC_COMPLIANCE_ID_ENV
    sla_id_env = ctx_obj.get("sla_id_env") or CLIENTSYNC_SLA_ID_ENV
    report_type_env = ctx_obj.get("report_type_env") or CLIENTSYNC_REPORT_TYPE_ENV

    api_key = (os.getenv(api_key_env) or "").strip()
    api_url = (os.getenv(api_url_env) or DEFAULT_API_URL).strip() or DEFAULT_API_URL
    client_id = (os.getenv(client_id_env) or "").strip()
    ticket_id = (os.getenv(ticket_id_env) or "").strip()
    technician_id = (os.getenv(technician_id_env) or "").strip()
    compliance_id = (os.getenv(compliance_id_env) or "").strip()
    sla_id = (os.getenv(sla_id_env) or "").strip()
    report_type = (os.getenv(report_type_env) or "").strip()

    return {
        "backend": BACKEND_NAME,
        "api_key_env": api_key_env,
        "api_url_env": api_url_env,
        "client_id_env": client_id_env,
        "ticket_id_env": ticket_id_env,
        "technician_id_env": technician_id_env,
        "compliance_id_env": compliance_id_env,
        "sla_id_env": sla_id_env,
        "report_type_env": report_type_env,
        "api_key": api_key,
        "api_url": api_url,
        "client_id": client_id,
        "ticket_id": ticket_id,
        "technician_id": technician_id,
        "compliance_id": compliance_id,
        "sla_id": sla_id,
        "report_type": report_type,
        "api_key_present": bool(api_key),
        "api_url_source": "env" if os.getenv(api_url_env) else "default",
        "client_id_present": bool(client_id),
        "ticket_id_present": bool(ticket_id),
        "technician_id_present": bool(technician_id),
        "compliance_id_present": bool(compliance_id),
        "sla_id_present": bool(sla_id),
        "report_type_present": bool(report_type),
    }


def config_snapshot(ctx_obj: dict[str, Any]) -> dict[str, Any]:
    runtime = resolve_runtime_values(ctx_obj)
    live_ready = runtime["api_key_present"]

    from .runtime import probe_runtime

    probe = probe_runtime(ctx_obj) if live_ready else {
        "ok": False,
        "code": "SKIPPED",
        "message": "ClientSync probe skipped until CLIENTSYNC_API_KEY is configured",
        "details": {"skipped": True},
    }
    return {
        "summary": "ClientSync connector configuration snapshot.",
        "backend": BACKEND_NAME,
        "runtime": {
            "implementation_mode": "live_read_write",
            "live_read_available": runtime["api_key_present"],
            "write_bridge_available": runtime["api_key_present"],
            "probe": probe,
        },
        "auth": {
            "api_key_env": runtime["api_key_env"],
            "api_key_present": runtime["api_key_present"],
            "api_key_preview": _mask(runtime["api_key"]),
            "api_url": runtime["api_url"],
            "api_url_source": runtime["api_url_source"],
        },
        "scope": {
            "workerFields": ["client_id", "ticket_id", "technician_id", "compliance_id", "report_type"],
            "client_id": runtime["client_id"] or None,
            "ticket_id": runtime["ticket_id"] or None,
            "technician_id": runtime["technician_id"] or None,
            "compliance_id": runtime["compliance_id"] or None,
            "sla_id": runtime["sla_id"] or None,
            "report_type": runtime["report_type"] or None,
        },
        "read_support": {
            "client.list": True,
            "client.get": True,
            "client.portal": True,
            "ticket.list": True,
            "ticket.get": True,
            "technician.list": True,
            "technician.get": True,
            "technician.availability": True,
            "compliance.list": True,
            "compliance.get": True,
            "compliance.check": True,
            "asset.list": True,
            "asset.get": True,
            "contract.list": True,
            "contract.get": True,
            "analytics.dashboard": True,
            "analytics.client_health": True,
            "analytics.sla_performance": True,
            "report.list": True,
            "audit.list": True,
        },
        "write_support": {
            "client.create": True,
            "client.update": True,
            "ticket.create": True,
            "ticket.update": True,
            "ticket.assign": True,
            "ticket.resolve": True,
            "compliance.report": True,
            "asset.create": True,
            "contract.renew": True,
            "report.generate": True,
            "audit.create": True,
        },
    }
