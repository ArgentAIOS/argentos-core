from __future__ import annotations

import json
from pathlib import Path

from click.testing import CliRunner

import cli_aos.pagerduty.client as client_module
import cli_aos.pagerduty.runtime as runtime
from cli_aos.pagerduty.cli import cli
from cli_aos.pagerduty.client import PagerDutyClient


AGENT_HARNESS_ROOT = Path(__file__).resolve().parents[1]
CONNECTOR_PATH = AGENT_HARNESS_ROOT.parent / "connector.json"
PERMISSIONS_PATH = AGENT_HARNESS_ROOT / "permissions.json"


def _set_env(monkeypatch) -> None:
    monkeypatch.setenv("PAGERDUTY_API_KEY", "pd_env")
    monkeypatch.setenv("PAGERDUTY_EVENTS_ROUTING_KEY", "routing_env")
    monkeypatch.setenv("PAGERDUTY_FROM_EMAIL", "operator@example.com")
    monkeypatch.setenv("PAGERDUTY_SERVICE_ID", "P123SERVICE")
    monkeypatch.setenv("PAGERDUTY_INCIDENT_ID", "P123INCIDENT")
    monkeypatch.setenv("PAGERDUTY_ESCALATION_POLICY_ID", "P123ESC")
    monkeypatch.setenv("PAGERDUTY_URGENCY", "high")
    monkeypatch.setenv("PAGERDUTY_TITLE", "Database connection pool exhausted")
    monkeypatch.setenv("PAGERDUTY_DESCRIPTION", "Primary DB connection pool at 100% capacity")
    monkeypatch.setenv("PAGERDUTY_SUMMARY", "Deploy 2026.04.26.1 completed")
    monkeypatch.setenv("PAGERDUTY_RESOLUTION", "Restarted the DB writer")


class FakePagerDutyClient:
    def __init__(self) -> None:
        self.last_create_incident: dict[str, str | None] | None = None
        self.last_manage_incident: dict[str, str | None] | None = None
        self.last_change_event: dict[str, str | None] | None = None

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

    def create_incident(
        self,
        *,
        from_email: str,
        service_id: str,
        title: str,
        description: str | None = None,
        urgency: str | None = None,
        escalation_policy_id: str | None = None,
    ):
        self.last_create_incident = {
            "from_email": from_email,
            "service_id": service_id,
            "title": title,
            "description": description,
            "urgency": urgency,
            "escalation_policy_id": escalation_policy_id,
        }
        return {
            "id": "PNEW123",
            "summary": title,
            "title": title,
            "status": "acknowledged",
            "urgency": urgency or "high",
            "service": {"id": service_id, "summary": "Database"},
            "raw": {"id": "PNEW123"},
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

    def manage_incident(
        self,
        incident_id: str,
        *,
        from_email: str,
        status: str,
        resolution: str | None = None,
    ):
        self.last_manage_incident = {
            "incident_id": incident_id,
            "from_email": from_email,
            "status": status,
            "resolution": resolution,
        }
        return {
            "id": incident_id,
            "summary": "Database down",
            "status": status,
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

    def create_change_event(self, *, summary: str, source: str, description: str | None = None):
        self.last_change_event = {"summary": summary, "source": source, "description": description}
        return {"status": "success", "message": "Event processed", "dedup_key": "ce-123"}


def test_manifest_and_permissions_are_in_sync():
    manifest = json.loads(CONNECTOR_PATH.read_text())
    permissions = json.loads(PERMISSIONS_PATH.read_text())["permissions"]
    manifest_command_ids = [command["id"] for command in manifest["commands"]]

    assert manifest["tool"] == "aos-pagerduty"
    assert manifest["scope"]["scaffold_only"] is False
    assert manifest["scope"]["write_bridge_available"] is True
    assert "incident.create" in manifest["scope"]["worker_visible_actions"]
    assert "change_event.create" in manifest["scope"]["worker_visible_actions"]
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
    assert payload["write_support"]["incident.create"] is True


def test_health_reports_needs_setup_without_keys(monkeypatch):
    monkeypatch.delenv("PAGERDUTY_API_KEY", raising=False)
    monkeypatch.delenv("PAGERDUTY_EVENTS_ROUTING_KEY", raising=False)
    monkeypatch.delenv("PAGERDUTY_FROM_EMAIL", raising=False)

    result = CliRunner().invoke(cli, ["--json", "health"])

    assert result.exit_code == 0
    payload = json.loads(result.output)
    assert payload["data"]["status"] == "needs_setup"
    assert "PAGERDUTY_API_KEY" in result.output
    assert "PAGERDUTY_EVENTS_ROUTING_KEY" in result.output


def test_health_reports_ready_when_probe_succeeds(monkeypatch):
    _set_env(monkeypatch)
    fake_client = FakePagerDutyClient()
    monkeypatch.setattr(runtime, "create_client", lambda _ctx: fake_client)

    result = CliRunner().invoke(cli, ["--json", "health"])

    assert result.exit_code == 0
    payload = json.loads(result.output)
    assert payload["data"]["status"] == "ready"
    assert payload["data"]["command_readiness"]["incident.create"] is True
    assert payload["data"]["command_readiness"]["change_event.create"] is True


def test_config_show_prefers_operator_service_keys(monkeypatch):
    _set_env(monkeypatch)
    fake_client = FakePagerDutyClient()
    monkeypatch.setattr(runtime, "create_client", lambda _ctx: fake_client)

    result = CliRunner().invoke(
        cli,
        ["--json", "config", "show"],
        obj={
            "service_keys": {
                "PAGERDUTY_API_KEY": "pd_service_key",
                "PAGERDUTY_EVENTS_ROUTING_KEY": "events_service_key",
            }
        },
    )

    assert result.exit_code == 0
    payload = json.loads(result.output)
    assert payload["data"]["auth"]["api_key_source"] == "service_key"
    assert payload["data"]["auth"]["events_routing_key_source"] == "service_key"


def test_config_show_uses_env_fallback_when_service_key_missing(monkeypatch):
    _set_env(monkeypatch)
    fake_client = FakePagerDutyClient()
    monkeypatch.setattr(runtime, "create_client", lambda _ctx: fake_client)

    result = CliRunner().invoke(cli, ["--json", "config", "show"])

    assert result.exit_code == 0
    payload = json.loads(result.output)
    assert payload["data"]["auth"]["api_key_source"] == "env"
    assert payload["data"]["auth"]["events_routing_key_source"] == "env"


def test_incident_list_hits_live_runtime(monkeypatch):
    _set_env(monkeypatch)
    fake_client = FakePagerDutyClient()
    monkeypatch.setattr(runtime, "create_client", lambda _ctx: fake_client)

    result = CliRunner().invoke(cli, ["--json", "incident", "list", "--limit", "5"])

    assert result.exit_code == 0
    payload = json.loads(result.output)
    assert payload["data"]["resource"] == "incident"
    assert payload["data"]["operation"] == "incident.list"
    assert payload["data"]["count"] == 1
    assert payload["data"]["results"][0]["id"] == "PINC123"


def test_incident_create_runs_live_write_path(monkeypatch):
    _set_env(monkeypatch)
    fake_client = FakePagerDutyClient()
    monkeypatch.setattr(runtime, "create_client", lambda _ctx: fake_client)

    result = CliRunner().invoke(cli, ["--json", "--mode", "write", "incident", "create"])

    assert result.exit_code == 0
    payload = json.loads(result.output)
    assert payload["data"]["operation"] == "incident.create"
    assert payload["data"]["result"]["id"] == "PNEW123"
    assert fake_client.last_create_incident == {
        "from_email": "operator@example.com",
        "service_id": "P123SERVICE",
        "title": "Database connection pool exhausted",
        "description": "Primary DB connection pool at 100% capacity",
        "urgency": "high",
        "escalation_policy_id": "P123ESC",
    }


def test_incident_acknowledge_runs_live_write_path(monkeypatch):
    _set_env(monkeypatch)
    fake_client = FakePagerDutyClient()
    monkeypatch.setattr(runtime, "create_client", lambda _ctx: fake_client)

    result = CliRunner().invoke(cli, ["--json", "--mode", "write", "incident", "acknowledge"])

    assert result.exit_code == 0
    payload = json.loads(result.output)
    assert payload["data"]["operation"] == "incident.acknowledge"
    assert payload["data"]["result"]["status"] == "acknowledged"
    assert fake_client.last_manage_incident == {
        "incident_id": "P123INCIDENT",
        "from_email": "operator@example.com",
        "status": "acknowledged",
        "resolution": None,
    }


def test_incident_resolve_accepts_resolution(monkeypatch):
    _set_env(monkeypatch)
    fake_client = FakePagerDutyClient()
    monkeypatch.setattr(runtime, "create_client", lambda _ctx: fake_client)

    result = CliRunner().invoke(
        cli,
        ["--json", "--mode", "write", "incident", "resolve", "--resolution", "Restarted and verified healthy"],
    )

    assert result.exit_code == 0
    payload = json.loads(result.output)
    assert payload["data"]["operation"] == "incident.resolve"
    assert payload["data"]["result"]["status"] == "resolved"
    assert fake_client.last_manage_incident == {
        "incident_id": "P123INCIDENT",
        "from_email": "operator@example.com",
        "status": "resolved",
        "resolution": "Restarted and verified healthy",
    }


def test_incident_create_requires_from_email(monkeypatch):
    _set_env(monkeypatch)
    monkeypatch.delenv("PAGERDUTY_FROM_EMAIL", raising=False)
    fake_client = FakePagerDutyClient()
    monkeypatch.setattr(runtime, "create_client", lambda _ctx: fake_client)

    result = CliRunner().invoke(cli, ["--json", "--mode", "write", "incident", "create"])

    assert result.exit_code == 4
    assert "from_email is required" in result.output


def test_change_event_create_runs_live_write_path(monkeypatch):
    _set_env(monkeypatch)
    fake_client = FakePagerDutyClient()
    monkeypatch.setattr(runtime, "create_client", lambda _ctx: fake_client)

    result = CliRunner().invoke(cli, ["--json", "--mode", "write", "change-event", "create"])

    assert result.exit_code == 0
    payload = json.loads(result.output)
    assert payload["data"]["operation"] == "change_event.create"
    assert payload["data"]["result"]["status"] == "success"
    assert fake_client.last_change_event == {
        "summary": "Deploy 2026.04.26.1 completed",
        "source": "aos-pagerduty",
        "description": "Primary DB connection pool at 100% capacity",
    }


def test_rest_client_uses_token_auth_header(monkeypatch):
    captured: dict[str, str] = {}

    class DummyHeaders:
        @staticmethod
        def get_content_charset(default: str) -> str:
            return default

    class DummyResponse:
        headers = DummyHeaders()

        def __enter__(self):
            return self

        def __exit__(self, exc_type, exc, tb):
            return False

        @staticmethod
        def read() -> bytes:
            return b'{"incidents": []}'

    def fake_urlopen(req, timeout):
        captured["authorization"] = req.get_header("Authorization")
        captured["accept"] = req.get_header("Accept")
        return DummyResponse()

    monkeypatch.setattr(client_module.request, "urlopen", fake_urlopen)

    client = PagerDutyClient(api_key="pd_test")
    payload = client.list_incidents(limit=1)

    assert payload["count"] == 0
    assert captured["authorization"] == "Token token=pd_test"
    assert captured["accept"] == "application/vnd.pagerduty+json;version=2"
