from __future__ import annotations

import json
import os
from typing import Any

from .constants import API_KEY_ENV, BASE_URL_ENV, DEFAULT_BASE_URL, DEFAULT_MODEL, MODEL_ENV, SEARCH_DOMAIN_ENV


def _redact(value: str | None) -> str | None:
    if not value:
        return None
    trimmed = value.strip()
    if len(trimmed) <= 6:
        return "***"
    return f"{trimmed[:4]}***"


def _parse_search_domains(value: str | None) -> list[str]:
    if not value:
        return []
    raw = value.strip()
    if not raw:
        return []
    if raw.startswith("["):
        try:
            parsed = json.loads(raw)
        except json.JSONDecodeError:
            parsed = None
        if isinstance(parsed, list):
            return [str(item).strip() for item in parsed if str(item).strip()]
    return [part.strip() for part in raw.split(",") if part.strip()]


def resolve_runtime_values(ctx_obj: dict[str, Any]) -> dict[str, Any]:
    api_key = os.getenv(API_KEY_ENV)
    model = os.getenv(MODEL_ENV, DEFAULT_MODEL).strip() or DEFAULT_MODEL
    base_url = os.getenv(BASE_URL_ENV, DEFAULT_BASE_URL).strip() or DEFAULT_BASE_URL
    search_domain = os.getenv(SEARCH_DOMAIN_ENV)
    search_domains = _parse_search_domains(search_domain)
    return {
        "api_key_env": API_KEY_ENV,
        "api_key_present": bool(api_key and api_key.strip()),
        "api_key": api_key.strip() if api_key else "",
        "base_url_env": BASE_URL_ENV,
        "base_url": base_url,
        "model_env": MODEL_ENV,
        "model": model,
        "model_present": bool(model),
        "search_domain_env": SEARCH_DOMAIN_ENV,
        "search_domain_present": bool(search_domains),
        "search_domain_filter": search_domains,
        "search_domain_filter_present": bool(search_domains),
    }


def config_snapshot(ctx_obj: dict[str, Any], *, probe: dict[str, Any] | None = None) -> dict[str, Any]:
    runtime = resolve_runtime_values(ctx_obj)
    return {
        "status": "ready" if probe and probe.get("ok") else "needs_setup",
        "summary": "Perplexity connector configuration.",
        "auth": {
            "api_key_env": runtime["api_key_env"],
            "api_key_present": runtime["api_key_present"],
        },
        "scope": {
            "base_url": runtime["base_url"],
            "model": runtime["model"],
            "search_domain_filter": runtime["search_domain_filter"] or None,
        },
        "runtime": {
            "implementation_mode": "live_read_only",
            "default_model": runtime["model"],
            "default_search_domain_filter": runtime["search_domain_filter"],
            "base_url": runtime["base_url"],
        },
        "checks": [
            {
                "name": "required_env",
                "ok": runtime["api_key_present"],
                "details": {"missing_keys": [] if runtime["api_key_present"] else [runtime["api_key_env"]]},
            }
        ],
        "probe": probe,
        "redacted": {
            "api_key": _redact(runtime["api_key"]),
        },
        "next_steps": [
            f"Set {runtime['api_key_env']} in API Keys.",
            f"Optionally set {runtime['model_env']} and {runtime['search_domain_env']} to stabilize worker defaults.",
        ],
    }
