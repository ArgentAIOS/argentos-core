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
        self._pos = 0
        self.headers = FakeHeaders({key.lower(): value for key, value in (headers or {}).items()})

    def __enter__(self) -> "FakeResponse":
        return self

    def __exit__(self, exc_type, exc, tb) -> bool:
        return False

    def read(self, size: int = -1) -> bytes:
        if size == -1:
            data = self._payload[self._pos:]
            self._pos = len(self._payload)
            return data
        data = self._payload[self._pos:self._pos + size]
        self._pos += size
        return data


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


def test_client_synthesize_with_voice_settings(monkeypatch):
    captured: dict[str, Any] = {}

    def fake_urlopen(request, timeout=90):
        captured["body"] = json.loads(request.data.decode("utf-8"))
        return FakeResponse(b"audio", headers={"Content-Type": "audio/mpeg"})

    monkeypatch.setattr(client_module, "urlopen", fake_urlopen)
    client = ElevenLabsClient(api_key="key", base_url="https://example.test")
    client.synthesize("Hi", voice_id="v1", stability=0.8, similarity_boost=0.6, style=0.3)
    assert captured["body"]["voice_settings"] == {"stability": 0.8, "similarity_boost": 0.6, "style": 0.3}


def test_client_synthesize_stream_uses_stream_endpoint(monkeypatch):
    captured: dict[str, Any] = {}
    audio_bytes = b"streamed-audio-data"

    def fake_urlopen(request, timeout=120):
        captured["url"] = request.full_url
        captured["body"] = json.loads(request.data.decode("utf-8"))
        return FakeResponse(audio_bytes, headers={"Content-Type": "audio/mpeg"})

    monkeypatch.setattr(client_module, "urlopen", fake_urlopen)
    client = ElevenLabsClient(api_key="key", base_url="https://example.test")
    payload = client.synthesize_stream("Hello stream", voice_id="voice_1")
    assert "/stream" in captured["url"]
    assert payload["audio"] == audio_bytes
    assert payload["chunk_count"] >= 1


def test_client_generate_sound_effect(monkeypatch):
    captured: dict[str, Any] = {}

    def fake_urlopen(request, timeout=120):
        captured["url"] = request.full_url
        captured["body"] = json.loads(request.data.decode("utf-8"))
        return FakeResponse(b"sfx-audio", headers={"Content-Type": "audio/mpeg"})

    monkeypatch.setattr(client_module, "urlopen", fake_urlopen)
    client = ElevenLabsClient(api_key="key", base_url="https://example.test")
    payload = client.generate_sound_effect("thunderstorm", duration_seconds=5.0)
    assert "/v1/sound-generation" in captured["url"]
    assert captured["body"]["text"] == "thunderstorm"
    assert captured["body"]["duration_seconds"] == 5.0
    assert payload["audio"] == b"sfx-audio"


def test_client_isolate_audio(monkeypatch):
    captured: dict[str, Any] = {}

    def fake_urlopen(request, timeout=120):
        captured["url"] = request.full_url
        captured["content_type"] = dict(request.header_items()).get("Content-type", "")
        return FakeResponse(b"isolated-audio", headers={"Content-Type": "audio/mpeg"})

    monkeypatch.setattr(client_module, "urlopen", fake_urlopen)
    client = ElevenLabsClient(api_key="key", base_url="https://example.test")
    payload = client.isolate_audio(b"noisy-audio")
    assert "/v1/audio-isolation" in captured["url"]
    assert "multipart/form-data" in captured["content_type"]
    assert payload["audio"] == b"isolated-audio"


def test_client_download_history_audio(monkeypatch):
    captured: dict[str, Any] = {}

    def fake_urlopen(request, timeout=90):
        captured["url"] = request.full_url
        captured["method"] = request.method
        return FakeResponse(b"history-audio", headers={"Content-Type": "audio/mpeg"})

    monkeypatch.setattr(client_module, "urlopen", fake_urlopen)
    client = ElevenLabsClient(api_key="key", base_url="https://example.test")
    payload = client.download_history_audio("hist_abc")
    assert "/v1/history/hist_abc/audio" in captured["url"]
    assert captured["method"] == "GET"
    assert payload["audio"] == b"history-audio"
    assert payload["history_item_id"] == "hist_abc"


def test_client_clone_voice(monkeypatch, tmp_path):
    captured: dict[str, Any] = {}
    sample = tmp_path / "sample.mp3"
    sample.write_bytes(b"fake-audio-sample")

    def fake_urlopen(request, timeout=120):
        captured["url"] = request.full_url
        captured["content_type"] = dict(request.header_items()).get("Content-type", "")
        captured["body"] = request.data
        return FakeResponse(b'{"voice_id":"cloned_v1"}')

    monkeypatch.setattr(client_module, "urlopen", fake_urlopen)
    client = ElevenLabsClient(api_key="key", base_url="https://example.test")
    payload = client.clone_voice(name="My Clone", description="Test clone", files=[str(sample)])
    assert "/v1/voices/add" in captured["url"]
    assert "multipart/form-data" in captured["content_type"]
    assert payload["voice_id"] == "cloned_v1"
