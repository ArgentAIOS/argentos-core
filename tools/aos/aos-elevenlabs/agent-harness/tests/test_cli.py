from __future__ import annotations

import json
from base64 import b64decode
from pathlib import Path
from typing import Any

from click.testing import CliRunner

from cli_aos.elevenlabs.cli import cli
import cli_aos.elevenlabs.runtime as runtime


AGENT_HARNESS_ROOT = Path(__file__).resolve().parents[1]
CONNECTOR_PATH = AGENT_HARNESS_ROOT.parent / "connector.json"
PERMISSIONS_PATH = AGENT_HARNESS_ROOT / "permissions.json"


class FakeElevenLabsClient:
    def read_user(self) -> dict[str, Any]:
        return {
            "user_id": "user_123",
            "first_name": "Agent",
            "subscription": {
                "tier": "starter",
                "character_count": 3500,
                "status": "active",
            },
        }

    def list_voices(
        self,
        *,
        page_size: int = 10,
        cursor: str | None = None,
        search: str | None = None,
    ) -> dict[str, Any]:
        voices = [
            {"voice_id": "voice_1", "name": "Rachel", "category": "professional", "preview_url": "https://example.test/1"},
            {"voice_id": "voice_2", "name": "Bella", "category": "generated", "preview_url": "https://example.test/2"},
        ]
        return {
            "voices": voices[:page_size],
            "has_more": False,
            "next_page_token": None,
            "total_count": len(voices),
        }

    def read_voice(self, voice_id: str) -> dict[str, Any]:
        return {"voice_id": voice_id, "name": "Rachel", "category": "professional"}

    def list_models(self) -> list[dict[str, Any]]:
        return [
            {"model_id": "eleven_multilingual_v2", "name": "Eleven Multilingual v2", "can_do_text_to_speech": True},
            {"model_id": "eleven_flash_v2_5", "name": "Eleven Flash v2.5", "can_do_text_to_speech": True},
        ]

    def list_history(
        self,
        *,
        page_size: int = 100,
        cursor: str | None = None,
        voice_id: str | None = None,
        model_id: str | None = None,
    ) -> dict[str, Any]:
        history = [
            {
                "history_item_id": "hist_1",
                "voice_id": voice_id or "voice_1",
                "voice_name": "Rachel",
                "model_id": model_id or "eleven_multilingual_v2",
                "content_type": "audio/mpeg",
            },
            {
                "history_item_id": "hist_2",
                "voice_id": "voice_2",
                "voice_name": "Bella",
                "model_id": "eleven_flash_v2_5",
                "content_type": "audio/mpeg",
            },
        ]
        return {
            "history": history[:page_size],
            "has_more": False,
            "last_history_item_id": None,
            "scanned_until": 1714650306,
        }

    def read_history_item(self, history_item_id: str) -> dict[str, Any]:
        return {"history_item_id": history_item_id, "voice_name": "Rachel", "model_id": "eleven_multilingual_v2"}

    def synthesize(
        self,
        text: str,
        *,
        voice_id: str,
        model_id: str | None = None,
        output_format: str = "mp3_44100_128",
    ) -> dict[str, Any]:
        audio = f"{voice_id}:{model_id or 'default'}:{text}:{output_format}".encode("utf-8")
        return {
            "audio": audio,
            "content_type": "audio/mpeg",
            "request_id": "req_fake",
            "character_count": len(text),
            "output_format": output_format,
            "voice_id": voice_id,
            "model_id": model_id,
            "request": {"method": "POST", "url": f"https://example.test/v1/text-to-speech/{voice_id}", "text_length": len(text)},
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
    assert manifest["scope"]["kind"] == "voice-generation"


def test_capabilities_exposes_manifest():
    payload = invoke_json(["capabilities"])
    assert payload["tool"] == "aos-elevenlabs"
    assert payload["data"]["backend"] == "elevenlabs-api"
    assert "voice.read" in json.dumps(payload["data"])
    assert payload["data"]["write_support"]["synthesize"] == "live"


def test_health_requires_api_key(monkeypatch):
    monkeypatch.delenv("ELEVENLABS_API_KEY", raising=False)
    payload = invoke_json(["health"])
    assert payload["data"]["status"] == "needs_setup"
    assert "ELEVENLABS_API_KEY" in json.dumps(payload["data"])


def test_health_ready_with_fake_client(monkeypatch):
    monkeypatch.setenv("ELEVENLABS_API_KEY", "abc123")
    monkeypatch.setenv("ELEVENLABS_BASE_URL", "https://example.test")
    monkeypatch.setattr(runtime, "create_client", lambda ctx_obj: FakeElevenLabsClient())
    payload = invoke_json(["health"])
    assert payload["data"]["status"] == "ready"
    assert payload["data"]["probe"]["ok"] is True
    assert payload["data"]["probe"]["details"]["user_id"] == "user_123"
    assert payload["data"]["connector"]["write_bridge_available"] is True


def test_config_show_redacts_api_key(monkeypatch):
    monkeypatch.setenv("ELEVENLABS_API_KEY", "super-secret-key")
    monkeypatch.setenv("ELEVENLABS_BASE_URL", "https://example.test")
    monkeypatch.setenv("ELEVENLABS_VOICE_ID", "voice_1")
    payload = invoke_json(["config", "show"])
    data = payload["data"]
    assert "super-secret-key" not in json.dumps(data)
    assert data["scope"]["voice_id"] == "voice_1"
    assert data["runtime"]["implementation_mode"] == "live_read_with_live_synthesis"
    assert data["runtime"]["write_bridge_available"] is True


def test_voice_list_returns_picker(monkeypatch):
    monkeypatch.setenv("ELEVENLABS_API_KEY", "abc123")
    monkeypatch.setattr(runtime, "create_client", lambda ctx_obj: FakeElevenLabsClient())
    payload = invoke_json(["voice", "list", "--page-size", "1"])
    data = payload["data"]
    assert data["voice_count"] == 1
    assert data["picker"]["kind"] == "voice"
    assert data["picker"]["items"][0]["id"] == "voice_1"


def test_voice_read_uses_scoped_voice(monkeypatch):
    monkeypatch.setenv("ELEVENLABS_API_KEY", "abc123")
    monkeypatch.setenv("ELEVENLABS_VOICE_ID", "voice_2")
    monkeypatch.setattr(runtime, "create_client", lambda ctx_obj: FakeElevenLabsClient())
    payload = invoke_json(["voice", "read"])
    assert payload["data"]["voice"]["voice_id"] == "voice_2"


def test_model_list_returns_models(monkeypatch):
    monkeypatch.setenv("ELEVENLABS_API_KEY", "abc123")
    monkeypatch.setattr(runtime, "create_client", lambda ctx_obj: FakeElevenLabsClient())
    payload = invoke_json(["model", "list"])
    data = payload["data"]
    assert data["model_count"] == 2
    assert data["picker"]["kind"] == "model"
    assert data["models"][0]["model_id"] == "eleven_multilingual_v2"


def test_history_list_uses_cursor_and_filters(monkeypatch):
    monkeypatch.setenv("ELEVENLABS_API_KEY", "abc123")
    monkeypatch.setenv("ELEVENLABS_MODEL_ID", "eleven_multilingual_v2")
    monkeypatch.setattr(runtime, "create_client", lambda ctx_obj: FakeElevenLabsClient())
    payload = invoke_json(["history", "list", "--page-size", "1", "--voice-id", "voice_2"])
    data = payload["data"]
    assert data["history_count"] == 1
    assert data["picker"]["kind"] == "history_item"
    assert data["scope_preview"]["model_id"] == "eleven_multilingual_v2"


def test_history_read_uses_scoped_history_item(monkeypatch):
    monkeypatch.setenv("ELEVENLABS_API_KEY", "abc123")
    monkeypatch.setenv("ELEVENLABS_HISTORY_ITEM_ID", "hist_2")
    monkeypatch.setattr(runtime, "create_client", lambda ctx_obj: FakeElevenLabsClient())
    payload = invoke_json(["history", "read"])
    assert payload["data"]["history_item"]["history_item_id"] == "hist_2"


def test_user_read_returns_subscription(monkeypatch):
    monkeypatch.setenv("ELEVENLABS_API_KEY", "abc123")
    monkeypatch.setattr(runtime, "create_client", lambda ctx_obj: FakeElevenLabsClient())
    payload = invoke_json(["user", "read"])
    assert payload["data"]["user"]["user_id"] == "user_123"
    assert payload["data"]["subscription"]["tier"] == "starter"


def test_synthesize_returns_inline_base64(monkeypatch):
    monkeypatch.setenv("ELEVENLABS_API_KEY", "abc123")
    monkeypatch.setattr(runtime, "create_client", lambda ctx_obj: FakeElevenLabsClient())
    payload = invoke_json_with_mode("write", ["synthesize", "Hello world", "--voice-id", "voice_1", "--model-id", "eleven_multilingual_v2"])
    data = payload["data"]
    assert data["status"] == "live_write"
    assert data["synthesis"]["voice_id"] == "voice_1"
    assert data["synthesis"]["model_id"] == "eleven_multilingual_v2"
    assert data["synthesis"]["output_reference"]["kind"] == "inline_base64"
    assert b64decode(data["synthesis"]["audio_base64"]).startswith(b"voice_1:eleven_multilingual_v2:Hello world")


def test_synthesize_can_write_output_file(monkeypatch, tmp_path):
    monkeypatch.setenv("ELEVENLABS_API_KEY", "abc123")
    monkeypatch.setattr(runtime, "create_client", lambda ctx_obj: FakeElevenLabsClient())
    output_path = tmp_path / "demo.mp3"
    result = CliRunner().invoke(
        cli,
        ["--json", "--mode", "write", "synthesize", "Hello world", "--voice-id", "voice_1", "--output", str(output_path)],
    )
    assert result.exit_code == 0, result.output
    payload = json.loads(result.output)
    data = payload["data"]["synthesis"]
    assert data["output_reference"]["kind"] == "file"
    assert data["output_reference"]["path"] == str(output_path)
    assert output_path.read_bytes().startswith(b"voice_1:default:Hello world")
