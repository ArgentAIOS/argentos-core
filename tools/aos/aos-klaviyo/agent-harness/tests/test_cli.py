from __future__ import annotations

import json
from pathlib import Path
from typing import Any

from click.testing import CliRunner

from cli_aos.klaviyo.cli import cli
import cli_aos.klaviyo.runtime as runtime


AGENT_HARNESS_ROOT = Path(__file__).resolve().parents[1]
CONNECTOR_PATH = AGENT_HARNESS_ROOT.parent / "connector.json"
PERMISSIONS_PATH = AGENT_HARNESS_ROOT / "permissions.json"


class FakeKlaviyoClient:
    def read_account(self) -> dict[str, Any]:
        return {
            "id": "acc_123",
            "name": "Demo Klaviyo Account",
            "timezone": "America/Chicago",
            "currency": "USD",
        }

    def list_lists(self, *, limit: int = 10) -> dict[str, Any]:
        lists = [
            {"id": "list_1", "name": "Newsletter", "profile_count": 101},
            {"id": "list_2", "name": "Customers", "profile_count": 52},
        ]
        return {"lists": lists[:limit]}

    def read_list(self, list_id: str) -> dict[str, Any]:
        return {"id": list_id, "name": "Newsletter", "profile_count": 101}

    def list_profiles(self, *, list_id: str | None = None, limit: int = 10, email: str | None = None) -> dict[str, Any]:
        profiles = [
            {
                "id": "prof_1",
                "email": "ada@example.com",
                "first_name": "Ada",
                "last_name": "Lovelace",
                "display_name": "Ada Lovelace",
            },
            {
                "id": "prof_2",
                "email": "grace@example.com",
                "first_name": "Grace",
                "last_name": "Hopper",
                "display_name": "Grace Hopper",
            },
        ]
        if email:
            profiles = [profile for profile in profiles if profile["email"] == email]
        return {"profiles": profiles[:limit], "list_id": list_id, "email": email}

    def read_profile(self, profile_id: str) -> dict[str, Any]:
        if profile_id == "prof_1":
            return {
                "id": "prof_1",
                "email": "ada@example.com",
                "first_name": "Ada",
                "last_name": "Lovelace",
                "display_name": "Ada Lovelace",
            }
        return {
            "id": profile_id,
            "email": "grace@example.com",
            "first_name": "Grace",
            "last_name": "Hopper",
            "display_name": "Grace Hopper",
        }

    def find_profile_by_email(self, email: str) -> dict[str, Any]:
        return {
            "id": "prof_1" if email == "ada@example.com" else "prof_2",
            "email": email,
            "first_name": "Ada" if email == "ada@example.com" else "Grace",
            "last_name": "Lovelace" if email == "ada@example.com" else "Hopper",
            "display_name": "Ada Lovelace" if email == "ada@example.com" else "Grace Hopper",
        }

    def list_campaigns(self, *, limit: int = 10) -> dict[str, Any]:
        campaigns = [
            {"id": "camp_1", "name": "March Newsletter", "status": "draft"},
            {"id": "camp_2", "name": "Welcome Series", "status": "scheduled"},
        ]
        return {"campaigns": campaigns[:limit]}

    def read_campaign(self, campaign_id: str) -> dict[str, Any]:
        return {"id": campaign_id, "name": "March Newsletter", "status": "draft"}


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
    assert payload["tool"] == "aos-klaviyo"
    assert payload["data"]["backend"] == "klaviyo-api"
    assert "account.read" in json.dumps(payload["data"])
    assert "campaign.read" in json.dumps(payload["data"])


def test_account_read_returns_picker_metadata(monkeypatch):
    monkeypatch.setenv("KLAVIYO_API_KEY", "pk_test_abc")
    monkeypatch.setattr(runtime, "create_client", lambda ctx_obj: FakeKlaviyoClient())
    payload = invoke_json(["account", "read"])
    data = payload["data"]
    assert data["account"]["name"] == "Demo Klaviyo Account"
    assert data["scope_preview"]["selection_surface"] == "account"
    assert data["scope_preview"]["command_id"] == "account.read"


def test_health_requires_api_key(monkeypatch):
    monkeypatch.delenv("KLAVIYO_API_KEY", raising=False)
    payload = invoke_json(["health"])
    assert payload["data"]["status"] == "needs_setup"
    assert "KLAVIYO_API_KEY" in json.dumps(payload["data"])


def test_health_ready_with_fake_client(monkeypatch):
    monkeypatch.setenv("KLAVIYO_API_KEY", "pk_test_abc")
    monkeypatch.setenv("KLAVIYO_REVISION", "2025-10-15")
    monkeypatch.setattr(runtime, "create_client", lambda ctx_obj: FakeKlaviyoClient())
    payload = invoke_json(["health"])
    assert payload["data"]["status"] == "ready"
    assert payload["data"]["probe"]["ok"] is True
    assert payload["data"]["probe"]["details"]["account"]["id"] == "acc_123"


def test_config_show_redacts_and_surfaces_scope(monkeypatch):
    monkeypatch.setenv("KLAVIYO_API_KEY", "pk_test_secret")
    monkeypatch.setenv("KLAVIYO_LIST_ID", "list_1")
    monkeypatch.setenv("KLAVIYO_PROFILE_EMAIL", "ada@example.com")
    monkeypatch.setenv("KLAVIYO_CAMPAIGN_ID", "camp_1")
    payload = invoke_json(["config", "show"])
    data = payload["data"]
    assert "pk_test_secret" not in json.dumps(data)
    assert data["scope"]["list_id"] == "list_1"
    assert data["runtime"]["implementation_mode"] == "live_read_with_scaffolded_writes"
    assert data["runtime"]["command_defaults"]["account.read"]["selection_surface"] == "account"
    assert data["runtime"]["picker_scopes"]["list"]["pickers"]["list"]["command"] == "list.list"
    assert data["runtime"]["picker_scopes"]["profile"]["pickers"]["profile"]["command"] == "profile.list"
    assert data["runtime"]["picker_scopes"]["campaign"]["pickers"]["campaign"]["command"] == "campaign.list"


def test_list_list_returns_picker_metadata(monkeypatch):
    monkeypatch.setenv("KLAVIYO_API_KEY", "pk_test_abc")
    monkeypatch.setattr(runtime, "create_client", lambda ctx_obj: FakeKlaviyoClient())
    payload = invoke_json(["list", "list", "--limit", "1"])
    data = payload["data"]
    assert data["list_count"] == 1
    assert data["picker"]["kind"] == "list"
    assert data["picker"]["items"][0]["id"] == "list_1"
    assert data["scope_preview"]["selection_surface"] == "list"
    assert data["scope_preview"]["command_id"] == "list.list"


def test_profile_list_uses_scoped_list(monkeypatch):
    monkeypatch.setenv("KLAVIYO_API_KEY", "pk_test_abc")
    monkeypatch.setenv("KLAVIYO_LIST_ID", "list_1")
    monkeypatch.setenv("KLAVIYO_PROFILE_EMAIL", "ada@example.com")
    monkeypatch.setattr(runtime, "create_client", lambda ctx_obj: FakeKlaviyoClient())
    payload = invoke_json(["profile", "list"])
    data = payload["data"]
    assert data["list_id"] == "list_1"
    assert data["profile_count"] == 1
    assert data["picker"]["kind"] == "profile"
    assert data["scope_preview"]["selection_surface"] == "profile"
    assert data["scope_preview"]["profile_email"] == "ada@example.com"


def test_profile_read_uses_email_fallback(monkeypatch):
    monkeypatch.setenv("KLAVIYO_API_KEY", "pk_test_abc")
    monkeypatch.setenv("KLAVIYO_PROFILE_EMAIL", "ada@example.com")
    monkeypatch.setattr(runtime, "create_client", lambda ctx_obj: FakeKlaviyoClient())
    payload = invoke_json(["profile", "read"])
    data = payload["data"]
    assert data["profile"]["email"] == "ada@example.com"
    assert data["scope_preview"]["selection_surface"] == "profile"
    assert data["scope_preview"]["profile_email"] == "ada@example.com"


def test_campaign_read_uses_scoped_campaign(monkeypatch):
    monkeypatch.setenv("KLAVIYO_API_KEY", "pk_test_abc")
    monkeypatch.setenv("KLAVIYO_CAMPAIGN_ID", "camp_1")
    monkeypatch.setattr(runtime, "create_client", lambda ctx_obj: FakeKlaviyoClient())
    payload = invoke_json(["campaign", "read"])
    assert payload["data"]["campaign"]["id"] == "camp_1"
    assert payload["data"]["scope_preview"]["selection_surface"] == "campaign"
    assert payload["data"]["scope_preview"]["command_id"] == "campaign.read"


def test_scaffold_write_commands_do_not_execute_live_mutations(monkeypatch):
    monkeypatch.setenv("KLAVIYO_API_KEY", "pk_test_abc")
    payload = invoke_json_with_mode("write", ["campaign", "create", "Spring launch"])
    assert payload["data"]["status"] == "scaffold_write_only"
    assert payload["data"]["command"] == "campaign.create"
