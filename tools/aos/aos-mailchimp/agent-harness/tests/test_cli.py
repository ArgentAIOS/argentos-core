from __future__ import annotations

import json
import os
from pathlib import Path
from typing import Any

from click.testing import CliRunner
import pytest

from cli_aos.mailchimp.cli import cli
import cli_aos.mailchimp.config as config
import cli_aos.mailchimp.runtime as runtime


AGENT_HARNESS_ROOT = Path(__file__).resolve().parents[1]
CONNECTOR_PATH = AGENT_HARNESS_ROOT.parent / "connector.json"
PERMISSIONS_PATH = AGENT_HARNESS_ROOT / "permissions.json"


@pytest.fixture(autouse=True)
def isolate_service_key_resolution(monkeypatch):
    monkeypatch.setattr(
        config,
        "service_key_env",
        lambda name, default=None: os.getenv(name) if os.getenv(name) is not None else default,
    )


class FakeMailchimpClient:
    def ping(self) -> dict[str, Any]:
        return {"health_status": "Everything's Chimpy!"}

    def read_account(self) -> dict[str, Any]:
        return {
            "account_name": "Newsletter HQ",
            "username": "newsletter@example.com",
            "dc": "us1",
            "contact": {"company": "ArgentOS"},
        }

    def list_audiences(self, *, limit: int = 10) -> dict[str, Any]:
        return {
            "lists": [
                {"id": "aud1", "name": "Newsletter", "stats": {"member_count": 101}},
                {"id": "aud2", "name": "Customers", "stats": {"member_count": 52}},
            ][:limit]
        }

    def read_audience(self, audience_id: str) -> dict[str, Any]:
        return {"id": audience_id, "name": "Newsletter", "stats": {"member_count": 101}}

    def list_members(self, audience_id: str, *, limit: int = 10) -> dict[str, Any]:
        return {
            "list_id": audience_id,
            "members": [
                {"id": "mem1", "email_address": "one@example.com", "status": "subscribed"},
                {"id": "mem2", "email_address": "two@example.com", "status": "cleaned"},
            ][:limit],
        }

    def read_member(self, audience_id: str, email: str) -> dict[str, Any]:
        return {"list_id": audience_id, "email_address": email, "status": "subscribed"}

    def list_campaigns(self, *, limit: int = 10, status: str | None = None) -> dict[str, Any]:
        campaigns = [
            {"id": "cmp1", "status": status or "save", "settings": {"title": "March newsletter"}},
            {"id": "cmp2", "status": status or "sent", "settings": {"title": "Product launch"}},
        ]
        return {"campaigns": campaigns[:limit]}

    def read_campaign(self, campaign_id: str) -> dict[str, Any]:
        return {"id": campaign_id, "status": "save", "settings": {"title": "March newsletter"}}

    def list_reports(self, *, limit: int = 10) -> dict[str, Any]:
        return {"reports": [{"campaign_id": "cmp1", "campaign_title": "March newsletter", "emails_sent": 1200}][:limit]}

    def read_report(self, campaign_id: str) -> dict[str, Any]:
        return {"campaign_id": campaign_id, "campaign_title": "March newsletter", "emails_sent": 1200}


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
    assert manifest["scope"]["kind"] == "email-marketing"


def test_capabilities_exposes_manifest():
    payload = invoke_json(["capabilities"])
    assert payload["tool"] == "aos-mailchimp"
    assert payload["data"]["backend"] == "mailchimp-marketing-api"
    assert "account.read" in json.dumps(payload["data"])
    assert "campaign.read" in json.dumps(payload["data"])


def test_account_read_returns_picker_metadata(monkeypatch):
    monkeypatch.setenv("MAILCHIMP_API_KEY", "abc-us1")
    monkeypatch.setenv("MAILCHIMP_SERVER_PREFIX", "us1")
    monkeypatch.setattr(runtime, "create_client", lambda ctx_obj: FakeMailchimpClient())
    payload = invoke_json(["account", "read"])
    data = payload["data"]
    assert data["account"]["account_name"] == "Newsletter HQ"
    assert data["scope_preview"]["selection_surface"] == "account"
    assert data["scope_preview"]["command_id"] == "account.read"
    assert data["scope_preview"]["server_prefix"] == "us1"


def test_health_requires_api_key_and_server_prefix(monkeypatch):
    monkeypatch.delenv("MAILCHIMP_API_KEY", raising=False)
    monkeypatch.delenv("MAILCHIMP_SERVER_PREFIX", raising=False)
    payload = invoke_json(["health"])
    assert payload["data"]["status"] == "needs_setup"
    assert "MAILCHIMP_API_KEY" in json.dumps(payload["data"])
    assert "MAILCHIMP_SERVER_PREFIX" in json.dumps(payload["data"])


def test_runtime_prefers_operator_service_keys_for_auth(monkeypatch):
    monkeypatch.setenv("MAILCHIMP_API_KEY", "env-us5")
    monkeypatch.setenv("MAILCHIMP_SERVER_PREFIX", "env1")

    def fake_service_key_env(name: str, default: str | None = None) -> str | None:
        if name == "MAILCHIMP_API_KEY":
            return "service-eu2"
        if name == "MAILCHIMP_SERVER_PREFIX":
            return "eu9"
        return default

    monkeypatch.setattr(config, "service_key_env", fake_service_key_env)
    runtime_values = config.resolve_runtime_values({})
    assert runtime_values["api_key"] == "service-eu2"
    assert runtime_values["server_prefix"] == "eu9"
    assert runtime_values["configured_server_prefix"] == "eu9"


def test_runtime_infers_server_prefix_from_api_key_suffix(monkeypatch):
    monkeypatch.delenv("MAILCHIMP_SERVER_PREFIX", raising=False)

    def fake_service_key_env(name: str, default: str | None = None) -> str | None:
        if name == "MAILCHIMP_API_KEY":
            return "service-eu2"
        if name == "MAILCHIMP_SERVER_PREFIX":
            return ""
        return default

    monkeypatch.setattr(config, "service_key_env", fake_service_key_env)
    runtime_values = config.resolve_runtime_values({})
    assert runtime_values["server_prefix"] == "eu2"
    assert runtime_values["server_prefix_present"] is True


def test_health_ready_with_fake_client(monkeypatch):
    monkeypatch.setenv("MAILCHIMP_API_KEY", "abc-us1")
    monkeypatch.setenv("MAILCHIMP_SERVER_PREFIX", "us1")
    monkeypatch.setattr(runtime, "create_client", lambda ctx_obj: FakeMailchimpClient())
    payload = invoke_json(["health"])
    assert payload["data"]["status"] == "ready"
    assert payload["data"]["probe"]["ok"] is True


def test_config_show_redacts_and_surfaces_scope(monkeypatch):
    monkeypatch.setenv("MAILCHIMP_API_KEY", "secret-us1")
    monkeypatch.setenv("MAILCHIMP_SERVER_PREFIX", "us1")
    monkeypatch.setenv("MAILCHIMP_AUDIENCE_ID", "aud1")
    monkeypatch.setenv("MAILCHIMP_CAMPAIGN_ID", "cmp1")
    monkeypatch.setenv("MAILCHIMP_MEMBER_EMAIL", "contact@example.com")
    payload = invoke_json(["config", "show"])
    data = payload["data"]
    assert "secret-us1" not in json.dumps(data)
    assert data["scope"]["audience_id"] == "aud1"
    assert data["runtime"]["implementation_mode"] == "live_read_with_scaffolded_writes"
    assert data["runtime"]["command_defaults"]["account.read"]["selection_surface"] == "account"
    assert data["runtime"]["picker_scopes"]["audience"]["pickers"]["audience"]["command"] == "audience.list"
    assert data["runtime"]["picker_scopes"]["campaign"]["pickers"]["campaign"]["command"] == "campaign.list"
    assert data["runtime"]["picker_scopes"]["member"]["pickers"]["member"]["command"] == "member.list"
    assert data["runtime"]["picker_scopes"]["member"]["selected"]["member_email"] == "contact@example.com"


def test_audience_list_returns_picker(monkeypatch):
    monkeypatch.setenv("MAILCHIMP_API_KEY", "abc-us1")
    monkeypatch.setenv("MAILCHIMP_SERVER_PREFIX", "us1")
    monkeypatch.setattr(runtime, "create_client", lambda ctx_obj: FakeMailchimpClient())
    payload = invoke_json(["audience", "list", "--limit", "1"])
    data = payload["data"]
    assert data["audience_count"] == 1
    assert data["picker"]["kind"] == "audience"
    assert data["picker"]["items"][0]["id"] == "aud1"
    assert data["scope_preview"]["selection_surface"] == "audience"
    assert data["scope_preview"]["command_id"] == "audience.list"


def test_member_list_uses_scoped_audience(monkeypatch):
    monkeypatch.setenv("MAILCHIMP_API_KEY", "abc-us1")
    monkeypatch.setenv("MAILCHIMP_SERVER_PREFIX", "us1")
    monkeypatch.setenv("MAILCHIMP_AUDIENCE_ID", "aud1")
    monkeypatch.setattr(runtime, "create_client", lambda ctx_obj: FakeMailchimpClient())
    payload = invoke_json(["member", "list"])
    assert payload["data"]["audience_id"] == "aud1"
    assert payload["data"]["member_count"] == 2
    assert payload["data"]["scope_preview"]["selection_surface"] == "member"
    assert payload["data"]["scope_preview"]["command_id"] == "member.list"


def test_campaign_read_uses_scoped_campaign(monkeypatch):
    monkeypatch.setenv("MAILCHIMP_API_KEY", "abc-us1")
    monkeypatch.setenv("MAILCHIMP_SERVER_PREFIX", "us1")
    monkeypatch.setenv("MAILCHIMP_CAMPAIGN_ID", "cmp1")
    monkeypatch.setattr(runtime, "create_client", lambda ctx_obj: FakeMailchimpClient())
    payload = invoke_json(["campaign", "read"])
    assert payload["data"]["campaign"]["id"] == "cmp1"
    assert payload["data"]["scope_preview"]["selection_surface"] == "campaign"
    assert payload["data"]["scope_preview"]["command_id"] == "campaign.read"


def test_report_list_returns_live_read(monkeypatch):
    monkeypatch.setenv("MAILCHIMP_API_KEY", "abc-us1")
    monkeypatch.setenv("MAILCHIMP_SERVER_PREFIX", "us1")
    monkeypatch.setattr(runtime, "create_client", lambda ctx_obj: FakeMailchimpClient())
    payload = invoke_json(["report", "list"])
    assert payload["data"]["report_count"] == 1
    assert payload["data"]["picker"]["kind"] == "report"
    assert payload["data"]["scope_preview"]["selection_surface"] == "campaign"


def test_scaffold_write_commands_do_not_execute_live_mutations(monkeypatch):
    monkeypatch.setenv("MAILCHIMP_API_KEY", "abc-us1")
    monkeypatch.setenv("MAILCHIMP_SERVER_PREFIX", "us1")
    payload = invoke_json_with_mode("write", ["campaign", "create-draft", "Spring launch"])
    assert payload["data"]["status"] == "scaffold_write_only"
    assert payload["data"]["command"] == "campaign.create_draft"


def test_member_read_requires_scope_when_missing(monkeypatch):
    monkeypatch.setenv("MAILCHIMP_API_KEY", "abc-us1")
    monkeypatch.setenv("MAILCHIMP_SERVER_PREFIX", "us1")
    result = CliRunner().invoke(cli, ["--json", "member", "read"])
    assert result.exit_code == 4
    payload = json.loads(result.output)
    assert payload["error"]["code"] in {"MAILCHIMP_AUDIENCE_REQUIRED", "MAILCHIMP_MEMBER_REQUIRED"}
