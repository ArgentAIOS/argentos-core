from __future__ import annotations

import json
from pathlib import Path

from click.testing import CliRunner

from cli_aos.vip_email import cli as vip_cli
from cli_aos.vip_email.cli import cli, runtime_config
from cli_aos.vip_email.service_keys import service_key_details


def test_capabilities_json_matches_manifest():
    result = CliRunner().invoke(cli, ["--json", "capabilities"])
    assert result.exit_code == 0
    envelope = json.loads(result.output)
    manifest = json.loads((Path(__file__).resolve().parents[2] / "connector.json").read_text())
    assert envelope["tool"] == "aos-vip-email"
    assert envelope["command"] == "capabilities"
    assert envelope["data"]["tool"] == manifest["tool"]
    assert envelope["data"]["scope"]["eventContract"]["event_type"] == "operator.alert.candidate"


def test_health_needs_setup_without_operator_config(monkeypatch):
    monkeypatch.delenv("GOOGLE_WORKSPACE_ACCOUNT", raising=False)
    monkeypatch.delenv("VIP_EMAIL_SENDERS", raising=False)
    result = CliRunner().invoke(cli, ["--json", "health"])
    assert result.exit_code == 0
    payload = json.loads(result.output)["data"]
    assert payload["status"] == "needs_setup"
    assert "GOOGLE_WORKSPACE_ACCOUNT" in payload["missing"]
    assert "VIP_EMAIL_SENDERS" in payload["missing"]


def test_operator_context_wins_for_runtime_config():
    ctx = {
        "service_keys": {
            "aos-vip-email": {
                "account": "ops@example.com",
                "senders": "dustin@example.com,richard@example.com",
            }
        }
    }
    config = runtime_config(ctx)
    assert config["account"] == "ops@example.com"
    assert config["account_source"] == "operator:service_keys:tool"
    assert config["vip_senders"] == ["dustin@example.com", "richard@example.com"]


def test_scoped_repo_service_key_blocks_env_fallback(tmp_path, monkeypatch):
    keys_path = tmp_path / "service-keys.json"
    keys_path.write_text(
        json.dumps(
            {
                "keys": [
                    {
                        "variable": "VIP_EMAIL_SENDERS",
                        "value": "operator@example.com",
                        "enabled": True,
                        "allowedRoles": ["operator"],
                    }
                ]
            }
        )
    )
    monkeypatch.setattr("cli_aos.vip_email.service_keys.SERVICE_KEYS_PATH", keys_path)
    monkeypatch.setenv("VIP_EMAIL_SENDERS", "env@example.com")
    details = service_key_details("VIP_EMAIL_SENDERS")
    assert details["source"] == "repo-service-key-scoped"
    assert details["blocked"] is True
    assert details["value"] == ""


def test_scan_now_emits_alert_candidates(monkeypatch, tmp_path):
    def fake_run_gws(_gws_bin: str, args: list[str]):
        assert args[:4] == ["gmail", "users", "messages", "list"]
        assert "--account" in args
        assert "from:dustin@example.com" in args[args.index("--query") + 1]
        return {
            "messages": [
                {
                    "id": "msg-1",
                    "snippet": "Please review the proposal.",
                    "payload": {
                        "headers": [
                            {"name": "From", "value": "Dustin <dustin@example.com>"},
                            {"name": "Subject", "value": "Need approval"},
                            {"name": "Date", "value": "Wed, 29 Apr 2026 09:00:00 -0500"},
                        ]
                    },
                }
            ]
        }

    monkeypatch.setattr(vip_cli, "run_gws", fake_run_gws)
    result = CliRunner().invoke(
        cli,
        [
            "--json",
            "scan",
            "now",
            "--gws-bin",
            "fake-gws",
            "--account",
            "ops@example.com",
            "--vip-senders",
            "dustin@example.com",
            "--state-path",
            str(tmp_path / "state.json"),
        ],
    )
    assert result.exit_code == 0
    payload = json.loads(result.output)["data"]
    assert payload["candidate_count"] == 1
    candidate = payload["candidates"][0]
    assert candidate["event_type"] == "operator.alert.candidate"
    assert candidate["source_provider"] == "google-workspace-gmail"
    assert candidate["dedupe_key"].startswith("gmail:ops@example.com:msg-1")


def test_scan_now_requires_vip_senders(monkeypatch):
    monkeypatch.setenv("GOOGLE_WORKSPACE_ACCOUNT", "ops@example.com")
    monkeypatch.delenv("VIP_EMAIL_SENDERS", raising=False)
    result = CliRunner().invoke(cli, ["--json", "scan", "now", "--gws-bin", "fake-gws"])
    assert result.exit_code == 4
    assert "VIP_EMAIL_SENDERS is not configured" in result.output
