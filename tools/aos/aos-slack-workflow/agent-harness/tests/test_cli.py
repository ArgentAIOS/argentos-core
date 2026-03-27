from __future__ import annotations

import json
from pathlib import Path
from typing import Any

from click.testing import CliRunner

from cli_aos.slack_workflow.cli import cli
import cli_aos.slack_workflow.runtime as runtime


AGENT_HARNESS_ROOT = Path(__file__).resolve().parents[1]
CONNECTOR_PATH = AGENT_HARNESS_ROOT.parent / "connector.json"
PERMISSIONS_PATH = AGENT_HARNESS_ROOT / "permissions.json"


class FakeSlackClient:
    def auth_test(self) -> dict[str, Any]:
        return {"ok": True, "team_id": "T123", "user_id": "U123"}

    def list_channels(self, *, limit: int = 20, cursor: str | None = None) -> dict[str, Any]:
        channels = [
            {"id": "C123", "name": "general", "is_private": False, "num_members": 10, "topic": "Announcements"},
            {"id": "C456", "name": "ops", "is_private": True, "num_members": 5, "topic": "Ops"},
        ]
        return {"channels": channels[:limit], "next_cursor": "", "raw": {"channels": channels}}

    def create_channel(self, *, name: str, is_private: bool = False) -> dict[str, Any]:
        return {"channel": {"id": "C999", "name": name, "is_private": is_private}, "raw": {}}

    def archive_channel(self, *, channel_id: str) -> dict[str, Any]:
        return {"channel_id": channel_id, "archived": True, "raw": {}}

    def post_message(self, *, channel_id: str, text: str, thread_ts: str | None = None) -> dict[str, Any]:
        return {"channel": channel_id, "ts": "123.456", "text": text, "thread_ts": thread_ts, "reply_count": 0, "raw": {}}

    def update_message(self, *, channel_id: str, ts: str, text: str) -> dict[str, Any]:
        return {"channel": channel_id, "ts": ts, "text": text, "thread_ts": None, "reply_count": 0, "raw": {}}

    def delete_message(self, *, channel_id: str, ts: str) -> dict[str, Any]:
        return {"channel": channel_id, "ts": ts, "deleted": True, "raw": {}}

    def add_reaction(self, *, channel_id: str, timestamp: str, emoji: str) -> dict[str, Any]:
        return {"channel": channel_id, "timestamp": timestamp, "emoji": emoji, "ok": True, "raw": {}}

    def list_users(self, *, limit: int = 20, cursor: str | None = None) -> dict[str, Any]:
        users = [
            {"id": "U123", "name": "ada", "real_name": "Ada Lovelace", "email": "ada@example.com", "is_bot": False},
            {"id": "U456", "name": "grace", "real_name": "Grace Hopper", "email": "grace@example.com", "is_bot": False},
        ]
        return {"users": users[:limit], "next_cursor": "", "raw": {"members": users}}

    def create_reminder(self, *, text: str, time_value: str, user_id: str | None = None) -> dict[str, Any]:
        return {"reminder": {"id": "R123", "text": text, "time": time_value, "user": user_id}, "raw": {}}

    def create_canvas(self, *, title: str, content: str | None = None, channel_id: str | None = None, owner_id: str | None = None) -> dict[str, Any]:
        return {"canvas_id": "F123", "raw": {"title": title, "content": content, "channel_id": channel_id, "owner_id": owner_id}}

    def update_canvas(self, *, canvas_id: str, content: str | None = None, changes_json: str | None = None) -> dict[str, Any]:
        return {"canvas_id": canvas_id, "changes": changes_json or content, "raw": {}}

    def upload_file(self, *, file_path: str, filename: str | None = None, channel_id: str | None = None, thread_ts: str | None = None, title: str | None = None, initial_comment: str | None = None) -> dict[str, Any]:
        return {
            "file_id": "F999",
            "filename": filename or Path(file_path).name,
            "channel_id": channel_id,
            "thread_ts": thread_ts,
            "uploaded_bytes": 4,
            "complete": {"files": [{"id": "F999", "title": title or "file.txt"}], "raw": {}},
            "raw": {},
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
    assert manifest["scope"]["kind"] == "communication"


def test_capabilities_exposes_manifest():
    payload = invoke_json(["capabilities"])
    assert payload["tool"] == "aos-slack-workflow"
    assert payload["data"]["backend"] == "slack-web-api"
    assert "message.post" in json.dumps(payload["data"])
    assert "file.upload" in json.dumps(payload["data"])


def test_health_requires_credentials(monkeypatch):
    monkeypatch.delenv("SLACK_BOT_TOKEN", raising=False)
    payload = invoke_json(["health"])
    assert payload["data"]["status"] == "needs_setup"
    assert "SLACK_BOT_TOKEN" in json.dumps(payload["data"])


def test_health_ready_with_fake_client(monkeypatch):
    monkeypatch.setenv("SLACK_BOT_TOKEN", "xoxb-test")
    monkeypatch.setattr(runtime, "create_client", lambda ctx_obj: FakeSlackClient())
    payload = invoke_json(["health"])
    assert payload["data"]["status"] == "ready"
    assert payload["data"]["probe"]["ok"] is True
    assert payload["data"]["probe"]["details"]["team_id"] == "T123"


def test_config_show_redacts_credentials(monkeypatch):
    monkeypatch.setenv("SLACK_BOT_TOKEN", "xoxb-secret")
    monkeypatch.setenv("SLACK_APP_TOKEN", "xapp-secret")
    monkeypatch.setenv("SLACK_CHANNEL_ID", "C123")
    payload = invoke_json(["config", "show"])
    data = payload["data"]
    assert "xoxb-secret" not in json.dumps(data)
    assert "xapp-secret" not in json.dumps(data)
    assert data["scope"]["channel_id"] == "C123"
    assert data["runtime"]["implementation_mode"] == "live_read_write"


def test_message_post_requires_write_mode(monkeypatch):
    monkeypatch.setenv("SLACK_BOT_TOKEN", "xoxb-test")
    monkeypatch.setenv("SLACK_CHANNEL_ID", "C123")
    monkeypatch.setenv("SLACK_TEXT", "hello")
    monkeypatch.setattr(runtime, "create_client", lambda ctx_obj: FakeSlackClient())
    result = CliRunner().invoke(cli, ["--json", "--mode", "readonly", "message", "post"])
    payload = json.loads(result.output)
    assert payload["ok"] is False
    assert payload["error"]["code"] == "PERMISSION_DENIED"


def test_message_post_succeeds_in_write_mode(monkeypatch):
    monkeypatch.setenv("SLACK_BOT_TOKEN", "xoxb-test")
    monkeypatch.setenv("SLACK_CHANNEL_ID", "C123")
    monkeypatch.setenv("SLACK_TEXT", "hello")
    monkeypatch.setattr(runtime, "create_client", lambda ctx_obj: FakeSlackClient())
    payload = invoke_json_with_mode("write", ["message", "post"])
    assert payload["data"]["status"] == "live_write"
    assert payload["data"]["message"]["channel"] == "C123"
    assert payload["data"]["scope_preview"]["command_id"] == "message.post"


def test_channel_list_returns_picker_metadata(monkeypatch):
    monkeypatch.setenv("SLACK_BOT_TOKEN", "xoxb-test")
    monkeypatch.setattr(runtime, "create_client", lambda ctx_obj: FakeSlackClient())
    payload = invoke_json(["channel", "list", "--limit", "1"])
    assert payload["data"]["channels"]["channels"][0]["id"] == "C123"
    assert payload["data"]["picker"]["kind"] == "channel"
    assert payload["data"]["scope_preview"]["command_id"] == "channel.list"


def test_user_list_returns_picker_metadata(monkeypatch):
    monkeypatch.setenv("SLACK_BOT_TOKEN", "xoxb-test")
    monkeypatch.setattr(runtime, "create_client", lambda ctx_obj: FakeSlackClient())
    payload = invoke_json(["user", "list", "--limit", "1"])
    assert payload["data"]["users"]["users"][0]["id"] == "U123"
    assert payload["data"]["picker"]["kind"] == "user"
    assert payload["data"]["scope_preview"]["command_id"] == "user.list"


def test_canvas_create_uses_fake_client(monkeypatch):
    monkeypatch.setenv("SLACK_BOT_TOKEN", "xoxb-test")
    monkeypatch.setenv("SLACK_CANVAS_TITLE", "Demo Canvas")
    monkeypatch.setattr(runtime, "create_client", lambda ctx_obj: FakeSlackClient())
    payload = invoke_json_with_mode("write", ["canvas", "create", "--content", "# Demo"])
    assert payload["data"]["canvas"]["canvas_id"] == "F123"
    assert payload["data"]["scope_preview"]["command_id"] == "canvas.create"


def test_file_upload_uses_fake_client(monkeypatch, tmp_path):
    file_path = tmp_path / "demo.txt"
    file_path.write_text("demo")
    monkeypatch.setenv("SLACK_BOT_TOKEN", "xoxb-test")
    monkeypatch.setenv("SLACK_CHANNEL_ID", "C123")
    monkeypatch.setattr(runtime, "create_client", lambda ctx_obj: FakeSlackClient())
    payload = invoke_json_with_mode("write", ["file", "upload", "--file-path", str(file_path)])
    assert payload["data"]["file"]["file_id"] == "F999"
    assert payload["data"]["file"]["uploaded_bytes"] == 4
    assert payload["data"]["scope_preview"]["command_id"] == "file.upload"
