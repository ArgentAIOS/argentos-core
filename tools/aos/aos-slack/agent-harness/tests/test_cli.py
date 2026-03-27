from __future__ import annotations

import json

from click.testing import CliRunner

import cli_aos.slack.runtime as runtime
from cli_aos.slack.cli import cli

BOT_TOKEN = "xoxb-test-token"


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
