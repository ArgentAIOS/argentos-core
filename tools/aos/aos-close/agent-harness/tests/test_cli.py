from __future__ import annotations

import json
from pathlib import Path
from typing import Any

from click.testing import CliRunner

from cli_aos.close.cli import cli
import cli_aos.close.config as config
import cli_aos.close.runtime as runtime
import cli_aos.close.service_keys as service_keys


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

    def create_lead(
        self,
        *,
        name: str,
        status: str | None = None,
        description: str | None = None,
        url: str | None = None,
    ) -> dict[str, Any]:
        return {"id": "lead_new", "display_name": name, "status_label": status, "description": description, "url": url}

    def update_lead(self, lead_id: str, *, fields: dict[str, Any]) -> dict[str, Any]:
        return {"id": lead_id, "display_name": fields.get("name", "Acme Corp"), "status_label": fields.get("status"), **fields}

    def list_contacts(self, *, limit: int = 10, lead_id: str | None = None) -> list[dict[str, Any]]:
        return [
            {
                "id": "cont_abc",
                "name": "Ada Lovelace",
                "title": "CEO",
                "emails": [{"email": "ada@example.com"}],
                "lead_id": lead_id or "lead_abc",
            }
        ][:limit]

    def get_contact(self, contact_id: str) -> dict[str, Any]:
        return {"id": contact_id, "name": "Ada Lovelace", "title": "CEO"}

    def create_contact(
        self,
        *,
        name: str,
        lead_id: str | None = None,
        email: str | None = None,
        phone: str | None = None,
        title: str | None = None,
    ) -> dict[str, Any]:
        return {
            "id": "cont_new",
            "name": name,
            "lead_id": lead_id,
            "emails": [{"email": email}] if email else [],
            "phones": [{"phone": phone}] if phone else [],
            "title": title,
        }

    def list_opportunities(
        self,
        *,
        limit: int = 10,
        lead_id: str | None = None,
        status_type: str | None = None,
    ) -> list[dict[str, Any]]:
        return [
            {
                "id": "oppo_abc",
                "note": "Big deal",
                "confidence": 80,
                "value": 50000,
                "status_type": status_type or "active",
                "lead_id": lead_id or "lead_abc",
            }
        ][:limit]

    def get_opportunity(self, opp_id: str) -> dict[str, Any]:
        return {"id": opp_id, "note": "Big deal", "confidence": 80, "value": 50000}

    def create_opportunity(
        self,
        *,
        lead_id: str,
        note: str | None = None,
        value: int | None = None,
        confidence: int | None = None,
        status_id: str | None = None,
        contact_id: str | None = None,
    ) -> dict[str, Any]:
        return {
            "id": "oppo_new",
            "lead_id": lead_id,
            "note": note,
            "value": value,
            "confidence": confidence,
            "status_id": status_id,
            "contact_id": contact_id,
            "status_type": "active",
        }

    def list_activities(
        self,
        *,
        limit: int = 10,
        lead_id: str | None = None,
        contact_id: str | None = None,
    ) -> list[dict[str, Any]]:
        return [{"id": "acti_abc", "type": "Note", "lead_id": lead_id or "lead_abc", "contact_id": contact_id}][:limit]

    def create_note_activity(
        self,
        *,
        lead_id: str,
        note: str,
        contact_id: str | None = None,
    ) -> dict[str, Any]:
        return {"id": "acti_new", "_type": "Note", "lead_id": lead_id, "contact_id": contact_id, "note": note}

    def list_tasks(
        self,
        *,
        limit: int = 10,
        lead_id: str | None = None,
        assigned_to: str | None = None,
    ) -> list[dict[str, Any]]:
        return [
            {
                "id": "task_abc",
                "text": "Follow up",
                "is_complete": False,
                "due_date": "2026-04-01",
                "assigned_to": assigned_to,
                "lead_id": lead_id or "lead_abc",
            }
        ][:limit]

    def create_task(
        self,
        *,
        lead_id: str,
        text: str,
        assigned_to: str | None = None,
        due_date: str | None = None,
    ) -> dict[str, Any]:
        return {
            "id": "task_new",
            "lead_id": lead_id,
            "text": text,
            "assigned_to": assigned_to,
            "due_date": due_date,
            "is_complete": False,
        }

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
    assert payload["data"]["write_support"]["lead.create"] == "live"
    assert payload["data"]["write_support"]["email.send"] == "scaffold_only"


def test_runtime_prefers_service_key(monkeypatch):
    service_keys.resolve_service_key.cache_clear()
    monkeypatch.setattr(config, "resolve_service_key", lambda variable: "svc_close_key" if variable == "CLOSE_API_KEY" else None)
    monkeypatch.setattr(service_keys, "resolve_service_key", lambda variable: "svc_close_key" if variable == "CLOSE_API_KEY" else None)
    monkeypatch.setenv("CLOSE_API_KEY", "env_close_key")
    runtime_values = config.resolve_runtime_values({})
    assert runtime_values["api_key"] == "svc_close_key"
    assert runtime_values["auth_source"] == "service_key"


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
    monkeypatch.setenv("CLOSE_LEAD_ID", "lead_env")
    monkeypatch.setattr(runtime, "create_client", lambda ctx_obj: FakeCloseClient())
    payload = invoke_json(["contact", "list"])
    assert payload["data"]["contact_count"] == 1
    assert payload["data"]["picker"]["kind"] == "contact"
    assert payload["data"]["scope_preview"]["lead_id"] == "lead_env"


def test_live_crm_write_commands_execute_mutations(monkeypatch):
    monkeypatch.setenv("CLOSE_API_KEY", "api_test_abc")
    monkeypatch.setenv("CLOSE_LEAD_ID", "lead_env")
    monkeypatch.setenv("CLOSE_CONTACT_ID", "cont_env")
    monkeypatch.setattr(runtime, "create_client", lambda ctx_obj: FakeCloseClient())

    lead_create = invoke_json_with_mode("write", ["lead", "create", "Test Lead", "--status", "Qualified"])
    assert lead_create["data"]["status"] == "live_write"
    assert lead_create["data"]["command"] == "lead.create"

    lead_update = invoke_json_with_mode("write", ["lead", "update", "lead_abc", "--status", "Customer"])
    assert lead_update["data"]["status"] == "live_write"
    assert lead_update["data"]["command"] == "lead.update"

    contact_create = invoke_json_with_mode("write", ["contact", "create", "Ada Lovelace", "--email", "ada@example.com"])
    assert contact_create["data"]["status"] == "live_write"
    assert contact_create["data"]["command"] == "contact.create"

    opportunity_create = invoke_json_with_mode("write", ["opportunity", "create", "--note", "Expansion", "--value", "50000"])
    assert opportunity_create["data"]["status"] == "live_write"
    assert opportunity_create["data"]["command"] == "opportunity.create"

    activity_create = invoke_json_with_mode("write", ["activity", "create", "Called to confirm timeline"])
    assert activity_create["data"]["status"] == "live_write"
    assert activity_create["data"]["command"] == "activity.create"

    task_create = invoke_json_with_mode("write", ["task", "create", "Follow up", "--assignee", "user_123"])
    assert task_create["data"]["status"] == "live_write"
    assert task_create["data"]["command"] == "task.create"


def test_scaffold_outreach_commands_are_explicit(monkeypatch):
    monkeypatch.setenv("CLOSE_API_KEY", "api_test_abc")
    payload = invoke_json_with_mode("write", ["email", "send", "test@example.com"])
    assert payload["data"]["status"] == "scaffold_write_only"
    assert payload["data"]["command"] == "email.send"
