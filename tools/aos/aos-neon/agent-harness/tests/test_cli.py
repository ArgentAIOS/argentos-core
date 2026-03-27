from __future__ import annotations

import json
from pathlib import Path
from typing import Any

from click.testing import CliRunner

from cli_aos.neon.cli import cli
import cli_aos.neon.runtime as runtime


AGENT_HARNESS_ROOT = Path(__file__).resolve().parents[1]
CONNECTOR_PATH = AGENT_HARNESS_ROOT.parent / "connector.json"
PERMISSIONS_PATH = AGENT_HARNESS_ROOT / "permissions.json"


class FakeNeonClient:
    def probe(self) -> dict[str, Any]:
        return {"ok": True, "details": {"rows": [{"ok": 1}]}}

    def sql_query(self, query: str, *, params: list[Any] | None = None) -> dict[str, Any]:
        return {
            "rows": [
                {"id": 1, "name": "Alice"},
                {"id": 2, "name": "Bob"},
            ],
            "fields": [{"name": "id"}, {"name": "name"}],
        }

    def sql_execute(self, statement: str, *, params: list[Any] | None = None) -> dict[str, Any]:
        return {"command": "INSERT", "rowCount": 1}

    def branch_list(self) -> list[dict[str, Any]]:
        return [
            {"id": "br-abc-123", "name": "main", "current_state": "ready", "created_at": "2026-01-01T00:00:00Z"},
            {"id": "br-def-456", "name": "dev", "current_state": "ready", "created_at": "2026-01-02T00:00:00Z"},
        ]

    def branch_create(self, *, name: str | None = None, parent_id: str | None = None) -> dict[str, Any]:
        return {
            "branch": {"id": "br-new-789", "name": name or "unnamed", "current_state": "init"},
        }

    def branch_delete(self, branch_id: str) -> dict[str, Any]:
        return {"branch": {"id": branch_id, "name": "deleted"}}

    def project_info(self) -> dict[str, Any]:
        return {
            "project": {
                "id": "proj-abc-123",
                "name": "My Neon Project",
                "region_id": "aws-us-east-2",
                "pg_version": 16,
            },
        }


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
    assert payload["tool"] == "aos-neon"
    assert payload["data"]["backend"] == "neon-api"
    assert "sql.query" in json.dumps(payload["data"])
    assert "branch.list" in json.dumps(payload["data"])


def test_health_requires_connection_string(monkeypatch):
    monkeypatch.delenv("NEON_CONNECTION_STRING", raising=False)
    monkeypatch.delenv("NEON_API_KEY", raising=False)
    payload = invoke_json(["health"])
    assert payload["data"]["status"] == "needs_setup"
    assert "NEON_CONNECTION_STRING" in json.dumps(payload["data"])


def test_health_ready_with_fake_client(monkeypatch):
    monkeypatch.setenv("NEON_CONNECTION_STRING", "postgresql://user:pass@ep-test.us-east-2.aws.neon.tech/dbname")
    monkeypatch.setenv("NEON_API_KEY", "neon_test_key_abc123")
    monkeypatch.setattr(runtime, "create_client", lambda ctx_obj: FakeNeonClient())
    payload = invoke_json(["health"])
    assert payload["data"]["status"] == "ready"
    assert payload["data"]["probe"]["ok"] is True


def test_sql_query_returns_rows(monkeypatch):
    monkeypatch.setenv("NEON_CONNECTION_STRING", "postgresql://user:pass@ep-test.us-east-2.aws.neon.tech/dbname")
    monkeypatch.setattr(runtime, "create_client", lambda ctx_obj: FakeNeonClient())
    payload = invoke_json(["sql", "query", "SELECT * FROM users"])
    data = payload["data"]
    assert data["row_count"] == 2
    assert data["scope_preview"]["command_id"] == "sql.query"


def test_sql_execute_requires_write_mode(monkeypatch):
    monkeypatch.setenv("NEON_CONNECTION_STRING", "postgresql://user:pass@ep-test.us-east-2.aws.neon.tech/dbname")
    result = CliRunner().invoke(cli, ["--json", "--mode", "readonly", "sql", "execute", "INSERT INTO users (name) VALUES ('Charlie')"])
    payload = json.loads(result.output)
    assert payload["ok"] is False
    assert payload["error"]["code"] == "PERMISSION_DENIED"


def test_sql_execute_with_write_mode(monkeypatch):
    monkeypatch.setenv("NEON_CONNECTION_STRING", "postgresql://user:pass@ep-test.us-east-2.aws.neon.tech/dbname")
    monkeypatch.setattr(runtime, "create_client", lambda ctx_obj: FakeNeonClient())
    payload = invoke_json_with_mode("write", ["sql", "execute", "INSERT INTO users (name) VALUES ('Charlie')"])
    assert payload["data"]["status"] == "live_write"
    assert payload["data"]["result"]["command"] == "INSERT"


def test_branch_list_returns_branches(monkeypatch):
    monkeypatch.setenv("NEON_CONNECTION_STRING", "postgresql://user:pass@ep-test.us-east-2.aws.neon.tech/dbname")
    monkeypatch.setenv("NEON_API_KEY", "neon_test_key_abc123")
    monkeypatch.setenv("NEON_PROJECT_ID", "proj-abc-123")
    monkeypatch.setattr(runtime, "create_client", lambda ctx_obj: FakeNeonClient())
    payload = invoke_json(["branch", "list"])
    data = payload["data"]
    assert data["branch_count"] == 2
    assert data["picker"]["kind"] == "branch"
    assert data["picker"]["items"][0]["label"] == "main"


def test_branch_create_with_write_mode(monkeypatch):
    monkeypatch.setenv("NEON_CONNECTION_STRING", "postgresql://user:pass@ep-test.us-east-2.aws.neon.tech/dbname")
    monkeypatch.setenv("NEON_API_KEY", "neon_test_key_abc123")
    monkeypatch.setenv("NEON_PROJECT_ID", "proj-abc-123")
    monkeypatch.setattr(runtime, "create_client", lambda ctx_obj: FakeNeonClient())
    payload = invoke_json_with_mode("write", ["branch", "create", "--name", "feature-x"])
    assert payload["data"]["status"] == "live_write"
    assert payload["data"]["scope_preview"]["command_id"] == "branch.create"


def test_branch_delete_requires_write_mode(monkeypatch):
    monkeypatch.setenv("NEON_CONNECTION_STRING", "postgresql://user:pass@ep-test.us-east-2.aws.neon.tech/dbname")
    monkeypatch.setenv("NEON_API_KEY", "neon_test_key_abc123")
    monkeypatch.setenv("NEON_PROJECT_ID", "proj-abc-123")
    result = CliRunner().invoke(cli, ["--json", "--mode", "readonly", "branch", "delete", "br-def-456"])
    payload = json.loads(result.output)
    assert payload["ok"] is False
    assert payload["error"]["code"] == "PERMISSION_DENIED"
