from __future__ import annotations

from typing import Any

from cli_aos.buffer.client import BufferClient


class FakeResponse:
    def __init__(self, data: Any, status: int = 200):
        self._data = data
        self.status = status
        self.headers = {"Content-Type": "application/json"}

    def read(self) -> bytes:
        import json

        return json.dumps(self._data).encode("utf-8")

    def __enter__(self):
        return self

    def __exit__(self, exc_type, exc, tb):
        return False


class FakeURLLib:
    def __init__(self):
        self.requests: list[dict[str, Any]] = []

    def __call__(self, request, timeout=None):
        url = request.full_url
        self.requests.append({"url": url, "method": request.method, "headers": dict(request.headers), "timeout": timeout})
        if url.endswith("/user.json"):
            return FakeResponse({"id": "user_1", "name": "Demo Account", "email": "demo@example.com"})
        if url.endswith("/profiles.json"):
            return FakeResponse([
                {"id": "chan_1", "service": "twitter", "service_username": "bufferdemo", "formatted_username": "@bufferdemo"},
                {"id": "chan_2", "service": "linkedin", "service_username": "bufferinc", "formatted_username": "Buffer"},
            ])
        if "/profiles/chan_1.json" in url:
            return FakeResponse({"id": "chan_1", "service": "twitter", "service_username": "bufferdemo", "formatted_username": "@bufferdemo"})
        if "/profiles/chan_1/schedules.json" in url:
            return FakeResponse([{"days": ["mon"], "times": ["12:00"]}])
        return FakeResponse({"ok": True})


def test_buffer_client_reads_account_and_profiles(monkeypatch):
    fake = FakeURLLib()
    monkeypatch.setattr("cli_aos.buffer.client.urlopen", fake)
    client = BufferClient(api_key="tok_123", base_url="https://api.bufferapp.com/1", graphql_url="https://api.buffer.com")
    account = client.read_account()
    profiles = client.list_profiles()
    channel = client.read_channel("chan_1")
    schedules = client.list_profile_schedules("chan_1")
    assert account["name"] == "Demo Account"
    assert len(profiles["profiles"]) == 2
    assert channel["id"] == "chan_1"
    assert schedules["schedules"][0]["days"] == ["mon"]
