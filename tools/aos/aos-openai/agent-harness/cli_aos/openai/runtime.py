from __future__ import annotations

import json
from typing import Any

from .client import OpenAIApiError, OpenAIClient
from .config import config_snapshot, resolve_runtime_values
from .constants import BACKEND_NAME, CONNECTOR_PATH
from .errors import CliError


def _load_manifest() -> dict[str, Any]:
    return json.loads(CONNECTOR_PATH.read_text())


def _scope_preview(command_id: str, resource: str, extra: dict[str, Any] | None = None) -> dict[str, Any]:
    payload = {
        "selection_surface": resource,
        "command_id": command_id,
        "backend": BACKEND_NAME,
    }
    if extra:
        payload.update(extra)
    return payload


def _picker(items: list[dict[str, Any]], *, kind: str, label_key: str = "label") -> dict[str, Any]:
    return {"kind": kind, "items": items, "count": len(items), "label_key": label_key}


def _require_arg(value: str | None, *, code: str, message: str, detail_key: str, detail_value: str) -> str:
    resolved = (value or "").strip()
    if resolved:
        return resolved
    raise CliError(code=code, message=message, exit_code=4, details={detail_key: detail_value})


def _parse_messages_json(messages_json: str | None) -> list[dict[str, Any]] | None:
    if not messages_json:
        return None
    try:
        payload = json.loads(messages_json)
    except json.JSONDecodeError as err:
        raise CliError(
            code="OPENAI_MESSAGES_JSON_INVALID",
            message="messages_json must be valid JSON",
            exit_code=4,
            details={"error": str(err)},
        ) from err
    if not isinstance(payload, list):
        raise CliError(
            code="OPENAI_MESSAGES_JSON_INVALID",
            message="messages_json must decode to a JSON array",
            exit_code=4,
            details={"type": type(payload).__name__},
        )
    if not all(isinstance(item, dict) for item in payload):
        raise CliError(
            code="OPENAI_MESSAGES_JSON_INVALID",
            message="messages_json must contain objects",
            exit_code=4,
            details={},
        )
    return payload


def capabilities_snapshot() -> dict[str, Any]:
    manifest = _load_manifest()
    write_support = {}
    read_support = {}
    for command in manifest["commands"]:
        command_id = command["id"]
        if command["required_mode"] == "readonly":
            read_support[command_id] = True
        else:
            write_support[command_id] = True
    return {
        "tool": manifest["tool"],
        "backend": manifest["backend"],
        "manifest_schema_version": manifest.get("manifest_schema_version", "1.0.0"),
        "connector": manifest["connector"],
        "auth": manifest["auth"],
        "scope": manifest.get("scope", {}),
        "commands": manifest["commands"],
        "read_support": read_support,
        "write_support": write_support,
    }


def create_client(ctx_obj: dict[str, Any]) -> OpenAIClient:
    runtime = resolve_runtime_values(ctx_obj)
    if not runtime["api_key_present"]:
        raise CliError(
            code="OPENAI_SETUP_REQUIRED",
            message="OpenAI connector is missing required credentials",
            exit_code=4,
            details={"missing_keys": [runtime["api_key_env"]]},
        )
    return OpenAIClient(
        api_key=runtime["api_key"],
        base_url=runtime["base_url"],
        organization_id=runtime["org_id"] or None,
        project_id=runtime["project_id"] or None,
    )


def probe_runtime(ctx_obj: dict[str, Any]) -> dict[str, Any]:
    runtime = resolve_runtime_values(ctx_obj)
    if not runtime["api_key_present"]:
        return {
            "ok": False,
            "code": "OPENAI_SETUP_REQUIRED",
            "message": "OpenAI connector is missing required credentials",
            "details": {
                "missing_keys": [runtime["api_key_env"]],
                "live_backend_available": False,
            },
        }
    try:
        client = create_client(ctx_obj)
        models = client.list_models(limit=3)
    except CliError as err:
        return {"ok": False, "code": err.code, "message": err.message, "details": err.details}
    except OpenAIApiError as err:
        code = "OPENAI_AUTH_FAILED" if err.status_code in {401, 403} else "OPENAI_API_ERROR"
        return {
            "ok": False,
            "code": code,
            "message": err.message,
            "details": {
                **(err.details or {}),
                "status_code": err.status_code,
                "live_backend_available": False,
            },
        }
    return {
        "ok": True,
        "code": "OK",
        "message": "OpenAI live runtime is ready",
        "details": {
            "live_backend_available": True,
            "model_count": models["count"],
            "sample_models": [item["id"] for item in models["models"][:3]],
        },
    }


def health_snapshot(ctx_obj: dict[str, Any]) -> dict[str, Any]:
    runtime = resolve_runtime_values(ctx_obj)
    probe = probe_runtime(ctx_obj)
    status = "ready" if probe["ok"] else ("needs_setup" if probe["code"] == "OPENAI_SETUP_REQUIRED" else "degraded")
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
            "org_id_env": runtime["org_id_env"],
            "org_id_present": runtime["org_id_present"],
            "project_id_env": runtime["project_id_env"],
            "project_id_present": runtime["project_id_present"],
        },
        "scope": {
            "base_url": runtime["base_url"],
            "default_model": runtime["model"] or None,
            "default_voice": runtime["voice"] or None,
            "default_image_size": runtime["image_size"] or None,
        },
        "checks": [
            {
                "name": "required_env",
                "ok": runtime["api_key_present"],
                "details": {"missing_keys": [] if runtime["api_key_present"] else [runtime["api_key_env"]]},
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
            f"Optionally set {runtime['org_id_env']} and {runtime['project_id_env']} if requests should be scoped.",
            "Use model.list to confirm the live backend responds with available models.",
        ],
    }


def doctor_snapshot(ctx_obj: dict[str, Any]) -> dict[str, Any]:
    runtime = resolve_runtime_values(ctx_obj)
    probe = probe_runtime(ctx_obj)
    ready = bool(probe.get("ok"))
    return {
        "status": "ready" if ready else ("needs_setup" if probe.get("code") == "OPENAI_SETUP_REQUIRED" else "degraded"),
        "summary": "OpenAI connector diagnostics.",
        "runtime": {
            "implementation_mode": "live_read_write",
            "command_readiness": {
                "chat.complete": ready,
                "embedding.create": ready,
                "image.generate": ready,
                "image.edit": ready and runtime["image_file_present"],
                "audio.transcribe": ready and runtime["audio_file_present"],
                "audio.tts": ready,
                "moderation.check": ready,
                "model.list": ready,
            },
            "image_file_present": runtime["image_file_present"],
            "audio_file_present": runtime["audio_file_present"],
        },
        "checks": [
            {"name": "required_env", "ok": runtime["api_key_present"]},
            {"name": "image_file", "ok": runtime["image_file_present"], "details": {"env": runtime["image_file_env"]}},
            {"name": "audio_file", "ok": runtime["audio_file_present"], "details": {"env": runtime["audio_file_env"]}},
            {"name": "live_backend", "ok": ready, "details": probe.get("details", {})},
        ],
        "supported_read_commands": ["moderation.check", "model.list"],
        "supported_write_commands": [
            "chat.complete",
            "embedding.create",
            "image.generate",
            "image.edit",
            "audio.transcribe",
            "audio.tts",
        ],
        "next_steps": [
            f"Set {runtime['api_key_env']} to enable live calls.",
            f"Set {runtime['image_file_env']} for image.edit and {runtime['audio_file_env']} for audio.transcribe defaults.",
            "Use health to confirm auth and connectivity before running write commands.",
        ],
    }


def chat_complete_result(
    ctx_obj: dict[str, Any],
    *,
    model: str | None,
    prompt: str | None,
    messages_json: str | None,
    max_tokens: int | None,
    temperature: float | None,
) -> dict[str, Any]:
    runtime = resolve_runtime_values(ctx_obj)
    resolved_model = model or runtime["model"] or "gpt-4o"
    parsed_messages = _parse_messages_json(messages_json or runtime["messages_json"])
    if parsed_messages is None:
        resolved_prompt = _require_arg(
            prompt or runtime["prompt"],
            code="OPENAI_PROMPT_REQUIRED",
            message="prompt or messages_json is required",
            detail_key="env",
            detail_value=runtime["prompt_env"],
        )
        parsed_messages = [{"role": "user", "content": resolved_prompt}]
    client = create_client(ctx_obj)
    completion = client.create_chat_completion(
        model=resolved_model,
        messages=parsed_messages,
        max_tokens=max_tokens if max_tokens is not None else runtime["max_tokens"],
        temperature=temperature if temperature is not None else runtime["temperature"],
    )
    return {
        "status": "live_write",
        "backend": BACKEND_NAME,
        "summary": f"Created chat completion with {resolved_model}.",
        "completion": completion,
        "scope_preview": _scope_preview("chat.complete", "chat", {"model": resolved_model}),
    }


def embedding_create_result(ctx_obj: dict[str, Any], *, model: str | None, prompt: str | None) -> dict[str, Any]:
    runtime = resolve_runtime_values(ctx_obj)
    resolved_prompt = _require_arg(
        prompt or runtime["prompt"],
        code="OPENAI_PROMPT_REQUIRED",
        message="prompt is required",
        detail_key="env",
        detail_value=runtime["prompt_env"],
    )
    resolved_model = model or runtime["model"] or "text-embedding-3-small"
    client = create_client(ctx_obj)
    embedding = client.create_embedding(model=resolved_model, input_text=resolved_prompt)
    return {
        "status": "live_write",
        "backend": BACKEND_NAME,
        "summary": f"Created embeddings with {resolved_model}.",
        "embedding": embedding,
        "scope_preview": _scope_preview("embedding.create", "embedding", {"model": resolved_model}),
    }


def image_generate_result(
    ctx_obj: dict[str, Any],
    *,
    model: str | None,
    prompt: str | None,
    image_prompt: str | None,
    image_size: str | None,
) -> dict[str, Any]:
    runtime = resolve_runtime_values(ctx_obj)
    resolved_prompt = _require_arg(
        image_prompt or prompt or runtime["image_prompt"] or runtime["prompt"],
        code="OPENAI_IMAGE_PROMPT_REQUIRED",
        message="prompt is required",
        detail_key="env",
        detail_value=runtime["image_prompt_env"],
    )
    resolved_model = model or runtime["model"] or "gpt-image-1"
    resolved_size = image_size or runtime["image_size"] or "1024x1024"
    client = create_client(ctx_obj)
    images = client.generate_image(model=resolved_model, prompt=resolved_prompt, size=resolved_size)
    return {
        "status": "live_write",
        "backend": BACKEND_NAME,
        "summary": f"Generated image with {resolved_model}.",
        "images": images,
        "scope_preview": _scope_preview("image.generate", "image", {"model": resolved_model, "size": resolved_size}),
    }


def image_edit_result(
    ctx_obj: dict[str, Any],
    *,
    model: str | None,
    image_prompt: str | None,
    prompt: str | None,
    image_size: str | None,
    image_file: str | None,
) -> dict[str, Any]:
    runtime = resolve_runtime_values(ctx_obj)
    resolved_prompt = _require_arg(
        image_prompt or prompt or runtime["image_prompt"] or runtime["prompt"],
        code="OPENAI_IMAGE_PROMPT_REQUIRED",
        message="prompt is required",
        detail_key="env",
        detail_value=runtime["image_prompt_env"],
    )
    resolved_image_file = _require_arg(
        image_file or runtime["image_file"],
        code="OPENAI_IMAGE_FILE_REQUIRED",
        message="image file is required",
        detail_key="env",
        detail_value=runtime["image_file_env"],
    )
    resolved_model = model or runtime["model"] or "gpt-image-1"
    resolved_size = image_size or runtime["image_size"] or "1024x1024"
    client = create_client(ctx_obj)
    images = client.edit_image(model=resolved_model, image_file=resolved_image_file, prompt=resolved_prompt, size=resolved_size)
    return {
        "status": "live_write",
        "backend": BACKEND_NAME,
        "summary": f"Edited image with {resolved_model}.",
        "images": images,
        "scope_preview": _scope_preview("image.edit", "image", {"model": resolved_model, "size": resolved_size}),
    }


def audio_transcribe_result(ctx_obj: dict[str, Any], *, model: str | None, audio_file: str | None) -> dict[str, Any]:
    runtime = resolve_runtime_values(ctx_obj)
    resolved_audio_file = _require_arg(
        audio_file or runtime["audio_file"],
        code="OPENAI_AUDIO_FILE_REQUIRED",
        message="audio file is required",
        detail_key="env",
        detail_value=runtime["audio_file_env"],
    )
    resolved_model = model or runtime["model"] or "gpt-4o-transcribe"
    client = create_client(ctx_obj)
    transcript = client.transcribe_audio(model=resolved_model, audio_file=resolved_audio_file)
    return {
        "status": "live_write",
        "backend": BACKEND_NAME,
        "summary": f"Transcribed audio with {resolved_model}.",
        "transcript": transcript,
        "scope_preview": _scope_preview("audio.transcribe", "audio", {"model": resolved_model}),
    }


def audio_tts_result(ctx_obj: dict[str, Any], *, model: str | None, prompt: str | None, voice: str | None) -> dict[str, Any]:
    runtime = resolve_runtime_values(ctx_obj)
    resolved_prompt = _require_arg(
        prompt or runtime["prompt"],
        code="OPENAI_PROMPT_REQUIRED",
        message="prompt is required",
        detail_key="env",
        detail_value=runtime["prompt_env"],
    )
    resolved_model = model or runtime["model"] or "gpt-4o-mini-tts"
    resolved_voice = voice or runtime["voice"] or "alloy"
    client = create_client(ctx_obj)
    audio = client.synthesize_speech(model=resolved_model, voice=resolved_voice, input_text=resolved_prompt)
    return {
        "status": "live_write",
        "backend": BACKEND_NAME,
        "summary": f"Generated speech with {resolved_model} using voice {resolved_voice}.",
        "audio": audio,
        "scope_preview": _scope_preview("audio.tts", "audio", {"model": resolved_model, "voice": resolved_voice}),
    }


def moderation_check_result(ctx_obj: dict[str, Any], *, model: str | None, prompt: str | None) -> dict[str, Any]:
    runtime = resolve_runtime_values(ctx_obj)
    resolved_prompt = _require_arg(
        prompt or runtime["prompt"],
        code="OPENAI_PROMPT_REQUIRED",
        message="prompt is required",
        detail_key="env",
        detail_value=runtime["prompt_env"],
    )
    resolved_model = model or runtime["model"] or "omni-moderation-latest"
    client = create_client(ctx_obj)
    moderation = client.check_moderation(model=resolved_model, input_text=resolved_prompt)
    return {
        "status": "live_read",
        "backend": BACKEND_NAME,
        "summary": f"Checked moderation with {resolved_model}.",
        "moderation": moderation,
        "scope_preview": _scope_preview("moderation.check", "moderation", {"model": resolved_model}),
    }


def model_list_result(ctx_obj: dict[str, Any], *, limit: int) -> dict[str, Any]:
    client = create_client(ctx_obj)
    models = client.list_models(limit=limit)
    picker_items = [
        {
            "value": item["id"],
            "label": item["id"],
            "subtitle": item.get("owned_by"),
            "selected": False,
        }
        for item in models["models"]
    ]
    return {
        "status": "live_read",
        "backend": BACKEND_NAME,
        "summary": f"Listed {models['count']} model(s).",
        "models": models,
        "picker": _picker(picker_items, kind="openai_model"),
        "scope_preview": _scope_preview("model.list", "model", {"limit": limit}),
    }


def config_show_result(ctx_obj: dict[str, Any]) -> dict[str, Any]:
    return config_snapshot(ctx_obj, probe=probe_runtime(ctx_obj))
