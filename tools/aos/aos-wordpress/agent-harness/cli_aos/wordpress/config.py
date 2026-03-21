from __future__ import annotations

import os
from typing import Any

from .constants import (
    DEFAULT_APPLICATION_PASSWORD_ENV,
    DEFAULT_BASE_URL_ENV,
    DEFAULT_USERNAME_ENV,
    LEGACY_APPLICATION_PASSWORD_ENV,
    LEGACY_BASE_URL_ENV,
    LEGACY_USERNAME_ENV,
)


def _first_present_env(*names: str) -> tuple[str, str]:
    for name in names:
        value = os.getenv(name, "")
        if value:
            return name, value
    return "", ""


def runtime_config() -> dict[str, Any]:
    base_url_source, base_url = _first_present_env(DEFAULT_BASE_URL_ENV, LEGACY_BASE_URL_ENV)
    username_source, username = _first_present_env(DEFAULT_USERNAME_ENV, LEGACY_USERNAME_ENV)
    password_source, application_password = _first_present_env(
        DEFAULT_APPLICATION_PASSWORD_ENV,
        LEGACY_APPLICATION_PASSWORD_ENV,
    )
    normalized_base_url = base_url.rstrip("/")
    api_root_url = f"{normalized_base_url}/wp-json" if normalized_base_url else ""

    return {
        "base_url": normalized_base_url,
        "base_url_present": bool(normalized_base_url),
        "base_url_source": base_url_source,
        "username_present": bool(username),
        "username_source": username_source,
        "application_password_present": bool(application_password),
        "application_password_source": password_source,
        "auth_ready": bool(normalized_base_url and username and application_password),
        "api_root_url": api_root_url,
        "request_timeout_s": 10.0,
    }


def redacted_config_snapshot() -> dict[str, Any]:
    config = runtime_config()
    return {
        "base_url": config["base_url"],
        "base_url_present": config["base_url_present"],
        "base_url_source": config["base_url_source"],
        "username_present": config["username_present"],
        "username_source": config["username_source"],
        "application_password_present": config["application_password_present"],
        "application_password_source": config["application_password_source"],
        "auth_ready": config["auth_ready"],
        "api_root_url": config["api_root_url"],
        "request_timeout_s": config["request_timeout_s"],
    }
