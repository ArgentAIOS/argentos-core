from __future__ import annotations

import json
from pathlib import Path
from typing import Any

from click.testing import CliRunner
import pytest

from cli_aos.dart.cli import cli
import cli_aos.dart.client as dart_client
import cli_aos.dart.runtime as runtime
import cli_aos.dart.service_keys as service_keys


HARNESS_ROOT = Path(__file__).resolve().parents[1]
CONNECTOR_PATH = HARNESS_ROOT.parent / "connector.json"
PERMISSIONS_PATH = HARNESS_ROOT / "permissions.json"


class FakeResponse:
    def __init__(self, payload: dict[str, Any] | list[dict[str, Any]], status: int = 200) -> None:
        self._payload = json.dumps(payload).encode("utf-8")
        self.status = status
        self.headers: dict[str, str] = {}

    def read(self) -> bytes:
        return self._payload

    def __enter__(self) -> "FakeResponse":
        return self

    def __exit__(self, exc_type, exc, tb) -> bool:
        return False


@pytest.fixture(autouse=True)
def no_operator_service_key_by_default(monkeypatch):
    service_keys.resolve_service_key.cache_clear()
    monkeypatch.setattr(service_keys, "resolve_service_key", lambda variable: None)


def invoke_json(
    args: list[str],
    monkeypatch,
    *,
    transport=None,
    service_key_values: dict[str, str] | None = None,
) -> dict[str, object]:
    if service_key_values is not None:
        monkeypatch.setattr(service_keys, "resolve_service_key", lambda variable: service_key_values.get(variable))
    if transport is not None:
        monkeypatch.setattr(dart_client, "urlopen", transport)
    result = CliRunner().invoke(cli, ["--json", *args])
    assert result.exit_code == 0, result.output
    return json.loads(result.output)


def write_transport_for(
    *,
    method: str,
    path: str,
    response: dict[str, Any],
    expected_auth: str,
    expected_body: dict[str, Any] | None = None,
):
    def _transport(request, timeout=30):  # noqa: ARG001
        assert request.get_method() == method
        assert path in request.full_url
        assert request.headers.get("Authorization") == f"Bearer {expected_auth}"
        if expected_body is not None:
            assert json.loads((request.data or b"{}").decode("utf-8")) == expected_body
        return FakeResponse(response)

    return _transport


def test_manifest_and_permissions_are_in_sync():
    manifest = json.loads(CONNECTOR_PATH.read_text())
    permissions = json.loads(PERMISSIONS_PATH.read_text())["permissions"]
    command_ids = [command["id"] for command in manifest["commands"]]
    assert set(command_ids) == set(permissions.keys())
    assert manifest["scope"]["kind"] == "project-management"
    assert "task.create" in command_ids
    assert manifest["scope"]["commandDefaults"]["comment.create"]["options"]["task_id"] == "DART_TASK_ID"


def test_cli_help_lists_required_commands():
    result = CliRunner().invoke(cli, ["--help"])
    assert result.exit_code == 0
    assert "capabilities" in result.output
    assert "health" in result.output
    assert "config" in result.output
    assert "task" in result.output


def test_capabilities_exposes_manifest(monkeypatch):
    payload = invoke_json(["capabilities"], monkeypatch)
    assert payload["ok"] is True
    assert payload["tool"] == "aos-dart"
    assert payload["command"] == "capabilities"
    assert payload["data"]["backend"] == "dart-api"
    assert payload["data"]["manifest_schema_version"] == "1.0.0"
    assert payload["data"]["modes"] == ["readonly", "write", "full", "admin"]
    assert "task.create" in json.dumps(payload["data"]["commands"])


def test_health_requires_api_key(monkeypatch):
    monkeypatch.delenv("DART_API_KEY", raising=False)
    monkeypatch.delenv("DART_DARTBOARD_ID", raising=False)
    monkeypatch.setattr(runtime, "resolve_runtime_binary", lambda: None)
    payload = invoke_json(["health"], monkeypatch)
    assert payload["data"]["status"] == "needs_setup"
    assert "DART_API_KEY" in json.dumps(payload["data"])


def test_config_show_redacts_key(monkeypatch):
    monkeypatch.setenv("DART_API_KEY", "env-secret-key")
    monkeypatch.setenv("DART_DARTBOARD_ID", "db_abc123")
    payload = invoke_json(
        ["config", "show"],
        monkeypatch,
        service_key_values={"DART_API_KEY": "operator-secret-key"},
    )
    data = payload["data"]
    assert "env-secret-key" not in json.dumps(data)
    assert "operator-secret-key" not in json.dumps(data)
    assert data["config"]["api_key"] == "<redacted>"
    assert data["auth"]["sources"]["DART_API_KEY"] == "service-keys"
    assert data["runtime"]["implementation_mode"] == "live_read_write"
    assert data["runtime"]["service_key_precedence"] == "service-keys-first-with-env-fallback"
    assert data["scope"]["dartboard_id"] == "db_abc123"


def test_health_reports_ready_with_fake_client(monkeypatch):
    class FakeDartClient:
        def list_dartboards(self, *, limit: int = 5) -> dict[str, Any]:
            return {"dartboards": [{"id": "db_1", "title": "Roadmap"}][:limit]}

        def get_dartboard(self, dartboard_id: str) -> dict[str, Any]:
            return {"dartboard": {"id": dartboard_id, "title": "Roadmap"}}

        def list_tasks(self, *, dartboard_id: str | None = None, assignee: str | None = None, status: str | None = None, limit: int = 5) -> dict[str, Any]:
            return {"tasks": [{"id": "task_1", "title": "Ship connector"}][:limit]}

        def get_task(self, task_id: str) -> dict[str, Any]:
            return {"task": {"id": task_id, "title": "Ship connector"}}

    monkeypatch.setenv("DART_API_KEY", "env-secret-key")
    monkeypatch.setenv("DART_DARTBOARD_ID", "db_1")
    monkeypatch.setenv("DART_TASK_ID", "task_1")
    monkeypatch.setattr(runtime, "resolve_runtime_binary", lambda: None)
    monkeypatch.setattr(runtime, "create_client", lambda config: FakeDartClient())
    payload = invoke_json(["health"], monkeypatch)
    assert payload["data"]["status"] == "ready"
    assert payload["data"]["probe"]["ok"] is True
    assert payload["data"]["probe"]["details"]["dartboard"]["id"] == "db_1"


def test_write_command_requires_write_mode():
    result = CliRunner().invoke(cli, ["--json", "task", "create", "Ship connector"])
    assert result.exit_code == 3
    payload = json.loads(result.output)
    assert payload["ok"] is False
    assert payload["error"]["code"] == "PERMISSION_DENIED"


def test_task_create_prefers_operator_service_keys_for_live_write(monkeypatch):
    monkeypatch.setenv("DART_API_KEY", "env-secret-key")
    monkeypatch.setenv("DART_DARTBOARD_ID", "db_123")
    transport = write_transport_for(
        method="POST",
        path="/tasks/create",
        expected_auth="operator-secret-key",
        expected_body={
            "dartboard_id": "db_123",
            "title": "Ship connector",
            "description": "Wire the true harness",
            "priority": "high",
        },
        response={"id": "task_123", "title": "Ship connector", "priority": "high"},
    )
    payload = invoke_json(
        [
            "--mode",
            "write",
            "task",
            "create",
            "Ship connector",
            "--description",
            "Wire the true harness",
            "--priority",
            "high",
        ],
        monkeypatch,
        transport=transport,
        service_key_values={"DART_API_KEY": "operator-secret-key"},
    )
    assert payload["data"]["status"] == "live_write"
    assert payload["data"]["task"]["id"] == "task_123"
    assert payload["data"]["scope_preview"]["dartboard_id"] == "db_123"


def test_task_update_rejects_empty_write(monkeypatch):
    monkeypatch.setenv("DART_API_KEY", "env-secret-key")
    monkeypatch.setenv("DART_TASK_ID", "task_123")
    result = CliRunner().invoke(cli, ["--json", "--mode", "write", "task", "update"])
    assert result.exit_code == 2
    payload = json.loads(result.output)
    assert payload["ok"] is False
    assert payload["error"]["code"] == "INVALID_USAGE"


def test_task_delete_accepts_task_id_option(monkeypatch):
    monkeypatch.setenv("DART_API_KEY", "env-secret-key")
    transport = write_transport_for(
        method="DELETE",
        path="/tasks/task_999",
        expected_auth="env-secret-key",
        response={},
    )
    payload = invoke_json(
        ["--mode", "write", "task", "delete", "--task-id", "task_999"],
        monkeypatch,
        transport=transport,
    )
    assert payload["data"]["status"] == "live_write"
    assert payload["data"]["deleted"] is True
    assert payload["data"]["task_id"] == "task_999"


def test_doc_get_uses_scoped_default_doc_id(monkeypatch):
    monkeypatch.setenv("DART_API_KEY", "env-secret-key")
    monkeypatch.setenv("DART_DOC_ID", "doc_321")
    transport = write_transport_for(
        method="GET",
        path="/docs/doc_321",
        expected_auth="env-secret-key",
        response={"id": "doc_321", "title": "Connector notes"},
    )
    payload = invoke_json(["doc", "get"], monkeypatch, transport=transport)
    assert payload["data"]["status"] == "live_read"
    assert payload["data"]["doc"]["id"] == "doc_321"
    assert payload["data"]["scope_preview"]["doc_id"] == "doc_321"
