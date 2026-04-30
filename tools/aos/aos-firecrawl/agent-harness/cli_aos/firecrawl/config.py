from __future__ import annotations

import os
from .service_keys import service_key_env
from typing import Any

from .constants import (
    DEFAULT_FIRECRAWL_API_KEY_ENV,
    DEFAULT_FIRECRAWL_BASE_URL,
    DEFAULT_PROXY_BASE_URL,
    DEFAULT_PROXY_BASE_URL_ENV,
    LEGACY_FIRECRAWL_API_KEY_ENV,
    LEGACY_PROXY_BASE_URL_ENV,
)


def _first_present_env(*names: str) -> tuple[str, str]:
    for name in names:
        value = service_key_env(name, "")
        if value:
            return name, value
    return "", ""


def runtime_config(ctx_obj: dict[str, Any] | None = None) -> dict[str, Any]:
    proxy_source, proxy_base_url = _first_present_env(DEFAULT_PROXY_BASE_URL_ENV, LEGACY_PROXY_BASE_URL_ENV)
    api_key_source, api_key = _first_present_env(DEFAULT_FIRECRAWL_API_KEY_ENV, LEGACY_FIRECRAWL_API_KEY_ENV)

    if ctx_obj:
        explicit_proxy = (ctx_obj.get("proxy_base_url") or "").strip()
        explicit_api_key = (ctx_obj.get("api_key") or "").strip()
        if explicit_proxy:
            proxy_base_url = explicit_proxy
            proxy_source = "cli"
        if explicit_api_key:
            api_key = explicit_api_key
            api_key_source = "cli"

    normalized_proxy = (proxy_base_url or DEFAULT_PROXY_BASE_URL).rstrip("/")
    direct_base_url = (service_key_env("FIRECRAWL_BASE_URL", DEFAULT_FIRECRAWL_BASE_URL) or DEFAULT_FIRECRAWL_BASE_URL).rstrip("/")
    return {
        "proxy_base_url": normalized_proxy,
        "proxy_base_url_source": proxy_source or "default",
        "proxy_enabled": bool(normalized_proxy),
        "direct_base_url": direct_base_url,
        "api_key_present": bool(api_key),
        "api_key_source": api_key_source,
        "auth_ready": bool(normalized_proxy or api_key),
        "prefer_proxy": True,
        "request_timeout_s": 25.0,
        "api_key": api_key,
    }


def redacted_config_snapshot(ctx_obj: dict[str, Any] | None = None) -> dict[str, Any]:
    config = runtime_config(ctx_obj)
    return {
        "proxy_base_url": config["proxy_base_url"],
        "proxy_base_url_source": config["proxy_base_url_source"],
        "proxy_enabled": config["proxy_enabled"],
        "direct_base_url": config["direct_base_url"],
        "api_key_present": config["api_key_present"],
        "api_key_source": config["api_key_source"],
        "auth_ready": config["auth_ready"],
        "prefer_proxy": config["prefer_proxy"],
        "request_timeout_s": config["request_timeout_s"],
    }
