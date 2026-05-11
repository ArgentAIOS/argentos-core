from __future__ import annotations

import json
import os
from pathlib import Path
from typing import Any

from click.testing import CliRunner

from cli_aos.resend.cli import cli
import cli_aos.resend.runtime as runtime


AGENT_HARNESS_ROOT = Path(__file__).resolve().parents[1]
CONNECTOR_PATH = AGENT_HARNESS_ROOT.parent / "connector.json"
PERMISSIONS_PATH = AGENT_HARNESS_ROOT / "permissions.json"


class FakeResendClient:
    def verify_api_key(self) -> dict[str, Any]:
        return {"domains": [{"id": "dom_1", "name": "example.com", "status": "verified"}]}

    def send_email(self, *, to: str | list[str], from_email: str, subject: str, html: str) -> dict[str, Any]:
        return {"id": "email_123"}

    def batch_send(self, *, emails: list[dict[str, Any]]) -> dict[str, Any]:
        return {"data": [{"id": f"email_{i}"} for i in range(len(emails))]}

    def list_domains(self) -> dict[str, Any]:
        return {"domains": [
            {"id": "dom_1", "name": "example.com", "status": "verified"},
            {"id": "dom_2", "name": "acme.io", "status": "pending"},
        ]}

    def verify_domain(self, domain_id: str) -> dict[str, Any]:
        return {"object": "domain", "id": domain_id, "status": "pending"}

    def list_audiences(self) -> dict[str, Any]:
        return {"audiences": [
            {"id": "aud_1", "name": "Newsletter"},
            {"id": "aud_2", "name": "Customers"},
        ]}

    def create_audience(self, *, name: str) -> dict[str, Any]:
        return {"id": "aud_new", "name": name}

    def list_contacts(self, *, audience_id: str) -> dict[str, Any]:
        return {"contacts": [
            {"id": "ct_1", "email": "ada@example.com", "first_name": "Ada", "last_name": "Lovelace"},
            {"id": "ct_2", "email": "grace@example.com", "first_name": "Grace", "last_name": "Hopper"},
        ]}

    def create_contact(self, *, audience_id: str, email: str, first_name: str | None = None, last_name: str | None = None) -> dict[str, Any]:
        return {"id": "ct_new", "email": email}

    def remove_contact(self, *, audience_id: str, contact_id: str) -> dict[str, Any]:
        return {"object": "contact", "id": contact_id, "deleted": True}


def missing_resend_runtime(ctx_obj: dict[str, Any]) -> dict[str, Any]:
    from_email = os.environ.get("RESEND_FROM_EMAIL", "")
    return {
        "backend": "resend-api",
        "api_key_env": "RESEND_API_KEY",
        "from_email_env": "RESEND_FROM_EMAIL",
        "audience_id_env": "RESEND_AUDIENCE_ID",
        "domain_id_env": "RESEND_DOMAIN_ID",
        "api_key": "",
        "from_email": from_email,
        "audience_id": "",
        "domain_id": "",
        "api_key_present": False,
        "from_email_present": bool(from_email),
        "audience_id_present": False,
        "domain_id_present": False,
    }


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
    assert payload["tool"] == "aos-resend"
    assert payload["data"]["backend"] == "resend-api"
    assert "email.send" in json.dumps(payload["data"])
    assert "domains.list" in json.dumps(payload["data"])


def test_health_requires_api_key(monkeypatch):
    monkeypatch.delenv("RESEND_API_KEY", raising=False)
    monkeypatch.setattr(runtime, "resolve_runtime_values", missing_resend_runtime)
    payload = invoke_json(["health.check"])
    assert payload["command"] == "health.check"
    assert payload["data"]["status"] == "needs_setup"
    assert "RESEND_API_KEY" in json.dumps(payload["data"])


def test_health_ready_with_fake_client(monkeypatch):
    monkeypatch.setenv("RESEND_API_KEY", "re_test_abc")
    monkeypatch.setattr(runtime, "create_client", lambda ctx_obj: FakeResendClient())
    payload = invoke_json(["health"])
    assert payload["data"]["status"] == "ready"
    assert payload["data"]["probe"]["ok"] is True


def test_domains_list_returns_picker_metadata(monkeypatch):
    monkeypatch.setenv("RESEND_API_KEY", "re_test_abc")
    monkeypatch.setattr(runtime, "create_client", lambda ctx_obj: FakeResendClient())
    payload = invoke_json(["domains", "list"])
    data = payload["data"]
    assert data["domain_count"] == 2
    assert data["picker"]["kind"] == "domain"
    assert data["picker"]["items"][0]["id"] == "dom_1"


def test_audiences_list_returns_picker_metadata(monkeypatch):
    monkeypatch.setenv("RESEND_API_KEY", "re_test_abc")
    monkeypatch.setattr(runtime, "create_client", lambda ctx_obj: FakeResendClient())
    payload = invoke_json(["audiences", "list"])
    data = payload["data"]
    assert data["audience_count"] == 2
    assert data["picker"]["kind"] == "audience"


def test_contacts_list_requires_audience(monkeypatch):
    monkeypatch.setenv("RESEND_API_KEY", "re_test_abc")
    monkeypatch.delenv("RESEND_AUDIENCE_ID", raising=False)
    monkeypatch.setattr(runtime, "create_client", lambda ctx_obj: FakeResendClient())
    result = CliRunner().invoke(cli, ["--json", "contacts", "list"])
    payload = json.loads(result.output)
    assert payload["ok"] is False
    assert payload["error"]["code"] == "RESEND_AUDIENCE_REQUIRED"


def test_contacts_list_with_audience(monkeypatch):
    monkeypatch.setenv("RESEND_API_KEY", "re_test_abc")
    monkeypatch.setenv("RESEND_AUDIENCE_ID", "aud_1")
    monkeypatch.setattr(runtime, "create_client", lambda ctx_obj: FakeResendClient())
    payload = invoke_json(["contacts", "list"])
    data = payload["data"]
    assert data["contact_count"] == 2
    assert data["audience_id"] == "aud_1"


def test_email_send_requires_write_mode(monkeypatch):
    monkeypatch.setenv("RESEND_API_KEY", "re_test_abc")
    monkeypatch.setenv("RESEND_FROM_EMAIL", "noreply@example.com")
    monkeypatch.setattr(runtime, "create_client", lambda ctx_obj: FakeResendClient())
    result = CliRunner().invoke(cli, ["--json", "--mode", "readonly", "email", "send", "test@example.com", "--subject", "Hi", "--html", "<p>Hello</p>"])
    payload = json.loads(result.output)
    assert payload["ok"] is False
    assert payload["error"]["code"] == "PERMISSION_DENIED"


def test_email_send_succeeds_in_write_mode(monkeypatch):
    monkeypatch.setenv("RESEND_API_KEY", "re_test_abc")
    monkeypatch.setenv("RESEND_FROM_EMAIL", "noreply@example.com")
    monkeypatch.setattr(runtime, "create_client", lambda ctx_obj: FakeResendClient())
    payload = invoke_json_with_mode("write", ["email", "send", "test@example.com", "--subject", "Hi", "--html", "<p>Hello</p>"])
    assert payload["data"]["status"] == "live_write"


def test_email_create_draft_is_local_preview(monkeypatch):
    monkeypatch.delenv("RESEND_API_KEY", raising=False)
    monkeypatch.setenv("RESEND_FROM_EMAIL", "drafts@example.com")
    monkeypatch.setattr(runtime, "resolve_runtime_values", missing_resend_runtime)

    payload = invoke_json_with_mode("write", ["email", "create_draft", "test@example.com", "--subject", "Hi", "--html", "<p>Hello</p>"])

    assert payload["command"] == "email.create_draft"
    assert payload["data"]["status"] == "local_preview"
    assert payload["data"]["draft"]["from"] == "drafts@example.com"
    assert payload["data"]["missing_keys"] == ["RESEND_API_KEY"]


def test_contacts_create_succeeds_in_write_mode(monkeypatch):
    monkeypatch.setenv("RESEND_API_KEY", "re_test_abc")
    monkeypatch.setenv("RESEND_AUDIENCE_ID", "aud_1")
    monkeypatch.setattr(runtime, "create_client", lambda ctx_obj: FakeResendClient())
    payload = invoke_json_with_mode("write", ["contacts", "create", "new@example.com"])
    assert payload["data"]["status"] == "live_write"
    assert payload["data"]["result"]["email"] == "new@example.com"
