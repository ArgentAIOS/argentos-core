from __future__ import annotations

import json
from pathlib import Path
from typing import Any

from click.testing import CliRunner

from cli_aos.openai.cli import cli
import cli_aos.openai.runtime as runtime


AGENT_HARNESS_ROOT = Path(__file__).resolve().parents[1]
CONNECTOR_PATH = AGENT_HARNESS_ROOT.parent / "connector.json"
PERMISSIONS_PATH = AGENT_HARNESS_ROOT / "permissions.json"


class FakeOpenAIClient:
    def list_models(self, *, limit: int = 50) -> dict[str, Any]:
        models = [
            {"id": "gpt-4o", "object": "model", "created": 1700000000, "owned_by": "openai"},
            {"id": "gpt-4o-mini", "object": "model", "created": 1700000001, "owned_by": "openai"},
        ]
        return {"models": models[:limit], "count": min(limit, len(models)), "raw": {"data": models}}

    def create_chat_completion(
        self,
        *,
        model: str,
        messages: list[dict[str, Any]],
        max_tokens: int | None = None,
        temperature: float | None = None,
    ) -> dict[str, Any]:
        return {
            "id": "chatcmpl_test_001",
            "object": "chat.completion",
            "created": 1700000100,
            "model": model,
            "choices": [
                {
                    "index": 0,
                    "finish_reason": "stop",
                    "role": "assistant",
                    "content": f"Echo: {messages[-1]['content']}",
                    "tool_calls": None,
                    "raw": {"message": {"role": "assistant", "content": f"Echo: {messages[-1]['content']}"}},
                }
            ],
            "usage": {"prompt_tokens": 5, "completion_tokens": 7, "total_tokens": 12},
            "raw": {},
            "request": {
                "max_tokens": max_tokens,
                "temperature": temperature,
            },
        }

    def create_embedding(self, *, model: str, input_text: str) -> dict[str, Any]:
        return {
            "model": model,
            "object": "list",
            "data": [{"object": "embedding", "embedding": [0.1, 0.2, 0.3], "index": 0}],
            "usage": {"prompt_tokens": len(input_text.split())},
            "embedding_count": 1,
            "dimensions": 3,
            "raw": {},
        }

    def generate_image(self, *, model: str, prompt: str, size: str | None = None) -> dict[str, Any]:
        return {
            "created": 1700000200,
            "images": [{"url": "https://example.com/image.png", "b64_json": None, "revised_prompt": prompt, "raw": {}}],
            "raw": {"size": size, "model": model},
        }

    def edit_image(self, *, model: str, image_file: str, prompt: str, size: str | None = None) -> dict[str, Any]:
        return {
            "created": 1700000201,
            "images": [{"url": "https://example.com/edited.png", "b64_json": None, "revised_prompt": prompt, "raw": {}}],
            "raw": {"image_file": image_file, "size": size, "model": model},
        }

    def transcribe_audio(self, *, model: str, audio_file: str) -> dict[str, Any]:
        return {"text": "hello world", "model": model, "audio_file": audio_file}

    def synthesize_speech(self, *, model: str, voice: str, input_text: str) -> dict[str, Any]:
        return {"format": "mp3", "content_type": "audio/mpeg", "bytes_count": 12, "audio_base64": "dGVzdA=="}

    def check_moderation(self, *, model: str, input_text: str) -> dict[str, Any]:
        return {
            "id": "modr_test_001",
            "model": model,
            "flagged": False,
            "results": [{"flagged": False, "categories": {"violence": False}}],
            "raw": {"input": input_text},
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
    assert payload["tool"] == "aos-openai"
    assert payload["data"]["backend"] == "openai-api"
    assert "chat.complete" in json.dumps(payload["data"])
    assert "image.generate" in json.dumps(payload["data"])
    assert "audio.transcribe" in json.dumps(payload["data"])


def test_health_requires_credentials(monkeypatch):
    monkeypatch.delenv("OPENAI_API_KEY", raising=False)
    payload = invoke_json(["health"])
    assert payload["data"]["status"] == "needs_setup"
    assert "OPENAI_API_KEY" in json.dumps(payload["data"])


def test_health_ready_with_fake_client(monkeypatch):
    monkeypatch.setenv("OPENAI_API_KEY", "sk-test-123")
    monkeypatch.setattr(runtime, "create_client", lambda ctx_obj: FakeOpenAIClient())
    payload = invoke_json(["health"])
    assert payload["data"]["status"] == "ready"
    assert payload["data"]["probe"]["ok"] is True
    assert payload["data"]["probe"]["details"]["model_count"] == 2


def test_config_show_redacts_credentials(monkeypatch):
    monkeypatch.setenv("OPENAI_API_KEY", "sk-super-secret")
    monkeypatch.setenv("OPENAI_ORG_ID", "org-secret")
    monkeypatch.setenv("OPENAI_PROJECT_ID", "proj-secret")
    monkeypatch.setattr(runtime, "create_client", lambda ctx_obj: FakeOpenAIClient())
    payload = invoke_json(["config", "show"])
    data = payload["data"]
    assert "sk-super-secret" not in json.dumps(data)
    assert "org-secret" not in json.dumps(data)
    assert "proj-secret" not in json.dumps(data)
    assert data["auth"]["api_key_present"] is True
    assert data["runtime"]["implementation_mode"] == "live_read_write"


def test_chat_complete_requires_write_mode(monkeypatch):
    monkeypatch.setenv("OPENAI_API_KEY", "sk-test-123")
    monkeypatch.setattr(runtime, "create_client", lambda ctx_obj: FakeOpenAIClient())
    result = CliRunner().invoke(cli, ["--json", "--mode", "readonly", "chat", "complete", "--prompt", "Hello"])
    payload = json.loads(result.output)
    assert payload["ok"] is False
    assert payload["error"]["code"] == "PERMISSION_DENIED"


def test_chat_complete_succeeds_in_write_mode(monkeypatch):
    monkeypatch.setenv("OPENAI_API_KEY", "sk-test-123")
    monkeypatch.setattr(runtime, "create_client", lambda ctx_obj: FakeOpenAIClient())
    payload = invoke_json_with_mode("write", ["chat", "complete", "--prompt", "Hello test"])
    assert payload["data"]["status"] == "live_write"
    assert payload["data"]["completion"]["id"] == "chatcmpl_test_001"
    assert payload["data"]["scope_preview"]["command_id"] == "chat.complete"


def test_moderation_check_returns_read_payload(monkeypatch):
    monkeypatch.setenv("OPENAI_API_KEY", "sk-test-123")
    monkeypatch.setattr(runtime, "create_client", lambda ctx_obj: FakeOpenAIClient())
    payload = invoke_json(["moderation", "check", "--prompt", "safe text"])
    assert payload["data"]["status"] == "live_read"
    assert payload["data"]["moderation"]["flagged"] is False


def test_model_list_returns_picker_metadata(monkeypatch):
    monkeypatch.setenv("OPENAI_API_KEY", "sk-test-123")
    monkeypatch.setattr(runtime, "create_client", lambda ctx_obj: FakeOpenAIClient())
    payload = invoke_json(["model", "list", "--limit", "1"])
    assert payload["data"]["models"]["count"] == 1
    assert payload["data"]["picker"]["kind"] == "openai_model"
    assert payload["data"]["scope_preview"]["command_id"] == "model.list"
