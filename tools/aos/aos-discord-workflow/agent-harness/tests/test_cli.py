from __future__ import annotations

import json
from pathlib import Path
from typing import Any

from click.testing import CliRunner

from cli_aos.discord_workflow.cli import cli
import cli_aos.discord_workflow.runtime as runtime


AGENT_HARNESS_ROOT = Path(__file__).resolve().parents[1]
CONNECTOR_PATH = AGENT_HARNESS_ROOT.parent / "connector.json"
PERMISSIONS_PATH = AGENT_HARNESS_ROOT / "permissions.json"


class FakeDiscordClient:
    def read_bot_user(self) -> dict[str, Any]:
        return {
            "id": "bot_123",
            "username": "ArgentOS",
            "global_name": "ArgentOS Bot",
            "bot": True,
            "raw": {},
        }

    def list_channels(self, *, guild_id: str) -> dict[str, Any]:
        channels = [
            {"id": "chan_1", "name": "general", "type": 0, "position": 1, "topic": "General chat", "raw": {}},
            {"id": "chan_2", "name": "ops", "type": 0, "position": 2, "topic": "Ops", "raw": {}},
        ]
        return {"channels": channels, "count": len(channels), "raw": {}}

    def create_channel(self, *, guild_id: str, name: str, channel_type: int = 0, topic: str | None = None) -> dict[str, Any]:
        return {"id": "chan_new", "name": name, "type": channel_type, "position": 3, "topic": topic, "raw": {}}

    def send_message(self, *, channel_id: str, content: str | None = None, embeds: list[dict[str, Any]] | None = None) -> dict[str, Any]:
        return {"id": "msg_1", "channel_id": channel_id, "content": content, "embeds": embeds or [], "author": {"id": "bot_123"}, "timestamp": "2026-03-27T00:00:00Z", "raw": {}}

    def edit_message(self, *, channel_id: str, message_id: str, content: str | None = None, embeds: list[dict[str, Any]] | None = None) -> dict[str, Any]:
        return {"id": message_id, "channel_id": channel_id, "content": content, "embeds": embeds or [], "author": {"id": "bot_123"}, "timestamp": "2026-03-27T00:00:00Z", "edited_timestamp": "2026-03-27T00:01:00Z", "raw": {}}

    def delete_message(self, *, channel_id: str, message_id: str) -> dict[str, Any]:
        return {"deleted": True, "status_code": 204, "raw": {}}

    def add_reaction(self, *, channel_id: str, message_id: str, emoji: str) -> dict[str, Any]:
        return {"added": True, "status_code": 204, "raw": {}}

    def create_thread(self, *, channel_id: str, message_id: str | None = None, name: str) -> dict[str, Any]:
        return {"id": "thread_1", "name": name, "type": 11, "position": 0, "parent_id": channel_id, "message_id": message_id, "raw": {}}

    def send_embed(self, *, channel_id: str, embed: dict[str, Any], content: str | None = None) -> dict[str, Any]:
        return {"id": "msg_embed_1", "channel_id": channel_id, "content": content, "embeds": [embed], "author": {"id": "bot_123"}, "timestamp": "2026-03-27T00:00:00Z", "raw": {}}

    def list_roles(self, *, guild_id: str) -> dict[str, Any]:
        roles = [
            {"id": "role_1", "name": "Admin", "color": 0, "position": 1, "permissions": "0", "raw": {}},
            {"id": "role_2", "name": "Member", "color": 0, "position": 2, "permissions": "0", "raw": {}},
        ]
        return {"roles": roles, "count": len(roles), "raw": {}}

    def assign_role(self, *, guild_id: str, member_id: str, role_id: str) -> dict[str, Any]:
        return {"assigned": True, "status_code": 204, "raw": {}}

    def list_members(self, *, guild_id: str, limit: int = 20) -> dict[str, Any]:
        members = [
            {"id": "member_1", "username": "alice", "display_name": "Alice", "joined_at": "2026-03-01T00:00:00Z", "roles": ["role_1"], "raw": {}},
            {"id": "member_2", "username": "bob", "display_name": "Bob", "joined_at": "2026-03-02T00:00:00Z", "roles": ["role_2"], "raw": {}},
        ]
        return {"members": members[:limit], "count": min(limit, len(members)), "raw": {}}

    def send_webhook(self, *, webhook_url: str, content: str | None = None, embed: dict[str, Any] | None = None, username: str | None = None, avatar_url: str | None = None) -> dict[str, Any]:
        return {"id": "webhook_msg_1", "content": content, "embeds": [embed] if embed else [], "username": username, "avatar_url": avatar_url, "raw": {}}


def invoke_json(args: list[str], *, obj: dict[str, Any] | None = None) -> dict[str, Any]:
    result = CliRunner().invoke(cli, ["--json", *args], obj=obj)
    assert result.exit_code == 0, result.output
    return json.loads(result.output)


def invoke_json_with_mode(mode: str, args: list[str], *, obj: dict[str, Any] | None = None) -> dict[str, Any]:
    result = CliRunner().invoke(cli, ["--json", "--mode", mode, *args], obj=obj)
    assert result.exit_code == 0, result.output
    return json.loads(result.output)


def test_manifest_and_permissions_are_in_sync():
    manifest = json.loads(CONNECTOR_PATH.read_text())
    permissions = json.loads(PERMISSIONS_PATH.read_text())["permissions"]
    command_ids = [command["id"] for command in manifest["commands"]]
    assert set(command_ids) == set(permissions.keys())
    assert manifest["scope"]["kind"] == "communication"


def test_capabilities_exposes_manifest():
    payload = invoke_json(["capabilities"])
    assert payload["tool"] == "aos-discord-workflow"
    assert payload["data"]["backend"] == "discord-bot-api"
    assert "message.send" in json.dumps(payload["data"])
    assert "webhook.send" in json.dumps(payload["data"])


def test_click_help_lists_discord_commands():
    result = CliRunner().invoke(cli, ["--help"])
    assert result.exit_code == 0, result.output
    assert "message" in result.output
    assert "webhook" in result.output
    assert "channel" in result.output


def test_health_requires_credentials(monkeypatch):
    monkeypatch.delenv("DISCORD_BOT_TOKEN", raising=False)
    monkeypatch.delenv("DISCORD_WEBHOOK_URL", raising=False)
    payload = invoke_json(["health"])
    assert payload["data"]["status"] == "needs_setup"
    assert "DISCORD_BOT_TOKEN" in json.dumps(payload["data"])


def test_health_ready_with_fake_client(monkeypatch):
    monkeypatch.setenv("DISCORD_BOT_TOKEN", "bot-token")
    monkeypatch.setattr(runtime, "create_client", lambda ctx_obj, require_bot_token=True: FakeDiscordClient())
    payload = invoke_json(["health"])
    assert payload["data"]["status"] == "ready"
    assert payload["data"]["probe"]["ok"] is True
    assert payload["data"]["probe"]["details"]["bot_user"]["id"] == "bot_123"


def test_config_show_redacts_credentials(monkeypatch):
    monkeypatch.setenv("DISCORD_BOT_TOKEN", "super-secret-token")
    monkeypatch.setenv("DISCORD_GUILD_ID", "guild_1")
    monkeypatch.setenv("DISCORD_CHANNEL_ID", "chan_1")
    payload = invoke_json(["config", "show"])
    data = payload["data"]
    assert "super-secret-token" not in json.dumps(data)
    assert data["scope"]["guild_id"] == "guild_1"
    assert data["runtime"]["implementation_mode"] == "live_read_write"


def test_config_show_prefers_operator_service_keys(monkeypatch):
    monkeypatch.setenv("DISCORD_BOT_TOKEN", "env-token")
    monkeypatch.setenv("DISCORD_WEBHOOK_URL", "https://discord.com/api/webhooks/env/token")
    monkeypatch.setenv("DISCORD_GUILD_ID", "env_guild")
    monkeypatch.setenv("DISCORD_CHANNEL_ID", "env_channel")
    monkeypatch.setattr(runtime, "create_client", lambda ctx_obj, require_bot_token=True: FakeDiscordClient())
    payload = invoke_json(
        ["config", "show"],
        obj={
            "service_keys": {
                "aos-discord-workflow": {
                    "DISCORD_BOT_TOKEN": "operator-token",
                    "DISCORD_WEBHOOK_URL": "https://discord.com/api/webhooks/operator/token",
                    "DISCORD_GUILD_ID": "operator_guild",
                    "DISCORD_CHANNEL_ID": "operator_channel",
                }
            }
        },
    )
    data = payload["data"]
    assert "operator-token" not in json.dumps(data)
    assert "env-token" not in json.dumps(data)
    assert data["auth"]["sources"]["DISCORD_BOT_TOKEN"] == "operator:service_keys:tool"
    assert data["auth"]["sources"]["DISCORD_WEBHOOK_URL"] == "operator:service_keys:tool"
    assert data["scope"]["guild_id"] == "operator_guild"
    assert data["scope"]["channel_id"] == "operator_channel"
    assert data["scope"]["sources"]["DISCORD_CHANNEL_ID"] == "operator:service_keys:tool"


def test_message_send_requires_write_mode(monkeypatch):
    monkeypatch.setenv("DISCORD_BOT_TOKEN", "bot-token")
    monkeypatch.setenv("DISCORD_CHANNEL_ID", "chan_1")
    monkeypatch.setattr(runtime, "create_client", lambda ctx_obj, require_bot_token=True: FakeDiscordClient())
    result = CliRunner().invoke(cli, ["--json", "--mode", "readonly", "message", "send", "--content", "hi"])
    payload = json.loads(result.output)
    assert payload["ok"] is False
    assert payload["error"]["code"] == "PERMISSION_DENIED"


def test_message_send_succeeds_in_write_mode(monkeypatch):
    monkeypatch.setenv("DISCORD_BOT_TOKEN", "bot-token")
    monkeypatch.setenv("DISCORD_CHANNEL_ID", "chan_1")
    monkeypatch.setattr(runtime, "create_client", lambda ctx_obj, require_bot_token=True: FakeDiscordClient())
    payload = invoke_json_with_mode("write", ["message", "send", "--content", "Hello Discord"])
    assert payload["data"]["status"] == "live_write"
    assert payload["data"]["message"]["id"] == "msg_1"
    assert payload["data"]["scope_preview"]["command_id"] == "message.send"


def test_channel_list_returns_picker_metadata(monkeypatch):
    monkeypatch.setenv("DISCORD_BOT_TOKEN", "bot-token")
    monkeypatch.setenv("DISCORD_GUILD_ID", "guild_1")
    monkeypatch.setattr(runtime, "create_client", lambda ctx_obj, require_bot_token=True: FakeDiscordClient())
    payload = invoke_json(["channel", "list", "--limit", "1"])
    assert payload["data"]["channels"]["count"] == 2
    assert payload["data"]["picker"]["kind"] == "discord_channel"
    assert payload["data"]["scope_preview"]["command_id"] == "channel.list"


def test_webhook_send_succeeds(monkeypatch):
    monkeypatch.delenv("DISCORD_BOT_TOKEN", raising=False)
    monkeypatch.setenv("DISCORD_WEBHOOK_URL", "https://discord.com/api/webhooks/123/abc")
    monkeypatch.setattr(runtime, "create_client", lambda ctx_obj, require_bot_token=True: FakeDiscordClient())
    payload = invoke_json_with_mode("write", ["webhook", "send", "--content", "Webhook hello"])
    assert payload["data"]["status"] == "live_write"
    assert payload["data"]["result"]["id"] == "webhook_msg_1"


def test_health_reports_partial_ready_for_webhook_only(monkeypatch):
    monkeypatch.delenv("DISCORD_BOT_TOKEN", raising=False)
    monkeypatch.setenv("DISCORD_WEBHOOK_URL", "https://discord.com/api/webhooks/123/abc")
    payload = invoke_json(["health"])
    assert payload["data"]["status"] == "partial_ready"
    assert payload["data"]["write_bridge_available"] is True


def test_thread_create_posts_initial_message_after_thread_creation(monkeypatch):
    monkeypatch.setenv("DISCORD_BOT_TOKEN", "bot-token")
    monkeypatch.setenv("DISCORD_CHANNEL_ID", "chan_1")
    monkeypatch.setattr(runtime, "create_client", lambda ctx_obj, require_bot_token=True: FakeDiscordClient())
    payload = invoke_json_with_mode("write", ["thread", "create", "--name", "Incident Room", "--content", "Start here"])
    assert payload["data"]["thread"]["id"] == "thread_1"
    assert payload["data"]["initial_message"]["channel_id"] == "thread_1"
    assert payload["data"]["initial_message"]["content"] == "Start here"
