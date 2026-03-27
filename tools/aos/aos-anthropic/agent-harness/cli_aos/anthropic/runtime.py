from __future__ import annotations

import json
from typing import Any

from .client import AnthropicApiError, AnthropicClient
from .config import config_snapshot, resolve_runtime_values
from .constants import BACKEND_NAME, CONNECTOR_PATH
from .errors import CliError


def _load_manifest() -> dict[str, Any]:
    return json.loads(CONNECTOR_PATH.read_text())


def _scope_preview(command_id: str, resource: str, extra: dict[str, Any] | None = None) -> dict[str, Any]:
    payload = {"selection_surface": resource, "command_id": command_id, "backend": BACKEND_NAME}
    if extra:
        payload.update(extra)
    return payload


def _picker(items: list[dict[str, Any]], *, kind: str, label_key: str = "label") -> dict[str, Any]:
    return {"kind": kind, "items": items, "count": len(items), "label_key": label_key}


def _parse_messages_json(messages_json: str | None) -> list[dict[str, Any]]:
    if not messages_json:
        raise CliError(
            code="ANTHROPIC_MESSAGES_REQUIRED",
            message="messages_json is required",
            exit_code=4,
            details={"hint": "Provide a JSON array of Anthropic message objects."},
        )
    try:
        payload = json.loads(messages_json)
    except json.JSONDecodeError as err:
        raise CliError(
            code="ANTHROPIC_MESSAGES_JSON_INVALID",
            message="messages_json must be valid JSON",
            exit_code=4,
            details={"error": str(err)},
        ) from err
    if not isinstance(payload, list) or not all(isinstance(item, dict) for item in payload):
        raise CliError(
            code="ANTHROPIC_MESSAGES_JSON_INVALID",
            message="messages_json must decode to an array of objects",
            exit_code=4,
            details={},
        )
    return payload


def capabilities_snapshot() -> dict[str, Any]:
    manifest = _load_manifest()
    write_support = {}
    read_support = {}
    for command in manifest["commands"]:
        if command["required_mode"] == "readonly":
            read_support[command["id"]] = True
        else:
            write_support[command["id"]] = True
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


def create_client(ctx_obj: dict[str, Any]) -> AnthropicClient:
    runtime = resolve_runtime_values(ctx_obj)
    if not runtime["api_key_present"]:
        raise CliError(
            code="ANTHROPIC_SETUP_REQUIRED",
            message="Anthropic connector is missing required credentials",
            exit_code=4,
            details={"missing_keys": [runtime["api_key_env"]]},
        )
    return AnthropicClient(
        api_key=runtime["api_key"],
        base_url=runtime["base_url"],
        version=runtime["version"],
    )


def probe_runtime(ctx_obj: dict[str, Any]) -> dict[str, Any]:
    runtime = resolve_runtime_values(ctx_obj)
    if not runtime["api_key_present"]:
        return {
            "ok": False,
            "code": "ANTHROPIC_SETUP_REQUIRED",
            "message": "Anthropic connector is missing required credentials",
            "details": {"missing_keys": [runtime["api_key_env"]], "live_backend_available": False},
        }
    try:
        client = create_client(ctx_obj)
        models = client.list_models(limit=3)
    except CliError as err:
        return {"ok": False, "code": err.code, "message": err.message, "details": err.details}
    except AnthropicApiError as err:
        code = "ANTHROPIC_AUTH_FAILED" if err.status_code in {401, 403} else "ANTHROPIC_API_ERROR"
        return {
            "ok": False,
            "code": code,
            "message": err.message,
            "details": {**(err.details or {}), "status_code": err.status_code, "live_backend_available": False},
        }
    return {
        "ok": True,
        "code": "OK",
        "message": "Anthropic live runtime is ready",
        "details": {"live_backend_available": True, "model_count": models["count"], "sample_models": [m["id"] for m in models["models"][:3]]},
    }


def health_snapshot(ctx_obj: dict[str, Any]) -> dict[str, Any]:
    runtime = resolve_runtime_values(ctx_obj)
    probe = probe_runtime(ctx_obj)
    status = "ready" if probe["ok"] else ("needs_setup" if probe["code"] == "ANTHROPIC_SETUP_REQUIRED" else "degraded")
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
            "version_env": runtime["version_env"],
            "version": runtime["version"],
        },
        "scope": {"base_url": runtime["base_url"], "default_model": runtime["model"] or None},
        "checks": [
            {
                "name": "required_env",
                "ok": runtime["api_key_present"],
                "details": {"missing_keys": [] if runtime["api_key_present"] else [runtime["api_key_env"]]},
            },
            {"name": "live_backend", "ok": bool(probe.get("ok")), "details": probe.get("details", {})},
        ],
        "runtime_ready": bool(probe.get("ok")),
        "probe": probe,
        "next_steps": [
            f"Set {runtime['api_key_env']} in API Keys.",
            f"Optionally pin {runtime['model_env']} and {runtime['version_env']} defaults.",
            "Use model.list to confirm the live backend responds before running write commands.",
        ],
    }


def doctor_snapshot(ctx_obj: dict[str, Any]) -> dict[str, Any]:
    runtime = resolve_runtime_values(ctx_obj)
    probe = probe_runtime(ctx_obj)
    ready = bool(probe.get("ok"))
    return {
        "status": "ready" if ready else ("needs_setup" if probe.get("code") == "ANTHROPIC_SETUP_REQUIRED" else "degraded"),
        "summary": "Anthropic connector diagnostics.",
        "runtime": {
            "implementation_mode": "live_read_write",
            "command_readiness": {
                "message.create": ready,
                "message.stream": ready,
                "model.list": ready,
            },
            "thinking_budget": runtime["thinking_budget"],
        },
        "checks": [
            {"name": "required_env", "ok": runtime["api_key_present"]},
            {"name": "live_backend", "ok": ready, "details": probe.get("details", {})},
        ],
        "supported_read_commands": ["model.list"],
        "supported_write_commands": ["message.create", "message.stream"],
        "next_steps": [
            f"Set {runtime['api_key_env']} to enable live calls.",
            "Provide messages_json as a JSON array for message commands.",
            "Set thinking budget only for models that support extended thinking.",
        ],
    }


def _resolved_request(
    ctx_obj: dict[str, Any],
    *,
    model: str | None,
    system_prompt: str | None,
    messages_json: str | None,
    max_tokens: int | None,
    temperature: float | None,
    thinking_budget: int | None,
) -> dict[str, Any]:
    runtime = resolve_runtime_values(ctx_obj)
    return {
        "model": model or runtime["model"] or "claude-sonnet-4-20250514",
        "system_prompt": system_prompt or runtime["system_prompt"] or None,
        "messages": _parse_messages_json(messages_json or runtime["messages_json"]),
        "max_tokens": max_tokens if max_tokens is not None else runtime["max_tokens"] or 4096,
        "temperature": temperature if temperature is not None else runtime["temperature"],
        "thinking_budget": thinking_budget if thinking_budget is not None else runtime["thinking_budget"],
    }


def message_create_result(
    ctx_obj: dict[str, Any],
    *,
    model: str | None,
    system_prompt: str | None,
    messages_json: str | None,
    max_tokens: int | None,
    temperature: float | None,
    thinking_budget: int | None,
) -> dict[str, Any]:
    request = _resolved_request(
        ctx_obj,
        model=model,
        system_prompt=system_prompt,
        messages_json=messages_json,
        max_tokens=max_tokens,
        temperature=temperature,
        thinking_budget=thinking_budget,
    )
    client = create_client(ctx_obj)
    message = client.create_message(**request)
    return {
        "status": "live_write",
        "backend": BACKEND_NAME,
        "summary": f"Created Anthropic message with {request['model']}.",
        "message": message,
        "scope_preview": _scope_preview("message.create", "message", {"model": request["model"]}),
    }


def message_stream_result(
    ctx_obj: dict[str, Any],
    *,
    model: str | None,
    system_prompt: str | None,
    messages_json: str | None,
    max_tokens: int | None,
    temperature: float | None,
    thinking_budget: int | None,
) -> dict[str, Any]:
    request = _resolved_request(
        ctx_obj,
        model=model,
        system_prompt=system_prompt,
        messages_json=messages_json,
        max_tokens=max_tokens,
        temperature=temperature,
        thinking_budget=thinking_budget,
    )
    client = create_client(ctx_obj)
    stream = client.stream_message(**request)
    return {
        "status": "live_write",
        "backend": BACKEND_NAME,
        "summary": f"Streamed Anthropic message with {request['model']}.",
        "stream": stream,
        "scope_preview": _scope_preview("message.stream", "message", {"model": request["model"]}),
    }


def model_list_result(ctx_obj: dict[str, Any], *, limit: int) -> dict[str, Any]:
    client = create_client(ctx_obj)
    models = client.list_models(limit=limit)
    picker_items = [
        {
            "value": item["id"],
            "label": item["display_name"] or item["id"],
            "subtitle": item.get("type"),
            "selected": False,
        }
        for item in models["models"]
    ]
    return {
        "status": "live_read",
        "backend": BACKEND_NAME,
        "summary": f"Listed {models['count']} model(s).",
        "models": models,
        "picker": _picker(picker_items, kind="anthropic_model"),
        "scope_preview": _scope_preview("model.list", "model", {"limit": limit}),
    }


def config_show_result(ctx_obj: dict[str, Any]) -> dict[str, Any]:
    return config_snapshot(ctx_obj, probe=probe_runtime(ctx_obj))
