from __future__ import annotations

import json
from pathlib import Path
from typing import Any

from click.testing import CliRunner

from cli_aos.trello.cli import cli
import cli_aos.trello.runtime as runtime


AGENT_HARNESS_ROOT = Path(__file__).resolve().parents[1]
CONNECTOR_PATH = AGENT_HARNESS_ROOT.parent / "connector.json"
PERMISSIONS_PATH = AGENT_HARNESS_ROOT / "permissions.json"


class FakeTrelloClient:
    def current_member(self) -> dict[str, Any]:
        return {
            "id": "mem_current",
            "full_name": "Ada Lovelace",
            "username": "ada",
            "initials": "AL",
            "avatar_url": "https://example.com/avatar.png",
            "board_ids": ["board_1"],
        }

    def read_member(self, member_id: str) -> dict[str, Any]:
        return {
            "id": member_id,
            "full_name": "Grace Hopper",
            "username": "grace",
            "initials": "GH",
            "avatar_url": "https://example.com/grace.png",
            "board_ids": ["board_1"],
        }

    def list_boards(self, *, limit: int = 10) -> list[dict[str, Any]]:
        boards = [
            {
                "id": "board_1",
                "name": "Operations",
                "closed": False,
                "url": "https://trello.com/b/board_1",
                "short_url": "https://trello.com/b/board_1",
            },
            {
                "id": "board_2",
                "name": "Roadmap",
                "closed": False,
                "url": "https://trello.com/b/board_2",
                "short_url": "https://trello.com/b/board_2",
            },
        ]
        return boards[:limit]

    def read_board(self, board_id: str) -> dict[str, Any]:
        return {
            "id": board_id,
            "name": "Operations",
            "closed": False,
            "url": f"https://trello.com/b/{board_id}",
            "short_url": f"https://trello.com/b/{board_id}",
        }

    def list_board_members(self, board_id: str, *, limit: int = 50) -> list[dict[str, Any]]:
        members = [
            {
                "id": "mem_current",
                "full_name": "Ada Lovelace",
                "username": "ada",
                "initials": "AL",
                "avatar_url": "https://example.com/avatar.png",
            },
            {
                "id": "mem_2",
                "full_name": "Grace Hopper",
                "username": "grace",
                "initials": "GH",
                "avatar_url": "https://example.com/grace.png",
            },
        ]
        return members[:limit]

    def list_lists(self, board_id: str) -> list[dict[str, Any]]:
        return [
            {
                "id": "list_1",
                "name": "Backlog",
                "closed": False,
                "board_id": board_id,
                "pos": 1,
                "url": f"https://trello.com/c/{board_id}/1",
            },
            {
                "id": "list_2",
                "name": "In Progress",
                "closed": False,
                "board_id": board_id,
                "pos": 2,
                "url": f"https://trello.com/c/{board_id}/2",
            },
        ]

    def read_list(self, list_id: str) -> dict[str, Any]:
        return {
            "id": list_id,
            "name": "Backlog",
            "closed": False,
            "board_id": "board_1",
            "pos": 1,
            "url": f"https://trello.com/c/{list_id}",
        }

    def list_cards(self, list_id: str) -> list[dict[str, Any]]:
        return [
            {
                "id": "card_1",
                "name": "Draft launch plan",
                "desc": "Draft the launch plan",
                "closed": False,
                "due": None,
                "due_complete": False,
                "board_id": "board_1",
                "list_id": list_id,
                "member_ids": ["mem_current"],
                "label_ids": ["label_1"],
                "url": f"https://trello.com/c/{list_id}/1",
                "short_url": f"https://trello.com/c/{list_id}/1",
            },
            {
                "id": "card_2",
                "name": "Review copy",
                "desc": "",
                "closed": False,
                "due": None,
                "due_complete": False,
                "board_id": "board_1",
                "list_id": list_id,
                "member_ids": [],
                "label_ids": [],
                "url": f"https://trello.com/c/{list_id}/2",
                "short_url": f"https://trello.com/c/{list_id}/2",
            },
        ]

    def read_card(self, card_id: str) -> dict[str, Any]:
        return {
            "id": card_id,
            "name": "Draft launch plan",
            "desc": "Draft the launch plan",
            "closed": False,
            "due": None,
            "due_complete": False,
            "board_id": "board_1",
            "list_id": "list_1",
            "member_ids": ["mem_current"],
            "label_ids": ["label_1"],
            "url": f"https://trello.com/c/{card_id}",
            "short_url": f"https://trello.com/c/{card_id}",
        }


def _invoke(args: list[str], monkeypatch) -> Any:
    monkeypatch.setattr(runtime, "create_client", lambda ctx_obj: FakeTrelloClient())
    return CliRunner().invoke(cli, args)


def _invoke_json(args: list[str], monkeypatch) -> dict[str, Any]:
    result = _invoke(["--json", *args], monkeypatch)
    assert result.exit_code == 0, result.output
    return json.loads(result.output)


def test_manifest_and_permissions_are_in_sync():
    manifest = json.loads(CONNECTOR_PATH.read_text())
    permissions = json.loads(PERMISSIONS_PATH.read_text())["permissions"]
    manifest_command_ids = [command["id"] for command in manifest["commands"]]

    assert set(manifest_command_ids) == set(permissions.keys())
    assert manifest["scope"]["kind"] == "project-tracking"
    assert "card.create_draft" in manifest_command_ids


def test_capabilities_json_matches_manifest():
    result = CliRunner().invoke(cli, ["--json", "capabilities"])
    assert result.exit_code == 0, result.output

    envelope = json.loads(result.output)
    payload = envelope["data"]
    manifest = json.loads(CONNECTOR_PATH.read_text())

    assert envelope["tool"] == "aos-trello"
    assert envelope["command"] == "capabilities"
    assert payload["tool"] == manifest["tool"]
    assert payload["backend"] == manifest["backend"]
    assert payload["manifest_schema_version"] == manifest["manifest_schema_version"]
    assert payload["connector"] == manifest["connector"]
    assert payload["auth"] == manifest["auth"]
    assert payload["commands"] == manifest["commands"]


def test_health_reports_needs_setup_without_env(monkeypatch):
    monkeypatch.delenv("TRELLO_API_KEY", raising=False)
    monkeypatch.delenv("TRELLO_TOKEN", raising=False)

    result = CliRunner().invoke(cli, ["--json", "health"])
    assert result.exit_code == 0, result.output

    payload = json.loads(result.output)
    assert payload["data"]["status"] == "needs_setup"
    assert payload["data"]["live_backend_available"] is False
    assert "TRELLO_API_KEY" in json.dumps(payload["data"]["checks"])
    assert "TRELLO_TOKEN" in json.dumps(payload["data"]["checks"])


def test_health_reports_ready_when_probe_succeeds(monkeypatch):
    monkeypatch.setenv("TRELLO_API_KEY", "api_key_secret")
    monkeypatch.setenv("TRELLO_TOKEN", "token_secret")
    monkeypatch.setenv("TRELLO_BOARD_ID", "board_1")
    monkeypatch.setenv("TRELLO_LIST_ID", "list_1")
    monkeypatch.setenv("TRELLO_CARD_ID", "card_1")
    monkeypatch.setenv("TRELLO_MEMBER_ID", "mem_2")
    monkeypatch.setattr(runtime, "create_client", lambda ctx_obj: FakeTrelloClient())

    result = CliRunner().invoke(cli, ["--json", "health"])
    assert result.exit_code == 0, result.output

    payload = json.loads(result.output)
    assert payload["data"]["status"] == "ready"
    assert payload["data"]["runtime_ready"] is True
    assert payload["data"]["live_backend_available"] is True
    assert payload["data"]["probe"]["details"]["account"]["id"] == "mem_current"


def test_config_show_redacts_scope_values(monkeypatch):
    monkeypatch.setenv("TRELLO_API_KEY", "api_key_secret")
    monkeypatch.setenv("TRELLO_TOKEN", "token_secret")
    monkeypatch.setenv("TRELLO_BOARD_ID", "board_1")
    monkeypatch.setenv("TRELLO_LIST_ID", "list_1")
    monkeypatch.setenv("TRELLO_CARD_ID", "card_1")
    monkeypatch.setenv("TRELLO_MEMBER_ID", "mem_2")
    monkeypatch.setattr(runtime, "create_client", lambda ctx_obj: FakeTrelloClient())

    result = CliRunner().invoke(cli, ["--json", "config", "show"])
    assert result.exit_code == 0, result.output
    assert "api_key_secret" not in result.output
    assert "token_secret" not in result.output
    assert '"runtime_mode"' not in result.output
    payload = json.loads(result.output)
    data = payload["data"]
    assert data["runtime"]["auth_ready"] is True
    assert data["runtime"]["command_defaults"]["board.read"]["args"][0] == "board_1"
    assert data["runtime"]["command_defaults"]["list.read"]["args"][0] == "list_1"
    assert data["runtime"]["command_defaults"]["card.read"]["args"][0] == "card_1"


def test_account_read_returns_live_payload(monkeypatch):
    monkeypatch.setenv("TRELLO_API_KEY", "api_key_secret")
    monkeypatch.setenv("TRELLO_TOKEN", "token_secret")
    monkeypatch.setattr(runtime, "create_client", lambda ctx_obj: FakeTrelloClient())

    payload = _invoke_json(["account", "read"], monkeypatch)
    data = payload["data"]
    assert data["account"]["id"] == "mem_current"
    assert data["scope_preview"]["selection_surface"] == "account"
    assert data["picker"]["kind"] == "account"


def test_member_list_returns_live_payload(monkeypatch):
    monkeypatch.setenv("TRELLO_API_KEY", "api_key_secret")
    monkeypatch.setenv("TRELLO_TOKEN", "token_secret")
    monkeypatch.setattr(runtime, "create_client", lambda ctx_obj: FakeTrelloClient())

    payload = _invoke_json(["member", "list", "--board-id", "board_1", "--limit", "2"], monkeypatch)
    data = payload["data"]
    assert data["member_count"] == 2
    assert data["board_id"] == "board_1"
    assert data["picker"]["kind"] == "member"
    assert data["picker"]["items"][0]["id"] == "mem_current"
    assert data["scope_preview"]["selection_surface"] == "member"


def test_board_list_returns_live_payload(monkeypatch):
    monkeypatch.setenv("TRELLO_API_KEY", "api_key_secret")
    monkeypatch.setenv("TRELLO_TOKEN", "token_secret")
    monkeypatch.setattr(runtime, "create_client", lambda ctx_obj: FakeTrelloClient())

    payload = _invoke_json(["board", "list", "--limit", "2"], monkeypatch)
    data = payload["data"]
    assert data["board_count"] == 2
    assert data["picker"]["kind"] == "board"
    assert data["picker"]["items"][0]["id"] == "board_1"
    assert data["scope_preview"]["selection_surface"] == "board"


def test_list_read_returns_live_payload(monkeypatch):
    monkeypatch.setenv("TRELLO_API_KEY", "api_key_secret")
    monkeypatch.setenv("TRELLO_TOKEN", "token_secret")
    monkeypatch.setattr(runtime, "create_client", lambda ctx_obj: FakeTrelloClient())

    payload = _invoke_json(["list", "read", "--list-id", "list_1"], monkeypatch)
    data = payload["data"]
    assert data["list_id"] == "list_1"
    assert data["list"]["name"] == "Backlog"
    assert data["picker"]["kind"] == "list"
    assert data["scope_preview"]["selection_surface"] == "list"


def test_card_read_returns_live_payload(monkeypatch):
    monkeypatch.setenv("TRELLO_API_KEY", "api_key_secret")
    monkeypatch.setenv("TRELLO_TOKEN", "token_secret")
    monkeypatch.setattr(runtime, "create_client", lambda ctx_obj: FakeTrelloClient())

    payload = _invoke_json(["card", "read", "--card-id", "card_1"], monkeypatch)
    data = payload["data"]
    assert data["card_id"] == "card_1"
    assert data["card"]["name"] == "Draft launch plan"
    assert data["picker"]["kind"] == "card"
    assert data["scope_preview"]["selection_surface"] == "card"


def test_card_create_draft_stays_scaffolded(monkeypatch):
    monkeypatch.setenv("TRELLO_API_KEY", "api_key_secret")
    monkeypatch.setenv("TRELLO_TOKEN", "token_secret")
    monkeypatch.setattr(runtime, "create_client", lambda ctx_obj: FakeTrelloClient())

    result = CliRunner().invoke(
        cli,
        ["--json", "--mode", "write", "card", "create_draft", "--list-id", "list_1", "--name", "New card"],
    )
    assert result.exit_code == 0, result.output
    payload = json.loads(result.output)
    data = payload["data"]
    assert data["status"] == "scaffold"
    assert data["executed"] is False
    assert data["command_id"] == "card.create_draft"
    assert data["inputs"]["list_id"] == "list_1"
    assert data["inputs"]["name"] == "New card"
    assert data["live_write_available"] is False


def test_write_command_is_blocked_in_readonly_mode(monkeypatch):
    monkeypatch.setenv("TRELLO_API_KEY", "api_key_secret")
    monkeypatch.setenv("TRELLO_TOKEN", "token_secret")
    monkeypatch.setattr(runtime, "create_client", lambda ctx_obj: FakeTrelloClient())

    result = CliRunner().invoke(
        cli,
        ["--json", "--mode", "readonly", "card", "create_draft", "--list-id", "list_1", "--name", "New card"],
    )
    assert result.exit_code == 3
    assert "PERMISSION_DENIED" in result.output

