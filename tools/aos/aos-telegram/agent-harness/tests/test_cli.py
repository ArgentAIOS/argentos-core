from __future__ import annotations

import json

from click.testing import CliRunner

import cli_aos.telegram.cli as telegram_cli
from cli_aos.telegram.cli import cli


def _json(result):
    return json.loads(result.output)


def test_health_check_reports_needs_setup_without_token(monkeypatch):
    monkeypatch.delenv("TELEGRAM_BOT_TOKEN", raising=False)

    result = CliRunner().invoke(cli, ["--json", "health.check"])

    assert result.exit_code == 0
    payload = _json(result)
    assert payload["command"] == "health.check"
    assert payload["data"]["status"] == "needs_setup"
    assert payload["data"]["runtime_ready"] is False


def test_message_send_uses_telegram_send_message(monkeypatch):
    monkeypatch.setenv("TELEGRAM_BOT_TOKEN", "token")
    calls = []

    def fake_request(method, token, params=None):
        calls.append((method, token, params or {}))
        return {"ok": True, "result": {"message_id": 123, "chat": {"id": params["chat_id"]}, "text": params["text"]}}

    monkeypatch.setattr(telegram_cli, "_api_request", fake_request)

    result = CliRunner().invoke(cli, ["--json", "--mode", "write", "message", "send", "--chat-id", "42", "--text", "hello"])

    assert result.exit_code == 0
    payload = _json(result)
    assert payload["command"] == "message.send"
    assert payload["data"]["status"] == "live_write"
    assert calls == [("sendMessage", "token", {"chat_id": "42", "text": "hello"})]
