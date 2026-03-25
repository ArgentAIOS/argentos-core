from __future__ import annotations

import json
import threading
from contextlib import contextmanager
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Any
from urllib.parse import parse_qs, urlparse

from click.testing import CliRunner

from cli_aos.hootsuite.cli import cli


HARNESS_ROOT = Path(__file__).resolve().parents[1]
CONNECTOR_PATH = HARNESS_ROOT.parent / "connector.json"
PERMISSIONS_PATH = HARNESS_ROOT / "permissions.json"


MEMBER = {"id": "member-1", "fullName": "Jane Social", "email": "jane@example.com"}
ORGANIZATIONS = [
    {"id": "org-1", "name": "North America CRM", "status": "active"},
    {"id": "org-2", "name": "EMEA Marketing", "status": "active"},
]
SOCIAL_PROFILES = [
    {"id": "sp-1", "type": "instagram", "socialNetworkUsername": "north-america-crm", "ownerId": "member-1"},
    {"id": "sp-2", "type": "linkedin", "socialNetworkUsername": "emea-marketing", "ownerId": "member-1"},
]
TEAMS = [
    {"id": "team-1", "name": "Growth"},
    {"id": "team-2", "name": "Support"},
]
MESSAGES = [
    {
        "id": "msg-1",
        "state": "scheduled",
        "text": "Launch message",
        "scheduledSendTime": "2026-03-20T12:00:00Z",
        "socialProfile": {"id": "sp-1"},
    },
    {
        "id": "msg-2",
        "state": "draft",
        "text": "Follow-up message",
        "scheduledSendTime": "2026-03-21T12:00:00Z",
        "socialProfile": {"id": "sp-2"},
    },
]


class MockHootsuiteHandler(BaseHTTPRequestHandler):
    requests: list[dict[str, Any]] = []

    def log_message(self, format: str, *args) -> None:  # noqa: A003
        return

    def _send_json(self, status: int, payload: dict[str, object]) -> None:
        body = json.dumps(payload).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def _record(self, method: str) -> tuple[str, dict[str, list[str]]]:
        parsed = urlparse(self.path)
        self.__class__.requests.append(
            {
                "method": method,
                "path": parsed.path,
                "query": parsed.query,
                "auth": self.headers.get("Authorization"),
                "accept": self.headers.get("Accept"),
            }
        )
        return parsed.path, parse_qs(parsed.query)

    def do_GET(self) -> None:  # noqa: N802
        path, query = self._record("GET")

        if path == "/v1/me":
            self._send_json(200, MEMBER)
            return
        if path == "/v1/me/organizations":
            self._send_json(200, {"data": ORGANIZATIONS})
            return
        if path == "/v1/socialProfiles":
            self._send_json(200, {"data": SOCIAL_PROFILES})
            return
        if path == "/v1/organizations/org-1":
            self._send_json(200, ORGANIZATIONS[0])
            return
        if path == "/v1/organizations/org-1/socialProfiles":
            self._send_json(200, {"data": SOCIAL_PROFILES[:1]})
            return
        if path == "/v1/organizations/org-1/teams":
            self._send_json(200, {"data": TEAMS})
            return
        if path == "/v1/socialProfiles/sp-1":
            self._send_json(200, SOCIAL_PROFILES[0])
            return
        if path == "/v1/teams/team-1":
            self._send_json(200, TEAMS[0])
            return
        if path == "/v1/teams/team-1/members":
            self._send_json(200, {"data": [MEMBER]})
            return
        if path == "/v1/teams/team-1/socialProfiles":
            self._send_json(200, {"data": SOCIAL_PROFILES[:1]})
            return
        if path == "/v1/messages":
            if query.get("socialProfileId") == ["sp-1"]:
                self._send_json(200, {"data": MESSAGES[:1]})
                return
            if query.get("limit") == ["1"]:
                self._send_json(200, {"data": MESSAGES[:1]})
                return
            self._send_json(200, {"data": MESSAGES})
            return
        if path == "/v1/messages/msg-1":
            self._send_json(200, MESSAGES[0])
            return

        self._send_json(404, {"message": "not found"})

    def do_POST(self) -> None:  # noqa: N802
        path, _ = self._record("POST")
        content_length = int(self.headers.get("Content-Length") or "0")
        body_text = self.rfile.read(content_length).decode("utf-8") if content_length else ""
        try:
            body = json.loads(body_text) if body_text else {}
        except json.JSONDecodeError:
            body = body_text
        self.__class__.requests[-1]["body"] = body
        if path == "/v1/messages":
            self._send_json(201, {"id": "msg-new", "state": "scheduled"})
            return
        self._send_json(404, {"message": "not found"})


@contextmanager
def mock_hootsuite_server():
    MockHootsuiteHandler.requests = []
    server = ThreadingHTTPServer(("127.0.0.1", 0), MockHootsuiteHandler)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    try:
        yield {
            "base_url": f"http://127.0.0.1:{server.server_address[1]}",
            "requests": MockHootsuiteHandler.requests,
        }
    finally:
        server.shutdown()
        server.server_close()
        thread.join(timeout=5)


def invoke_json(args: list[str]) -> dict[str, Any]:
    result = CliRunner().invoke(cli, ["--json", *args])
    assert result.exit_code == 0, result.output
    return json.loads(result.output)


def test_manifest_and_permissions_are_in_sync():
    manifest = json.loads(CONNECTOR_PATH.read_text())
    permissions = json.loads(PERMISSIONS_PATH.read_text())["permissions"]
    command_ids = [command["id"] for command in manifest["commands"]]
    assert set(command_ids) == set(permissions.keys())
    assert manifest["scope"]["kind"] == "social-scheduling"
    assert "message.schedule" in command_ids


def test_capabilities_exposes_manifest():
    payload = invoke_json(["capabilities"])
    assert payload["tool"] == "aos-hootsuite"
    assert payload["data"]["backend"] == "hootsuite-rest-api"
    assert "organization.read" in json.dumps(payload["data"])
    assert "message.schedule" in json.dumps(payload["data"])


def test_health_requires_access_token(monkeypatch):
    monkeypatch.delenv("HOOTSUITE_ACCESS_TOKEN", raising=False)
    payload = invoke_json(["health"])
    assert payload["data"]["status"] == "needs_setup"
    assert "HOOTSUITE_ACCESS_TOKEN" in json.dumps(payload["data"])


def test_health_ready_with_mock_server(monkeypatch):
    with mock_hootsuite_server() as server:
        monkeypatch.setenv("HOOTSUITE_ACCESS_TOKEN", "secret-token")
        monkeypatch.setenv("HOOTSUITE_BASE_URL", server["base_url"])
        payload = invoke_json(["health"])
        assert payload["data"]["status"] == "ready"
        assert payload["data"]["probe"]["ok"] is True
        assert payload["data"]["probe"]["details"]["organization_count"] == 2


def test_config_show_redacts_and_surfaces_scope(monkeypatch):
    monkeypatch.setenv("HOOTSUITE_ACCESS_TOKEN", "very-secret-token")
    monkeypatch.setenv("HOOTSUITE_BASE_URL", "http://127.0.0.1:9000")
    monkeypatch.setenv("HOOTSUITE_ORGANIZATION_ID", "org-1")
    monkeypatch.setenv("HOOTSUITE_SOCIAL_PROFILE_ID", "sp-1")
    monkeypatch.setenv("HOOTSUITE_TEAM_ID", "team-1")
    monkeypatch.setenv("HOOTSUITE_MESSAGE_ID", "msg-1")
    payload = invoke_json(["config", "show"])
    data = payload["data"]
    assert "very-secret-token" not in json.dumps(data)
    assert data["scope"]["access_token"] == "<redacted>"
    assert data["runtime"]["implementation_mode"] == "live_read_with_scaffolded_writes"
    assert data["runtime"]["command_defaults"]["organization.read"]["args"][0] == "HOOTSUITE_ORGANIZATION_ID"
    assert data["runtime"]["picker_scopes"]["organization"]["selected"]["organization_id"] == "org-1"
    assert data["runtime"]["picker_scopes"]["social_profile"]["selected"]["social_profile_id"] == "sp-1"
    assert data["runtime"]["picker_scopes"]["team"]["selected"]["team_id"] == "team-1"
    assert data["runtime"]["picker_scopes"]["message"]["selected"]["message_id"] == "msg-1"


def test_member_read_returns_scope_preview(monkeypatch):
    with mock_hootsuite_server() as server:
        monkeypatch.setenv("HOOTSUITE_ACCESS_TOKEN", "secret-token")
        monkeypatch.setenv("HOOTSUITE_BASE_URL", server["base_url"])
        payload = invoke_json(["me", "read"])
        assert payload["data"]["member"]["fullName"] == "Jane Social"
        assert payload["data"]["scope_preview"]["command_id"] == "me.read"
        assert payload["data"]["organization_count"] == 2
        assert payload["data"]["social_profile_count"] == 2


def test_organization_list_and_read(monkeypatch):
    with mock_hootsuite_server() as server:
        monkeypatch.setenv("HOOTSUITE_ACCESS_TOKEN", "secret-token")
        monkeypatch.setenv("HOOTSUITE_BASE_URL", server["base_url"])
        list_payload = invoke_json(["organization", "list"])
        assert list_payload["data"]["organization_count"] == 2
        assert list_payload["data"]["picker"]["kind"] == "organization"
        read_payload = invoke_json(["organization", "read", "org-1"])
        assert read_payload["data"]["organization"]["name"] == "North America CRM"
        assert read_payload["data"]["scope_preview"]["organization_id"] == "org-1"


def test_social_profile_list_and_read(monkeypatch):
    with mock_hootsuite_server() as server:
        monkeypatch.setenv("HOOTSUITE_ACCESS_TOKEN", "secret-token")
        monkeypatch.setenv("HOOTSUITE_BASE_URL", server["base_url"])
        list_payload = invoke_json(["social-profile", "list"])
        assert list_payload["data"]["social_profile_count"] == 2
        assert list_payload["data"]["picker"]["kind"] == "social_profile"
        read_payload = invoke_json(["social-profile", "read", "sp-1"])
        assert read_payload["data"]["social_profile"]["socialNetworkUsername"] == "north-america-crm"
        assert read_payload["data"]["scope_preview"]["social_profile_id"] == "sp-1"


def test_team_list_and_read(monkeypatch):
    with mock_hootsuite_server() as server:
        monkeypatch.setenv("HOOTSUITE_ACCESS_TOKEN", "secret-token")
        monkeypatch.setenv("HOOTSUITE_BASE_URL", server["base_url"])
        monkeypatch.setenv("HOOTSUITE_ORGANIZATION_ID", "org-1")
        list_payload = invoke_json(["team", "list"])
        assert list_payload["data"]["team_count"] == 2
        assert list_payload["data"]["organization_id"] == "org-1"
        read_payload = invoke_json(["team", "read", "team-1"])
        assert read_payload["data"]["team"]["name"] == "Growth"
        assert read_payload["data"]["scope_preview"]["team_id"] == "team-1"


def test_message_list_and_read(monkeypatch):
    with mock_hootsuite_server() as server:
        monkeypatch.setenv("HOOTSUITE_ACCESS_TOKEN", "secret-token")
        monkeypatch.setenv("HOOTSUITE_BASE_URL", server["base_url"])
        monkeypatch.setenv("HOOTSUITE_SOCIAL_PROFILE_ID", "sp-1")
        list_payload = invoke_json(["message", "list", "--limit", "1"])
        assert list_payload["data"]["message_count"] == 1
        assert list_payload["data"]["picker"]["kind"] == "message"
        assert list_payload["data"]["social_profile_id"] == "sp-1"
        read_payload = invoke_json(["message", "read", "msg-1"])
        assert read_payload["data"]["message"]["id"] == "msg-1"
        assert read_payload["data"]["scope_preview"]["message_id"] == "msg-1"


def test_scaffold_write_remains_scaffolded(monkeypatch):
    monkeypatch.setenv("HOOTSUITE_ACCESS_TOKEN", "secret-token")
    payload = invoke_json([
        "--mode",
        "write",
        "message",
        "schedule",
        "Launch post",
        "--social-profile-id",
        "sp-1",
        "--scheduled-send-time",
        "2026-03-20T12:00:00Z",
    ])
    assert payload["data"]["status"] == "scaffold_write_only"
    assert payload["data"]["command"] == "message.schedule"
    assert payload["data"]["inputs"]["social_profile_id"] == "sp-1"
