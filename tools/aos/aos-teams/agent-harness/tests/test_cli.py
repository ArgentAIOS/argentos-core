from __future__ import annotations

import json
from typing import Any

from click.testing import CliRunner

import cli_aos.teams.runtime as runtime
from cli_aos.teams.cli import cli

CONNECTOR_PATH = runtime.CONNECTOR_PATH
PERMISSIONS_PATH = runtime.PERMISSIONS_PATH


class FakeTeamsClient:
    def list_teams(self, *, limit: int = 20) -> dict[str, Any]:
        teams = [
            {"id": "team-1", "label": "Finance", "subtitle": "finance@example.com", "raw": {}},
            {"id": "team-2", "label": "Ops", "subtitle": "ops@example.com", "raw": {}},
        ]
        return {"items": teams[:limit], "count": min(limit, len(teams)), "raw": {}}

    def list_channels(self, *, team_id: str, limit: int = 20) -> dict[str, Any]:
        channels = [
            {"id": "channel-1", "label": "General", "subtitle": "standard", "raw": {"team_id": team_id}},
        ]
        return {"items": channels[:limit], "count": min(limit, len(channels)), "raw": {}}

    def list_meetings(self, *, user_id: str, limit: int = 10) -> dict[str, Any]:
        meetings = [
            {"id": "meeting-1", "label": "Weekly sync", "subtitle": "Conference Room", "raw": {"user_id": user_id}},
        ]
        return {"items": meetings[:limit], "count": min(limit, len(meetings)), "raw": {}}

    def create_channel(self, *, team_id: str, display_name: str, description: str | None = None) -> dict[str, Any]:
        return {
            "id": "channel-new",
            "displayName": display_name,
            "description": description,
            "membershipType": "standard",
            "team_id": team_id,
        }


def invoke_json(args: list[str]) -> dict[str, Any]:
    result = CliRunner().invoke(cli, ["--json", *args])
    assert result.exit_code == 0, result.output
    return json.loads(result.output)


def invoke_json_with_mode(mode: str, args: list[str]) -> dict[str, Any]:
    result = CliRunner().invoke(cli, ["--json", "--mode", mode, *args])
    return result


def test_manifest_and_permissions_are_in_sync():
    manifest = json.loads(CONNECTOR_PATH.read_text())
    permissions = json.loads(PERMISSIONS_PATH.read_text())["permissions"]
    command_ids = [command["id"] for command in manifest["commands"]]
    assert set(command_ids) == set(permissions.keys())
    assert manifest["scope"]["kind"] == "communication"


def test_capabilities_exposes_manifest():
    payload = invoke_json(["capabilities"])
    assert payload["tool"] == "aos-teams"
    assert payload["data"]["backend"] == "microsoft-graph"
    assert "adaptive_card.send" in json.dumps(payload["data"])


def test_health_requires_credentials(monkeypatch):
    monkeypatch.delenv("TEAMS_TENANT_ID", raising=False)
    monkeypatch.delenv("TEAMS_CLIENT_ID", raising=False)
    monkeypatch.delenv("TEAMS_CLIENT_SECRET", raising=False)
    payload = invoke_json(["health"])
    assert payload["data"]["status"] == "needs_setup"
    assert "TEAMS_TENANT_ID" in json.dumps(payload["data"])


def test_health_ready_with_fake_client(monkeypatch):
    monkeypatch.setenv("TEAMS_TENANT_ID", "tenant")
    monkeypatch.setenv("TEAMS_CLIENT_ID", "client")
    monkeypatch.setenv("TEAMS_CLIENT_SECRET", "secret")
    monkeypatch.setattr(runtime, "create_client", lambda ctx_obj=None: FakeTeamsClient())
    payload = invoke_json(["health"])
    assert payload["data"]["status"] == "ready"
    assert payload["data"]["probe"]["ok"] is True
    assert payload["data"]["probe"]["details"]["sample_team"][0]["id"] == "team-1"


def test_config_show_redacts_credentials(monkeypatch):
    monkeypatch.setenv("TEAMS_TENANT_ID", "tenant")
    monkeypatch.setenv("TEAMS_CLIENT_ID", "client")
    monkeypatch.setenv("TEAMS_CLIENT_SECRET", "super-secret")
    monkeypatch.setattr(runtime, "probe_runtime", lambda _ctx=None: {"ok": True, "code": "OK", "message": "probe ok", "details": {}})
    payload = invoke_json(["config", "show"])
    encoded = json.dumps(payload["data"])
    assert "super-secret" not in encoded
    assert "su...cret" in encoded
    assert payload["data"]["runtime"]["graph_base_url"].startswith("https://graph.microsoft.com")


def test_team_list_returns_picker(monkeypatch):
    monkeypatch.setenv("TEAMS_TENANT_ID", "tenant")
    monkeypatch.setenv("TEAMS_CLIENT_ID", "client")
    monkeypatch.setenv("TEAMS_CLIENT_SECRET", "secret")
    monkeypatch.setattr(runtime, "create_client", lambda ctx_obj=None: FakeTeamsClient())
    payload = invoke_json(["team", "list"])
    assert payload["data"]["summary"] == "Listed 2 team(s)."
    assert payload["data"]["picker_options"][0]["label"] == "Finance"
    assert payload["data"]["scope_preview"]["command_id"] == "team.list"


def test_channel_create_requires_write_mode(monkeypatch):
    monkeypatch.setenv("TEAMS_TENANT_ID", "tenant")
    monkeypatch.setenv("TEAMS_CLIENT_ID", "client")
    monkeypatch.setenv("TEAMS_CLIENT_SECRET", "secret")
    result = CliRunner().invoke(cli, ["--json", "--mode", "readonly", "channel", "create"])
    assert result.exit_code == 3
    assert "PERMISSION_DENIED" in result.output


def test_channel_create_executes_live_write_in_write_mode(monkeypatch):
    monkeypatch.setenv("TEAMS_TENANT_ID", "tenant")
    monkeypatch.setenv("TEAMS_CLIENT_ID", "client")
    monkeypatch.setenv("TEAMS_CLIENT_SECRET", "secret")
    monkeypatch.setattr(runtime, "create_client", lambda ctx_obj=None: FakeTeamsClient())
    result = invoke_json_with_mode("write", ["channel", "create", "team-1", "New Channel"])
    assert result.exit_code == 0
    payload = json.loads(result.output)
    assert payload["data"]["status"] == "live_write"
    assert payload["data"]["channel"]["displayName"] == "New Channel"
    assert payload["data"]["scope_preview"]["team_id"] == "team-1"


def test_meeting_list_uses_user_scope(monkeypatch):
    monkeypatch.setenv("TEAMS_TENANT_ID", "tenant")
    monkeypatch.setenv("TEAMS_CLIENT_ID", "client")
    monkeypatch.setenv("TEAMS_CLIENT_SECRET", "secret")
    monkeypatch.setenv("TEAMS_USER_ID", "user-1")
    monkeypatch.setattr(runtime, "create_client", lambda ctx_obj=None: FakeTeamsClient())
    payload = invoke_json(["meeting", "list"])
    assert payload["data"]["meetings"][0]["label"] == "Weekly sync"
    assert payload["data"]["scope_preview"]["command_id"] == "meeting.list"
