from __future__ import annotations

import json
import subprocess
from pathlib import Path
from typing import Any

from click.testing import CliRunner
import pytest

import cli_aos.slack.runtime as runtime
import cli_aos.slack.service_keys as service_keys
from cli_aos.slack.cli import cli

BOT_TOKEN = "xoxb-test-token"
AGENT_HARNESS_ROOT = Path(__file__).resolve().parents[1]
CONNECTOR_PATH = AGENT_HARNESS_ROOT.parent / "connector.json"
PERMISSIONS_PATH = AGENT_HARNESS_ROOT / "permissions.json"
ALL_ENV_KEYS = (
    "SLACK_BOT_TOKEN",
    "AOS_SLACK_BOT_TOKEN",
    "SLACK_APP_TOKEN",
    "AOS_SLACK_APP_TOKEN",
    "SLACK_WORKSPACE",
    "AOS_SLACK_WORKSPACE",
    "SLACK_TEAM_ID",
    "AOS_SLACK_TEAM_ID",
    "SLACK_CHANNEL_ID",
    "SLACK_THREAD_TS",
    "SLACK_USER_ID",
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


@pytest.fixture(autouse=True)
def no_operator_service_key_by_default(monkeypatch, tmp_path):
    monkeypatch.setattr(service_keys, "SERVICE_KEYS_PATH", tmp_path / "missing-service-keys.json")
    for key in ALL_ENV_KEYS:
        monkeypatch.delenv(key, raising=False)


def _set_bot_token(monkeypatch) -> None:
    monkeypatch.setenv("SLACK_BOT_TOKEN", BOT_TOKEN)
    monkeypatch.delenv("AOS_SLACK_BOT_TOKEN", raising=False)
    monkeypatch.delenv("SLACK_APP_TOKEN", raising=False)
    monkeypatch.delenv("AOS_SLACK_APP_TOKEN", raising=False)


def _json_output(result):
    return json.loads(result.output)


def _fake_slack_api(calls: list[tuple[str, dict[str, object]]]):
    def fake_request_json(api_method: str, token: str, *, params: dict[str, object] | None = None):
        call_params = params or {}
        calls.append((api_method, call_params))
        assert token == BOT_TOKEN
        if api_method == "auth.test":
            return {
                "team_id": "T123",
                "team": "Example",
                "user_id": "U123",
                "user": "agent-bot",
                "bot_id": "B123",
                "url": "https://example.slack.com",
            }
        if api_method == "conversations.list":
            return {
                "channels": [
                    {
                        "id": "C123",
                        "name": "general",
                        "is_channel": True,
                        "is_private": False,
                        "is_archived": False,
                        "is_member": True,
                        "num_members": 7,
                    }
                ],
                "response_metadata": {"next_cursor": ""},
            }
        if api_method == "users.list":
            return {
                "members": [
                    {
                        "id": "U234",
                        "name": "ada",
                        "real_name": "Ada Lovelace",
                        "is_bot": False,
                        "is_app_user": False,
                        "deleted": False,
                        "profile": {
                            "display_name": "ada",
                            "real_name": "Ada Lovelace",
                            "title": "Engineer",
                        },
                    },
                    {
                        "id": "U345",
                        "name": "slackbot",
                        "real_name": "Slackbot",
                        "is_bot": True,
                        "is_app_user": False,
                        "deleted": False,
                        "profile": {
                            "display_name": "Slackbot",
                            "real_name": "Slackbot",
                        },
                    },
                ],
                "response_metadata": {"next_cursor": ""},
            }
        if api_method == "search.messages":
            query = str(call_params.get("query", ""))
            text = "Direct mention" if query.startswith("<@") else "hello bot"
            return {
                "messages": {
                    "matches": [
                        {
                            "channel": {"id": "C123", "name": "general"},
                            "ts": "1700000000.000000",
                            "user": "U456",
                            "text": text,
                            "permalink": "https://example.slack.com/archives/C123/p1700000000000000",
                            "score": 1.0,
                        }
                    ],
                    "total": 1,
                }
            }
        if api_method == "reactions.list":
            return {
                "items": [
                    {
                        "type": "message",
                        "channel": "C123",
                        "reaction": "wave",
                        "count": 1,
                        "message": {"ts": "1700000000.000000", "text": "hello bot"},
                    }
                ],
                "response_metadata": {"next_cursor": ""},
            }
        if api_method == "chat.postMessage":
            assert call_params.get("channel") == "C123"
            assert call_params.get("text") == "hello there"
            return {
                "channel": "C123",
                "ts": "1700000001.000000",
                "message": {
                    "text": "hello there",
                    "user": "U123",
                    "channel": "C123",
                },
            }
        raise AssertionError(api_method)

    return fake_request_json


def _set_operator_service_keys(monkeypatch, values: dict[str, str]) -> None:
    real_details = service_keys.service_key_details

    def fake_details(variable: str, ctx_obj: dict[str, object] | None = None, default: str | None = None) -> dict[str, object]:
        if variable in values:
            return {"value": values[variable], "present": True, "usable": True, "source": "operator:service_keys", "variable": variable}
        return real_details(variable, ctx_obj, default=default)

    monkeypatch.setattr(service_keys, "service_key_details", fake_details)
    monkeypatch.setattr(runtime, "service_key_details", fake_details)


def test_manifest_and_permissions_are_in_sync():
    manifest = json.loads(CONNECTOR_PATH.read_text())
    permissions = json.loads(PERMISSIONS_PATH.read_text())
    manifest_command_ids = [command["id"] for command in manifest["commands"]]

    assert permissions["backend"] == manifest["backend"]
    assert set(manifest_command_ids) == set(permissions["permissions"].keys())
    assert manifest["scope"]["workerFields"] == ["channel", "message_text", "thread_ts", "user_id"]
    assert manifest["scope"]["live_write_smoke_tested"] is False
    assert manifest["scope"]["required"] == ["SLACK_BOT_TOKEN"]
    assert manifest["auth"]["service_keys"] == ["SLACK_BOT_TOKEN"]
    assert "SLACK_CHANNEL_ID" in manifest["auth"]["optional_service_keys"]
    assert manifest["scope"]["commandDefaults"]["message.reply"]["args"] == ["SLACK_CHANNEL_ID"]
    assert manifest["scope"]["commandDefaults"]["people.list"]["options"]["user-id"] == "SLACK_USER_ID"


def test_capabilities_json_includes_live_surface():
    result = CliRunner().invoke(cli, ["--json", "capabilities"])
    assert result.exit_code == 0
    assert '"tool": "aos-slack"' in result.output
    assert '"manifest_schema_version": "1.0.0"' in result.output
    assert '"health"' in result.output
    assert '"doctor"' in result.output
    assert '"config.show"' in result.output
    assert '"message.search"' in result.output
    assert '"people.list"' in result.output
    assert '"reaction.list"' in result.output


def test_health_reports_needs_setup_without_bot_token(monkeypatch):
    monkeypatch.delenv("SLACK_BOT_TOKEN", raising=False)
    monkeypatch.delenv("AOS_SLACK_BOT_TOKEN", raising=False)
    result = CliRunner().invoke(cli, ["--json", "health"])
    assert result.exit_code == 0
    assert '"status": "needs_setup"' in result.output
    assert "SLACK_BOT_TOKEN" in result.output


def test_health_reports_auth_error_on_invalid_token(monkeypatch):
    _set_bot_token(monkeypatch)

    def fake_request_json(api_method: str, token: str, *, params: dict[str, object] | None = None):
        assert token == BOT_TOKEN
        if api_method == "auth.test":
            raise runtime.CliError(
                code="AUTH_ERROR",
                message="invalid_auth",
                exit_code=4,
                details={"method": "auth.test", "slack_error": "invalid_auth"},
            )
        raise AssertionError(api_method)

    monkeypatch.setattr(runtime, "_request_json", fake_request_json)
    result = CliRunner().invoke(cli, ["--json", "health"])
    assert result.exit_code == 0
    assert '"status": "auth_error"' in result.output
    assert "invalid_auth" in result.output


def test_config_show_redacts_token_and_reports_runtime_ready(monkeypatch):
    _set_bot_token(monkeypatch)
    calls: list[tuple[str, dict[str, object]]] = []
    monkeypatch.setattr(runtime, "_request_json", _fake_slack_api(calls))

    result = CliRunner().invoke(cli, ["--json", "config", "show"])
    assert result.exit_code == 0
    assert BOT_TOKEN not in result.output
    assert '"runtime_ready": true' in result.output
    assert '"supported_commands"' in result.output
    assert '"message.search"' in result.output
    assert '"users:read"' in result.output
    assert '"people.list"' in result.output
    assert '"reaction.list"' in result.output


def test_config_show_prefers_operator_service_keys_for_auth_and_scope(monkeypatch):
    monkeypatch.setenv("SLACK_BOT_TOKEN", "env-token")
    monkeypatch.setenv("SLACK_CHANNEL_ID", "CENV")
    monkeypatch.setenv("SLACK_THREAD_TS", "111.222")
    monkeypatch.setenv("SLACK_USER_ID", "UENV")
    _set_operator_service_keys(
        monkeypatch,
        {
            "SLACK_BOT_TOKEN": BOT_TOKEN,
            "SLACK_CHANNEL_ID": "COPERATOR",
            "SLACK_THREAD_TS": "123.456",
            "SLACK_USER_ID": "UOPERATOR",
            "SLACK_WORKSPACE": "Operator Workspace",
            "SLACK_TEAM_ID": "TOPERATOR",
        },
    )
    calls: list[tuple[str, dict[str, object]]] = []
    monkeypatch.setattr(runtime, "_request_json", _fake_slack_api(calls))

    result = CliRunner().invoke(cli, ["--json", "config", "show"])
    assert result.exit_code == 0
    payload = _json_output(result)
    data = payload["data"]["config"]
    assert BOT_TOKEN not in result.output
    assert "env-token" not in result.output
    assert data["bot_token"]["source"] == "operator:service_keys"
    assert data["channel_id_hint"] == "COPERATOR"
    assert data["thread_ts_hint"] == "123.456"
    assert data["user_id_hint"] == "UOPERATOR"
    assert data["workspace_hint"] == "Operator Workspace"
    assert data["team_id_hint"] == "TOPERATOR"
    assert data["resolution_order"] == [
        "operator runtime service_keys/service_key_values/api_keys/secrets",
        "unmanaged repo service-keys.json",
        "local environment fallback",
    ]
    assert data["live_write_smoke_tested"] is False


def test_encrypted_repo_service_key_decrypts_with_master_key(monkeypatch, tmp_path):
    encrypted = encrypt_secret(tmp_path, BOT_TOKEN)
    path = write_service_keys(tmp_path, {"SLACK_BOT_TOKEN": encrypted})
    monkeypatch.setattr(service_keys, "SERVICE_KEYS_PATH", path)
    monkeypatch.setenv("HOME", str(tmp_path / "home"))

    details = service_keys.service_key_details("SLACK_BOT_TOKEN")

    assert details["value"] == BOT_TOKEN
    assert details["source"] == "repo-service-key"


def test_unreadable_encrypted_repo_service_key_falls_back_to_env_like_core_resolver(monkeypatch, tmp_path):
    path = write_service_keys(tmp_path, {"SLACK_BOT_TOKEN": "enc:v1:bad:bad:bad"})
    monkeypatch.setattr(service_keys, "SERVICE_KEYS_PATH", path)
    monkeypatch.setenv("SLACK_BOT_TOKEN", "env-token")

    details = service_keys.service_key_details("SLACK_BOT_TOKEN")

    assert details["value"] == "env-token"
    assert details["source"] == "env_fallback"


def test_scoped_repo_service_key_blocks_env_fallback(monkeypatch, tmp_path):
    path = write_service_keys(
        tmp_path,
        {"SLACK_BOT_TOKEN": "scoped-token"},
        extra={"allowedRoles": ["operator"]},
    )
    monkeypatch.setattr(service_keys, "SERVICE_KEYS_PATH", path)
    monkeypatch.setenv("SLACK_BOT_TOKEN", "env-token")

    details = service_keys.service_key_details("SLACK_BOT_TOKEN")

    assert details["value"] == ""
    assert details["source"] == "repo-service-key-scoped"
    assert details["blocked"] is True


def test_scoped_primary_service_key_blocks_legacy_env_aliases(monkeypatch, tmp_path):
    path = write_service_keys(
        tmp_path,
        {
            "SLACK_BOT_TOKEN": "scoped-token",
            "SLACK_TEAM_ID": "scoped-team",
        },
        extra={"allowedRoles": ["operator"]},
    )
    monkeypatch.setattr(service_keys, "SERVICE_KEYS_PATH", path)
    monkeypatch.setenv("AOS_SLACK_BOT_TOKEN", BOT_TOKEN)
    monkeypatch.setenv("AOS_SLACK_TEAM_ID", "TLEGACY")

    config = runtime.runtime_config()

    assert config["bot_token"] is None
    assert config["bot_token_env"] == "SLACK_BOT_TOKEN"
    assert config["bot_token_source"] == "repo-service-key-scoped"
    assert config["team_id_hint"] is None
    assert config["team_id_hint_env"] == "SLACK_TEAM_ID"
    assert config["team_id_hint_source"] == "repo-service-key-scoped"


def test_doctor_includes_runtime_probes(monkeypatch):
    _set_bot_token(monkeypatch)
    calls: list[tuple[str, dict[str, object]]] = []
    monkeypatch.setattr(runtime, "_request_json", _fake_slack_api(calls))

    result = CliRunner().invoke(cli, ["--json", "doctor"])
    assert result.exit_code == 0
    assert '"supported_read_scopes"' in result.output
    assert '"users:read"' in result.output
    assert '"channel_probe"' in result.output
    assert '"people_probe"' in result.output
    assert '"reaction_probe"' in result.output
    assert '"status": "ok"' in result.output


def test_channel_list_uses_conversations_list(monkeypatch):
    _set_bot_token(monkeypatch)
    calls: list[tuple[str, dict[str, object]]] = []
    monkeypatch.setattr(runtime, "_request_json", _fake_slack_api(calls))

    result = CliRunner().invoke(cli, ["--json", "channel", "list"])
    assert result.exit_code == 0
    payload = _json_output(result)
    data = payload["data"]
    assert calls[0][0] == "auth.test"
    assert calls[1][0] == "conversations.list"
    assert calls[1][1]["types"] == ["public_channel"]
    assert data["workspace"]["name"] == "Example"
    assert data["scope_preview"] == "Example > Workspace channels: #general"
    assert data["scope"]["selection_surface"] == "channel"
    assert data["picker"]["scope"]["kind"] == "workspace"
    assert data["picker"]["items"][0]["kind"] == "channel"
    assert data["picker"]["items"][0]["label"] == "#general"
    assert data["picker"]["items"][0]["scope_preview"] == "Example > #general"


def test_people_list_uses_users_list_and_picker_metadata(monkeypatch):
    _set_bot_token(monkeypatch)
    calls: list[tuple[str, dict[str, object]]] = []
    monkeypatch.setattr(runtime, "_request_json", _fake_slack_api(calls))

    result = CliRunner().invoke(cli, ["--json", "people", "list"])
    assert result.exit_code == 0
    payload = _json_output(result)
    data = payload["data"]
    assert calls[0][0] == "auth.test"
    assert calls[1][0] == "users.list"
    assert data["count"] == 1
    assert data["scope_preview"] == "Example > Mention targets: @ada"
    assert data["scope"]["selection_surface"] == "people"
    assert data["scope"]["filters"]["exclude_bots"] is True
    assert data["picker"]["items"][0]["kind"] == "person"
    assert data["picker"]["items"][0]["label"] == "@ada"
    assert data["picker"]["items"][0]["mention"] == "<@U234>"
    assert data["picker"]["items"][0]["scope_preview"] == "Example > Mention targets > @ada"


def test_people_list_filters_to_operator_scoped_user_id(monkeypatch):
    _set_bot_token(monkeypatch)
    _set_operator_service_keys(monkeypatch, {"SLACK_USER_ID": "U234"})
    calls: list[tuple[str, dict[str, object]]] = []
    monkeypatch.setattr(runtime, "_request_json", _fake_slack_api(calls))

    result = CliRunner().invoke(cli, ["--json", "people", "list"])
    assert result.exit_code == 0
    payload = _json_output(result)
    data = payload["data"]
    assert data["count"] == 1
    assert data["user_id"] == "U234"
    assert data["people"][0]["id"] == "U234"
    assert data["scope"]["user_id"] == "U234"


def test_message_search_uses_search_messages(monkeypatch):
    _set_bot_token(monkeypatch)
    calls: list[tuple[str, dict[str, object]]] = []
    monkeypatch.setattr(runtime, "_request_json", _fake_slack_api(calls))

    result = CliRunner().invoke(cli, ["--json", "message", "search", "--query", "hello", "--limit", "5"])
    assert result.exit_code == 0
    payload = _json_output(result)
    data = payload["data"]
    assert calls[0][0] == "auth.test"
    assert calls[1][0] == "search.messages"
    assert calls[1][1]["query"] == "hello"
    assert calls[1][1]["count"] == 5
    assert data["workspace"]["name"] == "Example"
    assert data["scope_preview"] == "Example > Message search for 'hello': #general - hello bot"
    assert data["scope"]["selection_surface"] == "message"
    assert data["picker"]["items"][0]["kind"] == "message"
    assert data["picker"]["items"][0]["label"] == "#general - hello bot"
    assert data["picker"]["items"][0]["surface"] == "message.search"


def test_mention_scan_defaults_to_bot_user_id(monkeypatch):
    _set_bot_token(monkeypatch)
    calls: list[tuple[str, dict[str, object]]] = []
    monkeypatch.setattr(runtime, "_request_json", _fake_slack_api(calls))

    result = CliRunner().invoke(cli, ["--json", "mention", "scan"])
    assert result.exit_code == 0
    payload = _json_output(result)
    data = payload["data"]
    assert calls[0][0] == "auth.test"
    assert calls[1][0] == "search.messages"
    assert calls[1][1]["query"] == "<@U123>"
    assert data["bot_user_id"] == "U123"
    assert data["scope_preview"] == "Example > Mentions for @agent-bot: #general - Direct mention"
    assert data["scope"]["bot_handle"] == "@agent-bot"
    assert data["picker"]["items"][0]["surface"] == "mention.scan"
    assert data["picker"]["items"][0]["label"] == "#general - Direct mention"


def test_mention_scan_uses_scoped_user_id_override(monkeypatch):
    _set_bot_token(monkeypatch)
    _set_operator_service_keys(monkeypatch, {"SLACK_USER_ID": "U234"})
    calls: list[tuple[str, dict[str, object]]] = []
    monkeypatch.setattr(runtime, "_request_json", _fake_slack_api(calls))

    result = CliRunner().invoke(cli, ["--json", "mention", "scan"])
    assert result.exit_code == 0
    payload = _json_output(result)
    data = payload["data"]
    assert calls[1][1]["query"] == "<@U234>"
    assert data["target_user_id"] == "U234"
    assert data["scope"]["target_user_id"] == "U234"


def test_message_reply_uses_scoped_channel_and_thread_defaults(monkeypatch):
    _set_bot_token(monkeypatch)
    _set_operator_service_keys(
        monkeypatch,
        {
            "SLACK_CHANNEL_ID": "C123",
            "SLACK_THREAD_TS": "1700000000.000000",
        },
    )
    calls: list[tuple[str, dict[str, object]]] = []
    monkeypatch.setattr(runtime, "_request_json", _fake_slack_api(calls))

    result = CliRunner().invoke(cli, ["--json", "--mode", "write", "message", "reply", "--text", "hello there"])
    assert result.exit_code == 0
    payload = _json_output(result)
    assert calls[0][0] == "chat.postMessage"
    assert calls[0][1]["channel"] == "C123"
    assert calls[0][1]["thread_ts"] == "1700000000.000000"
    assert payload["data"]["thread_ts"] == "1700000000.000000"


def test_reaction_list_uses_reactions_list(monkeypatch):
    _set_bot_token(monkeypatch)
    calls: list[tuple[str, dict[str, object]]] = []
    monkeypatch.setattr(runtime, "_request_json", _fake_slack_api(calls))

    result = CliRunner().invoke(cli, ["--json", "reaction", "list"])
    assert result.exit_code == 0
    payload = _json_output(result)
    data = payload["data"]
    assert calls[0][0] == "auth.test"
    assert calls[1][0] == "reactions.list"
    assert data["scope_preview"] == "Example > Reactions by @agent-bot: :wave: - #C123 - hello bot"
    assert data["scope"]["selection_surface"] == "reaction"
    assert data["picker"]["items"][0]["kind"] == "reaction"
    assert data["picker"]["items"][0]["label"] == ":wave: - #C123 - hello bot"


def test_permission_denied_for_write_path_in_readonly():
    result = CliRunner().invoke(cli, ["--json", "--mode", "readonly", "message", "reply", "C123", "--text", "hello there"])
    assert result.exit_code == 3
    assert "PERMISSION_DENIED" in result.output
