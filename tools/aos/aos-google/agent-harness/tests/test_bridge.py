from __future__ import annotations

from cli_aos.google import bridge


def test_run_gws_uses_gws_default_json_output(monkeypatch):
    captured = {}

    monkeypatch.setattr(bridge.shutil, "which", lambda _name: "/usr/bin/gws")

    class Proc:
        returncode = 0
        stdout = '{"ok": true}'
        stderr = ""

    def fake_run(cmd, capture_output, text, check, env):
        captured["cmd"] = cmd
        captured["env"] = env
        return Proc()

    monkeypatch.setattr(bridge.subprocess, "run", fake_run)

    result = bridge.run_gws("gws", ["gmail", "users", "messages", "list"])

    assert captured["cmd"] == ["gws", "gmail", "users", "messages", "list"]
    assert result == {"ok": True}
