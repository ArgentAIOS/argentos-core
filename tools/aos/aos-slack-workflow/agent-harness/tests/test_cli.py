from __future__ import annotations

import json
import subprocess
from pathlib import Path
from typing import Any

from click.testing import CliRunner
import pytest

from cli_aos.slack_workflow import config as slack_config
from cli_aos.slack_workflow.cli import cli
import cli_aos.slack_workflow.runtime as runtime
import cli_aos.slack_workflow.service_keys as service_keys


AGENT_HARNESS_ROOT = Path(__file__).resolve().parents[1]
CONNECTOR_PATH = AGENT_HARNESS_ROOT.parent / "connector.json"
PERMISSIONS_PATH = AGENT_HARNESS_ROOT / "permissions.json"
ALL_ENV_KEYS = (
    "SLACK_BOT_TOKEN",
    "SLACK_APP_TOKEN",
    "SLACK_BASE_URL",
    "SLACK_CHANNEL_ID",
    "SLACK_THREAD_TS",
    "SLACK_TEXT",
    "SLACK_EMOJI",
    "SLACK_USER_ID",
    "SLACK_CHANNEL_NAME",
    "SLACK_CANVAS_ID",
    "SLACK_CANVAS_TITLE",
    "SLACK_CANVAS_CONTENT",
    "SLACK_CANVAS_CHANGES",
    "SLACK_FILE_PATH",
    "SLACK_FILE_TITLE",
    "SLACK_REMINDER_TEXT",
    "SLACK_REMINDER_TIME",
    "SLACK_REMINDER_USER",
)


def write_service_keys(tmp_path: Path, values: dict[str, str], *, extra: dict[str, Any] | None = None) -> Path:
    path = tmp_path / "service-keys.json"
    path.write_text(
        json.dumps(
            {
                "version": 1,
                "keys": [
                    {
                        "id": f"sk-{key}",
                        "name": key,
                        "variable": key,
                        "value": value,
                        "enabled": True,
                        **(extra or {}),
                    }
                    for key, value in values.items()
                ],
            }
        )
    )
    return path


def encrypt_secret(tmp_path: Path, plaintext: str) -> str:
    home = tmp_path / "home"
    key_dir = home / ".argentos"
    key_dir.mkdir(parents=True, exist_ok=True)
    (key_dir / ".master-key").write_text("11" * 32)
    script = r"""
const { createCipheriv } = require("node:crypto");
const plaintext = process.argv[1];
const key = Buffer.from("11".repeat(32), "hex");
const iv = Buffer.from("22".repeat(12), "hex");
const cipher = createCipheriv("aes-256-gcm", key, iv);
let encrypted = cipher.update(plaintext, "utf8", "hex");
encrypted += cipher.final("hex");
const tag = cipher.getAuthTag().toString("hex");
process.stdout.write(`enc:v1:${iv.toString("hex")}:${tag}:${encrypted}`);
"""
    result = subprocess.run(
        ["node", "-e", script, plaintext],
        capture_output=True,
        text=True,
        timeout=10,
        check=True,
    )
    return result.stdout


def _clear_env(monkeypatch) -> None:
    for key in ALL_ENV_KEYS:
        monkeypatch.delenv(key, raising=False)


@pytest.fixture(autouse=True)
def no_operator_service_keys_by_default(monkeypatch, tmp_path):
    monkeypatch.setattr(service_keys, "SERVICE_KEYS_PATH", tmp_path / "missing-service-keys.json")
    _clear_env(monkeypatch)


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
    assert manifest["scope"]["live_read_available"] is True
    assert manifest["scope"]["write_bridge_available"] is True
    assert manifest["scope"]["live_write_smoke_tested"] is False
    assert manifest["scope"]["required"] == ["SLACK_BOT_TOKEN"]
    fields = {field["id"]: field for field in manifest["scope"]["fields"]}
    assert "message_type" not in fields
    assert "blocks_json" not in fields
    assert "attachments_json" not in fields
    assert "options" not in fields
    assert fields["canvas_id"]["applies_to"] == ["canvas.update"]
    assert fields["canvas_title"]["applies_to"] == ["canvas.create"]
    assert fields["file_path"]["description"] == "Local filesystem path of the file to upload."


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


def test_config_prefers_operator_service_keys_over_local_env(monkeypatch):
    monkeypatch.setenv("SLACK_BOT_TOKEN", "xoxb-env")
    monkeypatch.setenv("SLACK_CHANNEL_ID", "CENV")

    runtime_values = slack_config.resolve_runtime_values(
        {
            "service_keys": {
                "aos-slack-workflow": {
                    "bot_token": "xoxb-operator",
                    "channel_id": "COPERATOR",
                }
            }
        }
    )

    assert runtime_values["bot_token"] == "xoxb-operator"
    assert runtime_values["bot_token_source"] == "operator:service_keys:tool"
    assert runtime_values["channel_id"] == "COPERATOR"
    assert runtime_values["channel_id_source"] == "operator:service_keys:tool"


def test_encrypted_repo_service_key_decrypts_with_master_key(monkeypatch, tmp_path):
    encrypted = encrypt_secret(tmp_path, "xoxb-encrypted")
    path = write_service_keys(tmp_path, {"SLACK_BOT_TOKEN": encrypted})
    monkeypatch.setattr(service_keys, "SERVICE_KEYS_PATH", path)
    monkeypatch.setenv("HOME", str(tmp_path / "home"))

    details = service_keys.service_key_details("SLACK_BOT_TOKEN")

    assert details["value"] == "xoxb-encrypted"
    assert details["source"] == "repo-service-key"


def test_unreadable_encrypted_repo_service_key_falls_back_to_env_like_core_resolver(monkeypatch, tmp_path):
    path = write_service_keys(tmp_path, {"SLACK_BOT_TOKEN": "enc:v1:bad:bad:bad"})
    monkeypatch.setattr(service_keys, "SERVICE_KEYS_PATH", path)
    monkeypatch.setenv("SLACK_BOT_TOKEN", "xoxb-env-fallback")

    details = service_keys.service_key_details("SLACK_BOT_TOKEN")

    assert details["value"] == "xoxb-env-fallback"
    assert details["source"] == "env_fallback"


def test_scoped_repo_service_key_blocks_env_fallback(monkeypatch, tmp_path):
    path = write_service_keys(tmp_path, {"SLACK_BOT_TOKEN": "xoxb-scoped"}, extra={"allowedRoles": ["admin"]})
    monkeypatch.setattr(service_keys, "SERVICE_KEYS_PATH", path)
    monkeypatch.setenv("SLACK_BOT_TOKEN", "xoxb-env")

    details = service_keys.service_key_details("SLACK_BOT_TOKEN")

    assert details["value"] == ""
    assert details["source"] == "repo-service-key-scoped"
    assert details["blocked"] is True


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


def test_live_write_uses_operator_context_keys(monkeypatch):
    def create_client(ctx_obj: dict[str, Any]) -> FakeSlackClient:
        values = slack_config.resolve_runtime_values(ctx_obj)
        assert values["bot_token"] == "xoxb-operator"
        assert values["channel_id"] == "C777"
        assert values["text"] == "operator hello"
        return FakeSlackClient()

    monkeypatch.setattr(runtime, "create_client", create_client)
    result = CliRunner().invoke(
        cli,
        ["--json", "--mode", "write", "message", "post"],
        obj={
            "service_keys": {
                "aos-slack-workflow": {
                    "bot_token": "xoxb-operator",
                    "channel_id": "C777",
                    "text": "operator hello",
                }
            }
        },
    )

    assert result.exit_code == 0, result.output
    payload = json.loads(result.output)
    assert payload["data"]["message"]["channel"] == "C777"
    assert payload["data"]["message"]["text"] == "operator hello"


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
