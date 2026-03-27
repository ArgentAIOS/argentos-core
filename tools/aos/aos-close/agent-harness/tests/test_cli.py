from __future__ import annotations

import json
from pathlib import Path
from typing import Any

from click.testing import CliRunner

from cli_aos.close.cli import cli
import cli_aos.close.runtime as runtime


AGENT_HARNESS_ROOT = Path(__file__).resolve().parents[1]
CONNECTOR_PATH = AGENT_HARNESS_ROOT.parent / "connector.json"
PERMISSIONS_PATH = AGENT_HARNESS_ROOT / "permissions.json"


class FakeCloseClient:
    def list_leads(self, *, limit: int = 10, query: str | None = None) -> list[dict[str, Any]]:
        leads = [
            {"id": "lead_abc", "display_name": "Acme Corp", "status_label": "Potential", "contacts": []},
            {"id": "lead_def", "display_name": "Globex Inc", "status_label": "Qualified", "contacts": []},
        ]
        return leads[:limit]

    def get_lead(self, lead_id: str) -> dict[str, Any]:
        return {"id": lead_id, "display_name": "Acme Corp", "status_label": "Potential", "contacts": []}

    def list_contacts(self, *, limit: int = 10) -> list[dict[str, Any]]:
        return [{"id": "cont_abc", "name": "Ada Lovelace", "title": "CEO", "emails": [{"email": "ada@example.com"}]}][:limit]

    def get_contact(self, contact_id: str) -> dict[str, Any]:
        return {"id": contact_id, "name": "Ada Lovelace", "title": "CEO"}

    def list_opportunities(self, *, limit: int = 10) -> list[dict[str, Any]]:
        return [{"id": "oppo_abc", "note": "Big deal", "confidence": 80, "value": 50000, "status_type": "active"}][:limit]

    def get_opportunity(self, opp_id: str) -> dict[str, Any]:
        return {"id": opp_id, "note": "Big deal", "confidence": 80, "value": 50000}

    def list_activities(self, *, limit: int = 10) -> list[dict[str, Any]]:
        return [{"id": "acti_abc", "_type": "Email", "lead_id": "lead_abc"}][:limit]

    def list_tasks(self, *, limit: int = 10) -> list[dict[str, Any]]:
        return [{"id": "task_abc", "text": "Follow up", "is_complete": False, "due_date": "2026-04-01"}][:limit]

    def probe(self) -> dict[str, Any]:
        return {"id": "user_abc", "first_name": "Test", "last_name": "User", "organization_id": "org_abc"}


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
    assert payload["tool"] == "aos-close"
    assert payload["data"]["backend"] == "close-api"
    assert "lead.list" in json.dumps(payload["data"])
    assert "email.send" in json.dumps(payload["data"])


def test_health_requires_api_key(monkeypatch):
    monkeypatch.delenv("CLOSE_API_KEY", raising=False)
    payload = invoke_json(["health"])
    assert payload["data"]["status"] == "needs_setup"
    assert "CLOSE_API_KEY" in json.dumps(payload["data"])


def test_health_ready_with_fake_client(monkeypatch):
    monkeypatch.setenv("CLOSE_API_KEY", "api_test_abc")
    monkeypatch.setattr(runtime, "create_client", lambda ctx_obj: FakeCloseClient())
    payload = invoke_json(["health"])
    assert payload["data"]["status"] == "ready"
    assert payload["data"]["probe"]["ok"] is True


def test_lead_list_returns_picker_metadata(monkeypatch):
    monkeypatch.setenv("CLOSE_API_KEY", "api_test_abc")
    monkeypatch.setattr(runtime, "create_client", lambda ctx_obj: FakeCloseClient())
    payload = invoke_json(["lead", "list", "--limit", "1"])
    data = payload["data"]
    assert data["lead_count"] == 1
    assert data["picker"]["kind"] == "lead"
    assert data["scope_preview"]["command_id"] == "lead.list"


def test_lead_get_returns_record(monkeypatch):
    monkeypatch.setenv("CLOSE_API_KEY", "api_test_abc")
    monkeypatch.setattr(runtime, "create_client", lambda ctx_obj: FakeCloseClient())
    payload = invoke_json(["lead", "get", "lead_abc"])
    assert payload["data"]["lead"]["id"] == "lead_abc"
    assert payload["data"]["scope_preview"]["command_id"] == "lead.get"


def test_contact_list_returns_contacts(monkeypatch):
    monkeypatch.setenv("CLOSE_API_KEY", "api_test_abc")
    monkeypatch.setattr(runtime, "create_client", lambda ctx_obj: FakeCloseClient())
    payload = invoke_json(["contact", "list"])
    assert payload["data"]["contact_count"] == 1
    assert payload["data"]["picker"]["kind"] == "contact"


def test_scaffold_write_commands_do_not_execute_live_mutations(monkeypatch):
    monkeypatch.setenv("CLOSE_API_KEY", "api_test_abc")
    payload = invoke_json_with_mode("write", ["lead", "create", "Test Lead"])
    assert payload["data"]["status"] == "scaffold_write_only"
    assert payload["data"]["command"] == "lead.create"


def test_scaffold_outreach_commands_are_scaffolded(monkeypatch):
    monkeypatch.setenv("CLOSE_API_KEY", "api_test_abc")
    payload = invoke_json_with_mode("write", ["email", "send", "test@example.com"])
    assert payload["data"]["status"] == "scaffold_write_only"
    assert payload["data"]["command"] == "email.send"
