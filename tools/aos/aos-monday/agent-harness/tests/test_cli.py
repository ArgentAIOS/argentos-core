from __future__ import annotations

import json
from pathlib import Path
import tempfile

from click.testing import CliRunner

from cli_aos.monday.client import MondayApiError
from cli_aos.monday.cli import cli
from cli_aos.monday.config import resolve_runtime_values
import cli_aos.monday.runtime as runtime


AGENT_HARNESS_ROOT = Path(__file__).resolve().parents[1]
CONNECTOR_PATH = AGENT_HARNESS_ROOT.parent / "connector.json"
PERMISSIONS_PATH = AGENT_HARNESS_ROOT / "permissions.json"


class FakeMondayClient:
    def me(self):
        return {"id": "person_123", "name": "Alex", "email": "alex@example.com", "title": "Ops"}

    def list_workspaces(self):
        return [
            {"id": "workspace_1", "name": "Ops", "is_default_workspace": True},
            {"id": "workspace_2", "name": "Planning", "is_default_workspace": False},
        ]

    def list_boards(self):
        return [
            {"id": "board_1", "name": "Ops Board", "items_count": 2},
            {"id": "board_2", "name": "Planning Board", "items_count": 1},
        ]

    def read_board(self, board_id: str, *, limit: int):
        return {
            "id": board_id,
            "name": "Ops Board",
            "items_page": {
                "cursor": None,
                "items": [
                    {"id": "item_1", "name": "Launch prep"},
                    {"id": "item_2", "name": "Weekly check-in"},
                ][:limit],
            },
            "updates": [
                {"id": "update_1", "body": "Board update one", "created_at": "2026-03-18T12:00:00Z"},
                {"id": "update_2", "body": "Board update two", "created_at": "2026-03-18T13:00:00Z"},
            ][:limit],
        }

    def read_item(self, item_id: str):
        return {
            "id": item_id,
            "name": "Launch prep",
            "board": {"id": "board_1", "name": "Ops Board"},
        }

    def list_updates(self, *, limit: int):
        return [
            {
                "id": "update_1",
                "body": "Kickoff posted",
                "created_at": "2026-03-18T12:00:00Z",
                "creator": {"id": "person_123", "name": "Alex"},
            },
            {
                "id": "update_2",
                "body": "Board note",
                "created_at": "2026-03-18T13:00:00Z",
                "creator": {"id": "person_123", "name": "Alex"},
            },
        ][:limit]

    def create_item(self, *, board_id: str, item_name: str, group_id: str | None = None, column_values: str | None = None):
        return {
            "id": "item_3",
            "name": item_name,
            "board": {"id": board_id, "name": "Ops Board"},
            "group_id": group_id,
            "column_values": column_values,
        }

    def change_simple_column_value(self, *, board_id: str, item_id: str, column_id: str, value: str):
        return {
            "id": item_id,
            "name": "Launch prep",
            "board_id": board_id,
            "column_id": column_id,
            "value": value,
        }

    def change_multiple_column_values(self, *, board_id: str, item_id: str, column_values: str):
        return {
            "id": item_id,
            "name": "Launch prep",
            "board_id": board_id,
            "column_values": column_values,
        }

    def create_update(self, *, item_id: str, body: str):
        return {
            "id": "update_3",
            "body": body,
            "created_at": "2026-03-18T14:00:00Z",
            "item_id": item_id,
        }


class FailingMondayClient:
    def me(self):
        return {"id": "person_123", "name": "Alex"}

    def list_boards(self):
        raise MondayApiError(code="MONDAY_API_ERROR", message="Monday unavailable", status_code=503)


def _disable_repo_service_keys(monkeypatch):
    path = Path(tempfile.mkdtemp(prefix="monday-missing-service-keys-")) / "service-keys.json"
    monkeypatch.setattr("cli_aos.monday.service_keys.SERVICE_KEYS_PATH", path)


def _write_service_keys(values: dict[str, str]) -> Path:
    path = Path(tempfile.mkdtemp(prefix="monday-service-keys-")) / "service-keys.json"
    path.write_text(
        json.dumps(
            {
                "version": 1,
                "keys": [
                    {"id": f"sk-{key}", "name": key, "variable": key, "value": value, "enabled": True}
                    for key, value in values.items()
                ],
            }
        )
    )
    return path


def _set_required_env(monkeypatch):
    _disable_repo_service_keys(monkeypatch)
    monkeypatch.setenv("MONDAY_TOKEN", "secret_token")
    monkeypatch.setenv("MONDAY_API_VERSION", "2026-01")
    monkeypatch.setenv("MONDAY_API_URL", "https://api.monday.example.test/v2")


def _invoke(args: list[str], monkeypatch):
    monkeypatch.setattr(runtime, "create_client", lambda ctx_obj: FakeMondayClient())
    return CliRunner().invoke(cli, args)


def test_manifest_and_permissions_are_in_sync():
    manifest = json.loads(CONNECTOR_PATH.read_text())
    permissions = json.loads(PERMISSIONS_PATH.read_text())["permissions"]
    manifest_command_ids = [command["id"] for command in manifest["commands"]]

    assert set(manifest_command_ids) == set(permissions.keys())
    assert "capabilities" in manifest_command_ids
    assert "update.create" in manifest_command_ids
    assert manifest["scope"]["commandDefaults"]["item.update"]["args"] == [
        "MONDAY_ITEM_ID",
        "MONDAY_BOARD_ID",
        "MONDAY_COLUMN_ID",
    ]


def test_capabilities_json_matches_manifest():
    result = CliRunner().invoke(cli, ["--json", "capabilities"])
    assert result.exit_code == 0

    envelope = json.loads(result.output)
    payload = envelope["data"]
    manifest = json.loads(CONNECTOR_PATH.read_text())

    assert envelope["tool"] == "aos-monday"
    assert envelope["command"] == "capabilities"
    assert payload["tool"] == manifest["tool"]
    assert payload["backend"] == manifest["backend"]
    assert payload["manifest_schema_version"] == manifest["manifest_schema_version"]
    assert payload["connector"] == manifest["connector"]
    assert payload["auth"] == manifest["auth"]
    assert payload["scope"] == manifest["scope"]
    assert payload["commands"] == manifest["commands"]
    assert payload["read_support"]["board.list"] is True
    assert payload["read_support"]["config.show"] is True
    assert payload["write_support"]["live_writes_enabled"] is True
    assert payload["write_support"]["live_write_smoke_tested"] is False
    assert payload["write_support"]["write_commands"] == ["item.create", "item.update", "update.create"]


def test_health_reports_needs_setup_without_env(monkeypatch):
    _disable_repo_service_keys(monkeypatch)
    monkeypatch.delenv("MONDAY_TOKEN", raising=False)
    monkeypatch.delenv("MONDAY_API_VERSION", raising=False)
    monkeypatch.delenv("MONDAY_API_URL", raising=False)
    monkeypatch.delenv("MONDAY_WORKSPACE_ID", raising=False)
    monkeypatch.delenv("MONDAY_BOARD_ID", raising=False)

    result = CliRunner().invoke(cli, ["--json", "health"])
    assert result.exit_code == 0

    payload = json.loads(result.output)
    assert payload["data"]["status"] == "needs_setup"
    assert payload["data"]["live_backend_available"] is False
    assert "MONDAY_TOKEN" in payload["data"]["checks"][0]["details"]["missing_keys"]
    assert payload["data"]["auth"]["api_version_source"] == "default"


def test_health_reports_ready_when_probe_succeeds(monkeypatch):
    _set_required_env(monkeypatch)
    monkeypatch.setattr(runtime, "create_client", lambda ctx_obj: FakeMondayClient())

    result = CliRunner().invoke(cli, ["--json", "health"])
    assert result.exit_code == 0

    payload = json.loads(result.output)
    assert payload["data"]["status"] == "ready"
    assert payload["data"]["runtime_ready"] is True
    assert payload["data"]["live_backend_available"] is True
    assert payload["data"]["connector"]["live_read_available"] is True
    assert payload["data"]["connector"]["write_bridge_available"] is True
    assert payload["data"]["connector"]["write_paths_scaffolded"] is False


def test_doctor_reports_ready_when_setup_is_complete(monkeypatch):
    _set_required_env(monkeypatch)
    monkeypatch.setattr(runtime, "create_client", lambda ctx_obj: FakeMondayClient())

    result = CliRunner().invoke(cli, ["--json", "doctor"])
    assert result.exit_code == 0

    payload = json.loads(result.output)
    assert payload["data"]["status"] == "ready"
    assert payload["data"]["runtime_ready"] is True
    assert payload["data"]["live_backend_available"] is True
    assert payload["data"]["runtime"]["tenant_smoke_tested"] is False
    assert payload["data"]["runtime"]["live_write_smoke_tested"] is False
    assert payload["data"]["live_write_smoke_tested"] is False
    assert payload["data"]["write_bridge_available"] is True
    assert payload["data"]["write_bridge_runtime_ready"] is True
    assert "secret_token" not in result.output


def test_config_show_redacts_token_values(monkeypatch):
    _set_required_env(monkeypatch)
    monkeypatch.setenv("MONDAY_WORKSPACE_ID", "workspace-123")
    monkeypatch.setenv("MONDAY_BOARD_ID", "board-123")
    monkeypatch.setenv("MONDAY_ITEM_ID", "item-123")
    monkeypatch.setenv("MONDAY_COLUMN_ID", "status")
    monkeypatch.setattr(runtime, "create_client", lambda ctx_obj: FakeMondayClient())

    result = CliRunner().invoke(cli, ["--json", "config", "show"])
    assert result.exit_code == 0
    assert "secret_token" not in result.output
    assert '"token_present": true' in result.output
    assert '"write_paths_scaffolded": false' in result.output
    assert '"item_id": "item-123"' in result.output
    assert '"column_id": "status"' in result.output


def test_operator_context_precedes_env(monkeypatch):
    _set_required_env(monkeypatch)
    values = resolve_runtime_values(
        {
            "service_keys": {
                "aos-monday": {
                    "MONDAY_TOKEN": "operator-token",
                    "MONDAY_API_URL": "https://operator.example.test/v2",
                    "MONDAY_BOARD_ID": "board_operator",
                }
            }
        }
    )
    assert values["token"] == "operator-token"
    assert values["api_url"] == "https://operator.example.test/v2"
    assert values["board_id"] == "board_operator"
    assert values["details"]["MONDAY_TOKEN"]["source"] == "operator:service_keys:tool"


def test_repo_service_key_precedes_env(monkeypatch):
    monkeypatch.setenv("MONDAY_TOKEN", "env-token")
    monkeypatch.setattr("cli_aos.monday.service_keys.SERVICE_KEYS_PATH", _write_service_keys({"MONDAY_TOKEN": "repo-token"}))
    values = resolve_runtime_values({})
    assert values["token"] == "repo-token"
    assert values["details"]["MONDAY_TOKEN"]["source"] == "repo-service-key"


def test_encrypted_repo_service_key_falls_back_to_env(monkeypatch):
    monkeypatch.setenv("MONDAY_TOKEN", "env-token")
    monkeypatch.setattr("cli_aos.monday.service_keys.SERVICE_KEYS_PATH", _write_service_keys({"MONDAY_TOKEN": "enc:v1:abc:def:ghi"}))
    values = resolve_runtime_values({})
    assert values["token"] == ""
    assert values["token_present"] is True
    assert values["token_usable"] is False
    assert values["details"]["MONDAY_TOKEN"]["source"] == "repo-service-key-encrypted"


def test_scoped_repo_service_key_does_not_bypass_to_env(monkeypatch):
    monkeypatch.setenv("MONDAY_TOKEN", "env-token")
    path = Path(tempfile.mkdtemp(prefix="monday-scoped-service-keys-")) / "service-keys.json"
    path.write_text(
        json.dumps(
            {
                "version": 1,
                "keys": [
                    {
                        "id": "sk-MONDAY_TOKEN",
                        "name": "MONDAY_TOKEN",
                        "variable": "MONDAY_TOKEN",
                        "value": "repo-token",
                        "enabled": True,
                        "allowedRoles": ["operator"],
                    }
                ],
            }
        )
    )
    monkeypatch.setattr("cli_aos.monday.service_keys.SERVICE_KEYS_PATH", path)
    values = resolve_runtime_values({})
    assert values["token"] == ""
    assert values["token_present"] is True
    assert values["token_usable"] is False
    assert values["details"]["MONDAY_TOKEN"]["source"] == "repo-service-key-scoped"


def test_account_read_returns_live_payload(monkeypatch):
    _set_required_env(monkeypatch)
    monkeypatch.setattr(runtime, "create_client", lambda ctx_obj: FakeMondayClient())

    result = _invoke(["--json", "account", "read"], monkeypatch)
    assert result.exit_code == 0
    payload = json.loads(result.output)["data"]
    assert payload["status"] == "ok"
    assert payload["command"] == "account.read"
    assert payload["account"]["name"] == "Alex"
    assert payload["scope"]["kind"] == "account"


def test_workspace_list_returns_live_payload(monkeypatch):
    _set_required_env(monkeypatch)
    monkeypatch.setattr(runtime, "create_client", lambda ctx_obj: FakeMondayClient())

    result = _invoke(["--json", "workspace", "list", "--limit", "2"], monkeypatch)
    assert result.exit_code == 0
    payload = json.loads(result.output)["data"]
    assert payload["status"] == "ok"
    assert payload["command"] == "workspace.list"
    assert payload["scope"]["kind"] == "workspace"
    assert payload["scope_preview"] == "Workspaces: Ops, Planning"
    assert payload["items"][0]["name"] == "Ops"
    assert payload["result_types"] == {"unknown": 2}


def test_board_read_returns_live_payload(monkeypatch):
    _set_required_env(monkeypatch)
    monkeypatch.setattr(runtime, "create_client", lambda ctx_obj: FakeMondayClient())

    result = _invoke(["--json", "board", "read", "board_1", "--limit", "2"], monkeypatch)
    assert result.exit_code == 0
    payload = json.loads(result.output)["data"]
    assert payload["status"] == "ok"
    assert payload["command"] == "board.read"
    assert payload["board"]["id"] == "board_1"
    assert payload["scope"]["kind"] == "board"
    assert payload["items"][0]["name"] == "Launch prep"
    assert payload["updates"][0]["body"] == "Board update one"


def test_item_read_returns_live_payload(monkeypatch):
    _set_required_env(monkeypatch)
    monkeypatch.setattr(runtime, "create_client", lambda ctx_obj: FakeMondayClient())

    result = _invoke(["--json", "item", "read", "item_1"], monkeypatch)
    assert result.exit_code == 0
    payload = json.loads(result.output)["data"]
    assert payload["status"] == "ok"
    assert payload["command"] == "item.read"
    assert payload["item"]["id"] == "item_1"
    assert payload["scope"]["kind"] == "item"


def test_update_list_returns_live_payload(monkeypatch):
    _set_required_env(monkeypatch)
    monkeypatch.setattr(runtime, "create_client", lambda ctx_obj: FakeMondayClient())

    result = _invoke(["--json", "update", "list", "--limit", "2"], monkeypatch)
    assert result.exit_code == 0
    payload = json.loads(result.output)["data"]
    assert payload["status"] == "ok"
    assert payload["command"] == "update.list"
    assert payload["scope"]["kind"] == "update"
    assert payload["items"][0]["body"] == "Kickoff posted"


def test_item_create_uses_live_write(monkeypatch):
    _set_required_env(monkeypatch)
    monkeypatch.setattr(runtime, "create_client", lambda ctx_obj: FakeMondayClient())

    result = CliRunner().invoke(
        cli,
        [
            "--json",
            "--mode",
            "write",
            "item",
            "create",
            "--board-id",
            "board_1",
            "--name",
            "Draft item",
            "--column-values",
            '{"status":"Working on it"}',
        ],
    )
    assert result.exit_code == 0
    payload = json.loads(result.output)["data"]
    assert payload["status"] == "live_write"
    assert payload["command"] == "item.create"
    assert payload["item"]["id"] == "item_3"
    assert payload["inputs"]["column_values"] == '{"status":"Working on it"}'


def test_item_update_uses_live_simple_column_write(monkeypatch):
    _set_required_env(monkeypatch)
    monkeypatch.setattr(runtime, "create_client", lambda ctx_obj: FakeMondayClient())

    result = CliRunner().invoke(
        cli,
        [
            "--json",
            "--mode",
            "write",
            "item",
            "update",
            "item_1",
            "--board-id",
            "board_1",
            "--column-id",
            "status",
            "--column-value",
            "Done",
        ],
    )
    assert result.exit_code == 0
    payload = json.loads(result.output)["data"]
    assert payload["status"] == "live_write"
    assert payload["operation"] == "change_simple_column_value"
    assert payload["item"]["column_id"] == "status"
    assert payload["item"]["value"] == "Done"


def test_update_create_uses_live_write(monkeypatch):
    _set_required_env(monkeypatch)
    monkeypatch.setattr(runtime, "create_client", lambda ctx_obj: FakeMondayClient())

    result = CliRunner().invoke(cli, ["--json", "--mode", "write", "update", "create", "item_1", "--body", "Hello"])
    assert result.exit_code == 0
    payload = json.loads(result.output)["data"]
    assert payload["status"] == "live_write"
    assert payload["command"] == "update.create"
    assert payload["update"]["id"] == "update_3"


def test_write_commands_use_operator_scope_defaults(monkeypatch):
    _set_required_env(monkeypatch)
    monkeypatch.setenv("MONDAY_BOARD_ID", "board_1")
    monkeypatch.setenv("MONDAY_ITEM_ID", "item_1")
    monkeypatch.setenv("MONDAY_COLUMN_ID", "status")
    monkeypatch.setattr(runtime, "create_client", lambda ctx_obj: FakeMondayClient())

    create_result = CliRunner().invoke(cli, ["--json", "--mode", "write", "item", "create", "--name", "Draft item"])
    update_result = CliRunner().invoke(cli, ["--json", "--mode", "write", "item", "update", "--column-value", "Done"])
    note_result = CliRunner().invoke(cli, ["--json", "--mode", "write", "update", "create", "--body", "Hello"])
    assert create_result.exit_code == 0
    assert update_result.exit_code == 0
    assert note_result.exit_code == 0
    assert json.loads(create_result.output)["data"]["inputs"]["board_id"] == "board_1"
    assert json.loads(update_result.output)["data"]["inputs"]["item_id"] == "item_1"
    assert json.loads(update_result.output)["data"]["inputs"]["column_id"] == "status"
    assert json.loads(note_result.output)["data"]["inputs"]["item_id"] == "item_1"


def test_api_errors_are_json_failures(monkeypatch):
    _set_required_env(monkeypatch)
    monkeypatch.setattr(runtime, "create_client", lambda ctx_obj: FailingMondayClient())
    result = CliRunner().invoke(cli, ["--json", "board", "list"])
    assert result.exit_code == 4
    payload = json.loads(result.output)
    assert payload["ok"] is False
    assert payload["error"]["code"] == "MONDAY_API_ERROR"


def test_permission_gate_blocks_write_for_readonly():
    result = CliRunner().invoke(cli, ["--json", "--mode", "readonly", "update", "create", "item_1", "--body", "Hello"])
    assert result.exit_code == 3
    assert "PERMISSION_DENIED" in result.output
