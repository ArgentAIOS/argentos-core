from __future__ import annotations

import json
from pathlib import Path
from typing import Any

from click.testing import CliRunner

from cli_aos.anthropic.cli import cli
import cli_aos.anthropic.runtime as runtime


AGENT_HARNESS_ROOT = Path(__file__).resolve().parents[1]
CONNECTOR_PATH = AGENT_HARNESS_ROOT.parent / "connector.json"
PERMISSIONS_PATH = AGENT_HARNESS_ROOT / "permissions.json"
MESSAGES_JSON = '[{"role":"user","content":[{"type":"text","text":"Hello"}]}]'


class FakeAnthropicClient:
    def list_models(self, *, limit: int = 50) -> dict[str, Any]:
        models = [
            {"id": "claude-sonnet-4-20250514", "display_name": "Claude Sonnet 4", "type": "model", "created_at": "2025-05-14T00:00:00Z"},
            {"id": "claude-opus-4-20250514", "display_name": "Claude Opus 4", "type": "model", "created_at": "2025-05-14T00:00:00Z"},
        ]
        return {"models": models[:limit], "count": min(limit, len(models)), "raw": {"data": models}}

    def create_message(
        self,
        *,
        model: str,
        messages: list[dict[str, Any]],
        max_tokens: int,
        system_prompt: str | None = None,
        temperature: float | None = None,
        thinking_budget: int | None = None,
    ) -> dict[str, Any]:
        return {
            "id": "msg_test_001",
            "type": "message",
            "role": "assistant",
            "model": model,
            "stop_reason": "end_turn",
            "stop_sequence": None,
            "usage": {"input_tokens": 10, "output_tokens": 5},
            "text": "Hello from Claude",
            "content": [{"type": "text", "text": "Hello from Claude"}],
            "raw": {
                "messages": messages,
                "max_tokens": max_tokens,
                "system_prompt": system_prompt,
                "temperature": temperature,
                "thinking_budget": thinking_budget,
            },
        }

    def stream_message(
        self,
        *,
        model: str,
        messages: list[dict[str, Any]],
        max_tokens: int,
        system_prompt: str | None = None,
        temperature: float | None = None,
        thinking_budget: int | None = None,
    ) -> dict[str, Any]:
        return {
            "events": [
                {"event": "message_start", "data": {"type": "message_start"}},
                {"event": "content_block_delta", "data": {"delta": {"type": "text_delta", "text": "Hello "}}},
                {"event": "content_block_delta", "data": {"delta": {"type": "text_delta", "text": "stream"}}},
                {"event": "message_stop", "data": {"type": "message_stop"}},
            ],
            "event_count": 4,
            "text": "Hello stream",
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
    assert manifest["scope"]["kind"] == "ai-api"


def test_capabilities_exposes_manifest():
    payload = invoke_json(["capabilities"])
    assert payload["tool"] == "aos-anthropic"
    assert payload["data"]["backend"] == "anthropic-api"
    assert "message.create" in json.dumps(payload["data"])
    assert "message.stream" in json.dumps(payload["data"])
    assert "model.list" in json.dumps(payload["data"])


def test_health_requires_credentials(monkeypatch):
    monkeypatch.delenv("ANTHROPIC_API_KEY", raising=False)
    payload = invoke_json(["health"])
    assert payload["data"]["status"] == "needs_setup"
    assert "ANTHROPIC_API_KEY" in json.dumps(payload["data"])


def test_health_ready_with_fake_client(monkeypatch):
    monkeypatch.setenv("ANTHROPIC_API_KEY", "test-key")
    monkeypatch.setattr(runtime, "create_client", lambda ctx_obj: FakeAnthropicClient())
    payload = invoke_json(["health"])
    assert payload["data"]["status"] == "ready"
    assert payload["data"]["probe"]["ok"] is True
    assert payload["data"]["probe"]["details"]["model_count"] == 2


def test_config_show_redacts_credentials(monkeypatch):
    monkeypatch.setenv("ANTHROPIC_API_KEY", "sk-secret-value")
    monkeypatch.setattr(runtime, "create_client", lambda ctx_obj: FakeAnthropicClient())
    payload = invoke_json(["config", "show"])
    data = payload["data"]
    assert "sk-secret-value" not in json.dumps(data)
    assert data["auth"]["api_key_present"] is True
    assert data["runtime"]["implementation_mode"] == "live_read_write"


def test_message_create_requires_write_mode(monkeypatch):
    monkeypatch.setenv("ANTHROPIC_API_KEY", "test-key")
    monkeypatch.setattr(runtime, "create_client", lambda ctx_obj: FakeAnthropicClient())
    result = CliRunner().invoke(cli, ["--json", "--mode", "readonly", "message", "create", "--messages-json", MESSAGES_JSON])
    payload = json.loads(result.output)
    assert payload["ok"] is False
    assert payload["error"]["code"] == "PERMISSION_DENIED"


def test_message_create_succeeds_in_write_mode(monkeypatch):
    monkeypatch.setenv("ANTHROPIC_API_KEY", "test-key")
    monkeypatch.setattr(runtime, "create_client", lambda ctx_obj: FakeAnthropicClient())
    payload = invoke_json_with_mode("write", ["message", "create", "--messages-json", MESSAGES_JSON])
    assert payload["data"]["status"] == "live_write"
    assert payload["data"]["message"]["id"] == "msg_test_001"
    assert payload["data"]["scope_preview"]["command_id"] == "message.create"


def test_message_stream_returns_sse_payload(monkeypatch):
    monkeypatch.setenv("ANTHROPIC_API_KEY", "test-key")
    monkeypatch.setattr(runtime, "create_client", lambda ctx_obj: FakeAnthropicClient())
    payload = invoke_json_with_mode("write", ["message", "stream", "--messages-json", MESSAGES_JSON])
    assert payload["data"]["stream"]["event_count"] == 4
    assert payload["data"]["stream"]["text"] == "Hello stream"


def test_model_list_returns_picker_metadata(monkeypatch):
    monkeypatch.setenv("ANTHROPIC_API_KEY", "test-key")
    monkeypatch.setattr(runtime, "create_client", lambda ctx_obj: FakeAnthropicClient())
    payload = invoke_json(["model", "list", "--limit", "1"])
    assert payload["data"]["models"]["count"] == 1
    assert payload["data"]["picker"]["kind"] == "anthropic_model"
    assert payload["data"]["scope_preview"]["command_id"] == "model.list"
