from __future__ import annotations

import json
from urllib.parse import unquote

from click.testing import CliRunner

from cli_aos.m365 import runtime
from cli_aos.m365.cli import cli


def _clear_m365_env(monkeypatch) -> None:
    for key in [
        "M365_TENANT_ID",
        "M365_CLIENT_ID",
        "M365_CLIENT_SECRET",
        "M365_TARGET_USER",
        "M365_TEAM_ID",
        "M365_CHANNEL_ID",
        "M365_EXCEL_ITEM_ID",
        "M365_EXCEL_WORKSHEET_NAME",
        "M365_EXCEL_RANGE",
        "M365_GRAPH_BASE_URL",
        "M365_TOKEN_URL",
        "M365_HTTP_TIMEOUT_SECONDS",
    ]:
        monkeypatch.delenv(key, raising=False)


def _set_graph_env(monkeypatch) -> None:
    monkeypatch.setenv("M365_TENANT_ID", "tenant-id")
    monkeypatch.setenv("M365_CLIENT_ID", "client-id")
    monkeypatch.setenv("M365_CLIENT_SECRET", "super-secret")
    monkeypatch.setenv("M365_TARGET_USER", "alice@example.com")


def _fake_json_request_factory(call_log: list[dict[str, object]]):
    def fake_json_request(method, url, *, headers=None, payload=None, query=None, timeout_seconds=20.0, form_encoded=False):
        decoded_path = unquote(url.split("?", 1)[0])
        call_log.append(
            {
                "method": method,
                "url": url,
                "headers": headers or {},
                "payload": payload,
                "query": query or {},
                "form_encoded": form_encoded,
            }
        )
        if "oauth2/v2.0/token" in url:
            return {
                "access_token": "token",
                "token_type": "Bearer",
                "expires_in": 3600,
                "scope": "https://graph.microsoft.com/.default",
            }
        if decoded_path.endswith("/users/alice@example.com"):
            return {
                "id": "user-1",
                "displayName": "Alice Example",
                "mail": "alice@example.com",
                "userPrincipalName": "alice@example.com",
            }
        if decoded_path.endswith("/messages") and "/calendarView" not in decoded_path and "/channels/" not in decoded_path:
            return {
                "value": [
                    {
                        "id": "message-1",
                        "subject": "Quarterly report",
                        "from": {"emailAddress": {"address": "finance@example.com"}},
                        "bodyPreview": "Quarterly results attached.",
                        "receivedDateTime": "2026-03-18T12:00:00Z",
                        "isRead": False,
                        "webLink": "https://example.invalid/mail/message-1",
                    }
                ]
            }
        if decoded_path.endswith("/messages/message-1"):
            return {
                "id": "message-1",
                "subject": "Quarterly report",
                "from": {"emailAddress": {"address": "finance@example.com"}},
                "toRecipients": [{"emailAddress": {"address": "alice@example.com"}}],
                "bodyPreview": "Quarterly results attached.",
                "receivedDateTime": "2026-03-18T12:00:00Z",
                "isRead": False,
                "webLink": "https://example.invalid/mail/message-1",
            }
        if decoded_path.endswith("/joinedTeams"):
            return {
                "value": [
                    {
                        "id": "team-1",
                        "displayName": "Finance",
                        "description": "Finance team",
                        "mailNickname": "finance",
                        "webUrl": "https://example.invalid/teams/team-1",
                    }
                ]
            }
        if decoded_path.endswith("/teams/team-1/channels"):
            return {
                "value": [
                    {
                        "id": "channel-1",
                        "displayName": "General",
                        "description": "General channel",
                        "membershipType": "standard",
                        "webUrl": "https://example.invalid/teams/team-1/channels/channel-1",
                    }
                ]
            }
        if decoded_path.endswith("/calendarView"):
            return {
                "value": [
                    {
                        "id": "event-1",
                        "subject": "Weekly sync",
                        "start": {"dateTime": "2026-03-19T15:00:00Z", "timeZone": "UTC"},
                        "end": {"dateTime": "2026-03-19T15:30:00Z", "timeZone": "UTC"},
                        "organizer": {"emailAddress": {"address": "manager@example.com", "name": "Manager"}},
                        "location": {"displayName": "Conference Room"},
                        "isAllDay": False,
                        "webLink": "https://example.invalid/calendar/event-1",
                    }
                ]
            }
        if decoded_path.endswith("/drive/root/children"):
            return {
                "value": [
                    {
                        "id": "file-1",
                        "name": "Budget.xlsx",
                        "size": 1024,
                        "lastModifiedDateTime": "2026-03-18T08:00:00Z",
                        "webUrl": "https://example.invalid/drive/file-1",
                        "file": {},
                    }
                ]
            }
        if decoded_path.endswith("/workbook/worksheets"):
            return {
                "value": [
                    {
                        "id": "worksheet-1",
                        "name": "Sheet1",
                    }
                ]
            }
        if "usedRange" in decoded_path:
            return {
                "address": "Sheet1!A1:B3",
                "rowCount": 3,
                "columnCount": 2,
                "values": [
                    ["Name", "Amount"],
                    ["Alpha", 100],
                    ["Beta", 200],
                ],
            }
        if "/workbook/worksheets/" in decoded_path and "/range(address='" in decoded_path:
            return {
                "values": [
                    ["Name", "Amount"],
                    ["Alpha", 100],
                    ["Beta", 200],
                ]
            }
        if decoded_path.endswith("/teams/team-1/channels/channel-1/messages"):
            return {
                "value": [
                    {
                        "id": "team-message-1",
                        "subject": "Status update",
                        "bodyPreview": "Shipping is on track.",
                        "from": {"user": {"displayName": "Teammate"}},
                        "createdDateTime": "2026-03-18T13:00:00Z",
                        "webUrl": "https://example.invalid/teams/message-1",
                    }
                ]
            }
        raise AssertionError(f"Unexpected Graph URL in test: {url}")

    return fake_json_request


def test_capabilities_json_includes_global_commands():
    result = CliRunner().invoke(cli, ["--json", "capabilities"])
    assert result.exit_code == 0
    assert '"tool": "aos-m365"' in result.output
    assert '"doctor"' in result.output
    assert '"config.show"' in result.output
    assert '"health"' in result.output


def test_health_reports_needs_setup_without_env(monkeypatch):
    _clear_m365_env(monkeypatch)
    result = CliRunner().invoke(cli, ["--json", "health"])
    assert result.exit_code == 0
    payload = json.loads(result.output)
    assert payload["data"]["status"] == "needs_setup"
    assert "M365_TENANT_ID" in payload["data"]["checks"][0]["details"]["missing_keys"]
    assert payload["data"]["runtime"]["picker_scopes"]["teams"]["ready"] is False
    assert payload["data"]["runtime"]["picker_scopes"]["workbook"]["ready"] is False
    assert payload["data"]["runtime"]["picker_scopes"]["teams"]["pickers"]["team"]["command"] == "teams.list_teams"
    assert payload["data"]["runtime"]["picker_scopes"]["workbook"]["pickers"]["worksheet"]["command"] == "excel.list_worksheets"


def test_doctor_reports_ready_when_graph_probe_succeeds(monkeypatch):
    _set_graph_env(monkeypatch)
    monkeypatch.setenv("M365_TEAM_ID", "team-1")
    monkeypatch.setenv("M365_CHANNEL_ID", "channel-1")
    monkeypatch.setenv("M365_EXCEL_ITEM_ID", "item-1")
    monkeypatch.setenv("M365_EXCEL_WORKSHEET_NAME", "Sheet1")
    monkeypatch.setenv("M365_EXCEL_RANGE", "A1:C3")
    calls: list[dict[str, object]] = []
    monkeypatch.setattr(runtime, "_json_request", _fake_json_request_factory(calls))

    result = CliRunner().invoke(cli, ["--json", "doctor"])
    assert result.exit_code == 0

    payload = json.loads(result.output)
    assert payload["data"]["status"] == "healthy"
    assert payload["data"]["runtime"]["mail_ready"] is True
    assert payload["data"]["runtime"]["calendar_ready"] is True
    assert payload["data"]["runtime"]["file_ready"] is True
    assert payload["data"]["runtime_ready"] is True
    assert payload["data"]["runtime"]["picker_scopes"]["teams"]["candidates"][0]["label"] == "team-1"
    assert payload["data"]["runtime"]["picker_scopes"]["teams"]["candidates"][1]["label"] == "channel-1"
    assert payload["data"]["runtime"]["picker_scopes"]["workbook"]["candidates"][0]["label"] == "item-1"
    assert payload["data"]["runtime"]["picker_scopes"]["workbook"]["candidates"][1]["label"] == "Sheet1"
    assert payload["data"]["runtime"]["picker_scopes"]["teams"]["pickers"]["team"]["available"] is True
    assert payload["data"]["runtime"]["picker_scopes"]["teams"]["pickers"]["channel"]["available"] is True
    assert payload["data"]["runtime"]["picker_scopes"]["workbook"]["pickers"]["workbook"]["available"] is True
    assert payload["data"]["runtime"]["picker_scopes"]["workbook"]["pickers"]["worksheet"]["available"] is True
    assert payload["data"]["runtime"]["picker_scopes"]["workbook"]["pickers"]["range"]["available"] is True
    assert "super-secret" not in result.output
    assert "su...cret" in result.output
    assert len(calls) >= 2


def test_config_show_reports_runtime_probe_and_redacts_secret(monkeypatch):
    _set_graph_env(monkeypatch)
    monkeypatch.setenv("M365_TEAM_ID", "team-1")
    monkeypatch.setenv("M365_CHANNEL_ID", "channel-1")
    monkeypatch.setenv("M365_EXCEL_ITEM_ID", "item-1")
    monkeypatch.setenv("M365_EXCEL_WORKSHEET_NAME", "Sheet1")
    monkeypatch.setenv("M365_EXCEL_RANGE", "A1:C3")
    calls: list[dict[str, object]] = []
    monkeypatch.setattr(runtime, "_json_request", _fake_json_request_factory(calls))

    result = CliRunner().invoke(cli, ["--json", "config", "show"])
    assert result.exit_code == 0

    payload = json.loads(result.output)
    assert payload["data"]["runtime_ready"] is True
    assert payload["data"]["auth"]["redacted"]["M365_CLIENT_SECRET"] == "su...cret"
    assert payload["data"]["api_probe"]["ok"] is True
    assert payload["data"]["runtime"]["picker_scopes"]["teams"]["ready"] is True
    assert payload["data"]["runtime"]["picker_scopes"]["workbook"]["selected"]["worksheet"] == "Sheet1"
    assert payload["data"]["runtime"]["picker_scopes"]["teams"]["pickers"]["team"]["command"] == "teams.list_teams"
    assert payload["data"]["runtime"]["picker_scopes"]["teams"]["pickers"]["channel"]["command"] == "teams.list_channels"
    assert payload["data"]["runtime"]["picker_scopes"]["workbook"]["pickers"]["workbook"]["command"] == "excel.list_workbooks"
    assert payload["data"]["runtime"]["picker_scopes"]["workbook"]["pickers"]["range"]["command"] == "excel.used_range"


def test_mail_search_uses_graph_runtime(monkeypatch):
    _set_graph_env(monkeypatch)
    calls: list[dict[str, object]] = []
    monkeypatch.setattr(runtime, "_json_request", _fake_json_request_factory(calls))

    result = CliRunner().invoke(cli, ["--json", "mail", "search", "quarterly", "report"])
    assert result.exit_code == 0

    payload = json.loads(result.output)
    assert payload["data"]["count"] == 1
    assert payload["data"]["messages"][0]["subject"] == "Quarterly report"
    assert payload["data"]["scope_preview"]["surface"] == "mail"
    assert payload["data"]["scope_preview"]["candidates"][0]["label"] == "Quarterly report"
    assert calls[1]["query"]["$search"] == '"quarterly report"'


def test_mail_read_exposes_scope_preview(monkeypatch):
    _set_graph_env(monkeypatch)
    calls: list[dict[str, object]] = []
    monkeypatch.setattr(runtime, "_json_request", _fake_json_request_factory(calls))

    result = CliRunner().invoke(cli, ["--json", "mail", "read", "message-1"])
    assert result.exit_code == 0

    payload = json.loads(result.output)
    assert payload["data"]["message"]["id"] == "message-1"
    assert payload["data"]["scope_preview"]["mode"] == "read"
    assert payload["data"]["scope_preview"]["preview"]["subtitle"] == "finance@example.com"


def test_calendar_list_exposes_picker_preview(monkeypatch):
    _set_graph_env(monkeypatch)
    calls: list[dict[str, object]] = []
    monkeypatch.setattr(runtime, "_json_request", _fake_json_request_factory(calls))

    result = CliRunner().invoke(cli, ["--json", "calendar", "list"])
    assert result.exit_code == 0

    payload = json.loads(result.output)
    assert payload["data"]["count"] == 1
    assert payload["data"]["scope_preview"]["surface"] == "calendar"
    assert payload["data"]["scope_preview"]["candidates"][0]["label"] == "Weekly sync"


def test_file_list_exposes_picker_preview(monkeypatch):
    _set_graph_env(monkeypatch)
    calls: list[dict[str, object]] = []
    monkeypatch.setattr(runtime, "_json_request", _fake_json_request_factory(calls))

    result = CliRunner().invoke(cli, ["--json", "file", "list"])
    assert result.exit_code == 0

    payload = json.loads(result.output)
    assert payload["data"]["count"] == 1
    assert payload["data"]["scope_preview"]["surface"] == "file"
    assert payload["data"]["scope_preview"]["candidates"][0]["label"] == "Budget.xlsx"


def test_excel_list_workbooks_exposes_picker_preview(monkeypatch):
    _set_graph_env(monkeypatch)
    calls: list[dict[str, object]] = []
    monkeypatch.setattr(runtime, "_json_request", _fake_json_request_factory(calls))

    result = CliRunner().invoke(cli, ["--json", "excel", "list-workbooks"])
    assert result.exit_code == 0

    payload = json.loads(result.output)
    assert payload["data"]["count"] == 1
    assert payload["data"]["scope_preview"]["surface"] == "excel"
    assert payload["data"]["scope_preview"]["kind"] == "workbook"
    assert payload["data"]["scope_preview"]["candidates"][0]["label"] == "Budget.xlsx"


def test_excel_list_worksheets_exposes_picker_preview(monkeypatch):
    _set_graph_env(monkeypatch)
    monkeypatch.setenv("M365_EXCEL_ITEM_ID", "item-1")
    calls: list[dict[str, object]] = []
    monkeypatch.setattr(runtime, "_json_request", _fake_json_request_factory(calls))

    result = CliRunner().invoke(cli, ["--json", "excel", "list-worksheets"])
    assert result.exit_code == 0

    payload = json.loads(result.output)
    assert payload["data"]["count"] == 1
    assert payload["data"]["scope_preview"]["surface"] == "excel"
    assert payload["data"]["scope_preview"]["kind"] == "worksheet"
    assert payload["data"]["scope_preview"]["candidates"][0]["label"] == "Sheet1"


def test_excel_used_range_exposes_picker_preview(monkeypatch):
    _set_graph_env(monkeypatch)
    monkeypatch.setenv("M365_EXCEL_ITEM_ID", "item-1")
    monkeypatch.setenv("M365_EXCEL_WORKSHEET_NAME", "Sheet1")
    calls: list[dict[str, object]] = []
    monkeypatch.setattr(runtime, "_json_request", _fake_json_request_factory(calls))

    result = CliRunner().invoke(cli, ["--json", "excel", "used-range"])
    assert result.exit_code == 0

    payload = json.loads(result.output)
    assert payload["data"]["rows"][0]["Name"] == "Alpha"
    assert payload["data"]["scope_preview"]["surface"] == "excel"
    assert payload["data"]["scope_preview"]["kind"] == "range"
    assert payload["data"]["scope_preview"]["address"] == "Sheet1!A1:B3"


def test_excel_read_rows_exposes_picker_preview(monkeypatch):
    _set_graph_env(monkeypatch)
    monkeypatch.setenv("M365_EXCEL_ITEM_ID", "item-1")
    monkeypatch.setenv("M365_EXCEL_WORKSHEET_NAME", "Sheet1")
    monkeypatch.setenv("M365_EXCEL_RANGE", "A1:C3")
    calls: list[dict[str, object]] = []
    monkeypatch.setattr(runtime, "_json_request", _fake_json_request_factory(calls))

    result = CliRunner().invoke(cli, ["--json", "excel", "read-rows"])
    assert result.exit_code == 0

    payload = json.loads(result.output)
    assert payload["data"]["rows"][0]["Name"] == "Alpha"
    assert payload["data"]["scope_preview"]["surface"] == "excel"
    assert payload["data"]["scope_preview"]["columns"] == ["Name", "Amount"]
    assert payload["data"]["scope_preview"]["row_count"] == 2


def test_teams_list_messages_exposes_picker_preview(monkeypatch):
    _set_graph_env(monkeypatch)
    monkeypatch.setenv("M365_TEAM_ID", "team-1")
    monkeypatch.setenv("M365_CHANNEL_ID", "channel-1")
    calls: list[dict[str, object]] = []
    monkeypatch.setattr(runtime, "_json_request", _fake_json_request_factory(calls))

    result = CliRunner().invoke(cli, ["--json", "teams", "list-messages"])
    assert result.exit_code == 0

    payload = json.loads(result.output)
    assert payload["data"]["count"] == 1
    assert payload["data"]["scope_preview"]["surface"] == "teams"
    assert payload["data"]["scope_preview"]["candidates"][0]["label"] == "Status update"


def test_teams_list_teams_exposes_picker_preview(monkeypatch):
    _set_graph_env(monkeypatch)
    calls: list[dict[str, object]] = []
    monkeypatch.setattr(runtime, "_json_request", _fake_json_request_factory(calls))

    result = CliRunner().invoke(cli, ["--json", "teams", "list-teams"])
    assert result.exit_code == 0

    payload = json.loads(result.output)
    assert payload["data"]["count"] == 1
    assert payload["data"]["scope_preview"]["surface"] == "teams"
    assert payload["data"]["scope_preview"]["kind"] == "team"
    assert payload["data"]["scope_preview"]["candidates"][0]["label"] == "Finance"


def test_teams_list_channels_exposes_picker_preview(monkeypatch):
    _set_graph_env(monkeypatch)
    monkeypatch.setenv("M365_TEAM_ID", "team-1")
    calls: list[dict[str, object]] = []
    monkeypatch.setattr(runtime, "_json_request", _fake_json_request_factory(calls))

    result = CliRunner().invoke(cli, ["--json", "teams", "list-channels"])
    assert result.exit_code == 0

    payload = json.loads(result.output)
    assert payload["data"]["count"] == 1
    assert payload["data"]["scope_preview"]["surface"] == "teams"
    assert payload["data"]["scope_preview"]["kind"] == "channel"
    assert payload["data"]["scope_preview"]["candidates"][0]["label"] == "General"


def test_runtime_config_includes_picker_scope_metadata(monkeypatch):
    _set_graph_env(monkeypatch)
    monkeypatch.setenv("M365_TEAM_ID", "team-1")
    monkeypatch.setenv("M365_CHANNEL_ID", "channel-1")
    monkeypatch.setenv("M365_EXCEL_ITEM_ID", "item-1")
    monkeypatch.setenv("M365_EXCEL_WORKSHEET_NAME", "Sheet1")
    monkeypatch.setenv("M365_EXCEL_RANGE", "A1:C3")

    config = runtime.runtime_config()

    assert config["runtime"]["picker_scopes"]["teams"]["surface"] == "teams"
    assert config["runtime"]["picker_scopes"]["teams"]["kind"] == "channel_scope"
    assert config["runtime"]["picker_scopes"]["teams"]["mode"] == "live_read"
    assert config["runtime"]["picker_scopes"]["teams"]["pickers"]["team"]["command"] == "teams.list_teams"
    assert config["runtime"]["picker_scopes"]["teams"]["pickers"]["channel"]["command"] == "teams.list_channels"
    assert config["runtime"]["picker_scopes"]["teams"]["selected"]["team_id"] == "team-1"
    assert config["runtime"]["picker_scopes"]["workbook"]["surface"] == "excel"
    assert config["runtime"]["picker_scopes"]["workbook"]["mode"] == "live_read"
    assert config["runtime"]["picker_scopes"]["workbook"]["pickers"]["workbook"]["command"] == "excel.list_workbooks"
    assert config["runtime"]["picker_scopes"]["workbook"]["pickers"]["worksheet"]["command"] == "excel.list_worksheets"
    assert config["runtime"]["picker_scopes"]["workbook"]["pickers"]["range"]["command"] == "excel.used_range"
    assert config["runtime"]["picker_scopes"]["workbook"]["selected"]["item_id"] == "item-1"
    assert config["runtime"]["picker_scopes"]["workbook"]["selected"]["worksheet"] == "Sheet1"


def test_permission_denied_for_write_path_in_readonly():
    result = CliRunner().invoke(cli, ["--json", "--mode", "readonly", "mail", "reply"])
    assert result.exit_code in (3, 10)
    assert "PERMISSION_DENIED" in result.output or "NOT_IMPLEMENTED" in result.output
