from __future__ import annotations

import json
from pathlib import Path
from typing import Any

from click.testing import CliRunner

from cli_aos.supabase.cli import cli
import cli_aos.supabase.runtime as runtime


AGENT_HARNESS_ROOT = Path(__file__).resolve().parents[1]
CONNECTOR_PATH = AGENT_HARNESS_ROOT.parent / "connector.json"
PERMISSIONS_PATH = AGENT_HARNESS_ROOT / "permissions.json"


class FakeSupabaseClient:
    def probe(self) -> dict[str, Any]:
        return {"ok": True, "details": {"version": "12.2.0"}}

    def table_select(self, table: str, *, select: str = "*", filter_str: str | None = None, limit: int = 100) -> list[dict[str, Any]]:
        return [
            {"id": 1, "name": "Alice", "email": "alice@example.com"},
            {"id": 2, "name": "Bob", "email": "bob@example.com"},
        ][:limit]

    def table_insert(self, table: str, *, row: dict[str, Any]) -> dict[str, Any]:
        return {"id": 3, **row}

    def table_update(self, table: str, *, filter_str: str, updates: dict[str, Any]) -> list[dict[str, Any]]:
        return [{"id": 1, **updates}]

    def table_delete(self, table: str, *, filter_str: str) -> list[dict[str, Any]]:
        return [{"id": 1, "name": "Alice"}]

    def rpc_call(self, function_name: str, *, params: dict[str, Any] | None = None) -> Any:
        return {"result": "ok", "function": function_name}

    def storage_list_files(self, bucket: str, *, prefix: str = "", limit: int = 100) -> list[dict[str, Any]]:
        return [
            {"name": "report.pdf", "id": "abc-123", "created_at": "2026-01-01T00:00:00Z"},
            {"name": "data.csv", "id": "def-456", "created_at": "2026-01-02T00:00:00Z"},
        ][:limit]

    def storage_download_url(self, bucket: str, file_path: str) -> str:
        return f"https://xxx.supabase.co/storage/v1/object/public/{bucket}/{file_path}"


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
    assert manifest["scope"]["kind"] == "database"


def test_capabilities_exposes_manifest():
    payload = invoke_json(["capabilities"])
    assert payload["tool"] == "aos-supabase"
    assert payload["data"]["backend"] == "supabase-api"
    assert "table.select" in json.dumps(payload["data"])
    assert "storage.list" in json.dumps(payload["data"])


def test_health_requires_credentials(monkeypatch):
    monkeypatch.delenv("SUPABASE_URL", raising=False)
    monkeypatch.delenv("SUPABASE_SERVICE_ROLE_KEY", raising=False)
    payload = invoke_json(["health"])
    assert payload["data"]["status"] == "needs_setup"
    assert "SUPABASE_URL" in json.dumps(payload["data"])


def test_health_ready_with_fake_client(monkeypatch):
    monkeypatch.setenv("SUPABASE_URL", "https://test.supabase.co")
    monkeypatch.setenv("SUPABASE_SERVICE_ROLE_KEY", "eyJ0ZXN0Ijp0cnVlfQ")
    monkeypatch.setattr(runtime, "create_client", lambda ctx_obj: FakeSupabaseClient())
    payload = invoke_json(["health"])
    assert payload["data"]["status"] == "ready"
    assert payload["data"]["probe"]["ok"] is True


def test_project_info_returns_probe(monkeypatch):
    monkeypatch.setenv("SUPABASE_URL", "https://test.supabase.co")
    monkeypatch.setenv("SUPABASE_SERVICE_ROLE_KEY", "eyJ0ZXN0Ijp0cnVlfQ")
    monkeypatch.setattr(runtime, "create_client", lambda ctx_obj: FakeSupabaseClient())
    payload = invoke_json(["project", "info"])
    assert payload["data"]["project_url"] == "https://test.supabase.co"
    assert payload["data"]["scope_preview"]["command_id"] == "project.info"


def test_table_select_returns_rows(monkeypatch):
    monkeypatch.setenv("SUPABASE_URL", "https://test.supabase.co")
    monkeypatch.setenv("SUPABASE_SERVICE_ROLE_KEY", "eyJ0ZXN0Ijp0cnVlfQ")
    monkeypatch.setattr(runtime, "create_client", lambda ctx_obj: FakeSupabaseClient())
    payload = invoke_json(["table", "select", "users", "--limit", "1"])
    data = payload["data"]
    assert data["row_count"] == 1
    assert data["rows"][0]["name"] == "Alice"
    assert data["scope_preview"]["table"] == "users"


def test_table_insert_requires_write_mode(monkeypatch):
    monkeypatch.setenv("SUPABASE_URL", "https://test.supabase.co")
    monkeypatch.setenv("SUPABASE_SERVICE_ROLE_KEY", "eyJ0ZXN0Ijp0cnVlfQ")
    result = CliRunner().invoke(cli, ["--json", "--mode", "readonly", "table", "insert", "users", "--row", '{"name":"Charlie"}'])
    payload = json.loads(result.output)
    assert payload["ok"] is False
    assert payload["error"]["code"] == "PERMISSION_DENIED"


def test_table_insert_with_write_mode(monkeypatch):
    monkeypatch.setenv("SUPABASE_URL", "https://test.supabase.co")
    monkeypatch.setenv("SUPABASE_SERVICE_ROLE_KEY", "eyJ0ZXN0Ijp0cnVlfQ")
    monkeypatch.setattr(runtime, "create_client", lambda ctx_obj: FakeSupabaseClient())
    payload = invoke_json_with_mode("write", ["table", "insert", "users", "--row", '{"name":"Charlie"}'])
    assert payload["data"]["status"] == "live_write"
    assert payload["data"]["inserted"]["name"] == "Charlie"


def test_storage_list_returns_files(monkeypatch):
    monkeypatch.setenv("SUPABASE_URL", "https://test.supabase.co")
    monkeypatch.setenv("SUPABASE_SERVICE_ROLE_KEY", "eyJ0ZXN0Ijp0cnVlfQ")
    monkeypatch.setattr(runtime, "create_client", lambda ctx_obj: FakeSupabaseClient())
    payload = invoke_json(["storage", "list", "documents"])
    data = payload["data"]
    assert data["file_count"] == 2
    assert data["bucket"] == "documents"


def test_rpc_call_with_write_mode(monkeypatch):
    monkeypatch.setenv("SUPABASE_URL", "https://test.supabase.co")
    monkeypatch.setenv("SUPABASE_SERVICE_ROLE_KEY", "eyJ0ZXN0Ijp0cnVlfQ")
    monkeypatch.setattr(runtime, "create_client", lambda ctx_obj: FakeSupabaseClient())
    payload = invoke_json_with_mode("write", ["rpc", "call", "my_function"])
    assert payload["data"]["function"] == "my_function"
    assert payload["data"]["scope_preview"]["command_id"] == "rpc.call"
