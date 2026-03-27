from __future__ import annotations

import json
from pathlib import Path
from typing import Any

from click.testing import CliRunner

from cli_aos.sendgrid.cli import cli
import cli_aos.sendgrid.runtime as runtime


AGENT_HARNESS_ROOT = Path(__file__).resolve().parents[1]
CONNECTOR_PATH = AGENT_HARNESS_ROOT.parent / "connector.json"
PERMISSIONS_PATH = AGENT_HARNESS_ROOT / "permissions.json"


class FakeSendGridClient:
    def verify_api_key(self) -> dict[str, Any]:
        return {"scopes": ["mail.send", "marketing.read"]}

    def send_email(self, *, to: str, from_email: str, subject: str, html_body: str) -> dict[str, Any]:
        return {"status": "accepted", "to": to, "from": from_email, "subject": subject}

    def send_template_email(self, *, to: str, from_email: str, template_id: str, dynamic_data: dict | None = None) -> dict[str, Any]:
        return {"status": "accepted", "to": to, "from": from_email, "template_id": template_id}

    def list_contacts(self, *, limit: int = 50) -> dict[str, Any]:
        return {"contacts": [
            {"id": "c1", "email": "ada@example.com", "first_name": "Ada", "last_name": "Lovelace"},
            {"id": "c2", "email": "grace@example.com", "first_name": "Grace", "last_name": "Hopper"},
        ], "contact_count": 2}

    def add_contact(self, *, email: str, first_name: str | None = None, last_name: str | None = None, list_ids: list[str] | None = None) -> dict[str, Any]:
        return {"job_id": "job_123"}

    def search_contacts(self, *, query: str, limit: int = 50) -> dict[str, Any]:
        return {"contacts": [{"id": "c1", "email": "ada@example.com"}], "contact_count": 1}

    def list_lists(self, *, limit: int = 50) -> dict[str, Any]:
        return {"lists": [
            {"id": "list_1", "name": "Newsletter", "contact_count": 101},
            {"id": "list_2", "name": "Customers", "contact_count": 52},
        ]}

    def create_list(self, *, name: str) -> dict[str, Any]:
        return {"id": "list_new", "name": name, "contact_count": 0}

    def add_contacts_to_list(self, *, list_id: str, contact_ids: list[str]) -> dict[str, Any]:
        return {"job_id": "job_456"}

    def list_templates(self, *, limit: int = 50, generations: str = "dynamic") -> dict[str, Any]:
        return {"templates": [
            {"id": "tmpl_1", "name": "Welcome", "generation": "dynamic"},
            {"id": "tmpl_2", "name": "Receipt", "generation": "dynamic"},
        ]}

    def get_template(self, template_id: str) -> dict[str, Any]:
        return {"id": template_id, "name": "Welcome", "generation": "dynamic"}

    def global_stats(self, *, start_date: str = "2024-01-01") -> dict[str, Any]:
        return {"stats": [{"date": "2024-01-01", "stats": {"requests": 100, "delivered": 98}}]}

    def category_stats(self, *, category: str, start_date: str = "2024-01-01") -> dict[str, Any]:
        return {"stats": [{"date": "2024-01-01", "stats": {"requests": 50}}], "category": category}


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
    assert manifest["scope"]["kind"] == "email-delivery"


def test_capabilities_exposes_manifest():
    payload = invoke_json(["capabilities"])
    assert payload["tool"] == "aos-sendgrid"
    assert payload["data"]["backend"] == "sendgrid-api"
    assert "email.send" in json.dumps(payload["data"])
    assert "templates.list" in json.dumps(payload["data"])


def test_health_requires_api_key(monkeypatch):
    monkeypatch.delenv("SENDGRID_API_KEY", raising=False)
    payload = invoke_json(["health"])
    assert payload["data"]["status"] == "needs_setup"
    assert "SENDGRID_API_KEY" in json.dumps(payload["data"])


def test_health_ready_with_fake_client(monkeypatch):
    monkeypatch.setenv("SENDGRID_API_KEY", "SG.test_abc")
    monkeypatch.setattr(runtime, "create_client", lambda ctx_obj: FakeSendGridClient())
    payload = invoke_json(["health"])
    assert payload["data"]["status"] == "ready"
    assert payload["data"]["probe"]["ok"] is True


def test_contacts_list_returns_picker_metadata(monkeypatch):
    monkeypatch.setenv("SENDGRID_API_KEY", "SG.test_abc")
    monkeypatch.setattr(runtime, "create_client", lambda ctx_obj: FakeSendGridClient())
    payload = invoke_json(["contacts", "list"])
    data = payload["data"]
    assert data["contact_count"] == 2
    assert data["picker"]["kind"] == "contact"
    assert data["picker"]["items"][0]["id"] == "c1"


def test_lists_list_returns_picker_metadata(monkeypatch):
    monkeypatch.setenv("SENDGRID_API_KEY", "SG.test_abc")
    monkeypatch.setattr(runtime, "create_client", lambda ctx_obj: FakeSendGridClient())
    payload = invoke_json(["lists", "list"])
    data = payload["data"]
    assert data["list_count"] == 2
    assert data["picker"]["kind"] == "list"


def test_templates_list_returns_picker_metadata(monkeypatch):
    monkeypatch.setenv("SENDGRID_API_KEY", "SG.test_abc")
    monkeypatch.setattr(runtime, "create_client", lambda ctx_obj: FakeSendGridClient())
    payload = invoke_json(["templates", "list"])
    data = payload["data"]
    assert data["template_count"] == 2
    assert data["picker"]["kind"] == "template"


def test_email_send_requires_write_mode(monkeypatch):
    monkeypatch.setenv("SENDGRID_API_KEY", "SG.test_abc")
    monkeypatch.setenv("SENDGRID_FROM_EMAIL", "noreply@example.com")
    monkeypatch.setattr(runtime, "create_client", lambda ctx_obj: FakeSendGridClient())
    result = CliRunner().invoke(cli, ["--json", "--mode", "readonly", "email", "send", "test@example.com", "--subject", "Hi", "--body", "<p>Hello</p>"])
    payload = json.loads(result.output)
    assert payload["ok"] is False
    assert payload["error"]["code"] == "PERMISSION_DENIED"


def test_email_send_succeeds_in_write_mode(monkeypatch):
    monkeypatch.setenv("SENDGRID_API_KEY", "SG.test_abc")
    monkeypatch.setenv("SENDGRID_FROM_EMAIL", "noreply@example.com")
    monkeypatch.setattr(runtime, "create_client", lambda ctx_obj: FakeSendGridClient())
    payload = invoke_json_with_mode("write", ["email", "send", "test@example.com", "--subject", "Hi", "--body", "<p>Hello</p>"])
    assert payload["data"]["status"] == "live_write"
    assert payload["data"]["result"]["to"] == "test@example.com"


def test_contacts_add_succeeds_in_write_mode(monkeypatch):
    monkeypatch.setenv("SENDGRID_API_KEY", "SG.test_abc")
    monkeypatch.setattr(runtime, "create_client", lambda ctx_obj: FakeSendGridClient())
    payload = invoke_json_with_mode("write", ["contacts", "add", "new@example.com", "--first-name", "New"])
    assert payload["data"]["status"] == "live_write"
