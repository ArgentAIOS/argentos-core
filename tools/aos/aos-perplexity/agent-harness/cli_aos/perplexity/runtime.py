from __future__ import annotations

import json
from typing import Any

from .client import PerplexityApiError, PerplexityClient
from .config import config_snapshot, resolve_runtime_values
from .constants import BACKEND_NAME, CONNECTOR_PATH
from .errors import CliError


def _load_manifest() -> dict[str, Any]:
    return json.loads(CONNECTOR_PATH.read_text())


def _picker(items: list[dict[str, Any]], *, kind: str, label_key: str = "label") -> dict[str, Any]:
    return {"kind": kind, "items": items, "count": len(items), "label_key": label_key}


def _scope_preview(command_id: str, surface: str, extra: dict[str, Any] | None = None) -> dict[str, Any]:
    preview = {"selection_surface": surface, "command_id": command_id, "backend": BACKEND_NAME}
    if extra:
        preview.update(extra)
    return preview


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
            code="PERPLEXITY_MESSAGES_JSON_INVALID",
            message="messages_json must be valid JSON",
            exit_code=4,
            details={"error": str(err)},
        ) from err
    if not isinstance(payload, list):
        raise CliError(
            code="PERPLEXITY_MESSAGES_JSON_INVALID",
            message="messages_json must decode to a JSON array",
            exit_code=4,
            details={"type": type(payload).__name__},
        )
    if not all(isinstance(item, dict) for item in payload):
        raise CliError(
            code="PERPLEXITY_MESSAGES_JSON_INVALID",
            message="messages_json must contain objects",
            exit_code=4,
            details={},
        )
    return payload


def capabilities_snapshot() -> dict[str, Any]:
    manifest = _load_manifest()
    read_support = {}
    for command in manifest["commands"]:
        read_support[command["id"]] = command["required_mode"] == "readonly"
    return {
        "tool": manifest["tool"],
        "backend": manifest["backend"],
        "manifest_schema_version": manifest.get("manifest_schema_version", "1.0.0"),
        "connector": manifest["connector"],
        "auth": manifest["auth"],
        "scope": manifest.get("scope", {}),
        "commands": manifest["commands"],
        "read_support": read_support,
        "write_support": {},
    }


def create_client(ctx_obj: dict[str, Any]) -> PerplexityClient:
    runtime = resolve_runtime_values(ctx_obj)
    if not runtime["api_key_present"]:
        raise CliError(
            code="PERPLEXITY_SETUP_REQUIRED",
            message="Perplexity connector is missing the required API key",
            exit_code=4,
            details={"missing_keys": [runtime["api_key_env"]]},
        )
    return PerplexityClient(api_key=runtime["api_key"], base_url=runtime["base_url"])


def probe_runtime(ctx_obj: dict[str, Any]) -> dict[str, Any]:
    runtime = resolve_runtime_values(ctx_obj)
    if not runtime["api_key_present"]:
        return {
            "ok": False,
            "code": "PERPLEXITY_SETUP_REQUIRED",
            "message": "Perplexity connector is missing the required API key",
            "details": {"missing_keys": [runtime["api_key_env"]], "live_backend_available": False},
        }
    try:
        client = create_client(ctx_obj)
        probe_query = "Perplexity connector health check"
        search = client.search_query(
            query=probe_query,
            model=runtime["model"],
            search_domain_filter=runtime["search_domain_filter"] or None,
            max_results=1,
        )
    except CliError as err:
        return {"ok": False, "code": err.code, "message": err.message, "details": err.details}
    except PerplexityApiError as err:
        code = "PERPLEXITY_AUTH_FAILED" if err.status_code in {401, 403} else "PERPLEXITY_API_ERROR"
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
        "message": "Perplexity live runtime is ready",
        "details": {
            "live_backend_available": True,
            "result_count": search["result_count"],
            "sample_result_titles": [
                item["title"]
                for item in search["results"][:3]
                if isinstance(item, dict) and item.get("title")
            ],
        },
    }


def health_snapshot(ctx_obj: dict[str, Any]) -> dict[str, Any]:
    runtime = resolve_runtime_values(ctx_obj)
    probe = probe_runtime(ctx_obj)
    status = "ready" if probe["ok"] else ("needs_setup" if probe["code"] == "PERPLEXITY_SETUP_REQUIRED" else "degraded")
    return {
        "status": status,
        "summary": probe["message"],
        "connector": {
            "backend": BACKEND_NAME,
            "live_backend_available": bool(probe.get("ok")),
            "live_read_available": bool(probe.get("ok")),
            "write_bridge_available": False,
            "scaffold_only": False,
        },
        "auth": {
            "api_key_env": runtime["api_key_env"],
            "api_key_present": runtime["api_key_present"],
        },
        "scope": {
            "base_url": runtime["base_url"],
            "default_model": runtime["model"],
            "search_domain_filter": runtime["search_domain_filter"] or None,
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
        "write_bridge_available": False,
        "scaffold_only": False,
        "probe": probe,
        "next_steps": [
            f"Set {runtime['api_key_env']} in API Keys.",
            f"Optionally set {runtime['model_env']} and {runtime['search_domain_env']} to tune search behavior.",
            "Use search.query to confirm the API returns citations and answer text.",
        ],
    }


def doctor_snapshot(ctx_obj: dict[str, Any]) -> dict[str, Any]:
    runtime = resolve_runtime_values(ctx_obj)
    probe = probe_runtime(ctx_obj)
    ready = bool(probe.get("ok"))
    return {
        "status": "ready" if ready else ("needs_setup" if probe.get("code") == "PERPLEXITY_SETUP_REQUIRED" else "degraded"),
        "summary": "Perplexity connector diagnostics.",
        "runtime": {
            "implementation_mode": "live_read_only",
            "command_readiness": {
                "search.query": ready,
                "search.chat": ready,
                "chat.complete": ready,
                "chat.stream": ready,
            },
            "default_model": runtime["model"],
            "search_domain_filter": runtime["search_domain_filter"],
        },
        "checks": [
            {"name": "required_env", "ok": runtime["api_key_present"]},
            {"name": "live_backend", "ok": ready, "details": probe.get("details", {})},
        ],
        "supported_read_commands": [
            "search.query",
            "search.chat",
            "chat.complete",
            "chat.stream",
        ],
        "supported_write_commands": [],
        "next_steps": [
            f"Set {runtime['api_key_env']} to enable live Perplexity calls.",
            "Set PERPLEXITY_SEARCH_DOMAIN if you want domain-scoped search defaults.",
        ],
    }


def config_show_result(ctx_obj: dict[str, Any]) -> dict[str, Any]:
    return config_snapshot(ctx_obj, probe=probe_runtime(ctx_obj))


def search_query_result(
    ctx_obj: dict[str, Any],
    *,
    query: str,
    model: str | None,
    search_domains: list[str],
    max_results: int | None,
) -> dict[str, Any]:
    client = create_client(ctx_obj)
    runtime = resolve_runtime_values(ctx_obj)
    result = client.search_query(
        query=query,
        model=model or runtime["model"],
        search_domain_filter=search_domains or runtime["search_domain_filter"],
        max_results=max_results,
    )
    picker_items = [
        {
            "value": item.get("url") or item.get("title") or str(index),
            "label": item.get("title") or item.get("url") or f"Result {index + 1}",
            "subtitle": item.get("source"),
            "selected": False,
        }
        for index, item in enumerate(result["results"])
        if isinstance(item, dict)
    ]
    return {
        "status": "live_read",
        "backend": BACKEND_NAME,
        "summary": f"Returned {result['result_count']} Perplexity search result(s).",
        "query": query,
        "model": result["model"],
        "search_domain_filter": result["search_domain_filter"],
        "answer": result["answer"],
        "citations": result["citations"],
        "results": result["results"],
        "result_count": result["result_count"],
        "picker": _picker(picker_items, kind="search"),
        "scope_preview": _scope_preview(
            "search.query",
            "search",
            {
                "query": query,
                "model": result["model"],
                "search_domain_filter": result["search_domain_filter"],
                "max_results": max_results,
            },
        ),
    }


def search_chat_result(
    ctx_obj: dict[str, Any],
    *,
    query: str,
    model: str | None,
    search_domains: list[str],
    system_prompt: str | None,
    temperature: float | None,
    max_tokens: int | None,
) -> dict[str, Any]:
    client = create_client(ctx_obj)
    runtime = resolve_runtime_values(ctx_obj)
    result = client.search_chat(
        query=query,
        model=model or runtime["model"],
        search_domain_filter=search_domains or runtime["search_domain_filter"],
        system_prompt=system_prompt,
        temperature=temperature,
        max_tokens=max_tokens,
    )
    return {
        "status": "live_read",
        "backend": BACKEND_NAME,
        "summary": "Perplexity conversational search completed.",
        "query": query,
        "model": result["model"],
        "search_domain_filter": result["search_domain_filter"],
        "answer": result["answer"],
        "citations": result["citations"],
        "usage": result["usage"],
        "scope_preview": _scope_preview(
            "search.chat",
            "search",
            {
                "query": query,
                "model": result["model"],
                "search_domain_filter": result["search_domain_filter"],
            },
        ),
    }


def _build_messages(
    *,
    prompt: str | None,
    messages_json: str | None,
    system_prompt: str | None,
) -> list[dict[str, Any]]:
    messages = _parse_messages_json(messages_json)
    if messages is None:
        if prompt is None or not prompt.strip():
            raise CliError(
                code="PERPLEXITY_PROMPT_REQUIRED",
                message="prompt or messages_json is required",
                exit_code=4,
                details={},
            )
        messages = [{"role": "user", "content": prompt}]
    if system_prompt:
        has_system = any(message.get("role") == "system" for message in messages)
        if not has_system:
            messages = [{"role": "system", "content": system_prompt}, *messages]
    return messages


def chat_complete_result(
    ctx_obj: dict[str, Any],
    *,
    model: str | None,
    prompt: str | None,
    messages_json: str | None,
    system_prompt: str | None,
    temperature: float | None,
    max_tokens: int | None,
    search_domains: list[str],
) -> dict[str, Any]:
    runtime = resolve_runtime_values(ctx_obj)
    client = create_client(ctx_obj)
    messages = _build_messages(prompt=prompt, messages_json=messages_json, system_prompt=system_prompt)
    result = client.chat_complete(
        messages=messages,
        model=model or runtime["model"],
        search_domain_filter=search_domains or runtime["search_domain_filter"],
        temperature=temperature,
        max_tokens=max_tokens,
        system_prompt=system_prompt,
    )
    return {
        "status": "live_read",
        "backend": BACKEND_NAME,
        "summary": "Perplexity chat completion completed.",
        "model": result["model"],
        "messages": messages,
        "search_domain_filter": result["search_domain_filter"],
        "answer": result["answer"],
        "citations": result["citations"],
        "usage": result["usage"],
        "scope_preview": _scope_preview(
            "chat.complete",
            "chat",
            {"model": result["model"], "search_domain_filter": result["search_domain_filter"]},
        ),
    }


def chat_stream_result(
    ctx_obj: dict[str, Any],
    *,
    model: str | None,
    prompt: str | None,
    messages_json: str | None,
    system_prompt: str | None,
    temperature: float | None,
    max_tokens: int | None,
    search_domains: list[str],
) -> dict[str, Any]:
    runtime = resolve_runtime_values(ctx_obj)
    client = create_client(ctx_obj)
    messages = _build_messages(prompt=prompt, messages_json=messages_json, system_prompt=system_prompt)
    result = client.chat_stream(
        messages=messages,
        model=model or runtime["model"],
        search_domain_filter=search_domains or runtime["search_domain_filter"],
        temperature=temperature,
        max_tokens=max_tokens,
        system_prompt=system_prompt,
    )
    return {
        "status": "live_read",
        "backend": BACKEND_NAME,
        "summary": "Perplexity chat streamed successfully.",
        "model": result["model"],
        "messages": messages,
        "search_domain_filter": result["search_domain_filter"],
        "answer": result["answer"],
        "citations": result["citations"],
        "chunks": result["chunks"],
        "scope_preview": _scope_preview(
            "chat.stream",
            "chat",
            {"model": result["model"], "search_domain_filter": result["search_domain_filter"]},
        ),
    }
