from __future__ import annotations

import json
from pathlib import Path
from typing import Any

from click.testing import CliRunner

from cli_aos.claude_code.cli import cli
import cli_aos.claude_code.runtime as runtime


AGENT_HARNESS_ROOT = Path(__file__).resolve().parents[1]
CONNECTOR_PATH = AGENT_HARNESS_ROOT.parent / "connector.json"
PERMISSIONS_PATH = AGENT_HARNESS_ROOT / "permissions.json"


class FakeClaudeClient:
    def is_available(self) -> bool:
        return True

    def version(self) -> dict[str, Any]:
        return {"version": "1.2.3"}

    def prompt_send(
        self,
        *,
        prompt: str,
        project_dir: str | None = None,
        session_id: str | None = None,
        model: str | None = None,
        stream: bool = False,
    ) -> dict[str, Any]:
        return {
            "response": f"handled: {prompt}",
            "project_dir": project_dir,
            "session_id": session_id,
            "model": model,
            "stream": stream,
        }

    def session_list(self, *, limit: int = 10, project_dir: str | None = None) -> dict[str, Any]:
        return {
            "sessions": [
                {
                    "id": "sess-1",
                    "project": project_dir or "/tmp/project",
                    "model": "claude-sonnet-4-6",
                    "status": "active",
                }
            ][:limit]
        }

    def session_resume(
        self,
        *,
        session_id: str,
        prompt: str | None = None,
        project_dir: str | None = None,
        model: str | None = None,
    ) -> dict[str, Any]:
        return {"session_id": session_id, "prompt": prompt, "project_dir": project_dir, "model": model}

    def hook_list(self, *, project_dir: str | None = None) -> dict[str, Any]:
        return {"hooks": [{"id": "hook-1", "event": "post-tool", "matcher": "*", "command": "echo ok"}]}

    def hook_create(
        self,
        *,
        event: str,
        matcher: str,
        command: str,
        project_dir: str | None = None,
    ) -> dict[str, Any]:
        return {"id": "hook-2", "event": event, "matcher": matcher, "command": command, "project_dir": project_dir}

    def config_get(self, *, key: str | None = None, project_dir: str | None = None) -> dict[str, Any]:
        return {"key": key or "default", "value": "on"}

    def config_set(self, *, key: str, value: str, project_dir: str | None = None) -> dict[str, Any]:
        return {"key": key, "value": value}

    def mcp_list(self, *, project_dir: str | None = None) -> dict[str, Any]:
        return {"servers": [{"name": "linear", "status": "ready", "type": "http"}]}

    def mcp_call(
        self,
        *,
        server: str,
        tool: str,
        input_payload: dict[str, Any],
        project_dir: str | None = None,
    ) -> dict[str, Any]:
        return {"server": server, "tool": tool, "input": input_payload}


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
    assert manifest["scope"]["kind"] == "ai-coding"


def test_capabilities_exposes_manifest():
    payload = invoke_json(["capabilities"])
    assert payload["tool"] == "aos-claude-code"
    assert payload["data"]["backend"] == "claude-code-cli"
    assert "prompt.send" in json.dumps(payload["data"])
    assert "mcp.call" in json.dumps(payload["data"])


def test_health_requires_cli(monkeypatch):
    class MissingClient(FakeClaudeClient):
        def is_available(self) -> bool:
            return False

    monkeypatch.setattr(runtime, "create_client", lambda ctx_obj: MissingClient())
    payload = invoke_json(["health"])
    assert payload["data"]["status"] == "needs_setup"
    assert payload["data"]["probe"]["code"] == "CLAUDE_CODE_NOT_INSTALLED"


def test_health_ready_with_fake_client(monkeypatch):
    monkeypatch.setattr(runtime, "create_client", lambda ctx_obj: FakeClaudeClient())
    payload = invoke_json(["health"])
    assert payload["data"]["status"] == "ready"
    assert payload["data"]["probe"]["details"]["version"]["version"] == "1.2.3"


def test_config_show_redacts_credentials(monkeypatch):
    monkeypatch.setenv("ANTHROPIC_API_KEY", "super-secret-key")
    payload = invoke_json(["config", "show"])
    encoded = json.dumps(payload["data"])
    assert "super-secret-key" not in encoded
    assert payload["data"]["auth"]["api_key_present"] is True


def test_session_list_returns_picker(monkeypatch):
    monkeypatch.setattr(runtime, "create_client", lambda ctx_obj: FakeClaudeClient())
    payload = invoke_json(["session", "list"])
    assert payload["data"]["picker"]["kind"] == "claude_code_session"
    assert payload["data"]["sessions"][0]["id"] == "sess-1"


def test_prompt_send_requires_write_mode():
    result = CliRunner().invoke(cli, ["--json", "--mode", "readonly", "prompt", "send", "--prompt", "hi"])
    payload = json.loads(result.output)
    assert payload["ok"] is False
    assert payload["error"]["code"] == "PERMISSION_DENIED"


def test_prompt_send_succeeds_in_write_mode(monkeypatch):
    monkeypatch.setattr(runtime, "create_client", lambda ctx_obj: FakeClaudeClient())
    payload = invoke_json_with_mode("write", ["prompt", "send", "--prompt", "ship it", "--model", "claude-sonnet-4-6"])
    assert payload["data"]["status"] == "live_write"
    assert payload["data"]["result"]["response"] == "handled: ship it"


def test_hook_create_succeeds_in_write_mode(monkeypatch):
    monkeypatch.setattr(runtime, "create_client", lambda ctx_obj: FakeClaudeClient())
    payload = invoke_json_with_mode(
        "write",
        ["hook", "create", "--event", "post-tool", "--matcher", "*", "--command", "echo ok"],
    )
    assert payload["data"]["result"]["event"] == "post-tool"


def test_mcp_call_requires_json_payload(monkeypatch):
    monkeypatch.setattr(runtime, "create_client", lambda ctx_obj: FakeClaudeClient())
    result = CliRunner().invoke(
        cli,
        ["--json", "--mode", "write", "mcp", "call", "--server", "linear", "--tool", "list_issues", "--input-json", "not-json"],
    )
    payload = json.loads(result.output)
    assert payload["ok"] is False
    assert payload["error"]["code"] == "CLAUDE_CODE_MCP_INPUT_JSON_REQUIRED"


def test_mcp_list_and_call_succeed(monkeypatch):
    monkeypatch.setattr(runtime, "create_client", lambda ctx_obj: FakeClaudeClient())
    read_payload = invoke_json(["mcp", "list"])
    assert read_payload["data"]["servers"][0]["name"] == "linear"
    write_payload = invoke_json_with_mode(
        "write",
        ["mcp", "call", "--server", "linear", "--tool", "list_issues", "--input-json", "{\"team\":\"WEB\"}"],
    )
    assert write_payload["data"]["result"]["input"]["team"] == "WEB"
