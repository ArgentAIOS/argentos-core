from __future__ import annotations

import json
from pathlib import Path

from click.testing import CliRunner

import cli_aos.pagerduty.runtime as runtime
from cli_aos.pagerduty.cli import cli


AGENT_HARNESS_ROOT = Path(__file__).resolve().parents[1]
CONNECTOR_PATH = AGENT_HARNESS_ROOT.parent / "connector.json"
PERMISSIONS_PATH = AGENT_HARNESS_ROOT / "permissions.json"


def _set_env(monkeypatch) -> None:
    monkeypatch.setenv("PAGERDUTY_API_KEY", "pd_123")
    monkeypatch.setenv("PAGERDUTY_SERVICE_ID", "P123SERVICE")
    monkeypatch.setenv("PAGERDUTY_INCIDENT_ID", "P123INCIDENT")
    monkeypatch.setenv("PAGERDUTY_ESCALATION_POLICY_ID", "P123ESC")
    monkeypatch.setenv("PAGERDUTY_URGENCY", "high")
    monkeypatch.setenv("PAGERDUTY_TITLE", "Database connection pool exhausted")
    monkeypatch.setenv("PAGERDUTY_DESCRIPTION", "Primary DB connection pool at 100% capacity")


class FakePagerDutyClient:
    def list_incidents(self, *, limit: int = 25, statuses: list[str] | None = None, service_id: str | None = None):
        return {
            "items": [
                {
                    "id": "PINC123",
                    "summary": "Database down",
                    "status": "triggered",
                    "urgency": "high",
                    "created_at": "2026-03-27T10:00:00Z",
                    "updated_at": "2026-03-27T10:05:00Z",
                    "service": {"id": service_id or "P123SERVICE", "summary": "Database"},
                }
            ],
            "raw": {"limit": limit, "statuses": statuses or [], "service_id": service_id},
            "count": 1,
            "more": False,
            "limit": limit,
            "offset": 0,
            "total": 1,
        }

    def get_incident(self, incident_id: str):
        return {
            "id": incident_id,
            "summary": "Database down",
            "status": "triggered",
            "urgency": "high",
            "service": {"id": "P123SERVICE", "summary": "Database"},
            "raw": {"id": incident_id},
        }

    def list_services(self, *, limit: int = 25):
        return {
            "items": [
                {
                    "id": "P123SERVICE",
                    "name": "Database",
                    "summary": "Database",
                    "status": "active",
                    "description": "Primary DB service",
                }
            ],
            "raw": {"limit": limit},
            "count": 1,
            "more": False,
            "limit": limit,
            "offset": 0,
            "total": 1,
        }

    def get_service(self, service_id: str):
        return {
            "id": service_id,
            "name": "Database",
            "summary": "Database",
            "status": "active",
            "description": "Primary DB service",
            "raw": {"id": service_id},
        }

    def list_escalation_policies(self, *, limit: int = 25):
        return {
            "items": [
                {
                    "id": "P123ESC",
                    "name": "Primary Escalation",
                    "summary": "Primary Escalation",
                    "num_loops": 1,
                    "teams": [],
                    "services": [],
                }
            ],
            "raw": {"limit": limit},
            "count": 1,
            "more": False,
            "limit": limit,
            "offset": 0,
            "total": 1,
        }

    def list_on_calls(self, *, limit: int = 25, escalation_policy_id: str | None = None):
        return {
            "items": [
                {
                    "id": "ONCALL1",
                    "user": {"id": "U1", "summary": "Responder"},
                    "schedule": {"id": "S1", "summary": "Primary"},
                    "escalation_policy": {"id": escalation_policy_id or "P123ESC", "summary": "Primary"},
                    "escalation_level": 1,
                    "start": "2026-03-27T10:00:00Z",
                    "end": "2026-03-27T18:00:00Z",
                }
            ],
            "raw": {"limit": limit},
            "count": 1,
            "more": False,
            "limit": limit,
            "offset": 0,
            "total": 1,
        }

    def list_alerts(self, *, limit: int = 25, incident_id: str | None = None):
        return {
            "items": [
                {
                    "id": "A1",
                    "status": "triggered",
                    "severity": "critical",
                    "summary": "Database down",
                    "incident": {"id": incident_id or "P123INCIDENT"},
                }
            ],
            "raw": {"limit": limit},
            "count": 1,
            "more": False,
            "limit": limit,
            "offset": 0,
            "total": 1,
        }


def _fake_client_factory():
    return FakePagerDutyClient()


def test_manifest_and_permissions_are_in_sync():
    manifest = json.loads(CONNECTOR_PATH.read_text())
    permissions = json.loads(PERMISSIONS_PATH.read_text())["permissions"]
    manifest_command_ids = [command["id"] for command in manifest["commands"]]

    assert manifest["tool"] == "aos-pagerduty"
    assert manifest["scope"]["scaffold_only"] is True
    assert set(manifest_command_ids) == set(permissions.keys())


def test_capabilities_json_includes_manifest_metadata():
    result = CliRunner().invoke(cli, ["--json", "capabilities"])
    assert result.exit_code == 0
    payload = json.loads(result.output)
    manifest = json.loads(CONNECTOR_PATH.read_text())
    assert payload["tool"] == "aos-pagerduty"
    assert payload["backend"] == manifest["backend"]
    assert payload["connector"] == manifest["connector"]
    assert payload["scope"] == manifest["scope"]
    assert payload["auth"] == manifest["auth"]
    assert any(command["id"] == "change_event.create" for command in payload["commands"])


def test_health_reports_needs_setup_without_secret(monkeypatch):
    monkeypatch.delenv("PAGERDUTY_API_KEY", raising=False)

    result = CliRunner().invoke(cli, ["--json", "health"])
    assert result.exit_code == 0
    assert '"status": "needs_setup"' in result.output
    assert "PAGERDUTY_API_KEY" in result.output


def test_health_reports_live_read_ready_when_probe_succeeds(monkeypatch):
    _set_env(monkeypatch)
    monkeypatch.setattr(runtime, "create_client", lambda _ctx: FakePagerDutyClient())

    result = CliRunner().invoke(cli, ["--json", "health"])

    assert result.exit_code == 0
    payload = json.loads(result.output)
    assert payload["data"]["status"] == "ready"
    assert payload["data"]["checks"][1]["ok"] is True
    assert payload["data"]["checks"][1]["details"]["live_read_available"] is True


def test_config_show_redacts_and_reports_scope(monkeypatch):
    _set_env(monkeypatch)
    monkeypatch.setattr(runtime, "create_client", lambda _ctx: FakePagerDutyClient())

    result = CliRunner().invoke(cli, ["--json", "config", "show"])

    assert result.exit_code == 0
    payload = json.loads(result.output)
    assert payload["data"]["runtime"]["runtime_ready"] is True
    assert payload["data"]["auth"]["api_key_present"] is True
    assert payload["data"]["runtime"]["command_defaults"]["incident.create"]["service_id"] == "P123SERVICE"


def test_incident_list_hits_live_runtime(monkeypatch):
    _set_env(monkeypatch)
    monkeypatch.setattr(runtime, "create_client", lambda _ctx: FakePagerDutyClient())

    result = CliRunner().invoke(cli, ["--json", "incident", "list", "--limit", "5"])

    assert result.exit_code == 0
    payload = json.loads(result.output)
    assert payload["data"]["resource"] == "incident"
    assert payload["data"]["operation"] == "incident.list"
    assert payload["data"]["count"] == 1
    assert payload["data"]["results"][0]["id"] == "PINC123"


def test_write_command_is_permission_gated_in_readonly_mode():
    result = CliRunner().invoke(cli, ["--json", "incident", "create"])
    assert result.exit_code == 3
    assert "PERMISSION_DENIED" in result.output


def test_write_command_scaffolded_in_write_mode(monkeypatch):
    _set_env(monkeypatch)
    result = CliRunner().invoke(cli, ["--json", "--mode", "write", "incident", "create"])
    assert result.exit_code == 10
    assert "NOT_IMPLEMENTED" in result.output
    assert "incident.create is scaffolded" in result.output
