from __future__ import annotations

import json
from pathlib import Path

from click.testing import CliRunner

from cli_aos.clickup.cli import cli
import cli_aos.clickup.runtime as runtime


HARNESS_ROOT = Path(__file__).resolve().parents[1]
CONNECTOR_PATH = HARNESS_ROOT.parent / "connector.json"
PERMISSIONS_PATH = HARNESS_ROOT / "permissions.json"


def invoke_json(args: list[str]) -> dict[str, object]:
    result = CliRunner().invoke(cli, ["--json", *args])
    assert result.exit_code == 0, result.output
    return json.loads(result.output)


def test_manifest_and_permissions_are_in_sync():
    manifest = json.loads(CONNECTOR_PATH.read_text())
    permissions = json.loads(PERMISSIONS_PATH.read_text())["permissions"]
    command_ids = [command["id"] for command in manifest["commands"]]
    assert set(command_ids) == set(permissions.keys())
    assert manifest["scope"]["kind"] == "project-management"
    assert "task.create" in command_ids


def test_capabilities_exposes_manifest():
    payload = invoke_json(["capabilities"])
    assert payload["tool"] == "aos-clickup"
    assert payload["backend"] == "clickup-api"
    assert "task.create" in json.dumps(payload["data"])
    assert "comment.list" in json.dumps(payload["data"])


def test_health_requires_token_and_workspace(monkeypatch):
    monkeypatch.delenv("CLICKUP_API_TOKEN", raising=False)
    monkeypatch.delenv("CLICKUP_ACCESS_TOKEN", raising=False)
    monkeypatch.delenv("CLICKUP_WORKSPACE_ID", raising=False)
    monkeypatch.setattr(runtime, "resolve_runtime_binary", lambda: None)
    payload = invoke_json(["health"])
    assert payload["data"]["status"] == "needs_setup"
    assert "CLICKUP_API_TOKEN" in json.dumps(payload["data"])


def test_config_show_redacts_and_surfaces_scope(monkeypatch):
    monkeypatch.setenv("CLICKUP_API_TOKEN", "very-secret-token")
    monkeypatch.setenv("CLICKUP_WORKSPACE_ID", "12345678")
    monkeypatch.setenv("CLICKUP_SPACE_ID", "space_abc123")
    monkeypatch.setenv("CLICKUP_LIST_ID", "list_abc123")
    monkeypatch.setenv("CLICKUP_TASK_ID", "task_abc123")
    payload = invoke_json(["config", "show"])
    data = payload["data"]
    assert "very-secret-token" not in json.dumps(data)
    assert data["config"]["api_token"] == "<redacted>"
    assert data["runtime"]["implementation_mode"] == "live_read_write"
    assert data["runtime"]["live_read_surfaces"] == ["workspace", "space", "list", "task", "comment", "doc", "time_tracking", "goal"]
