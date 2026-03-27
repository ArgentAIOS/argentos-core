from __future__ import annotations

import os
from typing import Any

from .constants import (
    CANVA_API_KEY_ENV,
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
    CANVA_TEMPLATE_ID_ENV,
    CANVA_TITLE_ENV,
)


def _mask(value: str | None) -> str | None:
    if not value:
        return None
    if len(value) <= 4:
        return "*" * len(value)
    return f"{value[:2]}***{value[-2:]}"


def resolve_runtime_values(_ctx_obj: dict[str, Any]) -> dict[str, Any]:
    api_key = os.getenv(CANVA_API_KEY_ENV, "").strip()
    folder_id = os.getenv(CANVA_FOLDER_ID_ENV, "").strip()
    design_id = os.getenv(CANVA_DESIGN_ID_ENV, "").strip()
    template_id = os.getenv(CANVA_TEMPLATE_ID_ENV, "").strip()
    brand_template_id = os.getenv(CANVA_BRAND_TEMPLATE_ID_ENV, "").strip()
    export_format = os.getenv(CANVA_EXPORT_FORMAT_ENV, "").strip()
    export_job_id = os.getenv(CANVA_EXPORT_JOB_ID_ENV, "").strip()
    asset_file = os.getenv(CANVA_ASSET_FILE_ENV, "").strip()
    asset_url = os.getenv(CANVA_ASSET_URL_ENV, "").strip()
    asset_name = os.getenv(CANVA_ASSET_NAME_ENV, "").strip()
    asset_id = os.getenv(CANVA_ASSET_ID_ENV, "").strip()
    autofill_data = os.getenv(CANVA_AUTOFILL_DATA_ENV, "").strip()
    folder_name = os.getenv(CANVA_FOLDER_NAME_ENV, "").strip()
    title = os.getenv(CANVA_TITLE_ENV, "").strip()
    return {
        "api_key": api_key,
        "api_key_present": bool(api_key),
        "api_key_env": CANVA_API_KEY_ENV,
        "folder_id": folder_id or None,
        "folder_id_env": CANVA_FOLDER_ID_ENV,
        "design_id": design_id or None,
        "design_id_env": CANVA_DESIGN_ID_ENV,
        "template_id": template_id or None,
        "template_id_env": CANVA_TEMPLATE_ID_ENV,
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
            "api_key_env": runtime["api_key_env"],
            "api_key_present": runtime["api_key_present"],
            "api_key_preview": _mask(runtime["api_key"]),
        },
        "defaults": {
            "folder_id": runtime["folder_id"],
            "design_id": runtime["design_id"],
            "template_id": runtime["template_id"],
            "brand_template_id": runtime["brand_template_id"],
            "export_format": runtime["export_format"],
            "export_job_id": runtime["export_job_id"],
            "asset_file": runtime["asset_file"],
            "asset_url": runtime["asset_url"],
            "asset_name": runtime["asset_name"],
            "folder_name": runtime["folder_name"],
            "title": runtime["title"],
        },
    }
