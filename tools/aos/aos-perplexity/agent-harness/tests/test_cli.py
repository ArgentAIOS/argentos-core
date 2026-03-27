from __future__ import annotations

import json
from pathlib import Path
from typing import Any

from click.testing import CliRunner

from cli_aos.perplexity.cli import cli
import cli_aos.perplexity.runtime as runtime


AGENT_HARNESS_ROOT = Path(__file__).resolve().parents[1]
CONNECTOR_PATH = AGENT_HARNESS_ROOT.parent / "connector.json"
PERMISSIONS_PATH = AGENT_HARNESS_ROOT / "permissions.json"


class FakePerplexityClient:
    def search_query(
        self,
        *,
        query: str,
        model: str | None = None,
        search_domain_filter: list[str] | None = None,
        max_results: int | None = None,
    ) -> dict[str, Any]:
        results = [
            {"title": "Perplexity API", "url": "https://docs.perplexity.ai", "snippet": "Official docs", "source": "docs.perplexity.ai"},
            {"title": "Search Domain Filters", "url": "https://docs.perplexity.ai/guides/search-domain-filters", "snippet": "Domain filtering", "source": "docs.perplexity.ai"},
        ]
        return {
            "query": query,
            "model": model,
            "search_domain_filter": search_domain_filter or [],
            "max_results": max_results,
            "answer": "Perplexity answers with citations.",
            "citations": ["https://docs.perplexity.ai"],
            "results": results[: (max_results or len(results))],
            "result_count": len(results[: (max_results or len(results))]),
            "raw": {"results": results},
        }

    def search_chat(
        self,
        *,
        query: str,
        model: str | None = None,
        search_domain_filter: list[str] | None = None,
        system_prompt: str | None = None,
        temperature: float | None = None,
        max_tokens: int | None = None,
    ) -> dict[str, Any]:
        return {
            "model": model,
            "search_domain_filter": search_domain_filter or [],
            "answer": f"Search chat response for: {query}",
            "citations": ["https://docs.perplexity.ai"],
            "usage": {"prompt_tokens": 10, "completion_tokens": 20},
        }

    def chat_complete(
        self,
        *,
        messages: list[dict[str, Any]],
        model: str | None = None,
        search_domain_filter: list[str] | None = None,
        temperature: float | None = None,
        max_tokens: int | None = None,
        system_prompt: str | None = None,
    ) -> dict[str, Any]:
        return {
            "model": model,
            "messages": messages,
            "search_domain_filter": search_domain_filter or [],
            "temperature": temperature,
            "max_tokens": max_tokens,
            "system_prompt": system_prompt,
            "answer": "Chat completion response.",
            "citations": ["https://docs.perplexity.ai"],
            "usage": {"prompt_tokens": 12, "completion_tokens": 18},
        }

    def chat_stream(
        self,
        *,
        messages: list[dict[str, Any]],
        model: str | None = None,
        search_domain_filter: list[str] | None = None,
        temperature: float | None = None,
        max_tokens: int | None = None,
        system_prompt: str | None = None,
    ) -> dict[str, Any]:
        return {
            "model": model,
            "messages": messages,
            "search_domain_filter": search_domain_filter or [],
            "temperature": temperature,
            "max_tokens": max_tokens,
            "system_prompt": system_prompt,
            "answer": "Streamed response.",
            "citations": ["https://docs.perplexity.ai"],
            "chunks": [{"text": "Streamed "}, {"text": "response."}],
        }


def invoke_json(args: list[str]) -> dict[str, Any]:
    result = CliRunner().invoke(cli, ["--json", *args])
    assert result.exit_code == 0, result.output
    return json.loads(result.output)


def invoke_json_with_mode(mode: str, args: list[str]) -> dict[str, Any]:
    result = CliRunner().invoke(cli, ["--json", "--mode", mode, *args])
    assert result.exit_code == 0, result.output
    return json.loads(result.output)


def test_manifest_and_permissions_are_in_sync():
    manifest = json.loads(CONNECTOR_PATH.read_text())
    permissions = json.loads(PERMISSIONS_PATH.read_text())["permissions"]
    command_ids = [command["id"] for command in manifest["commands"]]
    assert set(command_ids) == set(permissions.keys())
    assert manifest["scope"]["kind"] == "ai-search"


def test_capabilities_exposes_manifest():
    payload = invoke_json(["capabilities"])
    assert payload["tool"] == "aos-perplexity"
    assert payload["data"]["backend"] == "perplexity-api"
    assert "search.query" in json.dumps(payload["data"])
    assert "chat.stream" in json.dumps(payload["data"])


def test_health_requires_api_key(monkeypatch):
    monkeypatch.delenv("PERPLEXITY_API_KEY", raising=False)
    payload = invoke_json(["health"])
    assert payload["data"]["status"] == "needs_setup"
    assert "PERPLEXITY_API_KEY" in json.dumps(payload["data"])


def test_health_ready_with_fake_client(monkeypatch):
    monkeypatch.setenv("PERPLEXITY_API_KEY", "pplx-test")
    monkeypatch.setattr(runtime, "create_client", lambda ctx_obj: FakePerplexityClient())
    payload = invoke_json(["health"])
    assert payload["data"]["status"] == "ready"
    assert payload["data"]["probe"]["ok"] is True
    assert payload["data"]["probe"]["details"]["result_count"] == 1


def test_config_show_redacts_credentials(monkeypatch):
    monkeypatch.setenv("PERPLEXITY_API_KEY", "pplx-secret")
    monkeypatch.setenv("PERPLEXITY_MODEL", "llama-3.1-sonar-large-128k-online")
    monkeypatch.setenv("PERPLEXITY_SEARCH_DOMAIN", "docs.perplexity.ai")
    payload = invoke_json(["config", "show"])
    data = payload["data"]
    assert "pplx-secret" not in json.dumps(data)
    assert data["scope"]["model"] == "llama-3.1-sonar-large-128k-online"
    assert data["scope"]["search_domain_filter"] == ["docs.perplexity.ai"]


def test_search_query_returns_picker_metadata(monkeypatch):
    monkeypatch.setenv("PERPLEXITY_API_KEY", "pplx-test")
    monkeypatch.setattr(runtime, "create_client", lambda ctx_obj: FakePerplexityClient())
    payload = invoke_json(["search", "query", "what is perplexity?"])
    data = payload["data"]
    assert data["result_count"] == 2
    assert data["picker"]["kind"] == "search"
    assert data["scope_preview"]["command_id"] == "search.query"


def test_search_chat_returns_answer(monkeypatch):
    monkeypatch.setenv("PERPLEXITY_API_KEY", "pplx-test")
    monkeypatch.setattr(runtime, "create_client", lambda ctx_obj: FakePerplexityClient())
    payload = invoke_json(["search", "chat", "who built Perplexity?"])
    data = payload["data"]
    assert data["answer"].startswith("Search chat response")
    assert data["scope_preview"]["command_id"] == "search.chat"


def test_chat_complete_uses_message_payload(monkeypatch):
    monkeypatch.setenv("PERPLEXITY_API_KEY", "pplx-test")
    monkeypatch.setattr(runtime, "create_client", lambda ctx_obj: FakePerplexityClient())
    payload = invoke_json(["chat", "complete", "--prompt", "Explain Perplexity."])
    data = payload["data"]
    assert data["answer"] == "Chat completion response."
    assert data["messages"][0]["role"] == "user"
    assert data["scope_preview"]["command_id"] == "chat.complete"


def test_chat_stream_returns_chunks(monkeypatch):
    monkeypatch.setenv("PERPLEXITY_API_KEY", "pplx-test")
    monkeypatch.setattr(runtime, "create_client", lambda ctx_obj: FakePerplexityClient())
    payload = invoke_json(["chat", "stream", "--prompt", "Stream this."])
    data = payload["data"]
    assert data["answer"] == "Streamed response."
    assert len(data["chunks"]) == 2
    assert data["scope_preview"]["command_id"] == "chat.stream"
