from __future__ import annotations

import os
from typing import Any

from .constants import (
    BACKEND_NAME,
    CONNECTWISE_BOARD_ID_ENV,
    CONNECTWISE_COMPANY_ID_ENV,
    CONNECTWISE_COMPANY_ID_SCOPE_ENV,
    CONNECTWISE_CONFIGURATION_ID_ENV,
    CONNECTWISE_CONTACT_ID_ENV,
    CONNECTWISE_PRIVATE_KEY_ENV,
    CONNECTWISE_PROJECT_ID_ENV,
    CONNECTWISE_PUBLIC_KEY_ENV,
    CONNECTWISE_SITE_URL_ENV,
    CONNECTWISE_TICKET_ID_ENV,
)


def _mask(value: str | None) -> str | None:
    if not value:
        return None
    if len(value) <= 8:
        return "*" * len(value)
    return f"{value[:4]}***{value[-4:]}"


def resolve_runtime_values(ctx_obj: dict[str, Any]) -> dict[str, Any]:
    company_id_env = ctx_obj.get("company_id_env") or CONNECTWISE_COMPANY_ID_ENV
    public_key_env = ctx_obj.get("public_key_env") or CONNECTWISE_PUBLIC_KEY_ENV
    private_key_env = ctx_obj.get("private_key_env") or CONNECTWISE_PRIVATE_KEY_ENV
    site_url_env = ctx_obj.get("site_url_env") or CONNECTWISE_SITE_URL_ENV
    board_id_env = ctx_obj.get("board_id_env") or CONNECTWISE_BOARD_ID_ENV
    company_scope_env = ctx_obj.get("company_scope_env") or CONNECTWISE_COMPANY_ID_SCOPE_ENV
    ticket_id_env = ctx_obj.get("ticket_id_env") or CONNECTWISE_TICKET_ID_ENV
    contact_id_env = ctx_obj.get("contact_id_env") or CONNECTWISE_CONTACT_ID_ENV
    project_id_env = ctx_obj.get("project_id_env") or CONNECTWISE_PROJECT_ID_ENV
    configuration_id_env = ctx_obj.get("configuration_id_env") or CONNECTWISE_CONFIGURATION_ID_ENV

    company_id = (os.getenv(company_id_env) or "").strip()
    public_key = (os.getenv(public_key_env) or "").strip()
    private_key = (os.getenv(private_key_env) or "").strip()
    site_url = (os.getenv(site_url_env) or "").strip()
    board_id = (os.getenv(board_id_env) or "").strip()
    company_scope = (os.getenv(company_scope_env) or "").strip()
    ticket_id = (os.getenv(ticket_id_env) or "").strip()
    contact_id = (os.getenv(contact_id_env) or "").strip()
    project_id = (os.getenv(project_id_env) or "").strip()
    configuration_id = (os.getenv(configuration_id_env) or "").strip()

    return {
        "backend": BACKEND_NAME,
        "company_id_env": company_id_env,
        "public_key_env": public_key_env,
        "private_key_env": private_key_env,
        "site_url_env": site_url_env,
        "board_id_env": board_id_env,
        "company_scope_env": company_scope_env,
        "ticket_id_env": ticket_id_env,
        "contact_id_env": contact_id_env,
        "project_id_env": project_id_env,
        "configuration_id_env": configuration_id_env,
        "company_id": company_id,
        "public_key": public_key,
        "private_key": private_key,
        "site_url": site_url,
        "board_id": board_id,
        "company_scope": company_scope,
        "ticket_id": ticket_id,
        "contact_id": contact_id,
        "project_id": project_id,
        "configuration_id": configuration_id,
        "company_id_present": bool(company_id),
        "public_key_present": bool(public_key),
        "private_key_present": bool(private_key),
        "site_url_present": bool(site_url),
        "credentials_present": bool(company_id and public_key and private_key and site_url),
    }


def config_snapshot(ctx_obj: dict[str, Any]) -> dict[str, Any]:
    runtime = resolve_runtime_values(ctx_obj)
    return {
        "auth": {
            "company_id_env": runtime["company_id_env"],
            "company_id_present": runtime["company_id_present"],
            "company_id_preview": _mask(runtime["company_id"]),
            "public_key_env": runtime["public_key_env"],
            "public_key_present": runtime["public_key_present"],
            "public_key_preview": _mask(runtime["public_key"]),
            "private_key_env": runtime["private_key_env"],
            "private_key_present": runtime["private_key_present"],
            "private_key_preview": _mask(runtime["private_key"]),
            "site_url_env": runtime["site_url_env"],
            "site_url_present": runtime["site_url_present"],
            "site_url_preview": _mask(runtime["site_url"]),
        },
        "scope": {
            "board_id": runtime["board_id"] or None,
            "company_id": runtime["company_scope"] or None,
            "ticket_id": runtime["ticket_id"] or None,
            "contact_id": runtime["contact_id"] or None,
            "project_id": runtime["project_id"] or None,
            "configuration_id": runtime["configuration_id"] or None,
        },
    }
