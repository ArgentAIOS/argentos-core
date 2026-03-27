from __future__ import annotations

import json
from pathlib import Path
from typing import Any

from click.testing import CliRunner

from cli_aos.buffer.cli import cli
import cli_aos.buffer.runtime as runtime


AGENT_HARNESS_ROOT = Path(__file__).resolve().parents[1]
CONNECTOR_PATH = AGENT_HARNESS_ROOT.parent / "connector.json"
PERMISSIONS_PATH = AGENT_HARNESS_ROOT / "permissions.json"


class FakeBufferClient:
    def read_account(self) -> dict[str, Any]:
        return {"id": "acct_1", "name": "Argent Buffer", "email": "buffer@example.com", "timezone": "America/Chicago", "locale": "en-US"}

    def list_channels(self) -> dict[str, Any]:
        return {
            "channels": [
                {"id": "chan_1", "service": "twitter", "service_username": "bufferdemo", "formatted_username": "@bufferdemo", "default": True, "timezone": "America/Chicago"},
                {"id": "chan_2", "service": "linkedin", "service_username": "bufferinc", "formatted_username": "Buffer", "default": False, "timezone": "America/Chicago"},
            ]
        }

    def read_channel(self, channel_id: str) -> dict[str, Any]:
        return {"id": channel_id, "service": "twitter", "service_username": "bufferdemo", "formatted_username": "@bufferdemo", "default": True, "timezone": "America/Chicago"}

    def list_profiles(self) -> dict[str, Any]:
        return {
            "profiles": [
                {"id": "chan_1", "service": "twitter", "service_username": "bufferdemo", "formatted_username": "@bufferdemo", "default": True, "timezone": "America/Chicago"},
            ]
        }

    def read_profile(self, profile_id: str) -> dict[str, Any]:
        return {"id": profile_id, "service": "twitter", "service_username": "bufferdemo", "formatted_username": "@bufferdemo", "default": True, "timezone": "America/Chicago"}

    def list_profile_schedules(self, profile_id: str) -> dict[str, Any]:
        return {"schedules": [{"days": ["mon"], "times": ["12:00"]}]}

    def list_posts(self, *, profile_id: str | None = None, status: str | None = None, limit: int = 10) -> dict[str, Any]:
        return {"supported": False, "status": "scaffold_read_only", "reason": "buffer post reads are scaffolded", "profile_id": profile_id, "status_filter": status, "limit": limit, "post_count": 0, "posts": []}

    def read_post(self, post_id: str) -> dict[str, Any]:
        return {"supported": False, "status": "scaffold_read_only", "reason": "buffer post reads are scaffolded", "post": {"id": post_id}}

    def create_post_draft(self, *, channel_id: str, text: str, due_at: str | None = None) -> dict[str, Any]:
        return {"supported": False, "status": "scaffold_write_only", "reason": "buffer post writes are scaffolded", "post": {"channel_id": channel_id, "text": text, "due_at": due_at}}

    def schedule_post(self, *, channel_id: str, text: str, due_at: str | None = None) -> dict[str, Any]:
        return {"supported": False, "status": "scaffold_write_only", "reason": "buffer post writes are scaffolded", "post": {"channel_id": channel_id, "text": text, "due_at": due_at}}


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
    assert manifest["scope"]["kind"] == "social-media"


def test_capabilities_exposes_manifest():
    payload = invoke_json(["capabilities"])
    assert payload["tool"] == "aos-buffer"
    assert payload["data"]["backend"] == "buffer-rest-api"
    assert "account.read" in json.dumps(payload["data"])
    assert "post.schedule" in json.dumps(payload["data"])


def test_account_read_returns_picker_metadata(monkeypatch):
    monkeypatch.setenv("BUFFER_API_KEY", "tok_test_abc")
    monkeypatch.setattr(runtime, "resolve_runtime_binary", lambda: "/tmp/aos-buffer")
    monkeypatch.setattr(runtime, "create_client", lambda ctx_obj=None: FakeBufferClient())
    payload = invoke_json(["account", "read"])
    data = payload["data"]
    assert data["account"]["name"] == "Argent Buffer"
    assert data["scope_preview"]["selection_surface"] == "account"
    assert data["scope_preview"]["command_id"] == "account.read"


def test_health_requires_api_key(monkeypatch):
    monkeypatch.delenv("BUFFER_API_KEY", raising=False)
    monkeypatch.delenv("BUFFER_ACCESS_TOKEN", raising=False)
    monkeypatch.setattr(runtime, "resolve_runtime_binary", lambda: None)
    payload = invoke_json(["health"])
    assert payload["data"]["status"] == "needs_setup"
    assert "BUFFER_API_KEY" in json.dumps(payload["data"])


def test_health_ready_with_fake_client(monkeypatch):
    monkeypatch.setenv("BUFFER_API_KEY", "tok_test_abc")
    monkeypatch.setenv("BUFFER_CHANNEL_ID", "chan_1")
    monkeypatch.setenv("BUFFER_PROFILE_ID", "chan_1")
    monkeypatch.setattr(runtime, "resolve_runtime_binary", lambda: "/tmp/aos-buffer")
    monkeypatch.setattr(runtime, "create_client", lambda ctx_obj=None: FakeBufferClient())
    payload = invoke_json(["health"])
    assert payload["data"]["status"] == "ready"
    assert payload["data"]["probe"]["ok"] is True
    assert payload["data"]["probe"]["account"]["id"] == "acct_1"


def test_config_show_redacts_and_surfaces_scope(monkeypatch):
    monkeypatch.setenv("BUFFER_API_KEY", "secret-token")
    monkeypatch.setenv("BUFFER_CHANNEL_ID", "chan_1")
    monkeypatch.setenv("BUFFER_PROFILE_ID", "chan_1")
    monkeypatch.setenv("BUFFER_POST_ID", "post_1")
    monkeypatch.setenv("BUFFER_POST_TEXT", "Launch post")
    payload = invoke_json(["config", "show"])
    data = payload["data"]
    assert "secret-token" not in json.dumps(data)
    assert data["scope"]["channel_id"] == "chan_1"
    assert data["runtime"]["implementation_mode"] == "live_read_with_scaffolded_writes"
    assert data["runtime"]["live_read_surfaces"] == ["account", "channel", "profile"]
    assert data["runtime"]["scaffolded_surfaces"] == ["post"]


def test_channel_list_returns_picker_metadata(monkeypatch):
    monkeypatch.setenv("BUFFER_API_KEY", "tok_test_abc")
    monkeypatch.setattr(runtime, "resolve_runtime_binary", lambda: "/tmp/aos-buffer")
    monkeypatch.setattr(runtime, "create_client", lambda ctx_obj=None: FakeBufferClient())
    payload = invoke_json(["channel", "list", "--limit", "1"])
    data = payload["data"]
    assert data["channel_count"] == 1
    assert data["picker"]["kind"] == "channel"
    assert data["picker"]["items"][0]["id"] == "chan_1"
    assert data["scope_preview"]["selection_surface"] == "channel"


def test_profile_read_uses_scoped_profile(monkeypatch):
    monkeypatch.setenv("BUFFER_API_KEY", "tok_test_abc")
    monkeypatch.setenv("BUFFER_PROFILE_ID", "chan_1")
    monkeypatch.setattr(runtime, "resolve_runtime_binary", lambda: "/tmp/aos-buffer")
    monkeypatch.setattr(runtime, "create_client", lambda ctx_obj=None: FakeBufferClient())
    payload = invoke_json(["profile", "read"])
    data = payload["data"]
    assert data["profile"]["id"] == "chan_1"
    assert data["schedules"][0]["days"] == ["mon"]
    assert data["scope_preview"]["selection_surface"] == "profile"


def test_post_list_is_scaffolded_but_visible(monkeypatch):
    monkeypatch.setenv("BUFFER_API_KEY", "tok_test_abc")
    monkeypatch.setenv("BUFFER_PROFILE_ID", "chan_1")
    monkeypatch.setattr(runtime, "resolve_runtime_binary", lambda: "/tmp/aos-buffer")
    monkeypatch.setattr(runtime, "create_client", lambda ctx_obj=None: FakeBufferClient())
    payload = invoke_json(["post", "list"])
    data = payload["data"]
    assert data["status"] == "scaffold_read_only"
    assert data["supported"] is False
    assert data["scope_preview"]["selection_surface"] == "post"


def test_post_create_draft_is_scaffolded_in_write_mode(monkeypatch):
    monkeypatch.setenv("BUFFER_API_KEY", "tok_test_abc")
    monkeypatch.setenv("BUFFER_CHANNEL_ID", "chan_1")
    monkeypatch.setenv("BUFFER_POST_TEXT", "Launch post")
    monkeypatch.setattr(runtime, "resolve_runtime_binary", lambda: "/tmp/aos-buffer")
    monkeypatch.setattr(runtime, "create_client", lambda ctx_obj=None: FakeBufferClient())
    payload = invoke_json_with_mode("write", ["post", "create-draft", "Launch post"])
    assert payload["data"]["status"] == "scaffold_write_only"
    assert payload["data"]["command"] == "post.create_draft"
