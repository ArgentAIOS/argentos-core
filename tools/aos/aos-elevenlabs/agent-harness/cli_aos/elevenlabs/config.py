from __future__ import annotations

import os
from typing import Any

from .constants import (
    BACKEND_NAME,
    DEFAULT_BASE_URL,
    ELEVENLABS_API_KEY_ENV,
    ELEVENLABS_BASE_URL_ENV,
    ELEVENLABS_HISTORY_ITEM_ID_ENV,
    ELEVENLABS_MODEL_ID_ENV,
    ELEVENLABS_VOICE_ID_ENV,
)


def _mask(value: str | None) -> str | None:
    if not value:
        return None
    if len(value) <= 8:
        return "*" * len(value)
    return f"{value[:4]}***{value[-4:]}"


def resolve_runtime_values(ctx_obj: dict[str, Any]) -> dict[str, Any]:
    api_key_env = ctx_obj.get("api_key_env") or ELEVENLABS_API_KEY_ENV
    base_url_env = ctx_obj.get("base_url_env") or ELEVENLABS_BASE_URL_ENV
    voice_id_env = ctx_obj.get("voice_id_env") or ELEVENLABS_VOICE_ID_ENV
    model_id_env = ctx_obj.get("model_id_env") or ELEVENLABS_MODEL_ID_ENV
    history_item_id_env = ctx_obj.get("history_item_id_env") or ELEVENLABS_HISTORY_ITEM_ID_ENV

    api_key = (os.getenv(api_key_env) or "").strip()
    configured_base_url = (os.getenv(base_url_env) or "").strip()
    base_url = configured_base_url or DEFAULT_BASE_URL
    voice_id = (os.getenv(voice_id_env) or "").strip()
    model_id = (os.getenv(model_id_env) or "").strip()
    history_item_id = (os.getenv(history_item_id_env) or "").strip()

    return {
        "backend": BACKEND_NAME,
        "api_key_env": api_key_env,
        "base_url_env": base_url_env,
        "configured_base_url": configured_base_url,
        "voice_id_env": voice_id_env,
        "model_id_env": model_id_env,
        "history_item_id_env": history_item_id_env,
        "api_key": api_key,
        "base_url": base_url,
        "voice_id": voice_id,
        "model_id": model_id,
        "history_item_id": history_item_id,
        "api_key_present": bool(api_key),
        "base_url_present": bool(base_url),
        "voice_id_present": bool(voice_id),
        "model_id_present": bool(model_id),
        "history_item_id_present": bool(history_item_id),
    }


def config_snapshot(ctx_obj: dict[str, Any]) -> dict[str, Any]:
    runtime = resolve_runtime_values(ctx_obj)
    return {
        "summary": "ElevenLabs connector configuration snapshot.",
        "backend": BACKEND_NAME,
        "runtime": {
            "implementation_mode": "live_read_with_live_write",
            "live_read_available": runtime["api_key_present"],
            "live_write_available": runtime["api_key_present"],
            "write_bridge_available": runtime["api_key_present"],
        },
        "auth": {
            "api_key_env": runtime["api_key_env"],
            "api_key_present": runtime["api_key_present"],
            "api_key_preview": _mask(runtime["api_key"]),
            "base_url_env": runtime["base_url_env"],
            "base_url": runtime["base_url"] or None,
            "base_url_source": "env" if runtime["configured_base_url"] else "default",
            "base_url_present": runtime["base_url_present"],
        },
        "scope": {
            "voice_id": runtime["voice_id"] or None,
            "model_id": runtime["model_id"] or None,
            "history_item_id": runtime["history_item_id"] or None,
            "commandDefaults": {
                "voices.get": {"args": [runtime["voice_id"] or runtime["voice_id_env"]]},
                "history.download": {"args": [runtime["history_item_id"] or runtime["history_item_id_env"]]},
                "tts.generate": {
                    "args": [
                        runtime["voice_id"] or runtime["voice_id_env"],
                        runtime["model_id"] or runtime["model_id_env"],
                    ]
                },
                "tts.stream": {
                    "args": [
                        runtime["voice_id"] or runtime["voice_id_env"],
                        runtime["model_id"] or runtime["model_id_env"],
                    ]
                },
            },
        },
        "read_support": {
            "voices.list": True,
            "voices.get": True,
            "model.list": True,
            "history.list": True,
            "history.download": True,
            "user.read": True,
        },
        "write_support": {
            "tts.generate": "live",
            "tts.stream": "live",
            "voices.clone": "live",
            "sfx.generate": "live",
            "audio.isolate": "live",
            "live_writes_enabled": runtime["api_key_present"],
            "scaffold_only": False,
        },
    }
