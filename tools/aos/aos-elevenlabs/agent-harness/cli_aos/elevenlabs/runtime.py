from __future__ import annotations

import base64
import hashlib
import json
from pathlib import Path
from typing import Any

from .client import ElevenLabsApiError, ElevenLabsClient
from .config import config_snapshot, resolve_runtime_values
from .constants import BACKEND_NAME, CONNECTOR_PATH
from .errors import CliError


def _load_manifest() -> dict[str, Any]:
    return json.loads(CONNECTOR_PATH.read_text())


def capabilities_snapshot() -> dict[str, Any]:
    manifest = _load_manifest()
    return {
        "tool": manifest["tool"],
        "backend": manifest["backend"],
        "manifest_schema_version": manifest.get("manifest_schema_version", "1.0.0"),
        "connector": manifest["connector"],
        "auth": manifest["auth"],
        "scope": manifest.get("scope", {}),
        "commands": manifest["commands"],
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
        },
    }


def create_client(ctx_obj: dict[str, Any]) -> ElevenLabsClient:
    runtime = resolve_runtime_values(ctx_obj)
    missing = []
    if not runtime["api_key_present"]:
        missing.append(runtime["api_key_env"])
    if missing:
        raise CliError(
            code="ELEVENLABS_SETUP_REQUIRED",
            message="ElevenLabs connector is missing required credentials",
            exit_code=4,
            details={"missing_keys": missing},
        )
    return ElevenLabsClient(api_key=runtime["api_key"], base_url=runtime["base_url"])


def probe_runtime(ctx_obj: dict[str, Any]) -> dict[str, Any]:
    runtime = resolve_runtime_values(ctx_obj)
    missing = []
    if not runtime["api_key_present"]:
        missing.append(runtime["api_key_env"])
    if missing:
        return {
            "ok": False,
            "code": "ELEVENLABS_SETUP_REQUIRED",
            "message": "ElevenLabs connector is missing required credentials",
            "details": {"missing_keys": missing, "live_backend_available": False, "live_write_available": False},
        }
    try:
        client = create_client(ctx_obj)
        user = client.read_user()
    except CliError as err:
        return {"ok": False, "code": err.code, "message": err.message, "details": err.details}
    except ElevenLabsApiError as err:
        code = "ELEVENLABS_AUTH_FAILED" if err.status_code in {401, 403} else "ELEVENLABS_API_ERROR"
        return {
            "ok": False,
            "code": code,
            "message": err.message,
            "details": {
                **(err.details or {}),
                "status_code": err.status_code,
                "live_backend_available": False,
                "live_write_available": False,
            },
        }
    subscription = user.get("subscription") if isinstance(user, dict) else None
    return {
        "ok": True,
        "code": "OK",
        "message": "ElevenLabs live read runtime is ready",
        "details": {
            "live_backend_available": True,
            "live_write_available": True,
            "user_id": user.get("user_id") if isinstance(user, dict) else None,
            "subscription_tier": subscription.get("tier") if isinstance(subscription, dict) else None,
            "base_url": runtime["base_url"],
        },
    }


def health_snapshot(ctx_obj: dict[str, Any]) -> dict[str, Any]:
    runtime = resolve_runtime_values(ctx_obj)
    probe = probe_runtime(ctx_obj)
    status = "ready"
    if not probe["ok"]:
        if probe["code"] == "ELEVENLABS_SETUP_REQUIRED":
            status = "needs_setup"
        elif probe["code"] == "ELEVENLABS_AUTH_FAILED":
            status = "auth_error"
        else:
            status = "degraded"
    return {
        "status": status,
        "summary": probe["message"],
        "connector": {
            "backend": BACKEND_NAME,
            "live_backend_available": bool(probe.get("ok")),
            "live_read_available": bool(probe.get("ok")),
            "write_bridge_available": bool(probe.get("ok")),
            "scaffold_only": False,
        },
        "auth": {
            "api_key_env": runtime["api_key_env"],
            "api_key_present": runtime["api_key_present"],
            "base_url_env": runtime["base_url_env"],
            "base_url_present": runtime["base_url_present"],
        },
        "scope": {
            "voice_id": runtime["voice_id"] or None,
            "model_id": runtime["model_id"] or None,
            "history_item_id": runtime["history_item_id"] or None,
        },
        "checks": [
            {
                "name": "required_env",
                "ok": runtime["api_key_present"],
                "details": {
                    "missing_keys": [
                        key
                        for key, present in [(runtime["api_key_env"], runtime["api_key_present"])]
                        if not present
                    ]
                },
            },
            {"name": "live_backend", "ok": bool(probe.get("ok")), "details": probe.get("details", {})},
        ],
        "runtime_ready": bool(probe.get("ok")),
        "live_backend_available": bool(probe.get("ok")),
        "live_read_available": bool(probe.get("ok")),
        "write_bridge_available": bool(probe.get("ok")),
        "scaffold_only": False,
        "probe": probe,
        "next_steps": [
            f"Set {runtime['api_key_env']} in API Keys.",
            f"Optional: set {runtime['base_url_env']} only if you need a non-default ElevenLabs API host.",
            "Optional: pin ELEVENLABS_VOICE_ID, ELEVENLABS_MODEL_ID, and ELEVENLABS_HISTORY_ITEM_ID for worker defaults.",
            "Use tts.generate for text-to-speech, tts.stream for streaming, sfx.generate for sound effects.",
        ],
    }


_ALL_COMMANDS = [
    "voices.list", "voices.get", "voices.clone",
    "model.list",
    "history.list", "history.download",
    "user.read",
    "tts.generate", "tts.stream",
    "sfx.generate", "audio.isolate",
]


def doctor_snapshot(ctx_obj: dict[str, Any]) -> dict[str, Any]:
    runtime = resolve_runtime_values(ctx_obj)
    probe = probe_runtime(ctx_obj)
    ready = bool(probe.get("ok"))
    return {
        "status": "ready" if ready else ("needs_setup" if probe.get("code") == "ELEVENLABS_SETUP_REQUIRED" else ("auth_error" if probe.get("code") == "ELEVENLABS_AUTH_FAILED" else "degraded")),
        "summary": "ElevenLabs connector diagnostics.",
        "runtime": {
            "implementation_mode": "live_read_with_live_write",
            "command_readiness": {cmd: ready for cmd in _ALL_COMMANDS},
            "voice_id_present": runtime["voice_id_present"],
            "model_id_present": runtime["model_id_present"],
            "history_item_id_present": runtime["history_item_id_present"],
        },
        "checks": [
            {"name": "required_env", "ok": runtime["api_key_present"]},
            {"name": "live_backend", "ok": ready, "details": probe.get("details", {})},
            {"name": "write_commands", "ok": ready, "details": {"mode": "live"}},
        ],
        "next_steps": [
            f"Set {runtime['api_key_env']} in API Keys.",
            "Use tts.generate / tts.stream / sfx.generate / audio.isolate / voices.clone for write operations.",
        ],
    }


def _picker(items: list[dict[str, Any]], *, kind: str, label_key: str = "label") -> dict[str, Any]:
    return {"kind": kind, "items": items, "count": len(items), "label_key": label_key}


def _require_arg(value: str | None, *, code: str, message: str, detail_key: str, detail_value: str) -> str:
    resolved = (value or "").strip()
    if resolved:
        return resolved
    raise CliError(code=code, message=message, exit_code=4, details={detail_key: detail_value})


# ---------------------------------------------------------------------------
# voices.*
# ---------------------------------------------------------------------------

def voice_list_result(ctx_obj: dict[str, Any], *, page_size: int, cursor: str | None, search: str | None) -> dict[str, Any]:
    runtime = resolve_runtime_values(ctx_obj)
    client = create_client(ctx_obj)
    payload = client.list_voices(page_size=page_size, cursor=cursor, search=search)
    voices = payload.get("voices", []) if isinstance(payload, dict) and isinstance(payload.get("voices"), list) else []
    items = []
    for item in voices:
        if not isinstance(item, dict):
            continue
        voice_id = str(item.get("voice_id") or "")
        if not voice_id:
            continue
        items.append(
            {
                "id": voice_id,
                "label": item.get("name") or voice_id,
                "voice_id": voice_id,
                "category": item.get("category"),
                "preview_url": item.get("preview_url"),
            }
        )
    return {
        "status": "live_read",
        "backend": BACKEND_NAME,
        "summary": f"Returned {len(voices)} ElevenLabs voice{'' if len(voices) == 1 else 's'}.",
        "voices": voices,
        "voice_count": len(voices),
        "pagination": {
            "has_more": payload.get("has_more") if isinstance(payload, dict) else None,
            "next_page_token": payload.get("next_page_token") if isinstance(payload, dict) else None,
            "total_count": payload.get("total_count") if isinstance(payload, dict) else None,
        },
        "picker": _picker(items, kind="voice"),
        "scope_preview": {
            "voice_id": runtime["voice_id"] or None,
        },
    }


def voice_get_result(ctx_obj: dict[str, Any], voice_id: str | None) -> dict[str, Any]:
    runtime = resolve_runtime_values(ctx_obj)
    resolved = _require_arg(
        voice_id or runtime["voice_id"],
        code="ELEVENLABS_VOICE_REQUIRED",
        message="Voice ID is required",
        detail_key="env",
        detail_value=runtime["voice_id_env"],
    )
    client = create_client(ctx_obj)
    voice = client.read_voice(resolved)
    return {
        "status": "live_read",
        "backend": BACKEND_NAME,
        "summary": f"Read ElevenLabs voice {resolved}.",
        "voice": voice,
        "scope_preview": {"voice_id": resolved},
    }


def voice_clone_result(
    ctx_obj: dict[str, Any],
    *,
    name: str,
    description: str | None,
    files: list[str],
) -> dict[str, Any]:
    if not name.strip():
        raise CliError(
            code="ELEVENLABS_NAME_REQUIRED",
            message="Voice clone name is required",
            exit_code=4,
            details={"field": "name"},
        )
    if not files:
        raise CliError(
            code="ELEVENLABS_FILES_REQUIRED",
            message="At least one audio sample file is required for voice cloning",
            exit_code=4,
            details={"field": "files"},
        )
    client = create_client(ctx_obj)
    result = client.clone_voice(name=name.strip(), description=description, files=files)
    voice_id = result.get("voice_id") if isinstance(result, dict) else None
    return {
        "status": "live_write",
        "backend": BACKEND_NAME,
        "summary": f"Created voice clone '{name.strip()}'" + (f" (voice_id={voice_id})" if voice_id else "") + ".",
        "voice": result,
        "voice_id": voice_id,
        "clone": {
            "name": name.strip(),
            "description": description,
            "sample_count": len(files),
            "sample_files": files,
        },
    }


# ---------------------------------------------------------------------------
# model.*
# ---------------------------------------------------------------------------

def model_list_result(ctx_obj: dict[str, Any]) -> dict[str, Any]:
    client = create_client(ctx_obj)
    models = client.list_models()
    items = []
    for item in models:
        model_id = str(item.get("model_id") or "")
        if not model_id:
            continue
        items.append(
            {
                "id": model_id,
                "label": item.get("name") or model_id,
                "model_id": model_id,
                "description": item.get("description"),
                "can_do_text_to_speech": item.get("can_do_text_to_speech"),
            }
        )
    return {
        "status": "live_read",
        "backend": BACKEND_NAME,
        "summary": f"Returned {len(models)} ElevenLabs model{'' if len(models) == 1 else 's'}.",
        "models": models,
        "model_count": len(models),
        "picker": _picker(items, kind="model"),
    }


# ---------------------------------------------------------------------------
# history.*
# ---------------------------------------------------------------------------

def history_list_result(
    ctx_obj: dict[str, Any],
    *,
    page_size: int,
    cursor: str | None,
    voice_id: str | None,
    model_id: str | None,
) -> dict[str, Any]:
    runtime = resolve_runtime_values(ctx_obj)
    client = create_client(ctx_obj)
    payload = client.list_history(page_size=page_size, cursor=cursor, voice_id=voice_id, model_id=model_id)
    history = payload.get("history", []) if isinstance(payload, dict) and isinstance(payload.get("history"), list) else []
    items = []
    for item in history:
        if not isinstance(item, dict):
            continue
        history_item_id = str(item.get("history_item_id") or "")
        if not history_item_id:
            continue
        label_bits = [history_item_id]
        if item.get("voice_name") or item.get("voice_id"):
            label_bits.insert(0, str(item.get("voice_name") or item.get("voice_id")))
        items.append(
            {
                "id": history_item_id,
                "label": " • ".join(label_bits),
                "history_item_id": history_item_id,
                "voice_id": item.get("voice_id"),
                "model_id": item.get("model_id"),
                "content_type": item.get("content_type"),
            }
        )
    return {
        "status": "live_read",
        "backend": BACKEND_NAME,
        "summary": f"Returned {len(history)} ElevenLabs history item{'' if len(history) == 1 else 's'}.",
        "history": history,
        "history_count": len(history),
        "pagination": {
            "has_more": payload.get("has_more") if isinstance(payload, dict) else None,
            "last_history_item_id": payload.get("last_history_item_id") if isinstance(payload, dict) else None,
            "scanned_until": payload.get("scanned_until") if isinstance(payload, dict) else None,
        },
        "picker": _picker(items, kind="history_item"),
        "scope_preview": {
            "voice_id": runtime["voice_id"] or voice_id or None,
            "model_id": runtime["model_id"] or model_id or None,
        },
    }


def history_download_result(
    ctx_obj: dict[str, Any],
    history_item_id: str | None,
    *,
    output_path: Path | None,
) -> dict[str, Any]:
    runtime = resolve_runtime_values(ctx_obj)
    resolved = _require_arg(
        history_item_id or runtime["history_item_id"],
        code="ELEVENLABS_HISTORY_REQUIRED",
        message="History item ID is required",
        detail_key="env",
        detail_value=runtime["history_item_id_env"],
    )
    client = create_client(ctx_obj)
    result = client.download_history_audio(resolved)
    audio = result["audio"]
    content_type = result.get("content_type") or "audio/mpeg"
    audio_sha256 = hashlib.sha256(audio).hexdigest()
    audio_size_bytes = len(audio)
    suggested_filename = f"elevenlabs-history-{resolved}.mp3"

    output_reference: dict[str, Any]
    audio_base64: str | None = None
    saved_path: Path | None = None
    if output_path is not None:
        saved_path = output_path.expanduser()
        if not saved_path.is_absolute():
            saved_path = Path.cwd() / saved_path
        saved_path.parent.mkdir(parents=True, exist_ok=True)
        saved_path.write_bytes(audio)
        output_reference = {
            "kind": "file",
            "path": str(saved_path),
            "absolute_path": str(saved_path),
            "filename": saved_path.name,
        }
    else:
        audio_base64 = base64.b64encode(audio).decode("ascii")
        output_reference = {
            "kind": "inline_base64",
            "mime_type": content_type,
            "filename": suggested_filename,
            "data": audio_base64,
        }

    return {
        "status": "live_read",
        "backend": BACKEND_NAME,
        "summary": f"Downloaded audio for history item {resolved}.",
        "download": {
            "history_item_id": resolved,
            "content_type": content_type,
            "audio_size_bytes": audio_size_bytes,
            "audio_sha256": audio_sha256,
            "output_reference": output_reference,
            "audio_base64": audio_base64,
            "saved_path": str(saved_path) if saved_path is not None else None,
            "suggested_filename": suggested_filename,
        },
        "scope_preview": {"history_item_id": resolved},
    }


# ---------------------------------------------------------------------------
# user.*
# ---------------------------------------------------------------------------

def user_read_result(ctx_obj: dict[str, Any]) -> dict[str, Any]:
    client = create_client(ctx_obj)
    user = client.read_user()
    subscription = user.get("subscription") if isinstance(user, dict) else None
    summary_bits = []
    if isinstance(user, dict) and user.get("user_id"):
        summary_bits.append(str(user["user_id"]))
    if isinstance(subscription, dict) and subscription.get("tier"):
        summary_bits.append(str(subscription["tier"]))
    summary = "Read ElevenLabs user info"
    if summary_bits:
        summary = f"{summary} ({' / '.join(summary_bits)})"
    return {
        "status": "live_read",
        "backend": BACKEND_NAME,
        "summary": summary + ".",
        "user": user,
        "subscription": subscription,
    }


# ---------------------------------------------------------------------------
# tts.*
# ---------------------------------------------------------------------------

def _suggested_audio_filename(voice_id: str, output_format: str) -> str:
    extension = "mp3" if output_format.lower().startswith("mp3") else "audio"
    slug = "".join(ch if ch.isalnum() or ch in {"-", "_"} else "-" for ch in voice_id).strip("-_")
    if not slug:
        slug = "voice"
    return f"elevenlabs-{slug}.{extension}"


def _build_synthesis_output(
    audio: bytes,
    *,
    content_type: str,
    voice_id: str,
    model_id: str | None,
    output_format: str,
    request_id: str | None,
    character_count: int | None,
    text: str,
    output_path: Path | None,
    request_meta: dict[str, Any],
    extra: dict[str, Any] | None = None,
) -> dict[str, Any]:
    audio_sha256 = hashlib.sha256(audio).hexdigest()
    audio_size_bytes = len(audio)
    suggested_filename = _suggested_audio_filename(voice_id, output_format)

    output_reference: dict[str, Any]
    audio_base64: str | None = None
    saved_path: Path | None = None
    if output_path is not None:
        saved_path = output_path.expanduser()
        if not saved_path.is_absolute():
            saved_path = Path.cwd() / saved_path
        saved_path.parent.mkdir(parents=True, exist_ok=True)
        saved_path.write_bytes(audio)
        output_reference = {
            "kind": "file",
            "path": str(saved_path),
            "absolute_path": str(saved_path),
            "filename": saved_path.name,
        }
    else:
        audio_base64 = base64.b64encode(audio).decode("ascii")
        output_reference = {
            "kind": "inline_base64",
            "mime_type": content_type,
            "filename": suggested_filename,
            "data": audio_base64,
        }

    synthesis: dict[str, Any] = {
        "text": text,
        "text_length": len(text),
        "voice_id": voice_id,
        "model_id": model_id,
        "output_format": output_format,
        "content_type": content_type,
        "audio_size_bytes": audio_size_bytes,
        "audio_sha256": audio_sha256,
        "request_id": request_id,
        "character_count": character_count,
        "request": request_meta,
        "output_reference": output_reference,
        "audio_base64": audio_base64,
        "saved_path": str(saved_path) if saved_path is not None else None,
        "suggested_filename": suggested_filename,
    }
    if extra:
        synthesis.update(extra)

    return {
        "status": "live_write",
        "backend": BACKEND_NAME,
        "summary": f"Synthesized ElevenLabs audio for voice {voice_id}.",
        "synthesis": synthesis,
        "scope_preview": {
            "voice_id": voice_id,
            "model_id": model_id,
        },
    }


def tts_generate_result(
    ctx_obj: dict[str, Any],
    *,
    text: str,
    voice_id: str | None,
    model_id: str | None,
    output_format: str,
    output_path: Path | None,
    stability: float | None,
    similarity_boost: float | None,
    style: float | None,
) -> dict[str, Any]:
    runtime = resolve_runtime_values(ctx_obj)
    resolved_voice_id = _require_arg(
        voice_id or runtime["voice_id"],
        code="ELEVENLABS_VOICE_REQUIRED",
        message="Voice ID is required",
        detail_key="env",
        detail_value=runtime["voice_id_env"],
    )
    resolved_model_id = (model_id or runtime["model_id"] or "").strip() or None
    if not text.strip():
        raise CliError(
            code="ELEVENLABS_TEXT_REQUIRED",
            message="Text is required",
            exit_code=4,
            details={"field": "text"},
        )

    client = create_client(ctx_obj)
    synthesis = client.synthesize(
        text,
        voice_id=resolved_voice_id,
        model_id=resolved_model_id,
        output_format=output_format,
        stability=stability,
        similarity_boost=similarity_boost,
        style=style,
    )

    return _build_synthesis_output(
        synthesis["audio"],
        content_type=synthesis.get("content_type") or "application/octet-stream",
        voice_id=resolved_voice_id,
        model_id=resolved_model_id,
        output_format=output_format,
        request_id=synthesis.get("request_id"),
        character_count=synthesis.get("character_count"),
        text=text,
        output_path=output_path,
        request_meta=synthesis.get("request", {}),
    )


def tts_stream_result(
    ctx_obj: dict[str, Any],
    *,
    text: str,
    voice_id: str | None,
    model_id: str | None,
    output_format: str,
    output_path: Path | None,
    stability: float | None,
    similarity_boost: float | None,
    style: float | None,
) -> dict[str, Any]:
    runtime = resolve_runtime_values(ctx_obj)
    resolved_voice_id = _require_arg(
        voice_id or runtime["voice_id"],
        code="ELEVENLABS_VOICE_REQUIRED",
        message="Voice ID is required",
        detail_key="env",
        detail_value=runtime["voice_id_env"],
    )
    resolved_model_id = (model_id or runtime["model_id"] or "").strip() or None
    if not text.strip():
        raise CliError(
            code="ELEVENLABS_TEXT_REQUIRED",
            message="Text is required",
            exit_code=4,
            details={"field": "text"},
        )

    client = create_client(ctx_obj)
    synthesis = client.synthesize_stream(
        text,
        voice_id=resolved_voice_id,
        model_id=resolved_model_id,
        output_format=output_format,
        stability=stability,
        similarity_boost=similarity_boost,
        style=style,
    )

    return _build_synthesis_output(
        synthesis["audio"],
        content_type=synthesis.get("content_type") or "application/octet-stream",
        voice_id=resolved_voice_id,
        model_id=resolved_model_id,
        output_format=output_format,
        request_id=synthesis.get("request_id"),
        character_count=None,
        text=text,
        output_path=output_path,
        request_meta=synthesis.get("request", {}),
        extra={"chunk_count": synthesis.get("chunk_count")},
    )


# ---------------------------------------------------------------------------
# sfx.*
# ---------------------------------------------------------------------------

def sfx_generate_result(
    ctx_obj: dict[str, Any],
    *,
    prompt: str,
    duration_seconds: float | None,
    prompt_influence: float | None,
    output_path: Path | None,
) -> dict[str, Any]:
    if not prompt.strip():
        raise CliError(
            code="ELEVENLABS_SFX_PROMPT_REQUIRED",
            message="Sound effect text prompt is required",
            exit_code=4,
            details={"field": "prompt"},
        )

    client = create_client(ctx_obj)
    result = client.generate_sound_effect(
        prompt,
        duration_seconds=duration_seconds,
        prompt_influence=prompt_influence,
    )
    audio = result["audio"]
    content_type = result.get("content_type") or "audio/mpeg"
    audio_sha256 = hashlib.sha256(audio).hexdigest()
    audio_size_bytes = len(audio)
    suggested_filename = "elevenlabs-sfx.mp3"

    output_reference: dict[str, Any]
    audio_base64: str | None = None
    saved_path: Path | None = None
    if output_path is not None:
        saved_path = output_path.expanduser()
        if not saved_path.is_absolute():
            saved_path = Path.cwd() / saved_path
        saved_path.parent.mkdir(parents=True, exist_ok=True)
        saved_path.write_bytes(audio)
        output_reference = {
            "kind": "file",
            "path": str(saved_path),
            "absolute_path": str(saved_path),
            "filename": saved_path.name,
        }
    else:
        audio_base64 = base64.b64encode(audio).decode("ascii")
        output_reference = {
            "kind": "inline_base64",
            "mime_type": content_type,
            "filename": suggested_filename,
            "data": audio_base64,
        }

    return {
        "status": "live_write",
        "backend": BACKEND_NAME,
        "summary": f"Generated sound effect from prompt ({len(prompt)} chars).",
        "sfx": {
            "prompt": prompt,
            "prompt_length": len(prompt),
            "duration_seconds": duration_seconds,
            "prompt_influence": prompt_influence,
            "content_type": content_type,
            "audio_size_bytes": audio_size_bytes,
            "audio_sha256": audio_sha256,
            "request_id": result.get("request_id"),
            "request": result.get("request", {}),
            "output_reference": output_reference,
            "audio_base64": audio_base64,
            "saved_path": str(saved_path) if saved_path is not None else None,
            "suggested_filename": suggested_filename,
        },
    }


# ---------------------------------------------------------------------------
# audio.*
# ---------------------------------------------------------------------------

def audio_isolate_result(
    ctx_obj: dict[str, Any],
    *,
    input_path: str,
    output_path: Path | None,
) -> dict[str, Any]:
    input_file = Path(input_path).expanduser()
    if not input_file.is_absolute():
        input_file = Path.cwd() / input_file
    if not input_file.exists():
        raise CliError(
            code="ELEVENLABS_FILE_NOT_FOUND",
            message=f"Input audio file not found: {input_file}",
            exit_code=4,
            details={"path": str(input_file)},
        )

    audio_data = input_file.read_bytes()
    client = create_client(ctx_obj)
    result = client.isolate_audio(audio_data)
    audio = result["audio"]
    content_type = result.get("content_type") or "audio/mpeg"
    audio_sha256 = hashlib.sha256(audio).hexdigest()
    audio_size_bytes = len(audio)
    suggested_filename = f"elevenlabs-isolated-{input_file.stem}.mp3"

    output_reference: dict[str, Any]
    audio_base64: str | None = None
    saved_path: Path | None = None
    if output_path is not None:
        saved_path = output_path.expanduser()
        if not saved_path.is_absolute():
            saved_path = Path.cwd() / saved_path
        saved_path.parent.mkdir(parents=True, exist_ok=True)
        saved_path.write_bytes(audio)
        output_reference = {
            "kind": "file",
            "path": str(saved_path),
            "absolute_path": str(saved_path),
            "filename": saved_path.name,
        }
    else:
        audio_base64 = base64.b64encode(audio).decode("ascii")
        output_reference = {
            "kind": "inline_base64",
            "mime_type": content_type,
            "filename": suggested_filename,
            "data": audio_base64,
        }

    return {
        "status": "live_write",
        "backend": BACKEND_NAME,
        "summary": f"Isolated audio from {input_file.name} ({audio_size_bytes} bytes).",
        "isolation": {
            "input_path": str(input_file),
            "input_size_bytes": len(audio_data),
            "content_type": content_type,
            "audio_size_bytes": audio_size_bytes,
            "audio_sha256": audio_sha256,
            "request_id": result.get("request_id"),
            "request": result.get("request", {}),
            "output_reference": output_reference,
            "audio_base64": audio_base64,
            "saved_path": str(saved_path) if saved_path is not None else None,
            "suggested_filename": suggested_filename,
        },
    }


# ---------------------------------------------------------------------------
# Legacy aliases (kept for backward compat if anything references old names)
# ---------------------------------------------------------------------------

def voice_read_result(ctx_obj: dict[str, Any], voice_id: str | None) -> dict[str, Any]:
    return voice_get_result(ctx_obj, voice_id)


def history_read_result(ctx_obj: dict[str, Any], history_item_id: str | None) -> dict[str, Any]:
    """Legacy: history.read is now history.download with inline base64."""
    return history_download_result(ctx_obj, history_item_id, output_path=None)


def synthesize_result(
    ctx_obj: dict[str, Any],
    *,
    text: str,
    voice_id: str | None,
    model_id: str | None,
    output_format: str,
    output_path: Path | None,
) -> dict[str, Any]:
    """Legacy: synthesize is now tts.generate."""
    return tts_generate_result(
        ctx_obj,
        text=text,
        voice_id=voice_id,
        model_id=model_id,
        output_format=output_format,
        output_path=output_path,
        stability=None,
        similarity_boost=None,
        style=None,
    )
