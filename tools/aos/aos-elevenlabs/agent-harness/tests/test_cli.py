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
        stability: float | None = None,
        similarity_boost: float | None = None,
        style: float | None = None,
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

    def synthesize_stream(
        self,
        text: str,
        *,
        voice_id: str,
        model_id: str | None = None,
        output_format: str = "mp3_44100_128",
        stability: float | None = None,
        similarity_boost: float | None = None,
        style: float | None = None,
    ) -> dict[str, Any]:
        audio = f"stream:{voice_id}:{text}".encode("utf-8")
        return {
            "audio": audio,
            "content_type": "audio/mpeg",
            "request_id": "req_stream",
            "output_format": output_format,
            "voice_id": voice_id,
            "model_id": model_id,
            "chunk_count": 3,
            "request": {"method": "POST", "url": f"https://example.test/v1/text-to-speech/{voice_id}/stream", "text_length": len(text)},
        }

    def clone_voice(
        self,
        *,
        name: str,
        description: str | None = None,
        files: list[str],
    ) -> dict[str, Any]:
        return {"voice_id": "cloned_v1", "name": name}

    def generate_sound_effect(
        self,
        text: str,
        *,
        duration_seconds: float | None = None,
        prompt_influence: float | None = None,
    ) -> dict[str, Any]:
        audio = f"sfx:{text}".encode("utf-8")
        return {
            "audio": audio,
            "content_type": "audio/mpeg",
            "request_id": "req_sfx",
            "request": {"method": "POST", "url": "https://example.test/v1/sound-generation", "prompt_length": len(text)},
        }

    def isolate_audio(self, audio_data: bytes) -> dict[str, Any]:
        return {
            "audio": b"isolated:" + audio_data[:20],
            "content_type": "audio/mpeg",
            "request_id": "req_isolate",
            "request": {"method": "POST", "url": "https://example.test/v1/audio-isolation", "input_size_bytes": len(audio_data)},
        }

    def download_history_audio(self, history_item_id: str) -> dict[str, Any]:
        return {
            "audio": f"audio:{history_item_id}".encode("utf-8"),
            "content_type": "audio/mpeg",
            "history_item_id": history_item_id,
            "request": {"method": "GET", "url": f"https://example.test/v1/history/{history_item_id}/audio"},
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
    assert "voices.get" in json.dumps(payload["data"])
    assert payload["data"]["write_support"]["tts.generate"] == "live"
    assert payload["data"]["write_support"]["sfx.generate"] == "live"
    assert payload["data"]["write_support"]["audio.isolate"] == "live"
    assert payload["data"]["write_support"]["voices.clone"] == "live"


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
    assert data["runtime"]["implementation_mode"] == "live_read_with_live_write"
    assert data["runtime"]["write_bridge_available"] is True


def test_voices_list_returns_picker(monkeypatch):
    monkeypatch.setenv("ELEVENLABS_API_KEY", "abc123")
    monkeypatch.setattr(runtime, "create_client", lambda ctx_obj: FakeElevenLabsClient())
    payload = invoke_json(["voices", "list", "--page-size", "1"])
    data = payload["data"]
    assert data["voice_count"] == 1
    assert data["picker"]["kind"] == "voice"
    assert data["picker"]["items"][0]["id"] == "voice_1"


def test_voices_get_uses_scoped_voice(monkeypatch):
    monkeypatch.setenv("ELEVENLABS_API_KEY", "abc123")
    monkeypatch.setenv("ELEVENLABS_VOICE_ID", "voice_2")
    monkeypatch.setattr(runtime, "create_client", lambda ctx_obj: FakeElevenLabsClient())
    payload = invoke_json(["voices", "get"])
    assert payload["data"]["voice"]["voice_id"] == "voice_2"


def test_voices_clone_creates_voice(monkeypatch, tmp_path):
    monkeypatch.setenv("ELEVENLABS_API_KEY", "abc123")
    monkeypatch.setattr(runtime, "create_client", lambda ctx_obj: FakeElevenLabsClient())
    sample = tmp_path / "sample.mp3"
    sample.write_bytes(b"fake-audio")
    payload = invoke_json_with_mode("write", ["voices", "clone", "--name", "TestClone", "--file", str(sample)])
    data = payload["data"]
    assert data["status"] == "live_write"
    assert data["voice_id"] == "cloned_v1"
    assert data["clone"]["name"] == "TestClone"
    assert data["clone"]["sample_count"] == 1


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


def test_history_download_returns_audio(monkeypatch):
    monkeypatch.setenv("ELEVENLABS_API_KEY", "abc123")
    monkeypatch.setenv("ELEVENLABS_HISTORY_ITEM_ID", "hist_2")
    monkeypatch.setattr(runtime, "create_client", lambda ctx_obj: FakeElevenLabsClient())
    payload = invoke_json(["history", "download"])
    data = payload["data"]
    assert data["download"]["history_item_id"] == "hist_2"
    assert data["download"]["output_reference"]["kind"] == "inline_base64"
    assert b64decode(data["download"]["audio_base64"]) == b"audio:hist_2"


def test_history_download_to_file(monkeypatch, tmp_path):
    monkeypatch.setenv("ELEVENLABS_API_KEY", "abc123")
    monkeypatch.setattr(runtime, "create_client", lambda ctx_obj: FakeElevenLabsClient())
    output = tmp_path / "download.mp3"
    payload = invoke_json(["history", "download", "hist_1", "--output", str(output)])
    data = payload["data"]
    assert data["download"]["output_reference"]["kind"] == "file"
    assert output.read_bytes() == b"audio:hist_1"


def test_user_read_returns_subscription(monkeypatch):
    monkeypatch.setenv("ELEVENLABS_API_KEY", "abc123")
    monkeypatch.setattr(runtime, "create_client", lambda ctx_obj: FakeElevenLabsClient())
    payload = invoke_json(["user", "read"])
    assert payload["data"]["user"]["user_id"] == "user_123"
    assert payload["data"]["subscription"]["tier"] == "starter"


def test_tts_generate_returns_inline_base64(monkeypatch):
    monkeypatch.setenv("ELEVENLABS_API_KEY", "abc123")
    monkeypatch.setattr(runtime, "create_client", lambda ctx_obj: FakeElevenLabsClient())
    payload = invoke_json_with_mode("write", ["tts", "generate", "Hello world", "--voice-id", "voice_1", "--model-id", "eleven_multilingual_v2"])
    data = payload["data"]
    assert data["status"] == "live_write"
    assert data["synthesis"]["voice_id"] == "voice_1"
    assert data["synthesis"]["model_id"] == "eleven_multilingual_v2"
    assert data["synthesis"]["output_reference"]["kind"] == "inline_base64"
    assert b64decode(data["synthesis"]["audio_base64"]).startswith(b"voice_1:eleven_multilingual_v2:Hello world")


def test_tts_generate_can_write_output_file(monkeypatch, tmp_path):
    monkeypatch.setenv("ELEVENLABS_API_KEY", "abc123")
    monkeypatch.setattr(runtime, "create_client", lambda ctx_obj: FakeElevenLabsClient())
    output_path = tmp_path / "demo.mp3"
    result = CliRunner().invoke(
        cli,
        ["--json", "--mode", "write", "tts", "generate", "Hello world", "--voice-id", "voice_1", "--output", str(output_path)],
    )
    assert result.exit_code == 0, result.output
    payload = json.loads(result.output)
    data = payload["data"]["synthesis"]
    assert data["output_reference"]["kind"] == "file"
    assert data["output_reference"]["path"] == str(output_path)
    assert output_path.read_bytes().startswith(b"voice_1:default:Hello world")


def test_tts_stream_returns_chunk_count(monkeypatch):
    monkeypatch.setenv("ELEVENLABS_API_KEY", "abc123")
    monkeypatch.setattr(runtime, "create_client", lambda ctx_obj: FakeElevenLabsClient())
    payload = invoke_json_with_mode("write", ["tts", "stream", "Hello stream", "--voice-id", "voice_1"])
    data = payload["data"]
    assert data["status"] == "live_write"
    assert data["synthesis"]["chunk_count"] == 3
    assert b64decode(data["synthesis"]["audio_base64"]).startswith(b"stream:voice_1:")


def test_sfx_generate_returns_audio(monkeypatch):
    monkeypatch.setenv("ELEVENLABS_API_KEY", "abc123")
    monkeypatch.setattr(runtime, "create_client", lambda ctx_obj: FakeElevenLabsClient())
    payload = invoke_json_with_mode("write", ["sfx", "generate", "thunderstorm with rain"])
    data = payload["data"]
    assert data["status"] == "live_write"
    assert data["sfx"]["prompt"] == "thunderstorm with rain"
    assert data["sfx"]["output_reference"]["kind"] == "inline_base64"
    assert b64decode(data["sfx"]["audio_base64"]) == b"sfx:thunderstorm with rain"


def test_sfx_generate_to_file(monkeypatch, tmp_path):
    monkeypatch.setenv("ELEVENLABS_API_KEY", "abc123")
    monkeypatch.setattr(runtime, "create_client", lambda ctx_obj: FakeElevenLabsClient())
    output = tmp_path / "thunder.mp3"
    payload = invoke_json_with_mode("write", ["sfx", "generate", "thunder", "--output", str(output)])
    assert payload["data"]["sfx"]["output_reference"]["kind"] == "file"
    assert output.read_bytes() == b"sfx:thunder"


def test_audio_isolate_returns_cleaned_audio(monkeypatch, tmp_path):
    monkeypatch.setenv("ELEVENLABS_API_KEY", "abc123")
    monkeypatch.setattr(runtime, "create_client", lambda ctx_obj: FakeElevenLabsClient())
    input_file = tmp_path / "noisy.mp3"
    input_file.write_bytes(b"noisy-audio-content-here")
    payload = invoke_json_with_mode("write", ["audio", "isolate", str(input_file)])
    data = payload["data"]
    assert data["status"] == "live_write"
    assert data["isolation"]["input_path"] == str(input_file)
    assert data["isolation"]["output_reference"]["kind"] == "inline_base64"


def test_audio_isolate_to_file(monkeypatch, tmp_path):
    monkeypatch.setenv("ELEVENLABS_API_KEY", "abc123")
    monkeypatch.setattr(runtime, "create_client", lambda ctx_obj: FakeElevenLabsClient())
    input_file = tmp_path / "noisy.mp3"
    input_file.write_bytes(b"noisy-audio-data")
    output = tmp_path / "clean.mp3"
    payload = invoke_json_with_mode("write", ["audio", "isolate", str(input_file), "--output", str(output)])
    assert payload["data"]["isolation"]["output_reference"]["kind"] == "file"
    assert output.exists()
