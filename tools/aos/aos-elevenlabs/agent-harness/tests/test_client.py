from __future__ import annotations

import json
from typing import Any

import cli_aos.elevenlabs.client as client_module
from cli_aos.elevenlabs.client import ElevenLabsClient


class FakeHeaders(dict[str, str]):
    def get_content_type(self) -> str:
        return self.get("content-type", "application/octet-stream")


class FakeResponse:
    def __init__(self, payload: bytes, *, headers: dict[str, str] | None = None) -> None:
        self._payload = payload
        self.headers = FakeHeaders({key.lower(): value for key, value in (headers or {}).items()})

    def __enter__(self) -> "FakeResponse":
        return self

    def __exit__(self, exc_type, exc, tb) -> bool:
        return False

    def read(self) -> bytes:
        return self._payload


def test_client_uses_base_url_and_api_key_header(monkeypatch):
    captured: dict[str, Any] = {}

    def fake_urlopen(request, timeout=30):
        captured["url"] = request.full_url
        captured["headers"] = {key.lower(): value for key, value in request.header_items()}
        return FakeResponse(b'{"user_id":"user_123","subscription":{"tier":"starter","status":"active"}}')

    monkeypatch.setattr(client_module, "urlopen", fake_urlopen)
    client = ElevenLabsClient(api_key="secret-key", base_url="https://example.test")
    payload = client.read_user()
    assert captured["url"] == "https://example.test/v1/user"
    assert captured["headers"]["xi-api-key"] == "secret-key"
    assert captured["headers"]["accept"] == "application/json"
    assert payload["user_id"] == "user_123"


def test_client_builds_v2_voice_list_url(monkeypatch):
    captured: dict[str, Any] = {}

    def fake_urlopen(request, timeout=30):
        captured["url"] = request.full_url
        return FakeResponse(b'{"voices":[{"voice_id":"voice_1","name":"Rachel"}],"has_more":false}')

    monkeypatch.setattr(client_module, "urlopen", fake_urlopen)
    client = ElevenLabsClient(api_key="secret-key", base_url="https://example.test")
    payload = client.list_voices(page_size=2)
    assert captured["url"] == "https://example.test/v2/voices?page_size=2"
    assert payload["voices"][0]["voice_id"] == "voice_1"


def test_client_synthesize_posts_binary_audio(monkeypatch):
    captured: dict[str, Any] = {}
    audio_bytes = b"fake-mp3-audio"

    def fake_urlopen(request, timeout=90):
        captured["url"] = request.full_url
        captured["body"] = json.loads(request.data.decode("utf-8"))
        captured["headers"] = {key.lower(): value for key, value in request.header_items()}
        return FakeResponse(
            audio_bytes,
            headers={
                "Content-Type": "audio/mpeg",
                "X-Request-Id": "req_123",
                "X-Character-Count": "13",
            },
        )

    monkeypatch.setattr(client_module, "urlopen", fake_urlopen)
    client = ElevenLabsClient(api_key="secret-key", base_url="https://example.test")
    payload = client.synthesize("Hello world", voice_id="voice_1", model_id="eleven_multilingual_v2")
    assert captured["url"] == "https://example.test/v1/text-to-speech/voice_1?output_format=mp3_44100_128"
    assert captured["body"] == {"text": "Hello world", "model_id": "eleven_multilingual_v2"}
    assert captured["headers"]["xi-api-key"] == "secret-key"
    assert captured["headers"]["accept"] == "audio/mpeg"
    assert payload["audio"] == audio_bytes
    assert payload["content_type"] == "audio/mpeg"
    assert payload["request_id"] == "req_123"
    assert payload["character_count"] == 13
