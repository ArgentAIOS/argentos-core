from __future__ import annotations

import json
from pathlib import Path
from typing import Any

import pytest
from click.testing import CliRunner

from cli_aos.onepassword.cli import cli
from cli_aos.onepassword.client import OnePasswordCliError
import cli_aos.onepassword.config as config_module
import cli_aos.onepassword.runtime as runtime


AGENT_HARNESS_ROOT = Path(__file__).resolve().parents[1]
CONNECTOR_PATH = AGENT_HARNESS_ROOT.parent / "connector.json"
PERMISSIONS_PATH = AGENT_HARNESS_ROOT / "permissions.json"


class FakeOnePasswordClient:
    def version(self) -> str:
        return "2.30.0"

    def whoami(self) -> dict[str, Any]:
        return {
            "account_uuid": "acct_123",
            "account_name": "Example",
            "url": "example.1password.com",
            "user_email": "agent@example.com",
        }

    def list_accounts(self) -> dict[str, Any]:
        accounts = [
            {
                "account_uuid": "acct_123",
                "account_name": "Example",
                "url": "example.1password.com",
                "user_email": "agent@example.com",
            }
        ]
        return {"accounts": accounts, "count": 1, "raw": accounts}

    def list_vaults(self) -> dict[str, Any]:
        vaults = [{"id": "vault_123", "name": "Private", "type": "USER_CREATED", "raw": {}}]
        return {"vaults": vaults, "count": 1, "raw": vaults}

    def list_items(self, *, vault: str | None = None, limit: int = 50) -> dict[str, Any]:
        items = [
            {
                "id": "item_123",
                "title": "github.com",
                "category": "LOGIN",
                "vault": {"id": "vault_123", "name": vault or "Private"},
                "updated_at": "2026-04-25T00:00:00Z",
                "raw": {},
            }
        ]
        return {"items": items[:limit], "count": min(limit, len(items)), "raw_count": len(items), "raw": items}

    def get_item(self, item: str, *, vault: str | None = None, redact: bool = True) -> dict[str, Any]:
        value = None if redact else "super-secret"
        return {
            "id": "item_123",
            "title": item,
            "category": "LOGIN",
            "vault": {"id": "vault_123", "name": vault or "Private"},
            "fields": [
                {
                    "id": "username",
                    "label": "username",
                    "type": "STRING",
                    "purpose": "USERNAME",
                    "value": "octocat",
                    "value_redacted": False,
                },
                {
                    "id": "password",
                    "label": "password",
                    "type": "CONCEALED",
                    "purpose": "PASSWORD",
                    "value": value,
                    "value_redacted": redact,
                },
            ],
            "urls": [{"href": "https://github.com"}],
            "created_at": "2026-04-24T00:00:00Z",
            "updated_at": "2026-04-25T00:00:00Z",
            "raw": None if redact else {},
            "redacted": redact,
        }


@pytest.fixture(autouse=True)
def no_operator_service_key(monkeypatch):
    monkeypatch.setattr(config_module, "resolve_service_key", lambda variable: None)


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
    assert manifest["scope"]["kind"] == "secret-management"
    assert manifest["scope"]["scaffold_only"] is False


def test_capabilities_exposes_manifest():
    payload = invoke_json(["capabilities"])
    assert payload["tool"] == "aos-1password"
    assert payload["data"]["tool"] == "aos-1password"
    assert payload["data"]["version"] == "0.1.0"
    assert payload["data"]["modes"] == ["readonly", "write", "full", "admin"]
    assert payload["data"]["backend"] == "1password-cli"
    assert "item.get" in json.dumps(payload["data"])
    assert payload["data"]["admin_support"]["item.reveal"] is True


def test_help_exposes_standard_global_flags():
    result = CliRunner().invoke(cli, ["--help"])
    assert result.exit_code == 0
    assert "--json" in result.output
    assert "--mode" in result.output
    assert "--verbose" in result.output
    assert "--version" in result.output


def test_health_ready_with_fake_client(monkeypatch):
    monkeypatch.setattr(runtime, "create_client", lambda ctx_obj: FakeOnePasswordClient())
    payload = invoke_json(["health"])
    assert payload["data"]["status"] == "ready"
    assert payload["data"]["probe"]["ok"] is True
    assert payload["data"]["connector"]["scaffold_only"] is False


def test_config_show_redacts_service_account_token(monkeypatch):
    monkeypatch.setenv("OP_SERVICE_ACCOUNT_TOKEN", "ops_super_secret_token")
    monkeypatch.setattr(runtime, "create_client", lambda ctx_obj: FakeOnePasswordClient())
    payload = invoke_json(["config", "show"])
    data = payload["data"]
    assert "ops_super_secret_token" not in json.dumps(data)
    assert data["auth"]["service_account_token_present"] is True
    assert data["auth"]["service_account_token_source"] == "process.env"
    assert data["runtime"]["implementation_mode"] == "live_read_admin_reveal"


def test_config_show_uses_operator_service_key_without_leaking(monkeypatch):
    monkeypatch.delenv("OP_SERVICE_ACCOUNT_TOKEN", raising=False)
    monkeypatch.setattr(config_module, "resolve_service_key", lambda variable: "operator_managed_token")
    monkeypatch.setattr(runtime, "create_client", lambda ctx_obj: FakeOnePasswordClient())
    payload = invoke_json(["config", "show"])
    data = payload["data"]
    assert "operator_managed_token" not in json.dumps(data)
    assert data["auth"]["service_account_token_present"] is True
    assert data["auth"]["service_account_token_source"] == "service-keys"
    assert data["auth"]["operator_service_keys"] == ["OP_SERVICE_ACCOUNT_TOKEN"]


def test_vault_list_returns_picker(monkeypatch):
    monkeypatch.setattr(runtime, "create_client", lambda ctx_obj: FakeOnePasswordClient())
    payload = invoke_json(["vault", "list"])
    assert payload["data"]["vaults"]["count"] == 1
    assert payload["data"]["picker"]["kind"] == "1password_vault"


def test_item_get_redacts_concealed_fields(monkeypatch):
    monkeypatch.setattr(runtime, "create_client", lambda ctx_obj: FakeOnePasswordClient())
    payload = invoke_json(["item", "get", "github.com", "--vault", "Private"])
    fields = payload["data"]["item"]["fields"]
    password = next(field for field in fields if field["id"] == "password")
    assert password["value"] is None
    assert password["value_redacted"] is True
    assert "super-secret" not in json.dumps(payload)


def test_item_reveal_requires_admin_mode(monkeypatch):
    monkeypatch.setattr(runtime, "create_client", lambda ctx_obj: FakeOnePasswordClient())
    result = CliRunner().invoke(cli, ["--json", "item", "reveal", "github.com", "--field", "password"])
    payload = json.loads(result.output)
    assert result.exit_code == 3
    assert payload["ok"] is False
    assert payload["error"]["code"] == "PERMISSION_DENIED"


def test_item_reveal_returns_single_field_in_admin_mode(monkeypatch):
    monkeypatch.setattr(runtime, "create_client", lambda ctx_obj: FakeOnePasswordClient())
    payload = invoke_json_with_mode("admin", ["item", "reveal", "github.com", "--field", "password"])
    assert payload["data"]["status"] == "live_sensitive_read"
    assert payload["data"]["sensitive"] is True
    assert payload["data"]["field"]["value"] == "super-secret"


def test_backend_unavailable_uses_runbook_exit_code(monkeypatch):
    class MissingCliClient(FakeOnePasswordClient):
        def get_item(self, item: str, *, vault: str | None = None, redact: bool = True) -> dict[str, Any]:
            raise OnePasswordCliError(code="ONEPASSWORD_CLI_NOT_FOUND", message="op missing")

    monkeypatch.setattr(runtime, "create_client", lambda ctx_obj: MissingCliClient())
    result = CliRunner().invoke(cli, ["--json", "item", "get", "github.com"])
    payload = json.loads(result.output)
    assert result.exit_code == 5
    assert payload["ok"] is False
    assert payload["error"]["code"] == "ONEPASSWORD_CLI_NOT_FOUND"


def test_missing_reveal_field_uses_not_found_exit_code(monkeypatch):
    monkeypatch.setattr(runtime, "create_client", lambda ctx_obj: FakeOnePasswordClient())
    result = CliRunner().invoke(cli, ["--json", "--mode", "admin", "item", "reveal", "github.com", "--field", "missing"])
    payload = json.loads(result.output)
    assert result.exit_code == 6
    assert payload["ok"] is False
    assert payload["error"]["code"] == "ONEPASSWORD_FIELD_NOT_FOUND"
