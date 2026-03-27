from __future__ import annotations

import os
from typing import Any

from .constants import (
    BACKEND_NAME,
    DEFAULT_BASE_URL,
    OPENAI_API_KEY_ENV,
    OPENAI_AUDIO_FILE_ENV,
    OPENAI_BASE_URL_ENV,
    OPENAI_IMAGE_FILE_ENV,
    OPENAI_IMAGE_PROMPT_ENV,
    OPENAI_IMAGE_SIZE_ENV,
    OPENAI_MAX_TOKENS_ENV,
    OPENAI_MESSAGES_JSON_ENV,
    OPENAI_MODEL_ENV,
    OPENAI_ORG_ID_ENV,
    OPENAI_PROJECT_ID_ENV,
    OPENAI_PROMPT_ENV,
    OPENAI_TEMPERATURE_ENV,
    OPENAI_VOICE_ENV,
)


def _mask(value: str | None) -> str | None:
    if not value:
        return None
    if len(value) <= 8:
        return "*" * len(value)
    return f"{value[:4]}***{value[-4:]}"


def _float_or_none(value: str | None) -> float | None:
    try:
        return float(value) if value not in (None, "") else None
    except ValueError:
        return None


def _int_or_none(value: str | None) -> int | None:
    try:
        return int(value) if value not in (None, "") else None
    except ValueError:
        return None


def resolve_runtime_values(ctx_obj: dict[str, Any]) -> dict[str, Any]:
    api_key_env = ctx_obj.get("api_key_env") or OPENAI_API_KEY_ENV
    org_id_env = ctx_obj.get("org_id_env") or OPENAI_ORG_ID_ENV
    project_id_env = ctx_obj.get("project_id_env") or OPENAI_PROJECT_ID_ENV
    base_url_env = ctx_obj.get("base_url_env") or OPENAI_BASE_URL_ENV
    model_env = ctx_obj.get("model_env") or OPENAI_MODEL_ENV
    prompt_env = ctx_obj.get("prompt_env") or OPENAI_PROMPT_ENV
    messages_json_env = ctx_obj.get("messages_json_env") or OPENAI_MESSAGES_JSON_ENV
    max_tokens_env = ctx_obj.get("max_tokens_env") or OPENAI_MAX_TOKENS_ENV
    temperature_env = ctx_obj.get("temperature_env") or OPENAI_TEMPERATURE_ENV
    image_prompt_env = ctx_obj.get("image_prompt_env") or OPENAI_IMAGE_PROMPT_ENV
    image_size_env = ctx_obj.get("image_size_env") or OPENAI_IMAGE_SIZE_ENV
    image_file_env = ctx_obj.get("image_file_env") or OPENAI_IMAGE_FILE_ENV
    audio_file_env = ctx_obj.get("audio_file_env") or OPENAI_AUDIO_FILE_ENV
    voice_env = ctx_obj.get("voice_env") or OPENAI_VOICE_ENV

    api_key = (os.getenv(api_key_env) or "").strip()
    org_id = (os.getenv(org_id_env) or "").strip()
    project_id = (os.getenv(project_id_env) or "").strip()
    base_url = (os.getenv(base_url_env) or DEFAULT_BASE_URL).strip().rstrip("/")
    model = (os.getenv(model_env) or "").strip()
    prompt = (os.getenv(prompt_env) or "").strip()
    messages_json = (os.getenv(messages_json_env) or "").strip()
    image_prompt = (os.getenv(image_prompt_env) or "").strip()
    image_size = (os.getenv(image_size_env) or "").strip()
    image_file = (os.getenv(image_file_env) or "").strip()
    audio_file = (os.getenv(audio_file_env) or "").strip()
    voice = (os.getenv(voice_env) or "").strip()
    max_tokens = _int_or_none(os.getenv(max_tokens_env))
    temperature = _float_or_none(os.getenv(temperature_env))

    return {
        "backend": BACKEND_NAME,
        "api_key_env": api_key_env,
        "org_id_env": org_id_env,
        "project_id_env": project_id_env,
        "base_url_env": base_url_env,
        "model_env": model_env,
        "prompt_env": prompt_env,
        "messages_json_env": messages_json_env,
        "max_tokens_env": max_tokens_env,
        "temperature_env": temperature_env,
        "image_prompt_env": image_prompt_env,
        "image_size_env": image_size_env,
        "image_file_env": image_file_env,
        "audio_file_env": audio_file_env,
        "voice_env": voice_env,
        "api_key": api_key,
        "org_id": org_id,
        "project_id": project_id,
        "base_url": base_url,
        "model": model,
        "prompt": prompt,
        "messages_json": messages_json,
        "max_tokens": max_tokens,
        "temperature": temperature,
        "image_prompt": image_prompt,
        "image_size": image_size,
        "image_file": image_file,
        "audio_file": audio_file,
        "voice": voice,
        "api_key_present": bool(api_key),
        "org_id_present": bool(org_id),
        "project_id_present": bool(project_id),
        "image_file_present": bool(image_file),
        "audio_file_present": bool(audio_file),
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
            "org_id_env": runtime["org_id_env"],
            "org_id_present": runtime["org_id_present"],
            "org_id_masked": _mask(runtime["org_id"]),
            "project_id_env": runtime["project_id_env"],
            "project_id_present": runtime["project_id_present"],
            "project_id_masked": _mask(runtime["project_id"]),
        },
        "scope": {
            "base_url": runtime["base_url"],
            "default_model": runtime["model"] or None,
            "default_prompt": runtime["prompt"] or None,
            "default_image_prompt": runtime["image_prompt"] or None,
            "default_image_size": runtime["image_size"] or None,
            "default_voice": runtime["voice"] or None,
            "image_file": runtime["image_file"] or None,
            "audio_file": runtime["audio_file"] or None,
        },
        "runtime": {
            "implementation_mode": "live_read_write",
            "runtime_ready": bool(probe["ok"]) if probe else runtime["runtime_ready"],
            "messages_json_present": bool(runtime["messages_json"]),
            "max_tokens": runtime["max_tokens"],
            "temperature": runtime["temperature"],
        },
        "probe": probe,
    }
