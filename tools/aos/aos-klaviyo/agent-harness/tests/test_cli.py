from __future__ import annotations

import json
from pathlib import Path
from typing import Any

from click.testing import CliRunner
import pytest

from cli_aos.klaviyo.cli import cli
import cli_aos.klaviyo.runtime as runtime
import cli_aos.klaviyo.service_keys as service_keys


AGENT_HARNESS_ROOT = Path(__file__).resolve().parents[1]
CONNECTOR_PATH = AGENT_HARNESS_ROOT.parent / "connector.json"
PERMISSIONS_PATH = AGENT_HARNESS_ROOT / "permissions.json"


@pytest.fixture(autouse=True)
def no_operator_service_key_by_default(monkeypatch):
    monkeypatch.setattr(service_keys, "resolve_service_key", lambda variable: None)


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


def invoke_json(args: list[str], obj: dict[str, Any] | None = None) -> dict[str, Any]:
    result = CliRunner().invoke(cli, ["--json", *args], obj=obj)
    assert result.exit_code == 0, result.output
    return json.loads(result.output)


def test_manifest_and_permissions_are_in_sync():
    manifest = json.loads(CONNECTOR_PATH.read_text())
    permissions = json.loads(PERMISSIONS_PATH.read_text())["permissions"]
    command_ids = [command["id"] for command in manifest["commands"]]
    assert set(command_ids) == set(permissions.keys())
    assert manifest["scope"]["kind"] == "email-marketing"
    assert manifest["scope"]["write_bridge_available"] is False
    assert all(command["required_mode"] == "readonly" for command in manifest["commands"])
    assert not any(command["action_class"] == "write" for command in manifest["commands"])
    assert "KLAVIYO_LIST_ID" in manifest["auth"]["service_keys"]


def test_manifest_field_applicability_matches_commands():
    manifest = json.loads(CONNECTOR_PATH.read_text())
    command_ids = {command["id"] for command in manifest["commands"]}
    for field in manifest["scope"]["fields"]:
        assert set(field["applies_to"]).issubset(command_ids)
    assert set(manifest["scope"]["commandDefaults"]).issubset(command_ids)


def test_capabilities_exposes_manifest():
    payload = invoke_json(["capabilities"])
    assert payload["tool"] == "aos-klaviyo"
    assert payload["data"]["backend"] == "klaviyo-api"
    assert "account.read" in json.dumps(payload["data"])
    assert "campaign.read" in json.dumps(payload["data"])
    assert payload["data"]["write_support"] == {}


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
    assert data["runtime"]["implementation_mode"] == "live_read_only"
    assert data["write_support"] == {}
    assert "KLAVIYO_LIST_ID" in data["auth"]["operator_service_keys"]
    assert data["runtime"]["command_defaults"]["account.read"]["selection_surface"] == "account"
    assert data["runtime"]["picker_scopes"]["list"]["pickers"]["list"]["command"] == "list.list"
    assert data["runtime"]["picker_scopes"]["profile"]["pickers"]["profile"]["command"] == "profile.list"
    assert data["runtime"]["picker_scopes"]["campaign"]["pickers"]["campaign"]["command"] == "campaign.list"


def test_operator_service_keys_take_precedence_over_environment(monkeypatch):
    service_key_values = {
        "KLAVIYO_API_KEY": "operator-api-key",
        "KLAVIYO_REVISION": "2026-01-15",
        "KLAVIYO_LIST_ID": "operator-list",
        "KLAVIYO_PROFILE_ID": "operator-profile",
        "KLAVIYO_PROFILE_EMAIL": "operator@example.com",
        "KLAVIYO_CAMPAIGN_ID": "operator-campaign",
    }
    for variable in service_key_values:
        monkeypatch.setenv(variable, f"env_{variable.lower()}")
    monkeypatch.setattr(service_keys, "resolve_service_key", lambda variable: service_key_values.get(variable))

    payload = invoke_json(["config", "show"])
    data = payload["data"]

    assert data["scope"]["list_id"] == "operator-list"
    assert data["scope"]["profile_id"] == "operator-profile"
    assert data["scope"]["profile_email"] == "operator@example.com"
    assert data["scope"]["campaign_id"] == "operator-campaign"
    assert data["auth"]["revision"] == "2026-01-15"
    assert data["auth"]["sources"]["KLAVIYO_LIST_ID"] == "service-keys"
    assert "env_klaviyo_api_key" not in json.dumps(data)
    assert "operator-api-key" not in json.dumps(data)


def test_operator_context_service_keys_take_precedence_over_environment(monkeypatch):
    monkeypatch.setenv("KLAVIYO_API_KEY", "env-api-key")
    monkeypatch.setenv("KLAVIYO_LIST_ID", "env-list")
    monkeypatch.setenv("KLAVIYO_PROFILE_ID", "env-profile")
    monkeypatch.setenv("KLAVIYO_PROFILE_EMAIL", "env@example.com")
    monkeypatch.setenv("KLAVIYO_CAMPAIGN_ID", "env-campaign")

    payload = invoke_json(
        [
            "config",
            "show",
        ],
        obj={
            "service_keys": {
                "KLAVIYO_API_KEY": "operator-context-api-key",
                "KLAVIYO_LIST_ID": "operator-context-list",
                "KLAVIYO_PROFILE_ID": "operator-context-profile",
                "KLAVIYO_PROFILE_EMAIL": "operator-context@example.com",
                "KLAVIYO_CAMPAIGN_ID": "operator-context-campaign",
            }
        },
    )
    data = payload["data"]

    assert data["scope"]["list_id"] == "operator-context-list"
    assert data["scope"]["profile_id"] == "operator-context-profile"
    assert data["scope"]["profile_email"] == "operator-context@example.com"
    assert data["scope"]["campaign_id"] == "operator-context-campaign"
    assert data["auth"]["api_key_source"] == "operator:service_keys"
    assert data["auth"]["sources"]["KLAVIYO_API_KEY"] == "operator:service_keys"
    assert data["auth"]["sources"]["KLAVIYO_LIST_ID"] == "operator:service_keys"
    assert data["runtime"]["picker_scopes"]["list"]["selected"]["list_id"] == "operator-context-list"


def test_config_read_support_matches_manifest():
    payload = invoke_json(["config", "show"])
    manifest = json.loads(CONNECTOR_PATH.read_text())
    command_ids = {command["id"] for command in manifest["commands"] if command["required_mode"] == "readonly"}
    assert set(payload["data"]["read_support"]) == command_ids


def test_doctor_supported_read_commands_match_manifest(monkeypatch):
    payload = invoke_json(["doctor"])
    manifest = json.loads(CONNECTOR_PATH.read_text())
    command_ids = {command["id"] for command in manifest["commands"] if command["required_mode"] == "readonly"}
    assert set(payload["data"]["supported_read_commands"]) == command_ids


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
