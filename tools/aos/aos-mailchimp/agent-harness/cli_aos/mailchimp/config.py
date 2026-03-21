from __future__ import annotations

import os
from typing import Any

from .constants import (
    DEFAULT_API_KEY_ENV,
    DEFAULT_SERVER_PREFIX_ENV,
    LEGACY_API_KEY_ENV,
    LEGACY_SERVER_PREFIX_ENV,
)


def _first_present_env(*names: str) -> tuple[str, str]:
    for name in names:
        value = os.getenv(name, "")
        if value:
            return name, value
    return "", ""


def _normalize_prefix(value: str | None) -> str:
    if not value:
        return ""
    return value.strip()


def runtime_config(ctx_obj: dict[str, Any] | None = None) -> dict[str, Any]:
    api_key_source, api_key = _first_present_env(DEFAULT_API_KEY_ENV, LEGACY_API_KEY_ENV)
    server_prefix_source, server_prefix = _first_present_env(DEFAULT_SERVER_PREFIX_ENV, LEGACY_SERVER_PREFIX_ENV)

    if ctx_obj:
        explicit_api_key = ctx_obj.get("api_key")
        explicit_server_prefix = ctx_obj.get("server_prefix")
        if explicit_api_key:
            api_key = explicit_api_key
            api_key_source = "cli"
        if explicit_server_prefix:
            server_prefix = explicit_server_prefix
            server_prefix_source = "cli"

    normalized_prefix = _normalize_prefix(server_prefix)
    inferred_prefix = ""
    if not normalized_prefix and api_key and "-" in api_key:
        inferred_prefix = api_key.rsplit("-", 1)[-1].strip()

    resolved_prefix = normalized_prefix or inferred_prefix
    base_url = f"https://{resolved_prefix}.api.mailchimp.com/3.0" if resolved_prefix else ""

    return {
        "api_key": api_key,
        "api_key_present": bool(api_key),
        "api_key_source": api_key_source,
        "server_prefix": normalized_prefix,
        "server_prefix_present": bool(normalized_prefix),
        "server_prefix_source": server_prefix_source,
        "inferred_server_prefix": inferred_prefix or None,
        "resolved_server_prefix": resolved_prefix or None,
        "base_url": base_url,
        "base_url_present": bool(base_url),
        "auth_ready": bool(api_key and base_url),
        "request_timeout_s": 20.0,
    }


def redacted_config_snapshot(ctx_obj: dict[str, Any] | None = None) -> dict[str, Any]:
    config = runtime_config(ctx_obj)
    return {
        "api_key_present": config["api_key_present"],
        "api_key_source": config["api_key_source"],
        "server_prefix": config["server_prefix"] or None,
        "server_prefix_present": config["server_prefix_present"],
        "server_prefix_source": config["server_prefix_source"],
        "inferred_server_prefix": config["inferred_server_prefix"],
        "resolved_server_prefix": config["resolved_server_prefix"],
        "base_url": config["base_url"] or None,
        "base_url_present": config["base_url_present"],
        "auth_ready": config["auth_ready"],
        "request_timeout_s": config["request_timeout_s"],
    }

