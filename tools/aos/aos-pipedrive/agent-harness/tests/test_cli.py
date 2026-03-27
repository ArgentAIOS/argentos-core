from __future__ import annotations

import json
from pathlib import Path
from typing import Any

from click.testing import CliRunner

from cli_aos.pipedrive.cli import cli
import cli_aos.pipedrive.runtime as runtime


AGENT_HARNESS_ROOT = Path(__file__).resolve().parents[1]
CONNECTOR_PATH = AGENT_HARNESS_ROOT.parent / "connector.json"
PERMISSIONS_PATH = AGENT_HARNESS_ROOT / "permissions.json"


class FakePipedriveClient:
    def list_deals(self, *, limit: int = 10) -> list[dict[str, Any]]:
        deals = [
            {"id": 1, "title": "Enterprise Deal", "value": 50000, "currency": "USD", "status": "open"},
            {"id": 2, "title": "SMB Deal", "value": 5000, "currency": "USD", "status": "open"},
        ]
        return deals[:limit]

    def get_deal(self, deal_id: str) -> dict[str, Any]:
        return {"id": int(deal_id), "title": "Enterprise Deal", "value": 50000, "currency": "USD", "status": "open"}

    def list_persons(self, *, limit: int = 10) -> list[dict[str, Any]]:
        return [{"id": 1, "name": "Ada Lovelace", "email": "ada@example.com", "phone": "555-0100"}][:limit]

    def get_person(self, person_id: str) -> dict[str, Any]:
        return {"id": int(person_id), "name": "Ada Lovelace", "email": "ada@example.com"}

    def list_organizations(self, *, limit: int = 10) -> list[dict[str, Any]]:
        return [{"id": 1, "name": "Acme Corp", "address": "123 Main St"}][:limit]

    def get_organization(self, org_id: str) -> dict[str, Any]:
        return {"id": int(org_id), "name": "Acme Corp"}

    def list_activities(self, *, limit: int = 10) -> list[dict[str, Any]]:
        return [{"id": 1, "subject": "Follow up call", "type": "call", "done": False}][:limit]

    def list_pipelines(self) -> list[dict[str, Any]]:
        return [{"id": 1, "name": "Sales Pipeline", "active": True}]

    def list_stages(self, *, pipeline_id: str | None = None) -> list[dict[str, Any]]:
        return [{"id": 1, "name": "Qualified", "pipeline_id": 1, "order_nr": 1}]

    def probe(self) -> dict[str, Any]:
        return {"success": True, "data": {"id": 1, "name": "Test User", "company_id": 1}}

    def create_deal(
        self,
        *,
        title: str,
        value: float | None = None,
        currency: str | None = None,
        person_id: str | None = None,
        org_id: str | None = None,
    ) -> dict[str, Any]:
        return {"id": 11, "title": title, "value": value, "currency": currency, "person_id": person_id, "org_id": org_id}

    def update_deal(self, deal_id: str, *, fields: dict[str, Any]) -> dict[str, Any]:
        return {"id": int(deal_id), **fields}

    def create_person(self, *, name: str, email: str | None = None) -> dict[str, Any]:
        return {"id": 21, "name": name, "email": email}

    def create_organization(self, *, name: str) -> dict[str, Any]:
        return {"id": 31, "name": name}

    def create_activity(
        self,
        *,
        subject: str,
        activity_type: str | None = None,
        person_id: str | None = None,
        deal_id: str | None = None,
        org_id: str | None = None,
    ) -> dict[str, Any]:
        return {"id": 41, "subject": subject, "type": activity_type, "person_id": person_id, "deal_id": deal_id, "org_id": org_id}

    def create_note(
        self,
        *,
        content: str,
        deal_id: str | None = None,
        person_id: str | None = None,
        org_id: str | None = None,
    ) -> dict[str, Any]:
        return {"id": 51, "content": content, "deal_id": deal_id, "person_id": person_id, "org_id": org_id}


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
    assert payload["tool"] == "aos-pipedrive"
    assert payload["data"]["backend"] == "pipedrive-api"
    assert "deal.list" in json.dumps(payload["data"])
    assert "pipeline.list" in json.dumps(payload["data"])


def test_health_requires_api_token(monkeypatch):
    monkeypatch.delenv("PIPEDRIVE_API_TOKEN", raising=False)
    payload = invoke_json(["health"])
    assert payload["data"]["status"] == "needs_setup"
    assert "PIPEDRIVE_API_TOKEN" in json.dumps(payload["data"])


def test_health_ready_with_fake_client(monkeypatch):
    monkeypatch.setenv("PIPEDRIVE_API_TOKEN", "test_token_abc")
    monkeypatch.setattr(runtime, "create_client", lambda ctx_obj: FakePipedriveClient())
    payload = invoke_json(["health"])
    assert payload["data"]["status"] == "ready"
    assert payload["data"]["probe"]["ok"] is True


def test_deal_list_returns_picker_metadata(monkeypatch):
    monkeypatch.setenv("PIPEDRIVE_API_TOKEN", "test_token_abc")
    monkeypatch.setattr(runtime, "create_client", lambda ctx_obj: FakePipedriveClient())
    payload = invoke_json(["deal", "list", "--limit", "1"])
    data = payload["data"]
    assert data["deal_count"] == 1
    assert data["picker"]["kind"] == "deal"
    assert data["scope_preview"]["command_id"] == "deal.list"


def test_deal_get_returns_record(monkeypatch):
    monkeypatch.setenv("PIPEDRIVE_API_TOKEN", "test_token_abc")
    monkeypatch.setattr(runtime, "create_client", lambda ctx_obj: FakePipedriveClient())
    payload = invoke_json(["deal", "get", "1"])
    assert payload["data"]["deal"]["id"] == 1
    assert payload["data"]["scope_preview"]["command_id"] == "deal.get"


def test_pipeline_list_returns_pipelines(monkeypatch):
    monkeypatch.setenv("PIPEDRIVE_API_TOKEN", "test_token_abc")
    monkeypatch.setattr(runtime, "create_client", lambda ctx_obj: FakePipedriveClient())
    payload = invoke_json(["pipeline", "list"])
    assert payload["data"]["pipeline_count"] == 1
    assert payload["data"]["picker"]["kind"] == "pipeline"


def test_write_commands_execute_live_mutations(monkeypatch):
    monkeypatch.setenv("PIPEDRIVE_API_TOKEN", "test_token_abc")
    monkeypatch.setattr(runtime, "create_client", lambda ctx_obj: FakePipedriveClient())

    deal_create = invoke_json_with_mode("write", ["deal", "create", "Test Deal"])
    assert deal_create["data"]["status"] == "live_write"
    assert deal_create["data"]["command"] == "deal.create"

    deal_update = invoke_json_with_mode("write", ["deal", "update", "1"])
    assert deal_update["data"]["status"] == "live_write"
    assert deal_update["data"]["command"] == "deal.update"

    note_create = invoke_json_with_mode("write", ["note", "create", "Follow-up note"])
    assert note_create["data"]["status"] == "live_write"
    assert note_create["data"]["command"] == "note.create"
