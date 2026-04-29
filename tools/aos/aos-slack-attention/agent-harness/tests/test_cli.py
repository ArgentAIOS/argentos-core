from __future__ import annotations

import json
from pathlib import Path

from click.testing import CliRunner

from cli_aos.slack_attention import cli as attention_cli
from cli_aos.slack_attention.cli import cli, runtime_config
from cli_aos.slack_attention.service_keys import service_key_details


def test_capabilities_json_matches_manifest():
    result = CliRunner().invoke(cli, ["--json", "capabilities"])
    assert result.exit_code == 0
    envelope = json.loads(result.output)
    manifest = json.loads((Path(__file__).resolve().parents[2] / "connector.json").read_text())
    assert envelope["tool"] == "aos-slack-attention"
    assert envelope["command"] == "capabilities"
    assert envelope["data"]["tool"] == manifest["tool"]
    assert envelope["data"]["scope"]["eventContract"]["event_type"] == "operator.alert.candidate"


def test_health_needs_setup_without_operator_config(monkeypatch):
    monkeypatch.delenv("SLACK_BOT_TOKEN", raising=False)
    monkeypatch.delenv("SLACK_ATTENTION_CHANNELS", raising=False)
    result = CliRunner().invoke(cli, ["--json", "health"])
    assert result.exit_code == 0
    payload = json.loads(result.output)["data"]
    assert payload["status"] == "needs_setup"
    assert "SLACK_BOT_TOKEN" in payload["missing"]
    assert "SLACK_ATTENTION_CHANNELS" in payload["missing"]


def test_operator_context_wins_for_runtime_config():
    ctx = {
        "service_keys": {
            "aos-slack-attention": {
                "bot_token": "xoxb-token",
                "channels": "C123,C456",
                "keywords": "urgent,blocked",
            }
        }
    }
    config = runtime_config(ctx)
    assert config["bot_token"] == "xoxb-token"
    assert config["bot_token_source"] == "operator:service_keys:tool"
    assert config["channels"] == ["C123", "C456"]
    assert config["keywords"] == ["urgent", "blocked"]


def test_scoped_repo_service_key_blocks_env_fallback(tmp_path, monkeypatch):
    keys_path = tmp_path / "service-keys.json"
    keys_path.write_text(
        json.dumps(
            {
                "keys": [
                    {
                        "variable": "SLACK_BOT_TOKEN",
                        "value": "repo-token",
                        "enabled": True,
                        "allowedRoles": ["operator"],
                    }
                ]
            }
        )
    )
    monkeypatch.setattr("cli_aos.slack_attention.service_keys.SERVICE_KEYS_PATH", keys_path)
    monkeypatch.setenv("SLACK_BOT_TOKEN", "env-token")
    details = service_key_details("SLACK_BOT_TOKEN")
    assert details["source"] == "repo-service-key-scoped"
    assert details["blocked"] is True
    assert details["value"] == ""


def test_scan_now_emits_alert_candidates(monkeypatch, tmp_path):
    monkeypatch.setenv("SLACK_BOT_TOKEN", "xoxb-test")

    def fake_slack_api(method: str, token: str, *, params=None):
        assert method == "conversations.history"
        assert token == "xoxb-test"
        assert params["channel"] == "C123"
        return {
            "ok": True,
            "messages": [
                {
                    "ts": "1714400000.000100",
                    "user": "U999",
                    "text": "Jason this is urgent and blocked",
                },
                {
                    "ts": "1714400001.000100",
                    "user": "U999",
                    "text": "ordinary chatter",
                },
            ],
        }

    monkeypatch.setattr(attention_cli, "slack_api", fake_slack_api)
    result = CliRunner().invoke(
        cli,
        [
            "--json",
            "scan",
            "now",
            "--channels",
            "C123",
            "--keywords",
            "urgent,blocked",
            "--mention-names",
            "Jason",
            "--state-path",
            str(tmp_path / "state.json"),
        ],
    )
    assert result.exit_code == 0
    payload = json.loads(result.output)["data"]
    assert payload["candidate_count"] == 1
    candidate = payload["candidates"][0]
    assert candidate["event_type"] == "operator.alert.candidate"
    assert candidate["source_provider"] == "slack"
    assert candidate["severity"] == "high"
    assert candidate["title"] == "Slack attention: operator name, keyword high signal"
    assert candidate["dedupe_key"] == "slack:C123:1714400000.000100"


def test_scan_now_requires_rules(monkeypatch):
    monkeypatch.setenv("SLACK_BOT_TOKEN", "xoxb-test")
    result = CliRunner().invoke(cli, ["--json", "scan", "now", "--channels", "C123"])
    assert result.exit_code == 4
    assert "Configure at least one Slack attention keyword" in result.output
