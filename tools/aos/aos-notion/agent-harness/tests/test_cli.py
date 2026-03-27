from __future__ import annotations

import json
from pathlib import Path

from click.testing import CliRunner

from cli_aos.notion.cli import cli
import cli_aos.notion.runtime as runtime


AGENT_HARNESS_ROOT = Path(__file__).resolve().parents[1]
CONNECTOR_PATH = AGENT_HARNESS_ROOT.parent / "connector.json"
PERMISSIONS_PATH = AGENT_HARNESS_ROOT / "permissions.json"


class FakeNotionClient:
    def current_user(self):
        return {"object": "user", "id": "user_123", "name": "Alex", "type": "person"}

    def list_databases(self, *, limit: int):
        return {
            "results": [
                {
                    "object": "database",
                    "id": "db_1",
                    "title": [{"plain_text": "Ops"}],
                    "url": "https://www.notion.so/db_1",
                },
                {
                    "object": "database",
                    "id": "db_2",
                    "title": [{"plain_text": "Plans"}],
                    "url": "https://www.notion.so/db_2",
                },
            ][:limit],
            "has_more": False,
            "next_cursor": None,
        }

    def query_database(self, database_id: str, *, limit: int, filter_expression: str | None):
        results = [
            {
                "object": "page",
                "id": "page_1",
                "properties": {"Name": {"title": [{"plain_text": "Project plan"}]}},
            },
            {
                "object": "page",
                "id": "page_2",
                "properties": {"Name": {"title": [{"plain_text": "Weekly notes"}]}},
            },
        ]
        if filter_expression:
            needle = filter_expression.casefold()
            results = [
                item
                for item in results
                if needle in json.dumps(item, sort_keys=True, default=str).casefold()
            ]
        return {
            "results": results[:limit],
            "has_more": False,
            "next_cursor": None,
            "filter_expression": filter_expression,
            "filter_mode": "client-text" if filter_expression else "none",
        }

    def read_page(self, page_id: str):
        return {
            "page": {
                "object": "page",
                "id": page_id,
                "properties": {"Name": {"title": [{"plain_text": "Spec draft"}]}},
            },
            "blocks": {
                "object": "block",
                "id": page_id,
                "type": "paragraph",
                "has_children": False,
            },
        }

    def read_block(self, block_id: str):
        return {
            "block": {
                "object": "block",
                "id": block_id,
                "type": "heading_1",
                "has_children": True,
            },
            "children": [
                {
                    "object": "block",
                    "id": "child_1",
                    "type": "paragraph",
                    "has_children": False,
                }
            ],
        }

    def search(self, *, query: str, limit: int):
        return {
            "results": [
                {
                    "object": "page",
                    "id": "page_99",
                    "title": [{"plain_text": "Search hit"}],
                    "url": "https://www.notion.so/page_99",
                }
            ][:limit],
            "has_more": False,
            "next_cursor": None,
        }

    def read_database(self, database_id: str):
        return {
            "object": "database",
            "id": database_id,
            "title": [{"plain_text": "Quarterly Notes"}],
            "properties": {
                "Name": {"id": "title", "type": "title", "title": {}},
            },
        }

    def create_page(self, *, title: str, database_id: str | None, parent_page_id: str | None):
        return {
            "object": "page",
            "id": "page_created",
            "parent": {"database_id": database_id, "page_id": parent_page_id},
            "title": title,
        }

    def update_page(self, page_id: str, *, title: str):
        return {
            "object": "page",
            "id": page_id,
            "title": title,
        }

    def append_block_children(self, block_id: str, *, content: str):
        return {
            "object": "block",
            "id": block_id,
            "content": content,
        }


def _invoke(args: list[str], monkeypatch):
    monkeypatch.setattr(runtime, "create_client", lambda ctx_obj: FakeNotionClient())
    return CliRunner().invoke(cli, args)


def test_manifest_and_permissions_are_in_sync():
    manifest = json.loads(CONNECTOR_PATH.read_text())
    permissions = json.loads(PERMISSIONS_PATH.read_text())["permissions"]
    manifest_command_ids = [command["id"] for command in manifest["commands"]]

    assert set(manifest_command_ids) == set(permissions.keys())
    assert "capabilities" in manifest_command_ids
    assert "search.query" in manifest_command_ids


def test_capabilities_json_matches_manifest():
    result = CliRunner().invoke(cli, ["--json", "capabilities"])
    assert result.exit_code == 0

    envelope = json.loads(result.output)
    payload = envelope["data"]
    manifest = json.loads(CONNECTOR_PATH.read_text())

    assert envelope["tool"] == "aos-notion"
    assert envelope["command"] == "capabilities"
    assert payload["tool"] == manifest["tool"]
    assert payload["backend"] == manifest["backend"]
    assert payload["manifest_schema_version"] == manifest["manifest_schema_version"]
    assert payload["connector"] == manifest["connector"]
    assert payload["auth"] == manifest["auth"]
    assert payload["commands"] == manifest["commands"]


def test_health_reports_needs_setup_without_env(monkeypatch):
    monkeypatch.delenv("NOTION_TOKEN", raising=False)
    monkeypatch.delenv("NOTION_VERSION", raising=False)
    monkeypatch.delenv("NOTION_WORKSPACE_ID", raising=False)

    result = CliRunner().invoke(cli, ["--json", "health"])
    assert result.exit_code == 0

    payload = json.loads(result.output)
    assert payload["data"]["status"] == "needs_setup"
    assert payload["data"]["live_backend_available"] is False
    assert "NOTION_TOKEN" in payload["data"]["checks"][0]["details"]["missing_keys"]


def test_health_reports_ready_when_probe_succeeds(monkeypatch):
    monkeypatch.setenv("NOTION_TOKEN", "secret_token")
    monkeypatch.setenv("NOTION_VERSION", "2022-06-28")
    monkeypatch.setenv("NOTION_WORKSPACE_ID", "workspace-123")
    monkeypatch.setattr(runtime, "create_client", lambda ctx_obj: FakeNotionClient())

    result = CliRunner().invoke(cli, ["--json", "health"])
    assert result.exit_code == 0

    payload = json.loads(result.output)
    assert payload["data"]["status"] == "ready"
    assert payload["data"]["runtime_ready"] is True
    assert payload["data"]["live_backend_available"] is True
    assert payload["data"]["connector"]["live_read_available"] is True


def test_doctor_reports_live_read_when_setup_is_complete(monkeypatch):
    monkeypatch.setenv("NOTION_TOKEN", "secret_token")
    monkeypatch.setenv("NOTION_VERSION", "2022-06-28")
    monkeypatch.setenv("NOTION_WORKSPACE_ID", "workspace-123")
    monkeypatch.setattr(runtime, "create_client", lambda ctx_obj: FakeNotionClient())

    result = CliRunner().invoke(cli, ["--json", "doctor"])
    assert result.exit_code == 0

    payload = json.loads(result.output)
    assert payload["data"]["status"] == "ready"
    assert payload["data"]["runtime_ready"] is True
    assert payload["data"]["live_backend_available"] is True
    assert "secret_token" not in result.output


def test_config_show_redacts_token_values(monkeypatch):
    monkeypatch.setenv("NOTION_TOKEN", "secret_token")
    monkeypatch.setenv("NOTION_VERSION", "2022-06-28")
    monkeypatch.setenv("NOTION_WORKSPACE_ID", "workspace-123")
    monkeypatch.setattr(runtime, "create_client", lambda ctx_obj: FakeNotionClient())

    result = CliRunner().invoke(cli, ["--json", "config", "show"])
    assert result.exit_code == 0
    assert "secret_token" not in result.output
    assert '"token_present": true' in result.output
    assert '"runtime_ready": true' in result.output
    assert '"scaffold_only": false' in result.output


def test_permission_gate_blocks_write_for_readonly():
    result = CliRunner().invoke(cli, ["--json", "--mode", "readonly", "page", "create", "--title", "Test Page"])
    assert result.exit_code == 3
    assert "PERMISSION_DENIED" in result.output


def test_database_list_returns_live_payload(monkeypatch):
    monkeypatch.setenv("NOTION_TOKEN", "secret_token")
    monkeypatch.setattr(runtime, "create_client", lambda ctx_obj: FakeNotionClient())

    result = _invoke(["--json", "database", "list", "--limit", "5"], monkeypatch)
    assert result.exit_code == 0
    payload = json.loads(result.output)["data"]
    assert payload["status"] == "ok"
    assert payload["command"] == "database.list"
    assert payload["scope"]["kind"] == "workspace"
    assert payload["scope"]["selection_surface"] == "database"
    assert payload["scope_preview"] == "Accessible databases: Ops, Plans"
    assert payload["picker"]["items"][0]["label"] == "Ops"
    assert payload["picker"]["items"][0]["scope_preview"] == "Accessible databases > Ops"
    assert payload["result_types"] == {"database": 2}
    assert "scaffold_only" not in payload


def test_database_list_plain_output_prefers_scope_preview(monkeypatch):
    monkeypatch.setenv("NOTION_TOKEN", "secret_token")
    monkeypatch.setattr(runtime, "create_client", lambda ctx_obj: FakeNotionClient())

    result = CliRunner().invoke(cli, ["database", "list", "--limit", "5"])
    assert result.exit_code == 0
    assert result.output.strip() == "Accessible databases: Ops, Plans"


def test_database_query_applies_text_filter(monkeypatch):
    monkeypatch.setenv("NOTION_TOKEN", "secret_token")
    monkeypatch.setattr(runtime, "create_client", lambda ctx_obj: FakeNotionClient())

    result = _invoke(["--json", "database", "query", "db_1", "--filter", "project", "--limit", "5"], monkeypatch)
    assert result.exit_code == 0
    payload = json.loads(result.output)["data"]
    assert payload["database_id"] == "db_1"
    assert payload["filter_mode"] == "client-text"
    assert payload["scope"]["kind"] == "database"
    assert payload["scope"]["id"] == "db_1"
    assert payload["scope_preview"] == "Database db_1 rows: Project plan"
    assert payload["picker"]["scope"]["selection_surface"] == "page"
    assert payload["picker"]["items"][0]["label"] == "Project plan"
    assert payload["picker"]["items"][0]["scope_preview"] == "Database db_1 > Project plan"
    assert payload["result_types"] == {"page": 1}
    assert len(payload["results"]) == 1
    assert payload["results"][0]["id"] == "page_1"


def test_page_read_returns_live_payload(monkeypatch):
    monkeypatch.setenv("NOTION_TOKEN", "secret_token")
    monkeypatch.setattr(runtime, "create_client", lambda ctx_obj: FakeNotionClient())

    result = _invoke(["--json", "page", "read", "page_1"], monkeypatch)
    assert result.exit_code == 0
    payload = json.loads(result.output)["data"]
    assert payload["page_id"] == "page_1"
    assert payload["page_title"] == "Spec draft"
    assert payload["scope"]["kind"] == "page"
    assert payload["scope"]["id"] == "page_1"
    assert payload["scope_preview"] == "Page Spec draft"
    assert payload["picker"]["items"][0]["label"] == "Spec draft"
    assert payload["page"]["id"] == "page_1"
    assert payload["blocks"]["id"] == "page_1"


def test_block_read_returns_live_payload(monkeypatch):
    monkeypatch.setenv("NOTION_TOKEN", "secret_token")
    monkeypatch.setattr(runtime, "create_client", lambda ctx_obj: FakeNotionClient())

    result = _invoke(["--json", "block", "read", "block_1"], monkeypatch)
    assert result.exit_code == 0
    payload = json.loads(result.output)["data"]
    assert payload["block_id"] == "block_1"
    assert payload["block"]["id"] == "block_1"
    assert payload["children"][0]["id"] == "child_1"


def test_search_query_returns_live_payload(monkeypatch):
    monkeypatch.setenv("NOTION_TOKEN", "secret_token")
    monkeypatch.setattr(runtime, "create_client", lambda ctx_obj: FakeNotionClient())

    result = _invoke(["--json", "search", "query", "project plan"], monkeypatch)
    assert result.exit_code == 0
    payload = json.loads(result.output)["data"]
    assert payload["query"] == "project plan"
    assert payload["scope"]["kind"] == "workspace"
    assert payload["scope"]["selection_surface"] == "database,page"
    assert payload["scope_preview"] == "Search 'project plan': Search hit"
    assert payload["picker"]["items"][0]["kind"] == "page"
    assert payload["results"][0]["id"] == "page_99"
    assert payload["live_backend_available"] is True


def test_write_commands_execute_live(monkeypatch):
    monkeypatch.setenv("NOTION_TOKEN", "secret_token")
    monkeypatch.setattr(runtime, "create_client", lambda ctx_obj: FakeNotionClient())

    create_result = CliRunner().invoke(
        cli,
        ["--json", "--mode", "write", "page", "create", "--database-id", "db_1", "--title", "Quarterly Notes"],
    )
    assert create_result.exit_code == 0
    assert '"status": "live_write"' in create_result.output
    assert '"command_id": "page.create"' in create_result.output
    assert '"executed": true' in create_result.output

    update_result = CliRunner().invoke(
        cli,
        ["--json", "--mode", "write", "page", "update", "page_1", "--title", "Updated Notes"],
    )
    assert update_result.exit_code == 0
    assert '"status": "live_write"' in update_result.output
    assert '"command_id": "page.update"' in update_result.output
    assert '"executed": true' in update_result.output

    append_result = CliRunner().invoke(
        cli,
        ["--json", "--mode", "write", "block", "append", "block_1", "--content", "New text"],
    )
    assert append_result.exit_code == 0
    assert '"status": "live_write"' in append_result.output
    assert '"command_id": "block.append"' in append_result.output
    assert '"executed": true' in append_result.output


def test_probe_runtime_reports_live_read_when_token_exists(monkeypatch):
    monkeypatch.setenv("NOTION_TOKEN", "secret_token")
    monkeypatch.setattr(runtime, "create_client", lambda ctx_obj: FakeNotionClient())

    payload = runtime.probe_runtime({})
    assert payload["ok"] is True
    assert payload["details"]["probe_mode"] == "live-read"
    assert payload["details"]["live_backend_available"] is True


def test_read_command_without_token_errors(monkeypatch):
    monkeypatch.delenv("NOTION_TOKEN", raising=False)

    result = CliRunner().invoke(cli, ["--json", "database", "list", "--limit", "5"])
    assert result.exit_code == 4
    payload = json.loads(result.output)
    assert payload["ok"] is False
    assert payload["error"]["code"] == "NOTION_SETUP_REQUIRED"
