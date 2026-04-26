from __future__ import annotations

import os
from typing import Any

from .constants import (
    CANVA_ACCESS_TOKEN_ENV,
    CANVA_ASSET_FILE_ENV,
    CANVA_ASSET_ID_ENV,
    CANVA_ASSET_NAME_ENV,
    CANVA_ASSET_URL_ENV,
    CANVA_AUTOFILL_DATA_ENV,
    CANVA_BRAND_TEMPLATE_ID_ENV,
    CANVA_DESIGN_ID_ENV,
    CANVA_EXPORT_FORMAT_ENV,
    CANVA_EXPORT_JOB_ID_ENV,
    CANVA_FOLDER_ID_ENV,
    CANVA_FOLDER_NAME_ENV,
    CANVA_TITLE_ENV,
    LEGACY_AOS_CANVA_ACCESS_TOKEN_ENV,
    LEGACY_AOS_CANVA_API_KEY_ENV,
    LEGACY_CANVA_API_KEY_ENV,
)
from .service_keys import resolve_service_key, service_key_env


def _mask(value: str | None) -> str | None:
    if not value:
        return None
    if len(value) <= 4:
        return "*" * len(value)
    return f"{value[:2]}***{value[-2:]}"


def _env(*names: str) -> str:
    for name in names:
        value = (service_key_env(name) or "").strip()
        if value:
            return value
    return ""


def _source(*names: str) -> str | None:
    for name in names:
        if (resolve_service_key(name) or "").strip():
            return "service-keys"
    for name in names:
        if os.getenv(name, "").strip():
            return "process.env"
    return None


def resolve_runtime_values(_ctx_obj: dict[str, Any]) -> dict[str, Any]:
    access_token = _env(
        CANVA_ACCESS_TOKEN_ENV,
        LEGACY_CANVA_API_KEY_ENV,
        LEGACY_AOS_CANVA_ACCESS_TOKEN_ENV,
        LEGACY_AOS_CANVA_API_KEY_ENV,
    )
    folder_id = _env(CANVA_FOLDER_ID_ENV)
    design_id = _env(CANVA_DESIGN_ID_ENV)
    brand_template_id = _env(CANVA_BRAND_TEMPLATE_ID_ENV)
    export_format = _env(CANVA_EXPORT_FORMAT_ENV)
    export_job_id = _env(CANVA_EXPORT_JOB_ID_ENV)
    asset_file = _env(CANVA_ASSET_FILE_ENV)
    asset_url = _env(CANVA_ASSET_URL_ENV)
    asset_name = _env(CANVA_ASSET_NAME_ENV)
    asset_id = _env(CANVA_ASSET_ID_ENV)
    autofill_data = _env(CANVA_AUTOFILL_DATA_ENV)
    folder_name = _env(CANVA_FOLDER_NAME_ENV)
    title = _env(CANVA_TITLE_ENV)
    return {
        "access_token": access_token,
        "access_token_present": bool(access_token),
        "access_token_env": CANVA_ACCESS_TOKEN_ENV,
        "access_token_source": _source(
            CANVA_ACCESS_TOKEN_ENV,
            LEGACY_CANVA_API_KEY_ENV,
            LEGACY_AOS_CANVA_ACCESS_TOKEN_ENV,
            LEGACY_AOS_CANVA_API_KEY_ENV,
        ),
        "legacy_access_token_envs": [
            LEGACY_CANVA_API_KEY_ENV,
            LEGACY_AOS_CANVA_ACCESS_TOKEN_ENV,
            LEGACY_AOS_CANVA_API_KEY_ENV,
        ],
        "folder_id": folder_id or None,
        "folder_id_env": CANVA_FOLDER_ID_ENV,
        "design_id": design_id or None,
        "design_id_env": CANVA_DESIGN_ID_ENV,
        "brand_template_id": brand_template_id or None,
        "brand_template_id_env": CANVA_BRAND_TEMPLATE_ID_ENV,
        "export_format": export_format or None,
        "export_format_env": CANVA_EXPORT_FORMAT_ENV,
        "export_job_id": export_job_id or None,
        "export_job_id_env": CANVA_EXPORT_JOB_ID_ENV,
        "asset_file": asset_file or None,
        "asset_file_env": CANVA_ASSET_FILE_ENV,
        "asset_url": asset_url or None,
        "asset_url_env": CANVA_ASSET_URL_ENV,
        "asset_name": asset_name or None,
        "asset_name_env": CANVA_ASSET_NAME_ENV,
        "asset_id": asset_id or None,
        "asset_id_env": CANVA_ASSET_ID_ENV,
        "autofill_data": autofill_data or None,
        "autofill_data_env": CANVA_AUTOFILL_DATA_ENV,
        "folder_name": folder_name or None,
        "folder_name_env": CANVA_FOLDER_NAME_ENV,
        "title": title or None,
        "title_env": CANVA_TITLE_ENV,
    }


def config_snapshot(ctx_obj: dict[str, Any]) -> dict[str, Any]:
    runtime = resolve_runtime_values(ctx_obj)
    return {
        "auth": {
            "access_token_env": runtime["access_token_env"],
            "legacy_access_token_envs": runtime["legacy_access_token_envs"],
            "access_token_present": runtime["access_token_present"],
            "access_token_source": runtime["access_token_source"],
            "access_token_preview": _mask(runtime["access_token"]),
        },
        "defaults": {
            "folder_id": runtime["folder_id"],
            "design_id": runtime["design_id"],
            "brand_template_id": runtime["brand_template_id"],
            "export_format": runtime["export_format"],
            "export_job_id": runtime["export_job_id"],
            "asset_file": runtime["asset_file"],
            "asset_url": runtime["asset_url"],
            "asset_name": runtime["asset_name"],
            "asset_id": runtime["asset_id"],
            "autofill_data_present": bool(runtime["autofill_data"]),
            "folder_name": runtime["folder_name"],
            "title": runtime["title"],
        },
        "runtime": {
            "implementation_mode": "live_read_with_live_writes" if runtime["access_token_present"] else "configuration_only",
            "operator_service_keys_first": True,
        },
    }
