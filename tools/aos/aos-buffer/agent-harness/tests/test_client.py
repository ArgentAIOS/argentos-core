from __future__ import annotations

import json
from typing import Any

import pytest

from cli_aos.buffer.client import BufferAPIError, BufferClient


class FakeResponse:
    def __init__(self, payload: dict[str, Any], status: int = 200):
        self._payload = payload
        self.status = status
        self.headers = {"Content-Type": "application/json"}

    def read(self) -> bytes:
        return json.dumps(self._payload).encode("utf-8")

    def __enter__(self):
        return self

    def __exit__(self, exc_type, exc, tb):
        return False


class FakeURLLib:
    def __init__(self):
        self.requests: list[dict[str, Any]] = []

    def __call__(self, request, timeout=None):
        body = json.loads(request.data.decode("utf-8"))
        self.requests.append(
            {
                "url": request.full_url,
                "method": request.method,
                "headers": dict(request.headers),
                "timeout": timeout,
                "query": body.get("query"),
                "variables": body.get("variables"),
            }
        )

        query = body.get("query", "")
        variables = body.get("variables", {})

        if "account {" in query:
            return FakeResponse({"data": {"account": {"id": "acct_1", "name": "Demo Account", "organizations": [{"id": "org_1"}]}}})
        if "channels(input:" in query:
            return FakeResponse({"data": {"channels": [{"id": "chan_1", "name": "Demo Channel", "service": "twitter"}]}})
        if "channel(input:" in query:
            return FakeResponse({"data": {"channel": {"id": variables["id"], "name": "Demo Channel", "displayName": "Demo Channel", "service": "twitter"}}})
        if "posts(" in query:
            return FakeResponse(
                {
                    "data": {
                        "posts": {
                            "edges": [{"cursor": "1", "node": {"id": "post_1", "text": "Hello", "status": "scheduled", "channelId": "chan_1"}}],
                            "pageInfo": {"hasNextPage": False, "endCursor": None},
                        }
                    }
                }
            )
        return FakeResponse({"errors": [{"message": "Unexpected query", "extensions": {"code": "UNEXPECTED"}}]})


def test_buffer_client_uses_graphql_endpoint_and_bearer_auth(monkeypatch):
    fake = FakeURLLib()
    monkeypatch.setattr("cli_aos.buffer.client.urlopen", fake)
    client = BufferClient(api_key="tok_123", base_url="https://api.buffer.com")
    account = client.read_account()
    channels = client.list_channels(organization_id="org_1")
    channel = client.read_channel(channel_id="chan_1")
    posts = client.list_posts(organization_id="org_1", channel_ids=["chan_1"], statuses=["scheduled"], limit=10)
    assert account["id"] == "acct_1"
    assert channels[0]["id"] == "chan_1"
    assert channel["id"] == "chan_1"
    assert posts["edges"][0]["node"]["id"] == "post_1"
    assert fake.requests[0]["headers"]["Authorization"] == "Bearer tok_123"
    assert fake.requests[0]["url"] == "https://api.buffer.com"


def test_buffer_client_raises_graphql_errors(monkeypatch):
    def fake_error(request, timeout=None):
        del request, timeout
        return FakeResponse({"errors": [{"message": "Not authorized", "extensions": {"code": "UNAUTHORIZED"}}]})

    monkeypatch.setattr("cli_aos.buffer.client.urlopen", fake_error)
    client = BufferClient(api_key="tok_123", base_url="https://api.buffer.com")
    with pytest.raises(BufferAPIError) as exc_info:
        client.read_account()
    assert exc_info.value.code == "UNAUTHORIZED"
    assert exc_info.value.exit_code == 4
