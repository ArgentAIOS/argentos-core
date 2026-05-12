from __future__ import annotations

import json

from click.testing import CliRunner

import cli_aos.subctl.cli as subctl_cli
from cli_aos.subctl.cli import cli


def _json(result):
    return json.loads(result.output)


def test_capabilities_returns_manifest():
    result = CliRunner().invoke(cli, ["--json", "capabilities"])
    assert result.exit_code == 0
    payload = _json(result)
    assert payload["ok"] is True
    assert payload["tool"] == "aos-subctl"
    assert payload["data"]["tool"] == "aos-subctl"
    assert payload["data"]["backend"] == "subctl-http"
    cmd_ids = {c["id"] for c in payload["data"]["commands"]}
    assert "orchestration.spawn" in cmd_ids
    assert "notify.send" in cmd_ids
    assert "state.get" in cmd_ids


def test_health_check_reports_degraded_when_dashboard_unreachable(monkeypatch):
    monkeypatch.setenv("SUBCTL_API", "http://127.0.0.1:65535")
    result = CliRunner().invoke(cli, ["--json", "health.check"])
    assert result.exit_code == 0
    payload = _json(result)
    assert payload["command"] == "health.check"
    assert payload["data"]["status"] == "degraded"
    assert payload["data"]["runtime_ready"] is False


def test_health_reports_healthy_when_state_returns(monkeypatch):
    def fake_request(method, path, body=None, timeout=20):
        assert method == "GET"
        assert path == "/api/state"
        return {
            "dispatch": {"verdict": "green"},
            "accounts": [{"alias": "claude-personal"}, {"alias": "claude-work"}],
            "sessions": [{"name": "release-prep"}],
        }

    monkeypatch.setattr(subctl_cli, "_http_request", fake_request)
    result = CliRunner().invoke(cli, ["--json", "health"])
    assert result.exit_code == 0
    payload = _json(result)
    assert payload["data"]["status"] == "healthy"
    assert payload["data"]["verdict"] == "green"
    assert payload["data"]["accounts_count"] == 2
    assert payload["data"]["sessions_count"] == 1


def test_orchestration_spawn_posts_to_dashboard(monkeypatch):
    calls = []

    def fake_request(method, path, body=None, timeout=20):
        calls.append((method, path, body))
        if path == "/api/orchestration/spawn":
            return {"ok": True, "name": body["name"], "account": body["account"]}
        return {}

    monkeypatch.setattr(subctl_cli, "_http_request", fake_request)
    result = CliRunner().invoke(
        cli,
        [
            "--json",
            "--mode",
            "write",
            "orchestration",
            "spawn",
            "--name",
            "release-prep",
            "--account",
            "claude-personal",
            "--task",
            "ship 2.4",
        ],
    )
    assert result.exit_code == 0
    payload = _json(result)
    assert payload["command"] == "orchestration.spawn"
    assert payload["data"]["status"] == "live_write"
    assert calls == [
        (
            "POST",
            "/api/orchestration/spawn",
            {"name": "release-prep", "account": "claude-personal", "task": "ship 2.4"},
        )
    ]


def test_orchestration_msg_targets_named_session(monkeypatch):
    captured: dict = {}

    def fake_request(method, path, body=None, timeout=20):
        captured["method"] = method
        captured["path"] = path
        captured["body"] = body
        return {"ok": True}

    monkeypatch.setattr(subctl_cli, "_http_request", fake_request)
    result = CliRunner().invoke(
        cli,
        [
            "--json",
            "--mode",
            "write",
            "orchestration",
            "msg",
            "--name",
            "release-prep",
            "--text",
            "status?",
        ],
    )
    assert result.exit_code == 0
    assert captured["method"] == "POST"
    assert captured["path"] == "/api/orchestration/release-prep/msg"
    assert captured["body"] == {"text": "status?"}


def test_write_command_blocked_in_readonly_mode(monkeypatch):
    """Default mode is readonly — orchestration.spawn must be denied."""
    result = CliRunner().invoke(
        cli,
        [
            "--json",
            "orchestration",
            "spawn",
            "--name",
            "x",
            "--account",
            "y",
            "--task",
            "z",
        ],
    )
    assert result.exit_code == 3
    payload = _json(result)
    assert payload["ok"] is False
    assert payload["error"]["code"] == "PERMISSION_DENIED"


def test_config_show_lists_defaults(monkeypatch):
    monkeypatch.delenv("SUBCTL_API", raising=False)
    monkeypatch.delenv("SUBCTL_BIN", raising=False)
    result = CliRunner().invoke(cli, ["--json", "config", "show"])
    assert result.exit_code == 0
    payload = _json(result)
    assert payload["data"]["api_base"] == "http://127.0.0.1:8787"
    assert payload["data"]["auth"]["api_source"] == "default"
    assert payload["data"]["auth"]["bin_source"] == "default"
