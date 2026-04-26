from __future__ import annotations

from typing import Any

from .constants import (
    DEFAULT_APPLICATION_PASSWORD_ENV,
    DEFAULT_BASE_URL_ENV,
    DEFAULT_USERNAME_ENV,
    LEGACY_APPLICATION_PASSWORD_ENV,
    LEGACY_BASE_URL_ENV,
    LEGACY_USERNAME_ENV,
)
from .service_keys import service_key_details


def _first_present_env(ctx_obj: dict[str, Any] | None, *names: str) -> dict[str, Any]:
    for name in names:
        detail = service_key_details(name, ctx_obj)
        if detail["value"] or detail["present"]:
            return detail
    return {"value": "", "present": False, "usable": False, "source": "missing", "variable": ""}


def runtime_config(ctx_obj: dict[str, Any] | None = None) -> dict[str, Any]:
    base_url_detail = _first_present_env(ctx_obj, DEFAULT_BASE_URL_ENV, LEGACY_BASE_URL_ENV)
    username_detail = _first_present_env(ctx_obj, DEFAULT_USERNAME_ENV, LEGACY_USERNAME_ENV)
    password_detail = _first_present_env(
        ctx_obj,
        DEFAULT_APPLICATION_PASSWORD_ENV,
        LEGACY_APPLICATION_PASSWORD_ENV,
    )
    base_url = base_url_detail["value"]
    username = username_detail["value"]
    application_password = password_detail["value"]
    normalized_base_url = base_url.rstrip("/")
    if normalized_base_url.endswith("/wp-json"):
        api_root_url = normalized_base_url
        normalized_base_url = normalized_base_url[: -len("/wp-json")]
    else:
        api_root_url = f"{normalized_base_url}/wp-json" if normalized_base_url else ""

    return {
        "base_url": normalized_base_url,
        "base_url_present": bool(normalized_base_url),
        "base_url_source": base_url_detail["source"],
        "base_url_variable": base_url_detail["variable"],
        "base_url_usable": base_url_detail["usable"],
        "username": username,
        "username_present": bool(username),
        "username_source": username_detail["source"],
        "username_variable": username_detail["variable"],
        "username_usable": username_detail["usable"],
        "application_password": application_password,
        "application_password_present": bool(application_password),
        "application_password_source": password_detail["source"],
        "application_password_variable": password_detail["variable"],
        "application_password_usable": password_detail["usable"],
        "auth_ready": bool(normalized_base_url and username and application_password),
        "api_root_url": api_root_url,
        "request_timeout_s": 10.0,
        "resolution_order": ["operator-context", "service-keys", "process.env"],
    }


def redacted_config_snapshot(ctx_obj: dict[str, Any] | None = None) -> dict[str, Any]:
    config = runtime_config(ctx_obj)
    return {
        "base_url": config["base_url"],
        "base_url_present": config["base_url_present"],
        "base_url_source": config["base_url_source"],
        "base_url_variable": config["base_url_variable"],
        "base_url_usable": config["base_url_usable"],
        "username_present": config["username_present"],
        "username_source": config["username_source"],
        "username_variable": config["username_variable"],
        "username_usable": config["username_usable"],
        "application_password_present": config["application_password_present"],
        "application_password_source": config["application_password_source"],
        "application_password_variable": config["application_password_variable"],
        "application_password_usable": config["application_password_usable"],
        "auth_ready": config["auth_ready"],
        "api_root_url": config["api_root_url"],
        "request_timeout_s": config["request_timeout_s"],
        "resolution_order": config["resolution_order"],
    }
