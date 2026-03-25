from __future__ import annotations

import json
from pathlib import Path
from typing import Any

from click.testing import CliRunner

from cli_aos.airtable.cli import cli
from cli_aos.airtable import client as airtable_client


AGENT_HARNESS_ROOT = Path(__file__).resolve().parents[1]
CONNECTOR_PATH = AGENT_HARNESS_ROOT.parent / "connector.json"
PERMISSIONS_PATH = AGENT_HARNESS_ROOT / "permissions.json"


class FakeResponse:
    def __init__(self, payload: dict[str, Any], status: int = 200) -> None:
        self._payload = json.dumps(payload).encode("utf-8")
        self.status = status

    def read(self) -> bytes:
        return self._payload

    def getcode(self) -> int:
        return self.status

    def __enter__(self) -> "FakeResponse":
        return self

    def __exit__(self, exc_type, exc, tb) -> bool:
        return False


def invoke_json(args: list[str], monkeypatch, transport=None) -> dict[str, Any]:
    if transport is not None:
        monkeypatch.setattr(airtable_client, "urlopen", transport)
    result = CliRunner().invoke(cli, ["--json", *args])
    assert result.exit_code == 0, result.output
    return json.loads(result.output)


def transport_for(routes: dict[str, dict[str, Any]]):
    def _transport(request, timeout=30):  # noqa: ARG001
        url = getattr(request, "full_url", str(request))
        for needle, payload in routes.items():
            if needle in url:
                return FakeResponse(payload)
        raise AssertionError(f"unexpected Airtable request: {url}")

    return _transport


def test_manifest_and_permissions_are_in_sync():
    manifest = json.loads(CONNECTOR_PATH.read_text())
    permissions = json.loads(PERMISSIONS_PATH.read_text())["permissions"]
    manifest_command_ids = [command["id"] for command in manifest["commands"]]

    assert "capabilities" in manifest_command_ids
    assert "doctor" in manifest_command_ids
    assert set(manifest_command_ids) == set(permissions.keys())
    assert manifest["scope"]["kind"] == "base-table-record"
    assert manifest["scope"]["commandDefaults"]["record.list"]["options"]["table"] == "AIRTABLE_TABLE_NAME"


def test_capabilities_json_includes_manifest_metadata():
    payload = invoke_json(["capabilities"], monkeypatch=None)
    assert payload["tool"] == "aos-airtable"
    assert payload["manifest_schema_version"] == "1.0.0"
    assert "record.create_draft" in json.dumps(payload)
    assert "read_support" in payload
    assert payload["scope"]["commandDefaults"]["table.read"]["args"] == ["AIRTABLE_TABLE_NAME"]


def test_health_reports_needs_setup_without_env(monkeypatch):
    monkeypatch.delenv("AIRTABLE_API_TOKEN", raising=False)
    monkeypatch.delenv("AIRTABLE_BASE_ID", raising=False)
    payload = invoke_json(["health"], monkeypatch)
    data = payload["data"]
    assert data["status"] == "needs_setup"
    assert data["live_backend_ready"] is False
    assert data["base_scoped_read_ready"] is False
    assert "AIRTABLE_API_TOKEN" in json.dumps(data)


def test_health_reports_partial_ready_when_token_present_but_base_missing(monkeypatch):
    monkeypatch.setenv("AIRTABLE_API_TOKEN", "pat_test_123")
    monkeypatch.delenv("AIRTABLE_BASE_ID", raising=False)
    payload = invoke_json(["health"], monkeypatch)
    data = payload["data"]
    assert data["status"] == "partial_ready"
    assert data["live_backend_ready"] is True
    assert data["base_scoped_read_ready"] is False


def test_health_reports_ready_when_setup_present(monkeypatch):
    monkeypatch.setenv("AIRTABLE_API_TOKEN", "pat_test_123")
    monkeypatch.setenv("AIRTABLE_BASE_ID", "app123")
    payload = invoke_json(["health"], monkeypatch)
    data = payload["data"]
    assert data["status"] == "ready"
    assert data["live_backend_ready"] is True
    assert data["base_scoped_read_ready"] is True


def test_config_show_redacts_sensitive_values(monkeypatch):
    monkeypatch.setenv("AIRTABLE_API_TOKEN", "pat_super_secret")
    monkeypatch.setenv("AIRTABLE_BASE_ID", "app123")
    monkeypatch.setenv("AIRTABLE_TABLE_NAME", "Projects")
    monkeypatch.setenv("AIRTABLE_WORKSPACE_ID", "wsp456")
    payload = invoke_json(["config", "show"], monkeypatch)
    data = payload["data"]
    assert "pat_super_secret" not in json.dumps(data)
    assert data["runtime"]["implementation_mode"] == "live_read_only"
    assert data["read_support"]["base.list"] is True
    assert data["read_support"]["record.read"] is True
    assert data["write_support"]["scaffold_only"] is True
    assert data["scope"]["table_name"] == "Projects"
    assert data["scope"]["commandDefaults"]["record.list"]["options"]["table"] == "Projects"


def test_doctor_reports_live_read_support_when_setup_present(monkeypatch):
    monkeypatch.setenv("AIRTABLE_API_TOKEN", "pat_test_123")
    monkeypatch.setenv("AIRTABLE_BASE_ID", "app123")
    monkeypatch.setenv("AIRTABLE_TABLE_NAME", "Projects")
    payload = invoke_json(["doctor"], monkeypatch)
    data = payload["data"]
    assert data["status"] == "ready"
    assert data["runtime"]["command_readiness"]["table.read"] is True
    assert data["runtime"]["base_scoped_read_ready"] is True
    assert data["runtime"]["table_name_present"] is True
    assert data["checks"][1]["details"]["implementation_mode"] == "live_read_only"


def test_base_list_reads_live_bases(monkeypatch):
    monkeypatch.setenv("AIRTABLE_API_TOKEN", "pat_test_123")
    monkeypatch.delenv("AIRTABLE_BASE_ID", raising=False)
    transport = transport_for(
        {
            "/v0/meta/bases": {
                "bases": [
                    {"id": "app111", "name": "Projects"},
                    {"id": "app222", "name": "Operations"},
                ]
            }
        }
    )
    payload = invoke_json(["base", "list", "--limit", "1"], monkeypatch, transport=transport)
    data = payload["data"]
    assert data["status"] == "live_read"
    assert data["base_count"] == 1
    assert data["bases"][0]["name"] == "Projects"
    assert data["picker"]["kind"] == "base"
    assert data["picker"]["items"][0]["label"] == "Projects (app111)"
    assert data["scope"]["preview"]["base_id"] is None
    assert data["scope"]["preview"]["table_name"] is None
    assert data["scope"]["preview"]["picker"]["kind"] == "base"


def test_base_list_marks_configured_base_as_selected(monkeypatch):
    monkeypatch.setenv("AIRTABLE_API_TOKEN", "pat_test_123")
    monkeypatch.setenv("AIRTABLE_BASE_ID", "app222")
    transport = transport_for(
        {
            "/v0/meta/bases": {
                "bases": [
                    {"id": "app111", "name": "Projects"},
                    {"id": "app222", "name": "Operations"},
                ]
            }
        }
    )
    payload = invoke_json(["base", "list"], monkeypatch, transport=transport)
    data = payload["data"]
    selected = next(item for item in data["picker"]["items"] if item["id"] == "app222")
    assert selected["selected"] is True


def test_base_read_returns_live_schema(monkeypatch):
    monkeypatch.setenv("AIRTABLE_API_TOKEN", "pat_test_123")
    monkeypatch.delenv("AIRTABLE_BASE_ID", raising=False)
    transport = transport_for(
        {
            "/v0/meta/bases/app123/tables": {
                "tables": [
                    {
                        "id": "tbl123",
                        "name": "Projects",
                        "fields": [{"id": "fld1", "name": "Name", "type": "singleLineText"}],
                        "views": [{"id": "viw1", "name": "Grid view"}],
                    }
                ]
            }
        }
    )
    payload = invoke_json(["base", "read", "app123"], monkeypatch, transport=transport)
    data = payload["data"]
    assert data["status"] == "live_read"
    assert data["base"]["id"] == "app123"
    assert data["table_count"] == 1
    assert data["tables"][0]["name"] == "Projects"
    assert data["base"]["table_picker"][0]["label"] == "Projects (tbl123)"
    assert data["base"]["selected_table_name"] is None
    assert data["scope"]["preview"]["base_id"] == "app123"
    assert data["scope"]["preview"]["table_name"] is None
    assert data["scope"]["preview"]["picker"]["kind"] == "table"


def test_base_read_uses_default_base_id_when_argument_is_omitted(monkeypatch):
    monkeypatch.setenv("AIRTABLE_API_TOKEN", "pat_test_123")
    monkeypatch.setenv("AIRTABLE_BASE_ID", "app123")
    transport = transport_for(
        {
            "/v0/meta/bases/app123/tables": {
                "tables": [
                    {"id": "tbl123", "name": "Projects", "fields": [], "views": []},
                ]
            }
        }
    )
    payload = invoke_json(["base", "read"], monkeypatch, transport=transport)
    data = payload["data"]
    assert data["status"] == "live_read"
    assert data["base"]["id"] == "app123"


def test_table_list_reads_live_schema(monkeypatch):
    monkeypatch.setenv("AIRTABLE_API_TOKEN", "pat_test_123")
    monkeypatch.setenv("AIRTABLE_BASE_ID", "app123")
    monkeypatch.setenv("AIRTABLE_TABLE_NAME", "Projects")
    transport = transport_for(
        {
            "/v0/meta/bases/app123/tables": {
                "tables": [
                    {"id": "tbl123", "name": "Projects", "fields": [], "views": []},
                    {"id": "tbl456", "name": "Tasks", "fields": [], "views": []},
                ]
            }
        }
    )
    payload = invoke_json(["table", "list"], monkeypatch, transport=transport)
    data = payload["data"]
    assert data["status"] == "live_read"
    assert data["table_count"] == 2
    assert [table["name"] for table in data["tables"]] == ["Projects", "Tasks"]
    assert data["base"]["selected_table_name"] == "Projects"
    assert data["table_picker"][0]["field_count"] == 0
    assert data["scope"]["preview"]["table_name"] == "Projects"
    assert data["scope"]["preview"]["picker"]["kind"] == "table"


def test_table_read_returns_live_table_schema(monkeypatch):
    monkeypatch.setenv("AIRTABLE_API_TOKEN", "pat_test_123")
    monkeypatch.setenv("AIRTABLE_BASE_ID", "app123")
    monkeypatch.setenv("AIRTABLE_TABLE_NAME", "Projects")
    transport = transport_for(
        {
            "/v0/meta/bases/app123/tables": {
                "tables": [
                    {"id": "tbl123", "name": "Projects", "fields": [], "views": []},
                    {"id": "tbl456", "name": "Tasks", "fields": [], "views": []},
                ]
            }
        }
    )
    payload = invoke_json(["table", "read", "Tasks"], monkeypatch, transport=transport)
    data = payload["data"]
    assert data["status"] == "live_read"
    assert data["table"]["name"] == "Tasks"
    assert data["base"]["id"] == "app123"
    assert data["table_picker"]["name"] == "Tasks"
    assert data["scope"]["preview"]["table_name"] == "Tasks"
    assert data["scope"]["preview"]["picker"]["kind"] == "table"


def test_table_read_uses_default_table_when_argument_is_omitted(monkeypatch):
    monkeypatch.setenv("AIRTABLE_API_TOKEN", "pat_test_123")
    monkeypatch.setenv("AIRTABLE_BASE_ID", "app123")
    monkeypatch.setenv("AIRTABLE_TABLE_NAME", "Projects")
    transport = transport_for(
        {
            "/v0/meta/bases/app123/tables": {
                "tables": [
                    {"id": "tbl123", "name": "Projects", "fields": [], "views": []},
                    {"id": "tbl456", "name": "Tasks", "fields": [], "views": []},
                ]
            }
        }
    )
    payload = invoke_json(["table", "read"], monkeypatch, transport=transport)
    data = payload["data"]
    assert data["status"] == "live_read"
    assert data["table"]["name"] == "Projects"


def test_record_list_reads_live_records(monkeypatch):
    monkeypatch.setenv("AIRTABLE_API_TOKEN", "pat_test_123")
    monkeypatch.setenv("AIRTABLE_BASE_ID", "app123")
    monkeypatch.setenv("AIRTABLE_TABLE_NAME", "Projects")
    transport = transport_for(
        {
            "/v0/app123/Projects?pageSize=2": {
                "records": [
                    {"id": "rec1", "createdTime": "2026-03-18T00:00:00.000Z", "fields": {"Name": "Alpha"}},
                    {"id": "rec2", "createdTime": "2026-03-18T00:00:00.000Z", "fields": {"Name": "Beta"}},
                ]
            }
        }
    )
    payload = invoke_json(["record", "list", "--limit", "2", "--table", "Projects"], monkeypatch, transport=transport)
    data = payload["data"]
    assert data["status"] == "live_read"
    assert data["record_count"] == 2
    assert [record["id"] for record in data["records"]] == ["rec1", "rec2"]
    assert data["base_id"] == "app123"
    assert data["scope"]["preview"]["table_name"] == "Projects"
    assert data["scope"]["preview"]["table_scope"]["record_readiness"]["record.list"] is True


def test_record_search_reads_and_filters_live_records(monkeypatch):
    monkeypatch.setenv("AIRTABLE_API_TOKEN", "pat_test_123")
    monkeypatch.setenv("AIRTABLE_BASE_ID", "app123")
    monkeypatch.setenv("AIRTABLE_TABLE_NAME", "Projects")
    transport = transport_for(
        {
            "/v0/app123/Projects?pageSize=100": {
                "records": [
                    {"id": "rec1", "fields": {"Name": "Alpha"}},
                    {"id": "rec2", "fields": {"Name": "Launch Plan"}},
                ]
            }
        }
    )
    payload = invoke_json(["record", "search", "--table", "Projects", "--query", "launch"], monkeypatch, transport=transport)
    data = payload["data"]
    assert data["status"] == "live_read"
    assert data["record_count"] == 1
    assert data["records"][0]["id"] == "rec2"
    assert data["search_strategy"] == "client_side_contains"


def test_record_list_uses_default_table_when_option_is_omitted(monkeypatch):
    monkeypatch.setenv("AIRTABLE_API_TOKEN", "pat_test_123")
    monkeypatch.setenv("AIRTABLE_BASE_ID", "app123")
    monkeypatch.setenv("AIRTABLE_TABLE_NAME", "Projects")
    transport = transport_for(
        {
            "/v0/app123/Projects?pageSize=2": {
                "records": [
                    {"id": "rec1", "createdTime": "2026-03-18T00:00:00.000Z", "fields": {"Name": "Alpha"}},
                    {"id": "rec2", "createdTime": "2026-03-18T00:00:00.000Z", "fields": {"Name": "Beta"}},
                ]
            }
        }
    )
    payload = invoke_json(["record", "list", "--limit", "2"], monkeypatch, transport=transport)
    data = payload["data"]
    assert data["status"] == "live_read"
    assert data["table"] == "Projects"
    assert data["record_count"] == 2


def test_record_search_uses_default_table_when_option_is_omitted(monkeypatch):
    monkeypatch.setenv("AIRTABLE_API_TOKEN", "pat_test_123")
    monkeypatch.setenv("AIRTABLE_BASE_ID", "app123")
    monkeypatch.setenv("AIRTABLE_TABLE_NAME", "Projects")
    transport = transport_for(
        {
            "/v0/app123/Projects?pageSize=100": {
                "records": [
                    {"id": "rec1", "fields": {"Name": "Alpha"}},
                    {"id": "rec2", "fields": {"Name": "Launch Plan"}},
                ]
            }
        }
    )
    payload = invoke_json(["record", "search", "--query", "launch"], monkeypatch, transport=transport)
    data = payload["data"]
    assert data["status"] == "live_read"
    assert data["table"] == "Projects"
    assert data["record_count"] == 1


def test_record_read_returns_live_record(monkeypatch):
    monkeypatch.setenv("AIRTABLE_API_TOKEN", "pat_test_123")
    monkeypatch.setenv("AIRTABLE_BASE_ID", "app123")
    monkeypatch.setenv("AIRTABLE_TABLE_NAME", "Projects")
    transport = transport_for(
        {
            "/v0/app123/Projects/rec1": {
                "id": "rec1",
                "createdTime": "2026-03-18T00:00:00.000Z",
                "fields": {"Name": "Alpha"},
            }
        }
    )
    payload = invoke_json(["record", "read", "rec1", "--table", "Projects"], monkeypatch, transport=transport)
    data = payload["data"]
    assert data["status"] == "live_read"
    assert data["record"]["id"] == "rec1"
    assert data["record"]["fields"]["Name"] == "Alpha"


def test_record_read_uses_default_table_when_option_is_omitted(monkeypatch):
    monkeypatch.setenv("AIRTABLE_API_TOKEN", "pat_test_123")
    monkeypatch.setenv("AIRTABLE_BASE_ID", "app123")
    monkeypatch.setenv("AIRTABLE_TABLE_NAME", "Projects")
    transport = transport_for(
        {
            "/v0/app123/Projects/rec1": {
                "id": "rec1",
                "createdTime": "2026-03-18T00:00:00.000Z",
                "fields": {"Name": "Alpha"},
            }
        }
    )
    payload = invoke_json(["record", "read", "rec1"], monkeypatch, transport=transport)
    data = payload["data"]
    assert data["status"] == "live_read"
    assert data["table"] == "Projects"
    assert data["record"]["id"] == "rec1"


def test_permission_denied_for_write_path_in_readonly():
    result = CliRunner().invoke(
        cli,
        [
            "--json",
            "--mode",
            "readonly",
            "record",
            "create-draft",
            "--table",
            "Projects",
            "--field",
            "Name=New Project",
        ],
    )
    assert result.exit_code == 3
    assert "PERMISSION_DENIED" in result.output
    assert "requires mode=write" in result.output


def test_write_command_stays_scaffolded_in_write_mode(monkeypatch):
    monkeypatch.setenv("AIRTABLE_API_TOKEN", "pat_test_123")
    monkeypatch.setenv("AIRTABLE_BASE_ID", "app123")
    result = CliRunner().invoke(
        cli,
        [
            "--json",
            "--mode",
            "write",
            "record",
            "update-draft",
            "rec123",
            "--table",
            "Projects",
            "--field",
            "Status=Draft",
        ],
    )
    assert result.exit_code == 0
    assert '"status": "scaffold"' in result.output
    assert '"executed": false' in result.output
    assert '"live_writes_enabled": false' in result.output
