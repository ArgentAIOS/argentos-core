from __future__ import annotations

import json
from pathlib import Path
from typing import Any

from click.testing import CliRunner

from cli_aos.lion_report.cli import cli
import cli_aos.lion_report.runtime as runtime


AGENT_HARNESS_ROOT = Path(__file__).resolve().parents[1]
CONNECTOR_PATH = AGENT_HARNESS_ROOT.parent / "connector.json"
PERMISSIONS_PATH = AGENT_HARNESS_ROOT / "permissions.json"


class FakeLionReportClient:
    def list_reports(self, *, report_type: str | None = None, date_range: str | None = None, limit: int = 25) -> dict[str, Any]:
        return {"reports": [{"id": "r1", "title": "Quarterly", "type": report_type or "summary", "status": "ready"}][:limit]}

    def get_report(self, report_id: str) -> dict[str, Any]:
        return {"id": report_id, "title": "Quarterly", "status": "ready"}

    def generate_report(self, payload: dict[str, Any]) -> dict[str, Any]:
        return {"job_id": "job-1", "payload": payload}

    def schedule_report(self, payload: dict[str, Any]) -> dict[str, Any]:
        return {"schedule_id": "sched-1", "payload": payload}

    def list_data_sources(self) -> dict[str, Any]:
        return {"sources": [{"id": "ds1", "name": "CRM", "type": "api"}]}

    def query_data_source(self, data_source: str, query_text: str, *, date_range: str | None = None) -> dict[str, Any]:
        return {"data_source": data_source, "query": query_text, "rows": [1, 2, 3]}

    def import_data(self, payload: dict[str, Any]) -> dict[str, Any]:
        return {"import_id": "imp-1", "payload": payload}

    def run_analysis(self, payload: dict[str, Any]) -> dict[str, Any]:
        return {"analysis_id": "an-1", "payload": payload}

    def list_analyses(self, *, limit: int = 20) -> dict[str, Any]:
        return {"analyses": [{"id": "an-1", "type": "trend", "status": "done"}][:limit]}

    def list_templates(self, *, limit: int = 20) -> dict[str, Any]:
        return {"templates": [{"id": "t1", "name": "Executive", "description": "Summary"}][:limit]}

    def get_template(self, template_id: str) -> dict[str, Any]:
        return {"id": template_id, "name": "Executive"}

    def export_pdf(self, report_id: str) -> dict[str, Any]:
        return {"report_id": report_id, "format": "pdf"}

    def export_csv(self, report_id: str) -> dict[str, Any]:
        return {"report_id": report_id, "format": "csv"}

    def export_email(self, report_id: str, recipient_email: str) -> dict[str, Any]:
        return {"report_id": report_id, "recipient_email": recipient_email}

    def list_journal_entries(self, *, date_range: str | None = None, limit: int = 25) -> dict[str, Any]:
        return {"entries": [{"id": "j1", "date": "2026-01-01"}][:limit]}

    def create_journal_entry(self, payload: dict[str, Any]) -> dict[str, Any]:
        return {"entry_id": "j2", "payload": payload}

    def list_users(self, *, limit: int = 25) -> dict[str, Any]:
        return {"users": [{"id": "u1", "name": "Ada"}][:limit]}

    def get_user(self, user_id: str) -> dict[str, Any]:
        return {"id": user_id, "name": "Ada"}

    def list_training(self, *, limit: int = 25) -> dict[str, Any]:
        return {"training": [{"id": "tr1", "status": "complete"}][:limit]}

    def training_stats(self) -> dict[str, Any]:
        return {"completed": 3}


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
    assert manifest["scope"]["kind"] == "intelligence-reporting"


def test_capabilities_exposes_manifest():
    payload = invoke_json(["capabilities"])
    assert payload["tool"] == "aos-lion-report"
    assert payload["data"]["backend"] == "lion-report-api"
    assert "report.generate" in json.dumps(payload["data"])


def test_health_requires_credentials():
    payload = invoke_json(["health"])
    assert payload["data"]["status"] == "needs_setup"
    assert payload["data"]["probe"]["code"] == "LION_REPORT_SETUP_REQUIRED"


def test_health_ready_with_fake_client(monkeypatch):
    monkeypatch.setenv("LION_REPORT_API_KEY", "lion-secret")
    monkeypatch.setattr(runtime, "create_client", lambda ctx_obj: FakeLionReportClient())
    payload = invoke_json(["health"])
    assert payload["data"]["status"] == "ready"
    assert payload["data"]["probe"]["ok"] is True


def test_config_show_redacts_credentials(monkeypatch):
    monkeypatch.setenv("LION_REPORT_API_KEY", "lion-secret")
    payload = invoke_json(["config", "show"])
    assert "lion-secret" not in json.dumps(payload["data"])
    assert payload["data"]["auth"]["api_key_present"] is True


def test_report_list_uses_picker(monkeypatch):
    monkeypatch.setenv("LION_REPORT_API_KEY", "lion-secret")
    monkeypatch.setattr(runtime, "create_client", lambda ctx_obj: FakeLionReportClient())
    payload = invoke_json(["report", "list"])
    assert payload["data"]["picker"]["kind"] == "lion_report"
    assert payload["data"]["reports"][0]["id"] == "r1"


def test_report_generate_requires_write_mode(monkeypatch):
    monkeypatch.setenv("LION_REPORT_API_KEY", "lion-secret")
    monkeypatch.setattr(runtime, "create_client", lambda ctx_obj: FakeLionReportClient())
    result = CliRunner().invoke(cli, ["--json", "--mode", "readonly", "report", "generate"])
    payload = json.loads(result.output)
    assert payload["ok"] is False
    assert payload["error"]["code"] == "PERMISSION_DENIED"


def test_report_generate_succeeds_in_write_mode(monkeypatch):
    monkeypatch.setenv("LION_REPORT_API_KEY", "lion-secret")
    monkeypatch.setattr(runtime, "create_client", lambda ctx_obj: FakeLionReportClient())
    payload = invoke_json_with_mode("write", ["report", "generate", "--report-type", "ops"])
    assert payload["data"]["status"] == "live_write"
    assert payload["data"]["result"]["job_id"] == "job-1"


def test_data_query_returns_result(monkeypatch):
    monkeypatch.setenv("LION_REPORT_API_KEY", "lion-secret")
    monkeypatch.setenv("LION_DATA_SOURCE", "crm")
    monkeypatch.setattr(runtime, "create_client", lambda ctx_obj: FakeLionReportClient())
    payload = invoke_json(["data", "query", "--query", "accounts"])
    assert payload["data"]["result"]["data_source"] == "crm"


def test_export_email_requires_write_mode(monkeypatch):
    monkeypatch.setenv("LION_REPORT_API_KEY", "lion-secret")
    monkeypatch.setattr(runtime, "create_client", lambda ctx_obj: FakeLionReportClient())
    result = CliRunner().invoke(cli, ["--json", "--mode", "readonly", "export", "email", "r1", "--recipient-email", "ops@example.com"])
    payload = json.loads(result.output)
    assert payload["ok"] is False
    assert payload["error"]["code"] == "PERMISSION_DENIED"


def test_export_email_succeeds_in_write_mode(monkeypatch):
    monkeypatch.setenv("LION_REPORT_API_KEY", "lion-secret")
    monkeypatch.setattr(runtime, "create_client", lambda ctx_obj: FakeLionReportClient())
    payload = invoke_json_with_mode("write", ["export", "email", "r1", "--recipient-email", "ops@example.com"])
    assert payload["data"]["status"] == "live_write"
    assert payload["data"]["result"]["recipient_email"] == "ops@example.com"
