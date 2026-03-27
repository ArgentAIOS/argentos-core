from __future__ import annotations

import json
from pathlib import Path

from click.testing import CliRunner

from cli_aos.google import commands as google_commands
from cli_aos.google.cli import cli


def test_capabilities_json_matches_manifest():
    result = CliRunner().invoke(cli, ["--json", "capabilities"])
    assert result.exit_code == 0

    envelope = json.loads(result.output)
    payload = envelope["data"]
    manifest = json.loads((Path(__file__).resolve().parents[2] / "connector.json").read_text())

    assert envelope["tool"] == "aos-google"
    assert envelope["command"] == "capabilities"
    assert payload["tool"] == manifest["tool"]
    assert payload["backend"] == manifest["backend"]
    assert payload["manifest_schema_version"] == manifest["manifest_schema_version"]
    assert payload["connector"] == manifest["connector"]
    assert payload["scope"] == manifest["scope"]
    assert payload["auth"] == manifest["auth"]
    assert payload["commands"] == manifest["commands"]


def test_config_show_includes_account_picker_metadata():
    result = CliRunner().invoke(cli, ["--json", "--account", "ops@example.com", "config", "show"])
    assert result.exit_code == 0

    payload = json.loads(result.output)["data"]

    assert payload["account"] == "ops@example.com"
    assert payload["scope"]["kind"] == "account"
    assert payload["scope"]["selection_surface"] == "account"
    assert payload["scope"]["account"] == "ops@example.com"
    assert payload["picker_options"] == [
        {
            "value": "ops@example.com",
            "label": "ops@example.com",
            "resource": "gmail.mailbox",
            "subtitle": "Mailbox scope",
            "selected": True,
        }
    ]


def test_config_show_includes_live_label_and_calendar_picker_options(monkeypatch):
    def fake_run_gws(gws_bin: str, args: list[str], env=None):
        if args[:4] == ["gmail", "users", "labels", "list"]:
            return {
                "labels": [
                    {
                        "id": "INBOX",
                        "name": "Inbox",
                        "type": "system",
                        "labelListVisibility": "labelShow",
                        "messagesTotal": 120,
                        "messagesUnread": 7,
                    },
                    {
                        "id": "Project_Finance",
                        "name": "Project Finance",
                        "type": "user",
                        "labelListVisibility": "labelShow",
                    },
                ]
            }
        if args[:3] == ["calendar", "calendarList", "list"]:
            return {
                "items": [
                    {
                        "id": "primary",
                        "summary": "Primary calendar",
                        "primary": True,
                        "accessRole": "owner",
                    },
                    {
                        "id": "team-calendar@example.com",
                        "summary": "Team calendar",
                        "selected": True,
                        "accessRole": "writer",
                    },
                ]
            }
        raise AssertionError(f"unexpected args: {args!r}")

    monkeypatch.setattr(google_commands, "run_gws", fake_run_gws)

    result = CliRunner().invoke(cli, ["--json", "--account", "ops@example.com", "config", "show"])
    assert result.exit_code == 0

    payload = json.loads(result.output)["data"]
    assert payload["label_picker_options"] == [
        {
            "value": "INBOX",
            "label": "Inbox",
            "resource": "gmail.label",
            "subtitle": "120 messages | 7 unread | system / labelShow",
            "kind": "label",
            "selection_surface": "label",
            "scope_preview": "Gmail labels > Inbox",
            "source_kind": "live_list",
            "source_command": "gmail.users.labels.list",
        },
        {
            "value": "Project_Finance",
            "label": "Project Finance",
            "resource": "gmail.label",
            "subtitle": "user / labelShow",
            "kind": "label",
            "selection_surface": "label",
            "scope_preview": "Gmail labels > Project Finance",
            "source_kind": "live_list",
            "source_command": "gmail.users.labels.list",
        },
    ]
    assert payload["scope"]["label_picker_options"] == payload["label_picker_options"]
    assert payload["calendar_picker_options"] == [
        {
            "value": "primary",
            "label": "Primary calendar",
            "resource": "calendar.calendar",
            "subtitle": "Primary calendar | Access role: owner",
            "kind": "calendar",
            "selection_surface": "calendar",
            "scope_preview": "Calendar scope > Primary calendar",
            "selected": True,
            "source_kind": "live_list",
            "source_command": "calendar.calendarList.list",
        },
        {
            "value": "team-calendar@example.com",
            "label": "Team calendar",
            "resource": "calendar.calendar",
            "subtitle": "Access role: writer",
            "kind": "calendar",
            "selection_surface": "calendar",
            "scope_preview": "Calendar scope > Team calendar",
            "selected": True,
            "source_kind": "live_list",
            "source_command": "calendar.calendarList.list",
        },
    ]
    assert payload["scope"]["calendar_picker_options"] == payload["calendar_picker_options"]


def test_permission_gate_blocks_write_for_readonly():
    result = CliRunner().invoke(
        cli,
        [
            "--json",
            "--mode",
            "readonly",
            "calendar",
            "create",
            "--summary",
            "Test",
            "--start",
            "2026-03-12T15:00:00Z",
            "--end",
            "2026-03-12T15:30:00Z",
        ],
    )
    assert result.exit_code == 3
    assert "PERMISSION_DENIED" in result.output


def test_health_fails_cleanly_without_gws():
    result = CliRunner().invoke(cli, ["--json", "--gws-bin", "definitely-not-a-real-gws", "health"])
    assert result.exit_code == 5
    assert "BACKEND_UNAVAILABLE" in result.output


def test_doctor_includes_install_hint_when_gws_missing():
    result = CliRunner().invoke(cli, ["--json", "--gws-bin", "definitely-not-a-real-gws", "doctor"])
    assert result.exit_code == 5
    assert "Install upstream with: npm install -g @googleworkspace/cli" in result.output


def test_doctor_marks_unauthenticated_auth_status(monkeypatch):
    monkeypatch.setattr(google_commands, "ensure_gws_exists", lambda *_args, **_kwargs: None)

    def fake_probe(_gws_bin: str, args: list[str], env=None):
        if args == ["--version"]:
            return {"ok": True, "returncode": 0, "stdout": "gws 1.2.3", "stderr": ""}
        if args == ["auth", "status", "--json"]:
            return {
                "ok": True,
                "returncode": 0,
                "stdout": json.dumps({"auth_method": "none", "credential_source": "none"}),
                "stderr": "",
            }
        raise AssertionError(f"unexpected probe args: {args!r}")

    monkeypatch.setattr(google_commands, "probe_gws", fake_probe)

    result = CliRunner().invoke(cli, ["--json", "doctor"])
    assert result.exit_code == 0

    payload = json.loads(result.output)
    assert payload["data"]["status"] == "degraded"
    auth_check = next(check for check in payload["data"]["checks"] if check["name"] == "gws_auth_status")
    assert auth_check["ok"] is False


def test_gmail_search_exposes_message_picker_options(monkeypatch):
    captured = {}

    def fake_run_gws(gws_bin: str, args: list[str], env=None):
        captured.setdefault("calls", []).append(args)
        if args[:4] == ["gmail", "users", "labels", "list"]:
            return {
                "labels": [
                    {
                        "id": "INBOX",
                        "name": "Inbox",
                        "type": "system",
                        "labelListVisibility": "labelShow",
                        "messagesTotal": 120,
                        "messagesUnread": 7,
                    },
                    {
                        "id": "Project_Finance",
                        "name": "Project Finance",
                        "type": "user",
                        "labelListVisibility": "labelShow",
                    },
                ]
            }
        if args[:4] == ["gmail", "users", "messages", "list"]:
            captured["gws_bin"] = gws_bin
            captured["args"] = args
            return {
                "messages": [
                    {
                        "id": "msg-1",
                        "snippet": "Quarterly budget ready",
                        "labelIds": ["INBOX", "Project_Finance"],
                        "payload": {
                            "headers": [
                                {"name": "Subject", "value": "Quarterly budget"},
                                {"name": "From", "value": "finance@example.com"},
                                {"name": "Date", "value": "Tue, 12 Mar 2026 09:00:00 -0500"},
                            ]
                        },
                    },
                    {
                        "id": "msg-2",
                        "snippet": "Travel receipt attached",
                        "labelIds": ["Project_Finance", "STARRED"],
                    },
                ]
            }
        raise AssertionError(f"unexpected args: {args!r}")

    monkeypatch.setattr(google_commands, "run_gws", fake_run_gws)

    result = CliRunner().invoke(
        cli,
        [
            "--json",
            "--account",
            "ops@example.com",
            "gmail",
            "search",
            "newer_than:7d",
            "--max-results",
            "2",
        ],
    )
    assert result.exit_code == 0

    payload = json.loads(result.output)["data"]
    assert captured["args"] == [
        "gmail",
        "users",
        "messages",
        "list",
        "--params",
        json.dumps({"userId": "me", "q": "newer_than:7d", "maxResults": 2}),
        "--account",
        "ops@example.com",
    ]
    assert payload["live_status"] == "live_read"
    assert payload["scope"]["kind"] == "mailbox"
    assert payload["scope"]["selection_surface"] == "message"
    assert payload["scope"]["account"] == "ops@example.com"
    assert payload["label_picker_options"] == [
        {
            "value": "INBOX",
            "label": "Inbox",
            "resource": "gmail.label",
            "subtitle": "120 messages | 7 unread | system / labelShow",
            "kind": "label",
            "selection_surface": "label",
            "scope_preview": "Gmail labels > Inbox",
            "source_kind": "live_list",
            "source_command": "gmail.users.labels.list",
        },
        {
            "value": "Project_Finance",
            "label": "Project Finance",
            "resource": "gmail.label",
            "subtitle": "user / labelShow",
            "kind": "label",
            "selection_surface": "label",
            "scope_preview": "Gmail labels > Project Finance",
            "source_kind": "live_list",
            "source_command": "gmail.users.labels.list",
        },
        {
            "value": "STARRED",
            "label": "Starred",
            "resource": "gmail.label",
            "subtitle": "Seen in 1 message",
            "kind": "label",
            "selection_surface": "label",
            "scope_preview": "Gmail labels > Starred",
            "message_count": 1,
            "source_kind": "observed_response",
            "source_command": "gmail.users.messages.list",
        },
    ]
    assert payload["scope"]["label_picker_options"] == payload["label_picker_options"]
    assert payload["picker_options"] == [
        {
            "value": "msg-1",
            "label": "Quarterly budget",
            "resource": "gmail.message",
            "subtitle": "finance@example.com | Tue, 12 Mar 2026 09:00:00 -0500",
            "source_kind": "observed_response",
            "source_command": "gmail.users.messages.list",
        },
        {
            "value": "msg-2",
            "label": "Travel receipt attached",
            "resource": "gmail.message",
            "source_kind": "observed_response",
            "source_command": "gmail.users.messages.list",
        },
    ]


def test_gmail_read_marks_selected_message(monkeypatch):
    def fake_run_gws(gws_bin: str, args: list[str], env=None):
        if args[:4] == ["gmail", "users", "labels", "list"]:
            return {
                "labels": [
                    {
                        "id": "INBOX",
                        "name": "Inbox",
                        "type": "system",
                        "labelListVisibility": "labelShow",
                        "messagesTotal": 50,
                        "messagesUnread": 2,
                    },
                    {
                        "id": "Billing",
                        "name": "Billing",
                        "type": "user",
                        "labelListVisibility": "labelShow",
                    },
                ]
            }
        assert args == [
            "gmail",
            "users",
            "messages",
            "get",
            "--params",
            json.dumps({"userId": "me", "id": "msg-3", "format": "full"}),
        ]
        return {
            "id": "msg-3",
            "snippet": "Latest invoice attached",
            "labelIds": ["INBOX", "Billing"],
            "payload": {
                "headers": [
                    {"name": "Subject", "value": "Invoice"},
                    {"name": "From", "value": "billing@example.com"},
                ]
            },
        }

    monkeypatch.setattr(google_commands, "run_gws", fake_run_gws)

    result = CliRunner().invoke(cli, ["--json", "gmail", "read", "msg-3"])
    assert result.exit_code == 0

    payload = json.loads(result.output)["data"]
    assert payload["live_status"] == "live_read"
    assert payload["scope"]["kind"] == "mailbox"
    assert payload["scope"]["selection_surface"] == "message"
    assert payload["label_picker_options"] == [
        {
            "value": "INBOX",
            "label": "Inbox",
            "resource": "gmail.label",
            "subtitle": "50 messages | 2 unread | system / labelShow",
            "kind": "label",
            "selection_surface": "label",
            "scope_preview": "Gmail labels > Inbox",
            "source_kind": "live_list",
            "source_command": "gmail.users.labels.list",
        },
        {
            "value": "Billing",
            "label": "Billing",
            "resource": "gmail.label",
            "subtitle": "user / labelShow",
            "kind": "label",
            "selection_surface": "label",
            "scope_preview": "Gmail labels > Billing",
            "source_kind": "live_list",
            "source_command": "gmail.users.labels.list",
        },
    ]
    assert payload["picker_options"] == [
        {
            "value": "msg-3",
            "label": "Invoice",
            "resource": "gmail.message",
            "subtitle": "billing@example.com",
            "selected": True,
            "source_kind": "observed_response",
            "source_command": "gmail.users.messages.get",
        }
    ]


def test_drive_list_exposes_file_picker_options(monkeypatch):
    def fake_run_gws(gws_bin: str, args: list[str], env=None):
        assert args == [
            "drive",
            "files",
            "list",
            "--params",
            json.dumps({"pageSize": 5, "q": "mimeType='application/pdf'"}),
        ]
        return {
            "files": [
                {
                    "id": "file-1",
                    "name": "Budget Q1",
                    "mimeType": "application/pdf",
                    "modifiedTime": "2026-03-12T10:00:00Z",
                }
            ]
        }

    monkeypatch.setattr(google_commands, "run_gws", fake_run_gws)

    result = CliRunner().invoke(
        cli,
        [
            "--json",
            "drive",
            "list",
            "--page-size",
            "5",
            "--query",
            "mimeType='application/pdf'",
        ],
    )
    assert result.exit_code == 0

    payload = json.loads(result.output)["data"]
    assert payload["live_status"] == "live_read"
    assert payload["scope"]["kind"] == "drive"
    assert payload["scope"]["selection_surface"] == "file"
    assert payload["picker_options"] == [
        {
            "value": "file-1",
            "label": "Budget Q1",
            "resource": "drive.file",
            "subtitle": "application/pdf | 2026-03-12T10:00:00Z",
        }
    ]


def test_calendar_list_exposes_event_picker_options(monkeypatch):
    def fake_run_gws(gws_bin: str, args: list[str], env=None):
        if args[:3] == ["calendar", "calendarList", "list"]:
            return {
                "items": [
                    {
                        "id": "primary",
                        "summary": "Primary calendar",
                        "primary": True,
                        "accessRole": "owner",
                    },
                    {
                        "id": "team-calendar@example.com",
                        "summary": "Team calendar",
                        "selected": True,
                        "accessRole": "writer",
                    },
                ]
            }
        assert args == [
            "calendar",
            "events",
            "list",
            "--params",
            json.dumps({"calendarId": "primary", "maxResults": 3, "singleEvents": True, "orderBy": "startTime"}),
        ]
        return {
            "items": [
                {
                    "id": "evt-1",
                    "summary": "Team Sync",
                    "calendarId": "team-calendar@example.com",
                    "start": {"dateTime": "2026-03-12T15:00:00Z"},
                    "end": {"dateTime": "2026-03-12T15:30:00Z"},
                }
            ]
        }

    monkeypatch.setattr(google_commands, "run_gws", fake_run_gws)

    result = CliRunner().invoke(cli, ["--json", "calendar", "list", "--max-results", "3"])
    assert result.exit_code == 0

    payload = json.loads(result.output)["data"]
    assert payload["live_status"] == "live_read"
    assert payload["scope"]["kind"] == "calendar"
    assert payload["scope"]["selection_surface"] == "event"
    assert payload["calendar_picker_options"] == [
        {
            "value": "primary",
            "label": "Primary calendar",
            "resource": "calendar.calendar",
            "subtitle": "Primary calendar | Access role: owner",
            "selected": True,
            "kind": "calendar",
            "selection_surface": "calendar",
            "scope_preview": "Calendar scope > Primary calendar",
            "source_kind": "live_list",
            "source_command": "calendar.calendarList.list",
        },
        {
            "value": "team-calendar@example.com",
            "label": "Team calendar",
            "resource": "calendar.calendar",
            "subtitle": "Access role: writer",
            "selected": True,
            "kind": "calendar",
            "selection_surface": "calendar",
            "scope_preview": "Calendar scope > Team calendar",
            "source_kind": "live_list",
            "source_command": "calendar.calendarList.list",
        }
    ]
    assert payload["scope"]["calendar_picker_options"] == payload["calendar_picker_options"]
    assert payload["picker_options"] == [
        {
            "value": "evt-1",
            "label": "Team Sync",
            "resource": "calendar.event",
            "subtitle": "2026-03-12T15:00:00Z -> 2026-03-12T15:30:00Z",
            "source_kind": "observed_response",
            "source_command": "calendar.events.list",
        }
    ]


def test_calendar_create_exposes_selected_calendar_scope(monkeypatch):
    def fake_run_gws(gws_bin: str, args: list[str], env=None):
        if args[:3] == ["calendar", "calendarList", "list"]:
            return {
                "items": [
                    {
                        "id": "primary",
                        "summary": "Primary calendar",
                        "primary": True,
                        "accessRole": "owner",
                    },
                    {
                        "id": "team-calendar@example.com",
                        "summary": "Team calendar",
                        "selected": True,
                        "accessRole": "writer",
                    },
                ]
            }
        assert args == [
            "calendar",
            "events",
            "insert",
            "--params",
            json.dumps(
                {
                    "calendarId": "primary",
                    "requestBody": {
                        "summary": "Team Sync",
                        "start": {"dateTime": "2026-03-12T15:00:00Z"},
                        "end": {"dateTime": "2026-03-12T15:30:00Z"},
                    },
                }
            ),
        ]
        return {
            "id": "evt-2",
            "summary": "Team Sync",
            "calendarId": "team-calendar@example.com",
            "start": {"dateTime": "2026-03-12T15:00:00Z"},
            "end": {"dateTime": "2026-03-12T15:30:00Z"},
        }

    monkeypatch.setattr(google_commands, "run_gws", fake_run_gws)

    result = CliRunner().invoke(
        cli,
        [
            "--json",
            "--mode",
            "write",
            "calendar",
            "create",
            "--summary",
            "Team Sync",
            "--start",
            "2026-03-12T15:00:00Z",
            "--end",
            "2026-03-12T15:30:00Z",
        ],
    )
    assert result.exit_code == 0

    payload = json.loads(result.output)["data"]
    assert payload["live_status"] == "live_write"
    assert payload["consequential"] is True
    assert payload["scope"]["kind"] == "calendar"
    assert payload["scope"]["selection_surface"] == "calendar"
    assert payload["calendar_picker_options"] == [
        {
            "value": "primary",
            "label": "Primary calendar",
            "resource": "calendar.calendar",
            "subtitle": "Primary calendar | Access role: owner",
            "selected": True,
            "kind": "calendar",
            "selection_surface": "calendar",
            "scope_preview": "Calendar scope > Primary calendar",
            "source_kind": "live_list",
            "source_command": "calendar.calendarList.list",
        },
        {
            "value": "team-calendar@example.com",
            "label": "Team calendar",
            "resource": "calendar.calendar",
            "subtitle": "Access role: writer",
            "selected": True,
            "kind": "calendar",
            "selection_surface": "calendar",
            "scope_preview": "Calendar scope > Team calendar",
            "source_kind": "live_list",
            "source_command": "calendar.calendarList.list",
        },
    ]
    assert payload["scope"]["calendar_picker_options"] == payload["calendar_picker_options"]
    assert payload["picker_options"] == [
        {
            "value": "evt-2",
            "label": "Team Sync",
            "resource": "calendar.event",
            "subtitle": "2026-03-12T15:00:00Z -> 2026-03-12T15:30:00Z",
            "selected": True,
            "source_kind": "observed_response",
            "source_command": "calendar.events.insert",
        }
    ]
