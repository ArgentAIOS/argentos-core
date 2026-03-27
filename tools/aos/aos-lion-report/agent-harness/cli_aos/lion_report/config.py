from __future__ import annotations

import os
from typing import Any

from .constants import (
    API_KEY_ENV,
    BASE_URL_ENV,
    DATA_SOURCE_ENV,
    DATE_RANGE_ENV,
    RECIPIENT_EMAIL_ENV,
    REPORT_ID_ENV,
    REPORT_TYPE_ENV,
    TEMPLATE_ID_ENV,
)


def _mask(value: str | None) -> str | None:
    if not value:
        return None
    if len(value) <= 4:
        return "*" * len(value)
    return f"{value[:2]}***{value[-2:]}"


def resolve_runtime_values(_ctx_obj: dict[str, Any]) -> dict[str, Any]:
    api_key = os.getenv(API_KEY_ENV, "").strip()
    base_url = os.getenv(BASE_URL_ENV, "https://api.lion.report").strip()
    report_id = os.getenv(REPORT_ID_ENV, "").strip()
    report_type = os.getenv(REPORT_TYPE_ENV, "").strip()
    date_range = os.getenv(DATE_RANGE_ENV, "").strip()
    data_source = os.getenv(DATA_SOURCE_ENV, "").strip()
    template_id = os.getenv(TEMPLATE_ID_ENV, "").strip()
    recipient_email = os.getenv(RECIPIENT_EMAIL_ENV, "").strip()
    return {
        "api_key": api_key,
        "api_key_present": bool(api_key),
        "api_key_env": API_KEY_ENV,
        "base_url": base_url.rstrip("/"),
        "base_url_env": BASE_URL_ENV,
        "report_id": report_id or None,
        "report_id_env": REPORT_ID_ENV,
        "report_type": report_type or None,
        "report_type_env": REPORT_TYPE_ENV,
        "date_range": date_range or None,
        "date_range_env": DATE_RANGE_ENV,
        "data_source": data_source or None,
        "data_source_env": DATA_SOURCE_ENV,
        "template_id": template_id or None,
        "template_id_env": TEMPLATE_ID_ENV,
        "recipient_email": recipient_email or None,
        "recipient_email_env": RECIPIENT_EMAIL_ENV,
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
            "base_url": runtime["base_url"],
            "report_id": runtime["report_id"],
            "report_type": runtime["report_type"],
            "date_range": runtime["date_range"],
            "data_source": runtime["data_source"],
            "template_id": runtime["template_id"],
            "recipient_email": runtime["recipient_email"],
        },
    }
