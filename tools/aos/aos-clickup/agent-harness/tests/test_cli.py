from __future__ import annotations

import json
import threading
from contextlib import contextmanager
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Any
from urllib.parse import urlparse

from click.testing import CliRunner

from cli_aos.clickup.cli import cli
import cli_aos.clickup.runtime as runtime


HARNESS_ROOT = Path(__file__).resolve().parents[1]
CONNECTOR_PATH = HARNESS_ROOT.parent / "connector.json"
PERMISSIONS_PATH = HARNESS_ROOT / "permissions.json"


WORKSPACES = [
    {"id": "12345678", "name": "Argent OS", "color": "#ff9900", "avatar": "https://example.com/workspace.png", "members": []},
    {"id": "87654321", "name": "Ops Connectors", "color": "#44aa88", "avatar": "https://example.com/workspace-2.png", "members": []},
]
SPACES = [
    {"id": "space_abc123", "name": "Core Ops", "private": False, "statuses": []},
    {"id": "space_def456", "name": "Vendor Work", "private": False, "statuses": []},
]
FOLDERS = [
    {"id": "folder_abc123", "name": "Backlog"},
    {"id": "folder_def456", "name": "Delivery"},
]
LISTS = [
    {"id": "list_abc123", "name": "Sprint Board", "status": "open"},
    {"id": "list_def456", "name": "Operations", "status": "open"},
]
TASKS = [
    {
        "id": "task_abc123",
        "name": "Ship ClickUp connector",
        "status": {"status": "open", "color": "#d3d3d3", "type": "open"},
        "list": {"id": "list_abc123"},
        "folder": {"id": "folder_abc123"},
        "space": {"id": "space_abc123"},
        "url": "https://app.clickup.com/t/task_abc123",
    },
    {
        "id": "task_def456",
        "name": "Validate harness",
        "status": {"status": "open", "color": "#d3d3d3", "type": "open"},
        "list": {"id": "list_abc123"},
        "folder": {"id": "folder_abc123"},
        "space": {"id": "space_abc123"},
        "url": "https://app.clickup.com/t/task_def456",
    },
]


class MockClickUpHandler(BaseHTTPRequestHandler):
    requests: list[dict[str, Any]] = []

    def log_message(self, format: str, *args) -> None:  # noqa: A003
        return

    def _send_json(self, status: int, payload: dict[str, Any]) -> None:
        body = json.dumps(payload).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def _record(self, method: str) -> str:
        parsed = urlparse(self.path)
        normalized_path = parsed.path[3:] if parsed.path.startswith("/v2/") else parsed.path
        self.__class__.requests.append(
            {
                "method": method,
                "path": normalized_path,
                "raw_path": parsed.path,
                "query": parsed.query,
                "auth": self.headers.get("Authorization"),
                "accept": self.headers.get("Accept"),
            }
        )
        return normalized_path

    def do_GET(self) -> None:  # noqa: N802
        path = self._record("GET")

        if path == "/team":
            self._send_json(200, {"teams": WORKSPACES})
            return
        if path == "/team/12345678/space":
            self._send_json(200, {"spaces": SPACES})
            return
        if path == "/space/space_abc123":
            self._send_json(200, SPACES[0])
            return
        if path == "/space/space_abc123/folder":
            self._send_json(200, {"folders": FOLDERS})
            return
        if path == "/space/space_abc123/list":
            self._send_json(200, {"lists": LISTS})
            return
        if path == "/folder/folder_abc123":
            self._send_json(200, FOLDERS[0])
            return
        if path == "/folder/folder_abc123/list":
            self._send_json(200, {"lists": LISTS[:1]})
            return
        if path == "/list/list_abc123":
            self._send_json(200, LISTS[0])
            return
        if path == "/list/list_abc123/task":
            self._send_json(200, {"tasks": TASKS})
            return
        if path == "/task/task_abc123":
            self._send_json(200, TASKS[0])
            return

        self._send_json(404, {"message": "not found"})


@contextmanager
def mock_clickup_server():
    MockClickUpHandler.requests = []
    server = ThreadingHTTPServer(("127.0.0.1", 0), MockClickUpHandler)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    try:
        yield {
            "base_url": f"http://127.0.0.1:{server.server_address[1]}",
            "requests": MockClickUpHandler.requests,
        }
    finally:
        server.shutdown()
        server.server_close()
        thread.join(timeout=5)


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
    assert manifest["scope"]["kind"] == "work-management"
    assert "task.create_draft" in command_ids


def test_capabilities_exposes_manifest():
    payload = invoke_json(["capabilities"])
    assert payload["tool"] == "aos-clickup"
    assert payload["backend"] == "clickup-rest-api"
    assert "workspace.read" in json.dumps(payload["data"])
    assert "task.update_draft" in json.dumps(payload["data"])


def test_health_requires_token_and_workspace(monkeypatch):
    monkeypatch.delenv("CLICKUP_API_TOKEN", raising=False)
    monkeypatch.delenv("CLICKUP_ACCESS_TOKEN", raising=False)
    monkeypatch.delenv("CLICKUP_WORKSPACE_ID", raising=False)
    monkeypatch.delenv("CLICKUP_TEAM_ID", raising=False)
    monkeypatch.setattr(runtime, "resolve_runtime_binary", lambda: None)
    payload = invoke_json(["health"])
    assert payload["data"]["status"] == "needs_setup"
    assert "CLICKUP_API_TOKEN" in json.dumps(payload["data"])


def test_health_ready_with_mock_server(monkeypatch):
    with mock_clickup_server() as server:
        monkeypatch.setenv("CLICKUP_API_TOKEN", "secret-token")
        monkeypatch.setenv("CLICKUP_WORKSPACE_ID", "12345678")
        monkeypatch.setenv("CLICKUP_SPACE_ID", "space_abc123")
        monkeypatch.setenv("CLICKUP_FOLDER_ID", "folder_abc123")
        monkeypatch.setenv("CLICKUP_LIST_ID", "list_abc123")
        monkeypatch.setenv("CLICKUP_TASK_ID", "task_abc123")
        monkeypatch.setenv("CLICKUP_BASE_URL", server["base_url"])
        monkeypatch.setattr(runtime, "resolve_runtime_binary", lambda: "/tmp/aos-clickup")
        payload = invoke_json(["health"])
        assert payload["data"]["status"] == "ready"
        assert payload["data"]["probe"]["ok"] is True
        assert payload["data"]["probe"]["workspace"]["space_count"] == 2
        assert payload["data"]["probe"]["task"]["id"] == "task_abc123"


def test_config_show_redacts_and_surfaces_scope(monkeypatch):
    monkeypatch.setenv("CLICKUP_API_TOKEN", "very-secret-token")
    monkeypatch.setenv("CLICKUP_WORKSPACE_ID", "12345678")
    monkeypatch.setenv("CLICKUP_SPACE_ID", "space_abc123")
    monkeypatch.setenv("CLICKUP_FOLDER_ID", "folder_abc123")
    monkeypatch.setenv("CLICKUP_LIST_ID", "list_abc123")
    monkeypatch.setenv("CLICKUP_TASK_ID", "task_abc123")
    payload = invoke_json(["config", "show"])
    data = payload["data"]
    assert "very-secret-token" not in json.dumps(data)
    assert data["config"]["api_token"] == "<redacted>"
    assert data["runtime"]["implementation_mode"] == "live_read_with_scaffolded_writes"
    assert data["runtime"]["live_read_surfaces"] == ["workspace", "space", "folder", "list", "task"]
    assert data["scope"]["resolved_workspace_id"] == "12345678"


def test_workspace_list_uses_live_api(monkeypatch):
    with mock_clickup_server() as server:
        monkeypatch.setenv("CLICKUP_API_TOKEN", "secret-token")
        monkeypatch.setenv("CLICKUP_BASE_URL", server["base_url"])
        monkeypatch.setattr(runtime, "resolve_runtime_binary", lambda: "/tmp/aos-clickup")
        payload = invoke_json(["workspace", "list", "--limit", "1"])
        data = payload["data"]
        assert data["workspace_count"] == 1
        assert data["workspaces"][0]["id"] == "12345678"
        assert data["scope_preview"]["selection_surface"] == "workspace"
        assert server["requests"][0]["path"] == "/team"
        assert server["requests"][0]["auth"] == "secret-token"


def test_folder_and_list_reads_use_live_api(monkeypatch):
    with mock_clickup_server() as server:
        monkeypatch.setenv("CLICKUP_API_TOKEN", "secret-token")
        monkeypatch.setenv("CLICKUP_BASE_URL", server["base_url"])
        monkeypatch.setenv("CLICKUP_SPACE_ID", "space_abc123")
        monkeypatch.setenv("CLICKUP_FOLDER_ID", "folder_abc123")
        monkeypatch.setenv("CLICKUP_LIST_ID", "list_abc123")
        monkeypatch.setattr(runtime, "resolve_runtime_binary", lambda: "/tmp/aos-clickup")
        folder_payload = invoke_json(["folder", "list", "space_abc123"])
        list_payload = invoke_json(["list", "read", "list_abc123"])
        task_payload = invoke_json(["task", "list", "list_abc123", "--limit", "1"])
        assert folder_payload["data"]["folder_count"] == 2
        assert folder_payload["data"]["folders"][0]["id"] == "folder_abc123"
        assert list_payload["data"]["list"]["id"] == "list_abc123"
        assert task_payload["data"]["task_count"] == 1
        assert task_payload["data"]["tasks"][0]["id"] == "task_abc123"


def test_task_create_draft_is_scaffolded_in_write_mode(monkeypatch):
    monkeypatch.setenv("CLICKUP_API_TOKEN", "secret-token")
    monkeypatch.setenv("CLICKUP_LIST_ID", "list_abc123")
    monkeypatch.setattr(runtime, "resolve_runtime_binary", lambda: "/tmp/aos-clickup")
    payload = invoke_json_with_mode("write", ["task", "create-draft", "Ship connector", "--description", "Draft only"])
    assert payload["data"]["status"] == "scaffold_write_only"
    assert payload["data"]["supported"] is False
    assert payload["data"]["task"]["list_id"] == "list_abc123"
    assert payload["data"]["command"] == "task.create_draft"
