from __future__ import annotations

import os
from typing import Any

from .constants import (
    BACKEND_NAME,
    PIPEDRIVE_API_TOKEN_ENV,
    PIPEDRIVE_COMPANY_DOMAIN_ENV,
    PIPEDRIVE_DEAL_ID_ENV,
    PIPEDRIVE_ORG_ID_ENV,
    PIPEDRIVE_PERSON_ID_ENV,
    PIPEDRIVE_PIPELINE_ID_ENV,
)


def _mask(value: str | None) -> str | None:
    if not value:
        return None
    if len(value) <= 8:
        return "*" * len(value)
    return f"{value[:4]}***{value[-4:]}"


def resolve_runtime_values(ctx_obj: dict[str, Any]) -> dict[str, Any]:
    token_env = ctx_obj.get("token_env") or PIPEDRIVE_API_TOKEN_ENV
    domain_env = ctx_obj.get("domain_env") or PIPEDRIVE_COMPANY_DOMAIN_ENV
    deal_id_env = ctx_obj.get("deal_id_env") or PIPEDRIVE_DEAL_ID_ENV
    person_id_env = ctx_obj.get("person_id_env") or PIPEDRIVE_PERSON_ID_ENV
    org_id_env = ctx_obj.get("org_id_env") or PIPEDRIVE_ORG_ID_ENV
    pipeline_id_env = ctx_obj.get("pipeline_id_env") or PIPEDRIVE_PIPELINE_ID_ENV

    api_token = (os.getenv(token_env) or "").strip()
    company_domain = (os.getenv(domain_env) or "").strip() or None
    deal_id = (os.getenv(deal_id_env) or "").strip()
    person_id = (os.getenv(person_id_env) or "").strip()
    org_id = (os.getenv(org_id_env) or "").strip()
    pipeline_id = (os.getenv(pipeline_id_env) or "").strip()

    return {
        "backend": BACKEND_NAME,
        "token_env": token_env,
        "domain_env": domain_env,
        "deal_id_env": deal_id_env,
        "person_id_env": person_id_env,
        "org_id_env": org_id_env,
        "pipeline_id_env": pipeline_id_env,
        "api_token": api_token,
        "company_domain": company_domain,
        "deal_id": deal_id,
        "person_id": person_id,
        "org_id": org_id,
        "pipeline_id": pipeline_id,
        "api_token_present": bool(api_token),
        "deal_id_present": bool(deal_id),
        "person_id_present": bool(person_id),
        "org_id_present": bool(org_id),
        "pipeline_id_present": bool(pipeline_id),
    }


def config_snapshot(ctx_obj: dict[str, Any]) -> dict[str, Any]:
    runtime = resolve_runtime_values(ctx_obj)
    live_ready = runtime["api_token_present"]

    from .runtime import probe_runtime

    probe = probe_runtime(ctx_obj) if live_ready else {
        "ok": False,
        "code": "SKIPPED",
        "message": "Pipedrive probe skipped until PIPEDRIVE_API_TOKEN is configured",
        "details": {"skipped": True},
    }
    return {
        "summary": "Pipedrive connector configuration snapshot.",
        "backend": BACKEND_NAME,
        "runtime": {
            "implementation_mode": "live_read_with_live_writes",
            "live_read_available": live_ready,
            "write_bridge_available": True,
            "probe": probe,
        },
        "auth": {
            "token_env": runtime["token_env"],
            "api_token_present": runtime["api_token_present"],
            "api_token_preview": _mask(runtime["api_token"]),
            "company_domain": runtime["company_domain"],
        },
        "scope": {
            "workerFields": ["deal_id", "person_id", "org_id", "pipeline_id", "stage_id", "title", "value", "currency"],
            "deal_id": runtime["deal_id"] or None,
            "person_id": runtime["person_id"] or None,
            "org_id": runtime["org_id"] or None,
            "pipeline_id": runtime["pipeline_id"] or None,
        },
        "read_support": {
            "deal.list": True,
            "deal.get": True,
            "person.list": True,
            "person.get": True,
            "organization.list": True,
            "organization.get": True,
            "activity.list": True,
            "pipeline.list": True,
            "stage.list": True,
        },
        "write_support": {
            "deal.create": "live",
            "deal.update": "live",
            "person.create": "live",
            "organization.create": "live",
            "activity.create": "live",
            "note.create": "live",
            "scaffold_only": False,
        },
    }
