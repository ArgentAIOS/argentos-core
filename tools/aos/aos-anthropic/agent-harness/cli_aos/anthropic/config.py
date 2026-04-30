from __future__ import annotations

import os
from .service_keys import service_key_env
from typing import Any

from .constants import (
    ANTHROPIC_API_KEY_ENV,
    ANTHROPIC_BASE_URL_ENV,
    ANTHROPIC_MAX_TOKENS_ENV,
    ANTHROPIC_MESSAGES_JSON_ENV,
    ANTHROPIC_MODEL_ENV,
    ANTHROPIC_SYSTEM_PROMPT_ENV,
    ANTHROPIC_TEMPERATURE_ENV,
    ANTHROPIC_THINKING_BUDGET_ENV,
    ANTHROPIC_VERSION_ENV,
    BACKEND_NAME,
    DEFAULT_BASE_URL,
    DEFAULT_VERSION,
)


def _mask(value: str | None) -> str | None:
    if not value:
        return None
    if len(value) <= 8:
        return "*" * len(value)
    return f"{value[:4]}***{value[-4:]}"


def _int_or_none(value: str | None) -> int | None:
    try:
        return int(value) if value not in (None, "") else None
    except ValueError:
        return None


def _float_or_none(value: str | None) -> float | None:
    try:
        return float(value) if value not in (None, "") else None
    except ValueError:
        return None


def resolve_runtime_values(ctx_obj: dict[str, Any]) -> dict[str, Any]:
    api_key_env = ctx_obj.get("api_key_env") or ANTHROPIC_API_KEY_ENV
    base_url_env = ctx_obj.get("base_url_env") or ANTHROPIC_BASE_URL_ENV
    version_env = ctx_obj.get("version_env") or ANTHROPIC_VERSION_ENV
    model_env = ctx_obj.get("model_env") or ANTHROPIC_MODEL_ENV
    system_prompt_env = ctx_obj.get("system_prompt_env") or ANTHROPIC_SYSTEM_PROMPT_ENV
    messages_json_env = ctx_obj.get("messages_json_env") or ANTHROPIC_MESSAGES_JSON_ENV
    max_tokens_env = ctx_obj.get("max_tokens_env") or ANTHROPIC_MAX_TOKENS_ENV
    temperature_env = ctx_obj.get("temperature_env") or ANTHROPIC_TEMPERATURE_ENV
    thinking_budget_env = ctx_obj.get("thinking_budget_env") or ANTHROPIC_THINKING_BUDGET_ENV

    api_key = (service_key_env(api_key_env) or "").strip()
    base_url = (service_key_env(base_url_env) or DEFAULT_BASE_URL).strip().rstrip("/")
    version = (service_key_env(version_env) or DEFAULT_VERSION).strip()
    model = (service_key_env(model_env) or "").strip()
    system_prompt = (service_key_env(system_prompt_env) or "").strip()
    messages_json = (service_key_env(messages_json_env) or "").strip()
    max_tokens = _int_or_none(service_key_env(max_tokens_env))
    temperature = _float_or_none(service_key_env(temperature_env))
    thinking_budget = _int_or_none(service_key_env(thinking_budget_env))

    return {
        "backend": BACKEND_NAME,
        "api_key_env": api_key_env,
        "base_url_env": base_url_env,
        "version_env": version_env,
        "model_env": model_env,
        "system_prompt_env": system_prompt_env,
        "messages_json_env": messages_json_env,
        "max_tokens_env": max_tokens_env,
        "temperature_env": temperature_env,
        "thinking_budget_env": thinking_budget_env,
        "api_key": api_key,
        "base_url": base_url,
        "version": version,
        "model": model,
        "system_prompt": system_prompt,
        "messages_json": messages_json,
        "max_tokens": max_tokens,
        "temperature": temperature,
        "thinking_budget": thinking_budget,
        "api_key_present": bool(api_key),
        "runtime_ready": bool(api_key),
    }


def config_snapshot(ctx_obj: dict[str, Any], *, probe: dict[str, Any] | None = None) -> dict[str, Any]:
    runtime = resolve_runtime_values(ctx_obj)
    return {
        "backend": BACKEND_NAME,
        "auth": {
            "api_key_env": runtime["api_key_env"],
            "api_key_present": runtime["api_key_present"],
            "api_key_masked": _mask(runtime["api_key"]),
        },
        "scope": {
            "base_url": runtime["base_url"],
            "version": runtime["version"],
            "default_model": runtime["model"] or None,
            "system_prompt": runtime["system_prompt"] or None,
            "messages_json_present": bool(runtime["messages_json"]),
        },
        "runtime": {
            "implementation_mode": "live_read_write",
            "runtime_ready": bool(probe["ok"]) if probe else runtime["runtime_ready"],
            "max_tokens": runtime["max_tokens"],
            "temperature": runtime["temperature"],
            "thinking_budget": runtime["thinking_budget"],
        },
        "probe": probe,
    }
