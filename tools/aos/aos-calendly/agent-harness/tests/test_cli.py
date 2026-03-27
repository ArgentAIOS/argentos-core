from __future__ import annotations

import json
from pathlib import Path
from typing import Any

from click.testing import CliRunner

from cli_aos.calendly.cli import cli
import cli_aos.calendly.runtime as runtime


AGENT_HARNESS_ROOT = Path(__file__).resolve().parents[1]
CONNECTOR_PATH = AGENT_HARNESS_ROOT.parent / "connector.json"
PERMISSIONS_PATH = AGENT_HARNESS_ROOT / "permissions.json"


class FakeCalendlyClient:
    def get_current_user(self) -> dict[str, Any]:
        return {
            "uri": "https://api.calendly.com/users/AAAA-BBBB-CCCC",
            "name": "Demo User",
            "email": "demo@example.com",
            "slug": "demo-user",
            "scheduling_url": "https://calendly.com/demo-user",
            "timezone": "America/Chicago",
        }

    def list_event_types(self, *, user_uri: str, count: int = 20) -> dict[str, Any]:
        event_types = [
            {
                "uri": "https://api.calendly.com/event_types/ET1",
                "name": "30-Minute Meeting",
                "slug": "30-minute-meeting",
                "active": True,
                "duration": 30,
                "kind": "solo",
                "scheduling_url": "https://calendly.com/demo-user/30-minute-meeting",
            },
            {
                "uri": "https://api.calendly.com/event_types/ET2",
                "name": "60-Minute Consultation",
                "slug": "60-minute-consultation",
                "active": True,
                "duration": 60,
                "kind": "solo",
                "scheduling_url": "https://calendly.com/demo-user/60-minute-consultation",
            },
        ]
        return {"event_types": event_types[:count], "pagination": {}}

    def get_event_type(self, uuid: str) -> dict[str, Any]:
        return {
            "uri": f"https://api.calendly.com/event_types/{uuid}",
            "name": "30-Minute Meeting",
            "slug": "30-minute-meeting",
            "active": True,
            "duration_minutes": 30,
            "kind": "solo",
        }

    def list_events(
        self,
        *,
        user_uri: str,
        count: int = 20,
        min_start_time: str | None = None,
        max_start_time: str | None = None,
        status: str | None = None,
    ) -> dict[str, Any]:
        events = [
            {
                "uri": "https://api.calendly.com/scheduled_events/EV1",
                "name": "30-Minute Meeting",
                "status": "active",
                "start_time": "2026-03-27T10:00:00Z",
                "end_time": "2026-03-27T10:30:00Z",
                "event_type": "https://api.calendly.com/event_types/ET1",
            },
        ]
        return {"events": events[:count], "pagination": {}}

    def get_event(self, uuid: str) -> dict[str, Any]:
        return {
            "uri": f"https://api.calendly.com/scheduled_events/{uuid}",
            "name": "30-Minute Meeting",
            "status": "active",
            "start_time": "2026-03-27T10:00:00Z",
            "end_time": "2026-03-27T10:30:00Z",
        }

    def list_invitees(self, event_uuid: str, *, count: int = 20, email: str | None = None) -> dict[str, Any]:
        invitees = [
            {
                "uri": "https://api.calendly.com/scheduled_events/EV1/invitees/INV1",
                "name": "Ada Lovelace",
                "email": "ada@example.com",
                "status": "active",
                "timezone": "America/New_York",
            },
        ]
        if email:
            invitees = [inv for inv in invitees if inv["email"] == email]
        return {"invitees": invitees[:count], "pagination": {}}

    def get_availability(self, event_type_uuid: str, *, start_time: str | None = None, end_time: str | None = None) -> dict[str, Any]:
        return {
            "slots": [
                {"status": "available", "start_time": "2026-03-28T10:00:00Z", "invitees_remaining": 1},
                {"status": "available", "start_time": "2026-03-28T10:30:00Z", "invitees_remaining": 1},
            ],
            "slot_count": 2,
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
    assert manifest["scope"]["kind"] == "scheduling"


def test_capabilities_exposes_manifest():
    payload = invoke_json(["capabilities"])
    assert payload["tool"] == "aos-calendly"
    assert payload["data"]["backend"] == "calendly-api"
    assert "events.list" in json.dumps(payload["data"])
    assert "event_types.list" in json.dumps(payload["data"])


def test_health_requires_api_key(monkeypatch):
    monkeypatch.delenv("CALENDLY_API_KEY", raising=False)
    payload = invoke_json(["health"])
    assert payload["data"]["status"] == "needs_setup"
    assert "CALENDLY_API_KEY" in json.dumps(payload["data"])


def test_health_ready_with_fake_client(monkeypatch):
    monkeypatch.setenv("CALENDLY_API_KEY", "test_token_abc")
    monkeypatch.setattr(runtime, "create_client", lambda ctx_obj: FakeCalendlyClient())
    payload = invoke_json(["health"])
    assert payload["data"]["status"] == "ready"
    assert payload["data"]["probe"]["ok"] is True
    assert payload["data"]["probe"]["details"]["user"]["name"] == "Demo User"


def test_config_show_redacts_key(monkeypatch):
    monkeypatch.setenv("CALENDLY_API_KEY", "test_secret_token_value")
    monkeypatch.setattr(runtime, "create_client", lambda ctx_obj: FakeCalendlyClient())
    payload = invoke_json(["config", "show"])
    data = payload["data"]
    assert "test_secret_token_value" not in json.dumps(data)
    assert data["auth"]["api_key_present"] is True
    assert data["runtime"]["implementation_mode"] == "live_read_with_scaffolded_writes"


def test_event_types_list_returns_picker_metadata(monkeypatch):
    monkeypatch.setenv("CALENDLY_API_KEY", "test_token_abc")
    monkeypatch.setattr(runtime, "create_client", lambda ctx_obj: FakeCalendlyClient())
    payload = invoke_json(["event-types", "list"])
    data = payload["data"]
    assert data["event_type_count"] == 2
    assert data["picker"]["kind"] == "event_type"
    assert data["scope_preview"]["selection_surface"] == "event_type"


def test_events_list_returns_picker_metadata(monkeypatch):
    monkeypatch.setenv("CALENDLY_API_KEY", "test_token_abc")
    monkeypatch.setattr(runtime, "create_client", lambda ctx_obj: FakeCalendlyClient())
    payload = invoke_json(["events", "list"])
    data = payload["data"]
    assert data["event_count"] == 1
    assert data["picker"]["kind"] == "event"
    assert data["scope_preview"]["command_id"] == "events.list"


def test_events_get_uses_scoped_uuid(monkeypatch):
    monkeypatch.setenv("CALENDLY_API_KEY", "test_token_abc")
    monkeypatch.setenv("CALENDLY_EVENT_UUID", "EV1")
    monkeypatch.setattr(runtime, "create_client", lambda ctx_obj: FakeCalendlyClient())
    payload = invoke_json(["events", "get"])
    data = payload["data"]
    assert data["event"]["status"] == "active"
    assert data["scope_preview"]["event_uuid"] == "EV1"


def test_invitees_list_requires_event_uuid(monkeypatch):
    monkeypatch.setenv("CALENDLY_API_KEY", "test_token_abc")
    monkeypatch.delenv("CALENDLY_EVENT_UUID", raising=False)
    result = CliRunner().invoke(cli, ["--json", "invitees", "list"])
    assert result.exit_code == 4
    assert "CALENDLY_EVENT_REQUIRED" in result.output


def test_invitees_list_returns_data(monkeypatch):
    monkeypatch.setenv("CALENDLY_API_KEY", "test_token_abc")
    monkeypatch.setenv("CALENDLY_EVENT_UUID", "EV1")
    monkeypatch.setattr(runtime, "create_client", lambda ctx_obj: FakeCalendlyClient())
    payload = invoke_json(["invitees", "list"])
    data = payload["data"]
    assert data["invitee_count"] == 1
    assert data["invitees"][0]["email"] == "ada@example.com"


def test_availability_get_returns_slots(monkeypatch):
    monkeypatch.setenv("CALENDLY_API_KEY", "test_token_abc")
    monkeypatch.setenv("CALENDLY_EVENT_TYPE_UUID", "ET1")
    monkeypatch.setattr(runtime, "create_client", lambda ctx_obj: FakeCalendlyClient())
    payload = invoke_json(["availability", "get"])
    data = payload["data"]
    assert data["slot_count"] == 2
    assert data["slots"][0]["status"] == "available"


def test_scaffold_write_commands_do_not_execute_live(monkeypatch):
    monkeypatch.setenv("CALENDLY_API_KEY", "test_token_abc")
    payload = invoke_json_with_mode("write", ["events", "cancel", "EV1"])
    assert payload["data"]["status"] == "scaffold_write_only"
    assert payload["data"]["command"] == "events.cancel"


def test_scheduling_links_create_is_scaffolded(monkeypatch):
    monkeypatch.setenv("CALENDLY_API_KEY", "test_token_abc")
    payload = invoke_json_with_mode("write", ["scheduling-links", "create", "ET1"])
    assert payload["data"]["status"] == "scaffold_write_only"
    assert payload["data"]["command"] == "scheduling_links.create"


def test_readonly_mode_blocks_write_command():
    result = CliRunner().invoke(cli, ["--json", "--mode", "readonly", "events", "cancel", "EV1"])
    assert result.exit_code == 3
    assert "PERMISSION_DENIED" in result.output
    assert "requires mode=write" in result.output
