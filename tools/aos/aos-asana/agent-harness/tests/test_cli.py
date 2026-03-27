from __future__ import annotations

import json
from pathlib import Path

from click.testing import CliRunner

from cli_aos.asana.cli import cli
import cli_aos.asana.runtime as runtime


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
    assert payload["tool"] == "aos-asana"
    assert payload["backend"] == "asana-api"
    assert "project.list" in json.dumps(payload["data"])
    assert "task.create" in json.dumps(payload["data"])


def test_health_requires_token_and_workspace(monkeypatch):
    monkeypatch.delenv("ASANA_ACCESS_TOKEN", raising=False)
    monkeypatch.delenv("ASANA_WORKSPACE_GID", raising=False)
    monkeypatch.setattr(runtime, "resolve_runtime_binary", lambda: None)
    payload = invoke_json(["health"])
    assert payload["data"]["status"] == "needs_setup"
    assert "ASANA_ACCESS_TOKEN" in json.dumps(payload["data"])


def test_config_show_redacts_token(monkeypatch):
    monkeypatch.setenv("ASANA_ACCESS_TOKEN", "very-secret-token")
    monkeypatch.setenv("ASANA_WORKSPACE_GID", "1234567890")
    monkeypatch.setenv("ASANA_PROJECT_GID", "9876543210")
    payload = invoke_json(["config", "show"])
    data = payload["data"]
    assert "very-secret-token" not in json.dumps(data)
    assert data["config"]["access_token"] == "<redacted>"
    assert data["runtime"]["implementation_mode"] == "live_read_write"
    assert data["scope"]["workspace_gid"] == "1234567890"
    assert data["scope"]["project_gid"] == "9876543210"
