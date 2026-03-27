from __future__ import annotations

import json
from pathlib import Path
from typing import Any

from click.testing import CliRunner

from cli_aos.salesforce.cli import cli
import cli_aos.salesforce.runtime as runtime


AGENT_HARNESS_ROOT = Path(__file__).resolve().parents[1]
CONNECTOR_PATH = AGENT_HARNESS_ROOT.parent / "connector.json"
PERMISSIONS_PATH = AGENT_HARNESS_ROOT / "permissions.json"


class FakeSalesforceClient:
    def list_leads(self, *, limit: int = 10) -> list[dict[str, Any]]:
        leads = [
            {"id": "00Q1", "name": "Jane Doe", "email": "jane@example.com", "company": "Acme", "status": "Open"},
            {"id": "00Q2", "name": "John Smith", "email": "john@example.com", "company": "Globex", "status": "Contacted"},
        ]
        return leads[:limit]

    def get_lead(self, record_id: str) -> dict[str, Any]:
        return {"id": record_id, "name": "Jane Doe", "email": "jane@example.com", "company": "Acme", "status": "Open"}

    def list_contacts(self, *, limit: int = 10) -> list[dict[str, Any]]:
        return [{"id": "003A", "name": "Ada Lovelace", "email": "ada@example.com", "phone": "555-0100"}][:limit]

    def get_contact(self, record_id: str) -> dict[str, Any]:
        return {"id": record_id, "name": "Ada Lovelace", "email": "ada@example.com"}

    def list_opportunities(self, *, limit: int = 10) -> list[dict[str, Any]]:
        return [{"id": "006A", "name": "Big Deal", "stage": "Prospecting", "amount": 50000}][:limit]

    def get_opportunity(self, record_id: str) -> dict[str, Any]:
        return {"id": record_id, "name": "Big Deal", "stage": "Prospecting", "amount": 50000}

    def list_accounts(self, *, limit: int = 10) -> list[dict[str, Any]]:
        return [{"id": "001A", "name": "Acme Corp", "industry": "Technology"}][:limit]

    def get_account(self, record_id: str) -> dict[str, Any]:
        return {"id": record_id, "name": "Acme Corp", "industry": "Technology"}

    def list_tasks(self, *, limit: int = 10) -> list[dict[str, Any]]:
        return [{"id": "00T1", "subject": "Follow up", "status": "Not Started", "priority": "Normal"}][:limit]

    def run_report(self, report_id: str) -> dict[str, Any]:
        return {"reportMetadata": {"id": report_id, "name": "Test Report"}, "factMap": {}}

    def run_soql(self, soql: str) -> dict[str, Any]:
        return {"totalSize": 1, "records": [{"Id": "001A", "Name": "Acme Corp"}]}

    def probe(self) -> dict[str, Any]:
        return {"DailyApiRequests": {"Max": 15000, "Remaining": 14500}}

    def create_lead(self, *, name: str, company: str | None = None, email: str | None = None) -> dict[str, Any]:
        return {"id": "00QNEW", "name": name, "company": company, "email": email}

    def update_lead(self, record_id: str, *, fields: dict[str, Any]) -> dict[str, Any]:
        return {"id": record_id, **fields}

    def create_contact(self, *, last_name: str, email: str | None = None) -> dict[str, Any]:
        return {"id": "003NEW", "name": last_name, "email": email}

    def create_opportunity(self, *, name: str, stage: str | None = None, amount: float | None = None, close_date: str | None = None) -> dict[str, Any]:
        return {"id": "006NEW", "name": name, "stage": stage, "amount": amount, "close_date": close_date}

    def update_opportunity(self, record_id: str, *, fields: dict[str, Any]) -> dict[str, Any]:
        return {"id": record_id, **fields}

    def create_task(self, *, subject: str) -> dict[str, Any]:
        return {"id": "00TNEW", "subject": subject, "status": "Not Started"}


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
    assert manifest["scope"]["kind"] == "crm"


def test_capabilities_exposes_manifest():
    payload = invoke_json(["capabilities"])
    assert payload["tool"] == "aos-salesforce"
    assert payload["data"]["backend"] == "salesforce-api"
    assert "lead.list" in json.dumps(payload["data"])
    assert "search.soql" in json.dumps(payload["data"])


def test_health_requires_credentials(monkeypatch):
    monkeypatch.delenv("SALESFORCE_ACCESS_TOKEN", raising=False)
    monkeypatch.delenv("SALESFORCE_INSTANCE_URL", raising=False)
    payload = invoke_json(["health"])
    assert payload["data"]["status"] == "needs_setup"
    assert "SALESFORCE_ACCESS_TOKEN" in json.dumps(payload["data"])


def test_health_ready_with_fake_client(monkeypatch):
    monkeypatch.setenv("SALESFORCE_ACCESS_TOKEN", "test_token_abc")
    monkeypatch.setenv("SALESFORCE_INSTANCE_URL", "https://test.salesforce.com")
    monkeypatch.setattr(runtime, "create_client", lambda ctx_obj: FakeSalesforceClient())
    payload = invoke_json(["health"])
    assert payload["data"]["status"] == "ready"
    assert payload["data"]["probe"]["ok"] is True


def test_lead_list_returns_picker_metadata(monkeypatch):
    monkeypatch.setenv("SALESFORCE_ACCESS_TOKEN", "test_token_abc")
    monkeypatch.setenv("SALESFORCE_INSTANCE_URL", "https://test.salesforce.com")
    monkeypatch.setattr(runtime, "create_client", lambda ctx_obj: FakeSalesforceClient())
    payload = invoke_json(["lead", "list", "--limit", "1"])
    data = payload["data"]
    assert data["lead_count"] == 1
    assert data["picker"]["kind"] == "lead"
    assert data["scope_preview"]["command_id"] == "lead.list"


def test_lead_get_returns_record(monkeypatch):
    monkeypatch.setenv("SALESFORCE_ACCESS_TOKEN", "test_token_abc")
    monkeypatch.setenv("SALESFORCE_INSTANCE_URL", "https://test.salesforce.com")
    monkeypatch.setattr(runtime, "create_client", lambda ctx_obj: FakeSalesforceClient())
    payload = invoke_json(["lead", "get", "00Q1"])
    assert payload["data"]["lead"]["id"] == "00Q1"
    assert payload["data"]["scope_preview"]["command_id"] == "lead.get"


def test_soql_returns_records(monkeypatch):
    monkeypatch.setenv("SALESFORCE_ACCESS_TOKEN", "test_token_abc")
    monkeypatch.setenv("SALESFORCE_INSTANCE_URL", "https://test.salesforce.com")
    monkeypatch.setattr(runtime, "create_client", lambda ctx_obj: FakeSalesforceClient())
    payload = invoke_json(["search", "soql", "SELECT Id FROM Account"])
    assert payload["data"]["record_count"] == 1
    assert payload["data"]["scope_preview"]["command_id"] == "search.soql"


def test_write_commands_execute_live_mutations(monkeypatch):
    monkeypatch.setenv("SALESFORCE_ACCESS_TOKEN", "test_token_abc")
    monkeypatch.setenv("SALESFORCE_INSTANCE_URL", "https://test.salesforce.com")
    monkeypatch.setattr(runtime, "create_client", lambda ctx_obj: FakeSalesforceClient())

    lead_create = invoke_json_with_mode("write", ["lead", "create", "Test Lead"])
    assert lead_create["data"]["status"] == "live_write"
    assert lead_create["data"]["command"] == "lead.create"

    lead_update = invoke_json_with_mode("write", ["lead", "update", "00Q1"])
    assert lead_update["data"]["status"] == "live_write"
    assert lead_update["data"]["command"] == "lead.update"

    task_create = invoke_json_with_mode("write", ["task", "create", "Follow up"])
    assert task_create["data"]["status"] == "live_write"
    assert task_create["data"]["command"] == "task.create"
