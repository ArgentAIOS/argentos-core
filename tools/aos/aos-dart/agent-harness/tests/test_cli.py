from __future__ import annotations

import json
from pathlib import Path

from click.testing import CliRunner

from cli_aos.dart.cli import cli
import cli_aos.dart.runtime as runtime


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
    assert payload["tool"] == "aos-dart"
    assert payload["backend"] == "dart-api"
    assert "dartboard.list" in json.dumps(payload["data"])
    assert "task.create" in json.dumps(payload["data"])


def test_health_requires_api_key(monkeypatch):
    monkeypatch.delenv("DART_API_KEY", raising=False)
    monkeypatch.delenv("DART_DARTBOARD_ID", raising=False)
    monkeypatch.setattr(runtime, "resolve_runtime_binary", lambda: None)
    payload = invoke_json(["health"])
    assert payload["data"]["status"] == "needs_setup"
    assert "DART_API_KEY" in json.dumps(payload["data"])


def test_config_show_redacts_key(monkeypatch):
    monkeypatch.setenv("DART_API_KEY", "very-secret-key")
    monkeypatch.setenv("DART_DARTBOARD_ID", "db_abc123")
    payload = invoke_json(["config", "show"])
    data = payload["data"]
    assert "very-secret-key" not in json.dumps(data)
    assert data["config"]["api_key"] == "<redacted>"
    assert data["runtime"]["implementation_mode"] == "live_read_write"
    assert data["scope"]["dartboard_id"] == "db_abc123"
