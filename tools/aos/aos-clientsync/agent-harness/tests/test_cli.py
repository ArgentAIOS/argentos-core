from __future__ import annotations

import json
from pathlib import Path
from typing import Any

from click.testing import CliRunner

from cli_aos.clientsync.cli import cli
import cli_aos.clientsync.runtime as runtime


AGENT_HARNESS_ROOT = Path(__file__).resolve().parents[1]
CONNECTOR_PATH = AGENT_HARNESS_ROOT.parent / "connector.json"
PERMISSIONS_PATH = AGENT_HARNESS_ROOT / "permissions.json"


class FakeClientSyncClient:
    def list_clients(self, *, limit: int = 25) -> dict[str, Any]:
        clients = [
            {"id": "cli_1", "name": "Acme Corp", "plan": "managed", "status": "active"},
            {"id": "cli_2", "name": "Globex Inc", "plan": "essentials", "status": "active"},
        ]
        return {"clients": clients[:limit], "total": 2}

    def get_client(self, client_id: str) -> dict[str, Any]:
        return {"id": client_id, "name": "Acme Corp", "plan": "managed", "status": "active", "contact_email": "admin@acme.com"}

    def create_client(self, *, name: str, contact_email: str | None = None, plan: str | None = None) -> dict[str, Any]:
        return {"id": "cli_new", "name": name, "contact_email": contact_email, "plan": plan or "essentials", "status": "active"}

    def update_client(self, client_id: str, *, updates: dict[str, Any]) -> dict[str, Any]:
        return {"id": client_id, **updates}

    def get_client_portal(self, client_id: str) -> dict[str, Any]:
        return {"client_id": client_id, "portal_url": f"https://portal.clientsync.io/{client_id}", "enabled": True}

    def list_tickets(self, *, client_id: str | None = None, technician_id: str | None = None, priority: str | None = None, status: str | None = None, limit: int = 25) -> dict[str, Any]:
        tickets = [
            {"id": "tkt_1", "subject": "Server down", "priority": "critical", "status": "open", "client_id": "cli_1"},
            {"id": "tkt_2", "subject": "VPN issue", "priority": "medium", "status": "in_progress", "client_id": "cli_1"},
        ]
        if client_id:
            tickets = [t for t in tickets if t["client_id"] == client_id]
        return {"tickets": tickets[:limit], "total": len(tickets)}

    def get_ticket(self, ticket_id: str) -> dict[str, Any]:
        return {"id": ticket_id, "subject": "Server down", "priority": "critical", "status": "open", "client_id": "cli_1"}

    def create_ticket(self, *, client_id: str, subject: str, description: str | None = None, priority: str | None = None) -> dict[str, Any]:
        return {"id": "tkt_new", "client_id": client_id, "subject": subject, "priority": priority or "medium", "status": "open"}

    def update_ticket(self, ticket_id: str, *, updates: dict[str, Any]) -> dict[str, Any]:
        return {"id": ticket_id, **updates}

    def assign_ticket(self, ticket_id: str, *, technician_id: str) -> dict[str, Any]:
        return {"id": ticket_id, "technician_id": technician_id, "status": "assigned"}

    def resolve_ticket(self, ticket_id: str, *, resolution: str | None = None) -> dict[str, Any]:
        return {"id": ticket_id, "status": "resolved", "resolution": resolution}

    def list_technicians(self, *, limit: int = 25) -> dict[str, Any]:
        techs = [
            {"id": "tech_1", "name": "Alice Smith", "email": "alice@msp.com", "role": "senior", "active": True},
            {"id": "tech_2", "name": "Bob Jones", "email": "bob@msp.com", "role": "junior", "active": True},
        ]
        return {"technicians": techs[:limit], "total": 2}

    def get_technician(self, technician_id: str) -> dict[str, Any]:
        return {"id": technician_id, "name": "Alice Smith", "email": "alice@msp.com", "role": "senior", "active": True}

    def get_technician_availability(self, technician_id: str) -> dict[str, Any]:
        return {"technician_id": technician_id, "available": True, "next_slot": "2026-03-27T09:00:00Z"}

    def list_compliance(self, *, limit: int = 25) -> dict[str, Any]:
        frameworks = [
            {"id": "SOC2", "framework": "SOC 2 Type II", "status": "active"},
            {"id": "HIPAA", "framework": "HIPAA", "status": "active"},
        ]
        return {"frameworks": frameworks[:limit], "total": 2}

    def get_compliance(self, compliance_id: str) -> dict[str, Any]:
        return {"id": compliance_id, "framework": "SOC 2 Type II", "status": "active", "version": "2024"}

    def check_compliance(self, *, client_id: str, compliance_id: str) -> dict[str, Any]:
        return {"client_id": client_id, "compliance_id": compliance_id, "score": 92, "passing": True}

    def generate_compliance_report(self, *, client_id: str, compliance_id: str) -> dict[str, Any]:
        return {"id": "rpt_comp_1", "client_id": client_id, "compliance_id": compliance_id, "status": "generated"}

    def list_assets(self, *, client_id: str | None = None, limit: int = 25) -> dict[str, Any]:
        assets = [
            {"id": "ast_1", "name": "Dell R750", "type": "server", "client_id": "cli_1"},
        ]
        return {"assets": assets[:limit], "total": 1}

    def get_asset(self, asset_id: str) -> dict[str, Any]:
        return {"id": asset_id, "name": "Dell R750", "type": "server", "serial": "SVC-12345"}

    def create_asset(self, *, client_id: str, name: str, asset_type: str | None = None, serial: str | None = None) -> dict[str, Any]:
        return {"id": "ast_new", "client_id": client_id, "name": name, "type": asset_type, "serial": serial}

    def list_contracts(self, *, client_id: str | None = None, limit: int = 25) -> dict[str, Any]:
        contracts = [
            {"id": "ctr_1", "name": "Managed Services Agreement", "client_id": "cli_1", "type": "managed", "mrr": 5000},
        ]
        return {"contracts": contracts[:limit], "total": 1}

    def get_contract(self, contract_id: str) -> dict[str, Any]:
        return {"id": contract_id, "name": "Managed Services Agreement", "type": "managed", "mrr": 5000}

    def renew_contract(self, contract_id: str, *, duration_months: int | None = None) -> dict[str, Any]:
        return {"id": contract_id, "status": "renewed", "duration_months": duration_months or 12}

    def get_analytics_dashboard(self, *, report_type: str | None = None, date_range: str | None = None) -> dict[str, Any]:
        return {"total_clients": 42, "open_tickets": 15, "avg_resolution_hours": 4.2, "sla_compliance": 98.5}

    def get_client_health(self, client_id: str) -> dict[str, Any]:
        return {"client_id": client_id, "health_score": 87, "risk_level": "low", "open_tickets": 2}

    def get_sla_performance(self, *, sla_id: str | None = None, date_range: str | None = None) -> dict[str, Any]:
        return {"sla_id": sla_id, "compliance_rate": 99.1, "breaches": 1, "avg_response_minutes": 12}

    def generate_report(self, *, report_type: str, client_id: str | None = None, date_range: str | None = None) -> dict[str, Any]:
        return {"id": "rpt_1", "report_type": report_type, "status": "generated"}

    def list_reports(self, *, limit: int = 25) -> dict[str, Any]:
        reports = [{"id": "rpt_1", "report_type": "monthly_client_review", "created": "2026-03-01"}]
        return {"reports": reports[:limit], "total": 1}

    def list_audit(self, *, date_range: str | None = None, limit: int = 25) -> dict[str, Any]:
        entries = [{"id": "aud_1", "action": "ticket.create", "resource_type": "ticket", "resource_id": "tkt_1"}]
        return {"entries": entries[:limit], "total": 1}

    def create_audit_entry(self, *, action: str, resource_type: str, resource_id: str, details: str | None = None) -> dict[str, Any]:
        return {"id": "aud_new", "action": action, "resource_type": resource_type, "resource_id": resource_id}


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
    assert manifest["scope"]["kind"] == "msp-management"


def test_capabilities_exposes_manifest():
    payload = invoke_json(["capabilities"])
    assert payload["tool"] == "aos-clientsync"
    assert payload["data"]["backend"] == "clientsync-api"
    assert "client.list" in json.dumps(payload["data"])
    assert "ticket.resolve" in json.dumps(payload["data"])


def test_health_requires_api_key(monkeypatch):
    monkeypatch.delenv("CLIENTSYNC_API_KEY", raising=False)
    payload = invoke_json(["health"])
    assert payload["data"]["status"] == "needs_setup"
    assert "CLIENTSYNC_API_KEY" in json.dumps(payload["data"])


def test_health_ready_with_fake_client(monkeypatch):
    monkeypatch.setenv("CLIENTSYNC_API_KEY", "cs_test_abc")
    monkeypatch.setattr(runtime, "create_client", lambda ctx_obj: FakeClientSyncClient())
    payload = invoke_json(["health"])
    assert payload["data"]["status"] == "ready"
    assert payload["data"]["probe"]["ok"] is True
    assert payload["data"]["probe"]["details"]["client_count"] == 2


def test_client_list_returns_picker_metadata(monkeypatch):
    monkeypatch.setenv("CLIENTSYNC_API_KEY", "cs_test_abc")
    monkeypatch.setattr(runtime, "create_client", lambda ctx_obj: FakeClientSyncClient())
    payload = invoke_json(["client", "list", "--limit", "1"])
    data = payload["data"]
    assert data["client_count"] == 1
    assert data["picker"]["kind"] == "client"
    assert data["picker"]["items"][0]["id"] == "cli_1"
    assert data["scope_preview"]["selection_surface"] == "client"


def test_client_get_uses_scoped_client(monkeypatch):
    monkeypatch.setenv("CLIENTSYNC_API_KEY", "cs_test_abc")
    monkeypatch.setenv("CLIENTSYNC_CLIENT_ID", "cli_1")
    monkeypatch.setattr(runtime, "create_client", lambda ctx_obj: FakeClientSyncClient())
    payload = invoke_json(["client", "get"])
    assert payload["data"]["client"]["id"] == "cli_1"
    assert payload["data"]["scope_preview"]["client_id"] == "cli_1"


def test_ticket_list_with_client_filter(monkeypatch):
    monkeypatch.setenv("CLIENTSYNC_API_KEY", "cs_test_abc")
    monkeypatch.setattr(runtime, "create_client", lambda ctx_obj: FakeClientSyncClient())
    payload = invoke_json(["ticket", "list", "--client-id", "cli_1"])
    data = payload["data"]
    assert data["ticket_count"] == 2
    assert data["picker"]["kind"] == "ticket"
    assert data["scope_preview"]["client_id"] == "cli_1"


def test_ticket_create_requires_write_mode(monkeypatch):
    monkeypatch.setenv("CLIENTSYNC_API_KEY", "cs_test_abc")
    monkeypatch.setattr(runtime, "create_client", lambda ctx_obj: FakeClientSyncClient())
    payload = invoke_json_with_mode("write", ["ticket", "create", "cli_1", "Server down"])
    assert payload["data"]["status"] == "live_write"
    assert payload["data"]["ticket"]["subject"] == "Server down"


def test_ticket_assign(monkeypatch):
    monkeypatch.setenv("CLIENTSYNC_API_KEY", "cs_test_abc")
    monkeypatch.setattr(runtime, "create_client", lambda ctx_obj: FakeClientSyncClient())
    payload = invoke_json_with_mode("write", ["ticket", "assign", "tkt_1", "tech_1"])
    assert payload["data"]["ticket"]["technician_id"] == "tech_1"


def test_technician_availability(monkeypatch):
    monkeypatch.setenv("CLIENTSYNC_API_KEY", "cs_test_abc")
    monkeypatch.setenv("CLIENTSYNC_TECHNICIAN_ID", "tech_1")
    monkeypatch.setattr(runtime, "create_client", lambda ctx_obj: FakeClientSyncClient())
    payload = invoke_json(["technician", "availability"])
    assert payload["data"]["availability"]["available"] is True


def test_compliance_check(monkeypatch):
    monkeypatch.setenv("CLIENTSYNC_API_KEY", "cs_test_abc")
    monkeypatch.setenv("CLIENTSYNC_CLIENT_ID", "cli_1")
    monkeypatch.setenv("CLIENTSYNC_COMPLIANCE_ID", "SOC2")
    monkeypatch.setattr(runtime, "create_client", lambda ctx_obj: FakeClientSyncClient())
    payload = invoke_json(["compliance", "check"])
    assert payload["data"]["result"]["passing"] is True
    assert payload["data"]["result"]["score"] == 92


def test_analytics_dashboard(monkeypatch):
    monkeypatch.setenv("CLIENTSYNC_API_KEY", "cs_test_abc")
    monkeypatch.setattr(runtime, "create_client", lambda ctx_obj: FakeClientSyncClient())
    payload = invoke_json(["analytics", "dashboard"])
    assert payload["data"]["dashboard"]["total_clients"] == 42


def test_config_show_redacts_key(monkeypatch):
    monkeypatch.setenv("CLIENTSYNC_API_KEY", "cs_test_secret_key")
    monkeypatch.setenv("CLIENTSYNC_CLIENT_ID", "cli_1")
    payload = invoke_json(["config", "show"])
    data = payload["data"]
    assert "cs_test_secret_key" not in json.dumps(data)
    assert data["scope"]["client_id"] == "cli_1"
    assert data["runtime"]["implementation_mode"] == "live_read_write"


def test_report_generate_requires_write(monkeypatch):
    monkeypatch.setenv("CLIENTSYNC_API_KEY", "cs_test_abc")
    monkeypatch.setattr(runtime, "create_client", lambda ctx_obj: FakeClientSyncClient())
    payload = invoke_json_with_mode("write", ["report", "generate", "monthly_client_review"])
    assert payload["data"]["status"] == "live_write"
    assert payload["data"]["report"]["report_type"] == "monthly_client_review"
