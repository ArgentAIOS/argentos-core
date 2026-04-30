from __future__ import annotations

import json
import subprocess
from pathlib import Path
from typing import Any

from click.testing import CliRunner
import pytest

import cli_aos.teams.runtime as runtime
import cli_aos.teams.service_keys as service_keys
from cli_aos.teams.cli import cli

AGENT_HARNESS_ROOT = Path(__file__).resolve().parents[1]
CONNECTOR_PATH = AGENT_HARNESS_ROOT.parent / "connector.json"
PERMISSIONS_PATH = AGENT_HARNESS_ROOT / "permissions.json"
ALL_ENV_KEYS = (
    "TEAMS_TENANT_ID",
    "TEAMS_CLIENT_ID",
    "TEAMS_CLIENT_SECRET",
    "TEAMS_TEAM_ID",
    "TEAMS_CHANNEL_ID",
    "TEAMS_CHAT_ID",
    "TEAMS_USER_ID",
    "TEAMS_GRAPH_BASE_URL",
    "TEAMS_TOKEN_URL",
    "TEAMS_HTTP_TIMEOUT_SECONDS",
    "TEAMS_MEETING_SUBJECT",
    "TEAMS_START_TIME",
    "TEAMS_END_TIME",
)


def write_service_keys(tmp_path: Path, values: dict[str, str], *, extra: dict[str, Any] | None = None) -> Path:
    path = tmp_path / "service-keys.json"
    path.write_text(
        json.dumps(
            {
                "version": 1,
                "keys": [
                    {
                        "id": f"sk-{key}",
                        "name": key,
                        "variable": key,
                        "value": value,
                        "enabled": True,
                        **(extra or {}),
                    }
                    for key, value in values.items()
                ],
            }
        )
    )
    return path


def encrypt_secret(tmp_path: Path, plaintext: str) -> str:
    home = tmp_path / "home"
    key_dir = home / ".argentos"
    key_dir.mkdir(parents=True, exist_ok=True)
    (key_dir / ".master-key").write_text("11" * 32)
    script = r"""
const { createCipheriv } = require("node:crypto");
const plaintext = process.argv[1];
const key = Buffer.from("11".repeat(32), "hex");
const iv = Buffer.from("22".repeat(12), "hex");
const cipher = createCipheriv("aes-256-gcm", key, iv);
let encrypted = cipher.update(plaintext, "utf8", "hex");
encrypted += cipher.final("hex");
const tag = cipher.getAuthTag().toString("hex");
process.stdout.write(`enc:v1:${iv.toString("hex")}:${tag}:${encrypted}`);
"""
    result = subprocess.run(
        ["node", "-e", script, plaintext],
        capture_output=True,
        text=True,
        timeout=10,
        check=True,
    )
    return result.stdout


def _clear_env(monkeypatch) -> None:
    for key in ALL_ENV_KEYS:
        monkeypatch.delenv(key, raising=False)


@pytest.fixture(autouse=True)
def no_operator_service_keys_by_default(monkeypatch, tmp_path):
    monkeypatch.setattr(service_keys, "SERVICE_KEYS_PATH", tmp_path / "missing-service-keys.json")
    _clear_env(monkeypatch)


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

    def create_online_meeting(self, *, user_id: str, subject: str, start_iso: str, end_iso: str) -> dict[str, Any]:
        return {
            "id": "meeting-new",
            "subject": subject,
            "startDateTime": start_iso,
            "endDateTime": end_iso,
            "user_id": user_id,
        }


def invoke_json(args: list[str], monkeypatch=None, service_keys_map: dict[str, str] | None = None) -> dict[str, Any]:
    obj = {"service_keys": {"aos-teams": service_keys_map}} if service_keys_map else None
    result = CliRunner().invoke(cli, ["--json", *args], obj=obj)
    assert result.exit_code == 0, result.output
    return json.loads(result.output)


def invoke_json_with_mode(mode: str, args: list[str], monkeypatch=None, service_keys_map: dict[str, str] | None = None):
    obj = {"service_keys": {"aos-teams": service_keys_map}} if service_keys_map else None
    result = CliRunner().invoke(cli, ["--json", "--mode", mode, *args], obj=obj)
    return result


def test_manifest_and_permissions_are_in_sync():
    manifest = json.loads(CONNECTOR_PATH.read_text())
    permissions = json.loads(PERMISSIONS_PATH.read_text())["permissions"]
    command_ids = [command["id"] for command in manifest["commands"]]
    assert set(command_ids) == set(permissions.keys())
    assert manifest["scope"]["kind"] == "communication"
    assert manifest["scope"]["live_read_available"] is True
    assert manifest["scope"]["write_bridge_available"] is True
    assert manifest["scope"]["live_write_smoke_tested"] is False
    assert manifest["scope"]["required"] == ["TEAMS_TENANT_ID", "TEAMS_CLIENT_ID", "TEAMS_CLIENT_SECRET"]
    assert "message.send" not in command_ids
    assert manifest["scope"]["commandDefaults"]["meeting.create"]["args"] == ["TEAMS_USER_ID"]
    meeting_list = next(command for command in manifest["commands"] if command["id"] == "meeting.list")
    assert meeting_list["summary"] == "List online calendar events for a scoped user"
    assert "upcoming Teams meetings" not in meeting_list["summary"]


def test_capabilities_exposes_manifest():
    payload = invoke_json(["capabilities"])
    assert payload["tool"] == "aos-teams"
    assert payload["data"]["backend"] == "microsoft-graph"
    assert "meeting.create" in json.dumps(payload["data"])
    assert "adaptive_card.send" not in json.dumps(payload["data"])


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
    payload = invoke_json(["config", "show"])
    encoded = json.dumps(payload["data"])
    assert "super-secret" not in encoded
    assert "su...cret" in encoded
    assert payload["data"]["runtime"]["graph_base_url"].startswith("https://graph.microsoft.com")
    assert payload["data"]["runtime"]["implementation_mode"] == "live_read_with_limited_live_writes"
    assert payload["data"]["write_support"]["scaffold_only"] is False


def test_config_show_prefers_operator_service_keys_for_auth_and_scope(monkeypatch):
    monkeypatch.setenv("TEAMS_TENANT_ID", "env-tenant")
    monkeypatch.setenv("TEAMS_CLIENT_ID", "env-client")
    monkeypatch.setenv("TEAMS_CLIENT_SECRET", "env-secret")
    monkeypatch.setenv("TEAMS_TEAM_ID", "env-team")
    monkeypatch.setenv("TEAMS_USER_ID", "env-user")
    payload = invoke_json(
        ["config", "show"],
        monkeypatch,
        service_keys_map={
            "TEAMS_TENANT_ID": "operator-tenant",
            "TEAMS_CLIENT_ID": "operator-client",
            "TEAMS_CLIENT_SECRET": "operator-secret",
            "TEAMS_TEAM_ID": "operator-team",
            "TEAMS_USER_ID": "operator-user",
        },
    )
    data = payload["data"]
    encoded = json.dumps(data)
    assert "operator-secret" not in encoded
    assert "env-secret" not in encoded
    assert data["auth"]["sources"]["TEAMS_TENANT_ID"] == "operator:service_keys:tool"
    assert data["scope"]["team_id"] == "operator-team"
    assert data["scope"]["user_id"] == "operator-user"
    assert data["scope"]["sources"]["TEAMS_TEAM_ID"] == "operator:service_keys:tool"
    assert data["scope"]["commandDefaults"]["channel.create"]["args"] == ["operator-team"]


def test_encrypted_repo_service_key_decrypts_with_master_key(monkeypatch, tmp_path):
    encrypted = encrypt_secret(tmp_path, "tenant-encrypted")
    path = write_service_keys(tmp_path, {"TEAMS_TENANT_ID": encrypted})
    monkeypatch.setattr(service_keys, "SERVICE_KEYS_PATH", path)
    monkeypatch.setenv("HOME", str(tmp_path / "home"))

    details = service_keys.service_key_details("TEAMS_TENANT_ID")

    assert details["value"] == "tenant-encrypted"
    assert details["source"] == "repo-service-key"


def test_unreadable_encrypted_repo_service_key_falls_back_to_env_like_core_resolver(monkeypatch, tmp_path):
    path = write_service_keys(tmp_path, {"TEAMS_TENANT_ID": "enc:v1:bad:bad:bad"})
    monkeypatch.setattr(service_keys, "SERVICE_KEYS_PATH", path)
    monkeypatch.setenv("TEAMS_TENANT_ID", "env-tenant")

    details = service_keys.service_key_details("TEAMS_TENANT_ID")

    assert details["value"] == "env-tenant"
    assert details["source"] == "env_fallback"


def test_scoped_repo_service_key_blocks_env_fallback(monkeypatch, tmp_path):
    path = write_service_keys(tmp_path, {"TEAMS_TENANT_ID": "scoped-tenant"}, extra={"allowedRoles": ["admin"]})
    monkeypatch.setattr(service_keys, "SERVICE_KEYS_PATH", path)
    monkeypatch.setenv("TEAMS_TENANT_ID", "env-tenant")

    details = service_keys.service_key_details("TEAMS_TENANT_ID")

    assert details["value"] == ""
    assert details["source"] == "repo-service-key-scoped"
    assert details["blocked"] is True


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


def test_channel_create_uses_scoped_team_id_when_present(monkeypatch):
    monkeypatch.setenv("TEAMS_TENANT_ID", "tenant")
    monkeypatch.setenv("TEAMS_CLIENT_ID", "client")
    monkeypatch.setenv("TEAMS_CLIENT_SECRET", "secret")
    monkeypatch.setattr(runtime, "create_client", lambda ctx_obj=None: FakeTeamsClient())
    result = invoke_json_with_mode(
        "write",
        ["channel", "create", "Launch Pad"],
        monkeypatch,
        service_keys_map={"TEAMS_TEAM_ID": "operator-team"},
    )
    assert result.exit_code == 0
    payload = json.loads(result.output)
    assert payload["data"]["channel"]["team_id"] == "operator-team"
    assert payload["data"]["scope_preview"]["team_id"] == "operator-team"


def test_meeting_list_uses_user_scope(monkeypatch):
    monkeypatch.setenv("TEAMS_TENANT_ID", "tenant")
    monkeypatch.setenv("TEAMS_CLIENT_ID", "client")
    monkeypatch.setenv("TEAMS_CLIENT_SECRET", "secret")
    monkeypatch.setenv("TEAMS_USER_ID", "user-1")
    monkeypatch.setattr(runtime, "create_client", lambda ctx_obj=None: FakeTeamsClient())
    payload = invoke_json(["meeting", "list"])
    assert payload["data"]["meetings"][0]["label"] == "Weekly sync"
    assert payload["data"]["scope_preview"]["command_id"] == "meeting.list"


def test_meeting_create_uses_scoped_user_and_normalizes_times(monkeypatch):
    monkeypatch.setenv("TEAMS_TENANT_ID", "tenant")
    monkeypatch.setenv("TEAMS_CLIENT_ID", "client")
    monkeypatch.setenv("TEAMS_CLIENT_SECRET", "secret")
    monkeypatch.setattr(runtime, "create_client", lambda ctx_obj=None: FakeTeamsClient())
    result = invoke_json_with_mode(
        "write",
        ["meeting", "create", "Weekly sync", "2026-04-01T10:00:00-05:00"],
        monkeypatch,
        service_keys_map={"TEAMS_USER_ID": "operator-user"},
    )
    assert result.exit_code == 0
    payload = json.loads(result.output)
    assert payload["data"]["meeting"]["user_id"] == "operator-user"
    assert payload["data"]["meeting"]["startDateTime"] == "2026-04-01T15:00:00Z"
    assert payload["data"]["meeting"]["endDateTime"] == "2026-04-01T15:30:00Z"


def test_help_does_not_expose_unsupported_message_or_card_commands():
    result = CliRunner().invoke(cli, ["--help"])
    assert result.exit_code == 0
    command_lines = {
        line.strip()
        for line in result.output.splitlines()
        if line.startswith("  ") and line.strip() and not line.strip().startswith("--")
    }
    assert "message" not in command_lines
    assert "adaptive-card" not in command_lines
