from __future__ import annotations

import json
from pathlib import Path
from typing import Any

from click.testing import CliRunner

from cli_aos.connectwise.cli import cli
import cli_aos.connectwise.config as config
import cli_aos.connectwise.runtime as runtime


AGENT_HARNESS_ROOT = Path(__file__).resolve().parents[1]
CONNECTOR_PATH = AGENT_HARNESS_ROOT.parent / "connector.json"
PERMISSIONS_PATH = AGENT_HARNESS_ROOT / "permissions.json"


class FakeConnectWiseClient:
    def health_probe(self) -> dict[str, Any]:
        return {"id": 1, "name": "Board 1"}

    def list_tickets(self, *, board_id: str | None = None, status: str | None = None, priority: str | None = None, limit: int = 25) -> dict[str, Any]:
        return {
            "tickets": [
                {
                    "id": 1001,
                    "summary": "Email down",
                    "status": "New",
                    "priority": "Priority 1 - Critical",
                    "company": "Acme",
                    "board": "Service Desk",
                    "assignee": "jdoe",
                    "created_at": "2026-03-26T12:00:00Z",
                    "updated_at": "2026-03-26T12:10:00Z",
                }
            ][:limit]
        }

    def get_ticket(self, ticket_id: str) -> dict[str, Any]:
        return {
            "id": ticket_id,
            "summary": "Email down",
            "status": "New",
            "priority": "Priority 1 - Critical",
            "company": "Acme",
            "board": "Service Desk",
            "assignee": "jdoe",
        }

    def create_ticket(self, payload: dict[str, Any]) -> dict[str, Any]:
        return {
            "id": 2001,
            "summary": payload.get("summary", "Created ticket"),
            "status": payload.get("status", "New"),
            "priority": payload.get("priority", "Priority 3 - Normal"),
            "company": payload.get("company", "Acme"),
            "board": payload.get("board", "Service Desk"),
            "assignee": payload.get("assignee", "jdoe"),
        }

    def list_companies(self, *, limit: int = 25) -> dict[str, Any]:
        return {"companies": [{"id": 250, "name": "Acme", "raw": {"type": "Customer"}}][:limit]}

    def get_company(self, company_id: str) -> dict[str, Any]:
        return {"id": company_id, "name": "Acme", "raw": {"type": "Customer"}}

    def create_company(self, payload: dict[str, Any]) -> dict[str, Any]:
        return {"id": 251, "name": payload.get("name", "Created Co"), "raw": payload}

    def list_contacts(self, *, company_id: str | None = None, limit: int = 25) -> dict[str, Any]:
        return {
            "contacts": [
                {
                    "id": 1001,
                    "first_name": "Ada",
                    "last_name": "Lovelace",
                    "email": "ada@example.com",
                    "company": "Acme",
                    "type": "Decision Maker",
                }
            ][:limit]
        }

    def get_contact(self, contact_id: str) -> dict[str, Any]:
        return {
            "id": contact_id,
            "first_name": "Ada",
            "last_name": "Lovelace",
            "email": "ada@example.com",
            "company": "Acme",
            "type": "Decision Maker",
        }

    def create_contact(self, payload: dict[str, Any]) -> dict[str, Any]:
        return {
            "id": 1002,
            "name": " ".join(part for part in [payload.get("firstName"), payload.get("lastName")] if part) or "Created Contact",
            "email": payload.get("emailAddress", "created@example.com"),
            "company": payload.get("company", "Acme"),
            "raw": payload,
        }

    def list_projects(self, *, limit: int = 25) -> dict[str, Any]:
        return {"projects": [{"id": 10, "name": "Migration", "status": "In Progress", "company": "Acme"}][:limit]}

    def get_project(self, project_id: str) -> dict[str, Any]:
        return {"id": project_id, "name": "Migration", "status": "In Progress", "company": "Acme"}

    def list_boards(self, *, limit: int = 25) -> dict[str, Any]:
        return {"boards": [{"id": 1, "name": "Service Desk", "location": "HQ", "department": "IT"}][:limit]}

    def list_statuses(self, board_id: str, *, limit: int = 25) -> dict[str, Any]:
        return {"statuses": [{"id": 11, "name": "New", "board": {"id": board_id}, "closed_flag": False}][:limit]}

    def list_members(self, *, limit: int = 25) -> dict[str, Any]:
        return {"members": [{"id": 77, "name": "Jane Doe", "email": "jane@example.com", "title": "Engineer"}][:limit]}

    def create_time_entry(self, ticket_id: str, payload: dict[str, Any]) -> dict[str, Any]:
        return {"id": 9001, "ticket": {"id": ticket_id}, **payload}

    def list_configurations(self, *, company_id: str | None = None, limit: int = 25) -> dict[str, Any]:
        return {"configurations": [{"id": 500, "name": "Laptop-01", "type": "Laptop", "status": "Active", "company": "Acme"}][:limit]}

    def get_configuration(self, configuration_id: str) -> dict[str, Any]:
        return {"id": configuration_id, "name": "Laptop-01", "type": "Laptop", "status": "Active", "company": "Acme"}


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
    assert manifest["scope"]["kind"] == "msp-platform"


def test_capabilities_exposes_manifest():
    payload = invoke_json(["capabilities"])
    assert payload["tool"] == "aos-connectwise"
    assert payload["data"]["backend"] == "connectwise-api"
    assert "ticket.list" in json.dumps(payload["data"])
    assert "time_entry.create" in json.dumps(payload["data"])
    assert payload["data"]["write_support"]["ticket.create"] is True
    assert payload["data"]["write_support"]["ticket.update"] is False


def test_health_requires_credentials(monkeypatch):
    monkeypatch.delenv("CW_COMPANY_ID_AUTH", raising=False)
    payload = invoke_json(["health"])
    assert payload["data"]["status"] == "needs_setup"
    assert "CW_COMPANY_ID_AUTH" in json.dumps(payload["data"])


def test_health_ready_with_fake_client(monkeypatch):
    monkeypatch.setenv("CW_COMPANY_ID_AUTH", "acme")
    monkeypatch.setenv("CW_PUBLIC_KEY", "public")
    monkeypatch.setenv("CW_PRIVATE_KEY", "private")
    monkeypatch.setenv("CW_SITE_URL", "na.myconnectwise.net")
    monkeypatch.setattr(runtime, "create_client", lambda ctx_obj: FakeConnectWiseClient())
    payload = invoke_json(["health"])
    assert payload["data"]["status"] == "ready"
    assert payload["data"]["connector"]["write_bridge_available"] is True
    assert payload["data"]["connector"]["scaffold_only"] is False
    assert payload["data"]["probe"]["ok"] is True
    assert payload["data"]["probe"]["details"]["boards"]["name"] == "Board 1"


def test_config_show_redacts_credentials(monkeypatch):
    monkeypatch.setenv("CW_COMPANY_ID_AUTH", "acme-company")
    monkeypatch.setenv("CW_PUBLIC_KEY", "public-secret")
    monkeypatch.setenv("CW_PRIVATE_KEY", "private-secret")
    monkeypatch.setenv("CW_SITE_URL", "na.myconnectwise.net")
    payload = invoke_json(["config", "show"])
    encoded = json.dumps(payload["data"])
    assert "acme-company" not in encoded
    assert "public-secret" not in encoded
    assert "private-secret" not in encoded
    assert payload["data"]["auth"]["site_url_present"] is True
    assert "CW_SITE_URL" in payload["data"]["auth"]["operator_service_keys"]


def test_runtime_config_prefers_operator_service_keys(monkeypatch):
    monkeypatch.setenv("CW_SITE_URL", "env.myconnectwise.net")
    monkeypatch.setenv("CW_COMPANY_ID_AUTH", "env-company")
    monkeypatch.setenv("CW_PUBLIC_KEY", "env-public")
    monkeypatch.setenv("CW_PRIVATE_KEY", "env-private")

    def fake_service_key_env(name: str, default: str | None = None) -> str | None:
        overrides = {
            "CW_SITE_URL": "service.myconnectwise.net",
            "CW_COMPANY_ID_AUTH": "service-company",
            "CW_PUBLIC_KEY": "service-public",
            "CW_PRIVATE_KEY": "service-private",
        }
        return overrides.get(name, default)

    monkeypatch.setattr(config, "service_key_env", fake_service_key_env)
    payload = config.resolve_runtime_values({})
    assert payload["site_url"] == "service.myconnectwise.net"
    assert payload["company_id"] == "service-company"
    assert payload["public_key"] == "service-public"
    assert payload["private_key"] == "service-private"


def test_ticket_list_returns_picker(monkeypatch):
    monkeypatch.setenv("CW_COMPANY_ID_AUTH", "acme")
    monkeypatch.setenv("CW_PUBLIC_KEY", "public")
    monkeypatch.setenv("CW_PRIVATE_KEY", "private")
    monkeypatch.setenv("CW_SITE_URL", "na.myconnectwise.net")
    monkeypatch.setattr(runtime, "create_client", lambda ctx_obj: FakeConnectWiseClient())
    payload = invoke_json(["ticket", "list"])
    assert payload["data"]["tickets"][0]["summary"] == "Email down"
    assert payload["data"]["picker"]["kind"] == "connectwise_ticket"


def test_ticket_list_does_not_use_company_scope_as_status_default(monkeypatch):
    monkeypatch.setenv("CW_COMPANY_ID_AUTH", "acme")
    monkeypatch.setenv("CW_PUBLIC_KEY", "public")
    monkeypatch.setenv("CW_PRIVATE_KEY", "private")
    monkeypatch.setenv("CW_SITE_URL", "na.myconnectwise.net")
    monkeypatch.setenv("CW_COMPANY_ID", "250")

    class AssertingClient(FakeConnectWiseClient):
        def list_tickets(self, *, board_id: str | None = None, status: str | None = None, priority: str | None = None, limit: int = 25) -> dict[str, Any]:
            assert status is None
            return super().list_tickets(board_id=board_id, status=status, priority=priority, limit=limit)

    monkeypatch.setattr(runtime, "create_client", lambda ctx_obj: AssertingClient())
    payload = invoke_json(["ticket", "list"])
    assert payload["data"]["tickets"][0]["id"] == 1001


def test_ticket_create_requires_write_mode(monkeypatch):
    monkeypatch.setenv("CW_COMPANY_ID_AUTH", "acme")
    monkeypatch.setenv("CW_PUBLIC_KEY", "public")
    monkeypatch.setenv("CW_PRIVATE_KEY", "private")
    monkeypatch.setenv("CW_SITE_URL", "na.myconnectwise.net")
    result = CliRunner().invoke(cli, ["--json", "--mode", "readonly", "ticket", "create"])
    payload = json.loads(result.output)
    assert payload["ok"] is False
    assert payload["error"]["code"] == "PERMISSION_DENIED"


def test_ticket_create_executes_in_write_mode(monkeypatch):
    monkeypatch.setenv("CW_COMPANY_ID_AUTH", "acme")
    monkeypatch.setenv("CW_PUBLIC_KEY", "public")
    monkeypatch.setenv("CW_PRIVATE_KEY", "private")
    monkeypatch.setenv("CW_SITE_URL", "na.myconnectwise.net")
    monkeypatch.setattr(runtime, "create_client", lambda ctx_obj: FakeConnectWiseClient())
    payload = invoke_json_with_mode("write", ["ticket", "create", "--payload-json", '{"summary":"Created from test"}'])
    assert payload["data"]["status"] == "live_write"
    assert payload["data"]["ticket"]["summary"] == "Created from test"
    assert payload["data"]["command_id"] == "ticket.create"


def test_ticket_update_is_scaffolded_in_write_mode(monkeypatch):
    monkeypatch.setenv("CW_COMPANY_ID_AUTH", "acme")
    monkeypatch.setenv("CW_PUBLIC_KEY", "public")
    monkeypatch.setenv("CW_PRIVATE_KEY", "private")
    monkeypatch.setenv("CW_SITE_URL", "na.myconnectwise.net")
    result = CliRunner().invoke(cli, ["--json", "--mode", "write", "ticket", "update"])
    payload = json.loads(result.output)
    assert payload["ok"] is False
    assert payload["error"]["code"] == "NOT_IMPLEMENTED"
    assert payload["error"]["details"]["command_id"] == "ticket.update"


def test_company_get_uses_scope_defaults(monkeypatch):
    monkeypatch.setenv("CW_COMPANY_ID_AUTH", "acme")
    monkeypatch.setenv("CW_PUBLIC_KEY", "public")
    monkeypatch.setenv("CW_PRIVATE_KEY", "private")
    monkeypatch.setenv("CW_SITE_URL", "na.myconnectwise.net")
    monkeypatch.setenv("CW_COMPANY_ID", "250")
    monkeypatch.setattr(runtime, "create_client", lambda ctx_obj: FakeConnectWiseClient())
    payload = invoke_json(["company", "get"])
    assert payload["data"]["company"]["id"] == "250"


def test_company_create_executes_in_write_mode(monkeypatch):
    monkeypatch.setenv("CW_COMPANY_ID_AUTH", "acme")
    monkeypatch.setenv("CW_PUBLIC_KEY", "public")
    monkeypatch.setenv("CW_PRIVATE_KEY", "private")
    monkeypatch.setenv("CW_SITE_URL", "na.myconnectwise.net")
    monkeypatch.setattr(runtime, "create_client", lambda ctx_obj: FakeConnectWiseClient())
    payload = invoke_json_with_mode("write", ["company", "create", "--payload", "name=Acme Two", "--payload", "identifier=ACME2"])
    assert payload["data"]["status"] == "live_write"
    assert payload["data"]["company"]["name"] == "Acme Two"


def test_status_list_requires_board_id(monkeypatch):
    monkeypatch.setenv("CW_COMPANY_ID_AUTH", "acme")
    monkeypatch.setenv("CW_PUBLIC_KEY", "public")
    monkeypatch.setenv("CW_PRIVATE_KEY", "private")
    monkeypatch.setenv("CW_SITE_URL", "na.myconnectwise.net")
    monkeypatch.setattr(runtime, "create_client", lambda ctx_obj: FakeConnectWiseClient())
    result = CliRunner().invoke(cli, ["--json", "status", "list"])
    payload = json.loads(result.output)
    assert payload["ok"] is False
    assert payload["error"]["code"] == "CONNECTWISE_BOARD_ID_REQUIRED"


def test_contact_create_executes_in_write_mode(monkeypatch):
    monkeypatch.setenv("CW_COMPANY_ID_AUTH", "acme")
    monkeypatch.setenv("CW_PUBLIC_KEY", "public")
    monkeypatch.setenv("CW_PRIVATE_KEY", "private")
    monkeypatch.setenv("CW_SITE_URL", "na.myconnectwise.net")
    monkeypatch.setattr(runtime, "create_client", lambda ctx_obj: FakeConnectWiseClient())
    payload = invoke_json_with_mode("write", ["contact", "create", "--payload-json", '{"firstName":"Ada","lastName":"Lovelace","emailAddress":"ada@example.com"}'])
    assert payload["data"]["status"] == "live_write"
    assert payload["data"]["contact"]["name"] == "Ada Lovelace"


def test_configuration_list_returns_picker(monkeypatch):
    monkeypatch.setenv("CW_COMPANY_ID_AUTH", "acme")
    monkeypatch.setenv("CW_PUBLIC_KEY", "public")
    monkeypatch.setenv("CW_PRIVATE_KEY", "private")
    monkeypatch.setenv("CW_SITE_URL", "na.myconnectwise.net")
    monkeypatch.setattr(runtime, "create_client", lambda ctx_obj: FakeConnectWiseClient())
    payload = invoke_json(["configuration", "list"])
    assert payload["data"]["configurations"][0]["name"] == "Laptop-01"
    assert payload["data"]["picker"]["kind"] == "connectwise_configuration"


def test_time_entry_create_executes_in_write_mode(monkeypatch):
    monkeypatch.setenv("CW_COMPANY_ID_AUTH", "acme")
    monkeypatch.setenv("CW_PUBLIC_KEY", "public")
    monkeypatch.setenv("CW_PRIVATE_KEY", "private")
    monkeypatch.setenv("CW_SITE_URL", "na.myconnectwise.net")
    monkeypatch.setattr(runtime, "create_client", lambda ctx_obj: FakeConnectWiseClient())
    payload = invoke_json_with_mode("write", ["time-entry", "create", "12345", "--payload-json", '{"hoursDeduct":1.0,"notes":"Triage"}'])
    assert payload["data"]["status"] == "live_write"
    assert payload["data"]["time_entry"]["ticket"]["id"] == "12345"
