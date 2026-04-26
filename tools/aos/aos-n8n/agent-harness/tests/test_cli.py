from __future__ import annotations

import json
import threading
from contextlib import contextmanager
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Any
from urllib.parse import parse_qs, urlparse

from click.testing import CliRunner

from cli_aos.n8n.cli import cli
import cli_aos.n8n.service_keys as service_keys


AGENT_HARNESS_ROOT = Path(__file__).resolve().parents[1]
CONNECTOR_PATH = AGENT_HARNESS_ROOT.parent / "connector.json"
PERMISSIONS_PATH = AGENT_HARNESS_ROOT / "permissions.json"

LIVE_WORKFLOWS = [
    {
        "id": "workflow-123",
        "name": "Onboarding Sync",
        "active": True,
        "createdAt": "2026-03-18T12:00:00Z",
        "updatedAt": "2026-03-19T13:00:00Z",
        "tags": [{"name": "ops"}],
    },
    {
        "id": "workflow-456",
        "name": "Daily Sync",
        "active": True,
        "createdAt": "2026-03-17T12:00:00Z",
        "updatedAt": "2026-03-19T14:00:00Z",
        "tags": [{"name": "sync"}],
    },
]

LIVE_WORKFLOW = {
    "id": "workflow-123",
    "name": "Onboarding Sync",
    "active": True,
    "createdAt": "2026-03-18T12:00:00Z",
    "updatedAt": "2026-03-19T13:00:00Z",
    "tags": [{"name": "ops"}],
}


def _clear_service_key_cache() -> None:
    service_keys.resolve_service_key.cache_clear()


def _mock_service_keys(monkeypatch, values: dict[str, str] | None = None) -> None:
    _clear_service_key_cache()
    resolver = lambda variable: (values or {}).get(variable)
    monkeypatch.setattr(service_keys, "resolve_service_key", resolver)


class MockN8NHandler(BaseHTTPRequestHandler):
    requests: list[dict[str, Any | None]] = []

    def log_message(self, format: str, *args) -> None:  # noqa: A003
        return

    def _send_json(self, status: int, payload: dict[str, object]) -> None:
        body = json.dumps(payload).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self) -> None:  # noqa: N802
        parsed = urlparse(self.path)
        self.__class__.requests.append(
            {
                "method": "GET",
                "path": parsed.path,
                "query": parsed.query,
                "auth": self.headers.get("X-N8N-API-KEY"),
                "accept": self.headers.get("Accept"),
            }
        )
        query = parse_qs(parsed.query)

        if parsed.path == "/api/v1/workflows" and query.get("limit") == ["1"] and query.get("active") == ["true"]:
            self._send_json(200, {"data": LIVE_WORKFLOWS[:1]})
            return

        if parsed.path == "/api/v1/workflows" and query.get("limit") == ["2"] and query.get("active") == ["true"]:
            self._send_json(200, {"data": LIVE_WORKFLOWS})
            return

        if parsed.path == "/api/v1/workflows" and query.get("limit") == ["1000"]:
            self._send_json(200, {"data": LIVE_WORKFLOWS})
            return

        if parsed.path == "/api/v1/workflows/workflow-123":
            self._send_json(200, {"data": LIVE_WORKFLOW})
            return

        self._send_json(404, {"message": "not found"})

    def do_POST(self) -> None:  # noqa: N802
        parsed = urlparse(self.path)
        content_length = int(self.headers.get("Content-Length") or "0")
        body_text = self.rfile.read(content_length).decode("utf-8") if content_length else ""
        try:
            body = json.loads(body_text) if body_text else {}
        except json.JSONDecodeError:
            body = body_text
        self.__class__.requests.append(
            {
                "method": "POST",
                "path": parsed.path,
                "query": parsed.query,
                "auth": self.headers.get("X-N8N-API-KEY"),
                "accept": self.headers.get("Accept"),
                "content_type": self.headers.get("Content-Type"),
                "body": body,
            }
        )

        if parsed.path == "/aos-n8n/workflow-trigger":
            self._send_json(200, {"ok": True, "executionId": "exec-123", "status": "queued"})
            return

        self._send_json(404, {"message": "not found"})


@contextmanager
def mock_n8n_server():
    MockN8NHandler.requests = []
    server = ThreadingHTTPServer(("127.0.0.1", 0), MockN8NHandler)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    try:
        yield {
            "base_url": f"http://127.0.0.1:{server.server_address[1]}",
            "requests": MockN8NHandler.requests,
        }
    finally:
        server.shutdown()
        server.server_close()
        thread.join(timeout=5)


def _set_live_env(monkeypatch, base_url: str) -> None:
    monkeypatch.setenv("N8N_API_URL", base_url)
    monkeypatch.setenv("N8N_API_KEY", "super-secret-key")
    monkeypatch.setenv("N8N_WEBHOOK_BASE_URL", base_url)
    monkeypatch.setenv("N8N_WORKSPACE_NAME", "Ops")
    monkeypatch.setenv("N8N_WORKFLOW_NAME", "Onboarding Sync")
    monkeypatch.setenv("N8N_WORKFLOW_STATUS", "active")
    monkeypatch.delenv("N8N_WORKFLOW_ID", raising=False)


def test_help_lists_global_flags_and_workflow_commands():
    result = CliRunner().invoke(cli, ["--help"])
    assert result.exit_code == 0
    assert "--json" in result.output
    assert "--mode" in result.output
    assert "capabilities" in result.output
    assert "workflow" in result.output


def test_manifest_and_permissions_are_in_sync():
    manifest = json.loads(CONNECTOR_PATH.read_text())
    permissions = json.loads(PERMISSIONS_PATH.read_text())["permissions"]
    manifest_command_ids = [command["id"] for command in manifest["commands"]]

    assert set(manifest_command_ids) == set(permissions.keys())
    assert "workflow.list" in manifest_command_ids
    assert "workflow.trigger" in manifest_command_ids
    assert manifest["backend"] == "n8n-live-bridge"
    assert manifest["scope"]["scaffold_only"] is False
    assert manifest["scope"]["live_backend_available"] is True
    trigger_command = next(command for command in manifest["commands"] if command["id"] == "workflow.trigger")
    assert trigger_command["input_hints"]["event"]["default"] == "manual"
    assert "payload" in trigger_command["input_hints"]
    assert trigger_command["response_hints"]["normalized_fields"][0] == "ok"


def test_capabilities_json_matches_manifest():
    result = CliRunner().invoke(cli, ["--json", "capabilities"])
    assert result.exit_code == 0

    envelope = json.loads(result.output)
    payload = envelope["data"]
    manifest = json.loads(CONNECTOR_PATH.read_text())

    assert envelope["tool"] == "aos-n8n"
    assert envelope["command"] == "capabilities"
    assert payload["tool"] == manifest["tool"]
    assert payload["backend"] == manifest["backend"]
    assert payload["manifest_schema_version"] == manifest["manifest_schema_version"]
    assert payload["connector"] == manifest["connector"]
    assert payload["scope"] == manifest["scope"]
    assert payload["auth"] == manifest["auth"]
    assert payload["commands"] == manifest["commands"]


def test_health_reports_needs_setup_without_env(monkeypatch):
    _mock_service_keys(monkeypatch)
    monkeypatch.delenv("N8N_API_URL", raising=False)
    monkeypatch.delenv("N8N_API_KEY", raising=False)
    monkeypatch.delenv("N8N_WEBHOOK_BASE_URL", raising=False)
    monkeypatch.delenv("N8N_WORKSPACE_NAME", raising=False)
    monkeypatch.delenv("N8N_WORKFLOW_ID", raising=False)
    monkeypatch.delenv("N8N_WORKFLOW_NAME", raising=False)
    monkeypatch.delenv("N8N_WORKFLOW_STATUS", raising=False)

    result = CliRunner().invoke(cli, ["--json", "health"])
    assert result.exit_code == 0

    payload = json.loads(result.output)
    assert payload["data"]["status"] == "needs_setup"
    assert payload["data"]["live_backend_available"] is False
    assert payload["data"]["connector"]["scaffold_only"] is False
    assert payload["data"]["connector"]["write_bridge_available"] is False
    assert "N8N_API_URL" in payload["data"]["checks"][0]["details"]["missing_keys"]


def test_config_show_reports_live_read_truthfully(monkeypatch):
    with mock_n8n_server() as server:
        _mock_service_keys(monkeypatch)
        _set_live_env(monkeypatch, server["base_url"])

        result = CliRunner().invoke(cli, ["--json", "config", "show"])
        assert result.exit_code == 0
        assert "super-secret-key" not in result.output

        payload = json.loads(result.output)["data"]
        assert payload["backend"] == "n8n-live-bridge"
        assert payload["runtime_ready"] is True
        assert payload["live_backend_available"] is True
        assert payload["live_read_available"] is True
        assert payload["write_bridge_available"] is True
        assert payload["scaffold_only"] is False
        assert payload["api_probe"]["ok"] is True
        assert payload["api_probe"]["details"]["sample_count"] == 1
        assert payload["write_probe"]["ok"] is True
        assert payload["auth"]["sources"]["N8N_API_URL"] == "process.env"
        assert payload["auth"]["sources"]["N8N_WEBHOOK_BASE_URL"] == "process.env"
        assert payload["runtime"]["workflow_name"] == "Onboarding Sync"
        assert payload["trigger_builder"]["event_hints"][0]["value"] == "manual"
        assert payload["trigger_builder"]["payload_hints"]["shape"] == "flat key-value map"
        assert payload["trigger_builder"]["request_template"]["workflow"]["workflow_name"] == "Onboarding Sync"


def test_config_show_prefers_operator_service_keys_for_live_endpoints(monkeypatch):
    with mock_n8n_server() as server:
        monkeypatch.setenv("N8N_API_URL", "https://env.example.com")
        monkeypatch.setenv("N8N_API_KEY", "env-secret-key")
        monkeypatch.setenv("N8N_WEBHOOK_BASE_URL", "https://env-hooks.example.com")
        monkeypatch.setenv("N8N_WORKSPACE_NAME", "Ops")
        monkeypatch.setenv("N8N_WORKFLOW_NAME", "Onboarding Sync")
        monkeypatch.setenv("N8N_WORKFLOW_STATUS", "active")
        monkeypatch.delenv("N8N_WORKFLOW_ID", raising=False)
        _mock_service_keys(
            monkeypatch,
            {
                "N8N_API_URL": server["base_url"],
                "N8N_API_KEY": "operator-secret-key",
                "N8N_WEBHOOK_BASE_URL": server["base_url"],
            },
        )

        result = CliRunner().invoke(cli, ["--json", "config", "show"])
        assert result.exit_code == 0
        assert "operator-secret-key" not in result.output
        assert "env-secret-key" not in result.output

        payload = json.loads(result.output)["data"]
        assert payload["auth"]["sources"]["N8N_API_URL"] == "service-keys"
        assert payload["auth"]["sources"]["N8N_API_KEY"] == "service-keys"
        assert payload["auth"]["sources"]["N8N_WEBHOOK_BASE_URL"] == "service-keys"
        assert any(
            request["path"] == "/api/v1/workflows"
            and request["query"] == "limit=1&active=true"
            and request["auth"] == "operator-secret-key"
            for request in server["requests"]
        )


def test_doctor_reports_live_status_and_permissions(monkeypatch):
    with mock_n8n_server() as server:
        _mock_service_keys(monkeypatch)
        _set_live_env(monkeypatch, server["base_url"])

        result = CliRunner().invoke(cli, ["--json", "doctor"])
        assert result.exit_code == 0

        payload = json.loads(result.output)["data"]
        assert payload["status"] == "ready"
        assert payload["scaffold_only"] is False
        assert payload["config"]["runtime"]["live_read_available"] is True
        assert payload["recommendations"][0] == "Use workflow.list, workflow.status, and workflow.trigger as live commands."
        assert payload["permissions"] == [
            "capabilities",
            "config.show",
            "doctor",
            "health",
            "workflow.list",
            "workflow.status",
            "workflow.trigger",
        ]


def test_workflow_list_fetches_live_workflows_and_builds_picker_options(monkeypatch):
    with mock_n8n_server() as server:
        _mock_service_keys(monkeypatch)
        _set_live_env(monkeypatch, server["base_url"])

        result = CliRunner().invoke(cli, ["--json", "workflow", "list", "--limit", "2", "--status", "active"])
        assert result.exit_code == 0

        payload = json.loads(result.output)["data"]
        assert payload["status"] == "live"
        assert payload["scaffold_only"] is False
        assert payload["executed"] is True
        assert payload["count"] == 2
        assert payload["filters"]["requested_status"] == "active"
        assert payload["filters"]["active_only"] is True
        assert payload["workflows"][0]["name"] == "Onboarding Sync"
        assert payload["workflow_candidates"][0]["label"] == "Onboarding Sync"
        assert payload["workflow_candidates"][0]["subtitle"].startswith("active")
        assert payload["scope_preview"]["live_backend_available"] is True
        assert payload["scope_preview"]["trigger_builder"]["event_hints"][0]["value"] == "manual"
        assert payload["write_bridge_available"] is True
        assert payload["live_backend_available"] is True

        assert any(
            request["path"] == "/api/v1/workflows"
            and request["query"] == "limit=1&active=true"
            and request["auth"] == "super-secret-key"
            for request in server["requests"]
        )
        assert any(
            request["path"] == "/api/v1/workflows"
            and request["query"] == "limit=2&active=true"
            and request["auth"] == "super-secret-key"
            for request in server["requests"]
        )


def test_workflow_status_uses_configured_workflow_target(monkeypatch):
    with mock_n8n_server() as server:
        _mock_service_keys(monkeypatch)
        _set_live_env(monkeypatch, server["base_url"])

        result = CliRunner().invoke(cli, ["--json", "workflow", "status"])
        assert result.exit_code == 0

        payload = json.loads(result.output)["data"]
        assert payload["workflow"]["id"] == "workflow-123"
        assert payload["workflow"]["name"] == "Onboarding Sync"
        assert payload["workflow"]["status"] == "active"
        assert payload["resolved_target"]["selector"] == "workflow_name"
        assert payload["scope_preview"]["operation"] == "status"
        assert payload["picker_options"][0]["value"] == "workflow-123"
        assert payload["matches_requested_status"] is None
        assert payload["trigger_builder"]["request_template"]["workflow"]["workflow_name"] == "Onboarding Sync"
        assert payload["write_bridge_available"] is True
        assert payload["live_backend_available"] is True

        assert any(
            request["method"] == "GET"
            and request["path"] == "/api/v1/workflows"
            and request["query"] == "limit=1&active=true"
            for request in server["requests"]
        )
        assert any(
            request["method"] == "GET"
            and request["path"] == "/api/v1/workflows"
            and request["query"] == "limit=1000"
            for request in server["requests"]
        )
        assert any(request["method"] == "GET" and request["path"] == "/api/v1/workflows/workflow-123" for request in server["requests"])


def test_workflow_list_reports_config_error_when_setup_is_missing(monkeypatch):
    _mock_service_keys(monkeypatch)
    monkeypatch.delenv("N8N_API_URL", raising=False)
    monkeypatch.delenv("N8N_API_KEY", raising=False)
    result = CliRunner().invoke(cli, ["--json", "workflow", "list"])
    assert result.exit_code == 4
    payload = json.loads(result.output)
    assert payload["ok"] is False
    assert payload["error"]["code"] == "N8N_SETUP_REQUIRED"


def test_workflow_trigger_requires_write_mode(monkeypatch):
    _mock_service_keys(monkeypatch)
    result = CliRunner().invoke(cli, ["--json", "--mode", "readonly", "workflow", "trigger", "workflow-123"])
    assert result.exit_code == 3
    payload = json.loads(result.output)
    assert payload["ok"] is False
    assert payload["error"]["code"] == "PERMISSION_DENIED"
    assert payload["error"]["details"]["required_mode"] == "write"


def test_workflow_trigger_executes_bridge_and_posts_payload(monkeypatch):
    with mock_n8n_server() as server:
        _mock_service_keys(monkeypatch)
        _set_live_env(monkeypatch, server["base_url"])

        result = CliRunner().invoke(
            cli,
            ["--json", "--mode", "write", "workflow", "trigger", "workflow-123", "--event", "manual", "--payload", "source=agent"],
        )
        assert result.exit_code == 0

        payload = json.loads(result.output)["data"]
        assert payload["status"] == "triggered"
        assert payload["executed"] is True
        assert payload["live_backend_available"] is True
        assert payload["write_bridge_available"] is True
        assert payload["workflow"]["workflow_id"] == "workflow-123"
        assert payload["request"]["event"] == "manual"
        assert payload["request"]["payload"] == {"source": "agent"}
        assert payload["bridge"]["ok"] is True
        assert payload["bridge"]["execution_id"] == "exec-123"
        assert payload["bridge"]["response_status"] == "queued"
        assert payload["response_normalized"]["summary"] == "Triggered execution exec-123 (queued)."
        assert payload["trigger_builder"]["request_template"]["payload"] == {"source": "agent"}
        assert payload["trigger_builder"]["response_hints"]["normalized_fields"][0] == "ok"

        assert any(
            request["method"] == "POST"
            and request["path"] == "/aos-n8n/workflow-trigger"
            and request["auth"] is None
            and request["content_type"] == "application/json"
            and request["body"]["event"] == "manual"
            and request["body"]["payload"] == {"source": "agent"}
            and request["body"]["workflow"]["workflow_id"] == "workflow-123"
            for request in server["requests"]
        )
