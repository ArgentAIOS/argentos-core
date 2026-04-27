from __future__ import annotations

import json
import subprocess
import threading
from contextlib import contextmanager
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Any
from urllib.parse import parse_qs, urlparse

from click.testing import CliRunner
import pytest

from cli_aos.make import config as make_config
from cli_aos.make.cli import cli
import cli_aos.make.service_keys as service_keys


AGENT_HARNESS_ROOT = Path(__file__).resolve().parents[1]
CONNECTOR_PATH = AGENT_HARNESS_ROOT.parent / "connector.json"
PERMISSIONS_PATH = AGENT_HARNESS_ROOT / "permissions.json"
ALL_ENV_KEYS = (
    "MAKE_API_URL",
    "MAKE_API_KEY",
    "MAKE_WEBHOOK_BASE_URL",
    "MAKE_ORGANIZATION_ID",
    "MAKE_ORGANIZATION_NAME",
    "MAKE_TEAM_ID",
    "MAKE_TEAM_NAME",
    "MAKE_SCENARIO_ID",
    "MAKE_SCENARIO_NAME",
    "MAKE_SCENARIO_STATUS",
    "MAKE_CONNECTION_ID",
    "MAKE_CONNECTION_NAME",
    "MAKE_EXECUTION_ID",
    "MAKE_RUN_ID",
)

LIVE_ORGANIZATIONS = [
    {"id": "org-123", "name": "Ops Org", "status": "active"},
    {"id": "org-456", "name": "Creative Org", "status": "active"},
]
LIVE_TEAMS = [
    {"id": "team-123", "name": "Ops Team", "organization_name": "Ops Org", "status": "active"},
    {"id": "team-456", "name": "Support Team", "organization_name": "Ops Org", "status": "active"},
]
LIVE_SCENARIOS = [
    {
        "id": "scenario-123",
        "name": "Onboarding Sync",
        "status": "active",
        "organization_name": "Ops Org",
        "team_name": "Ops Team",
        "last_run_at": "2026-03-19T10:00:00Z",
    },
    {
        "id": "scenario-456",
        "name": "Daily Digest",
        "status": "active",
        "organization_name": "Ops Org",
        "team_name": "Ops Team",
        "last_run_at": "2026-03-19T11:00:00Z",
    },
]
LIVE_CONNECTIONS = [
    {"id": "conn-123", "name": "HubSpot", "status": "connected", "organization_name": "Ops Org"},
    {"id": "conn-456", "name": "Slack", "status": "connected", "organization_name": "Ops Org"},
]
LIVE_EXECUTIONS = [
    {
        "id": "exec-123",
        "scenario_id": "scenario-123",
        "scenario_name": "Onboarding Sync",
        "status": "queued",
        "started_at": "2026-03-19T12:00:00Z",
    },
    {
        "id": "exec-456",
        "scenario_id": "scenario-456",
        "scenario_name": "Daily Digest",
        "status": "success",
        "started_at": "2026-03-19T11:30:00Z",
    },
]


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


class MockMakeHandler(BaseHTTPRequestHandler):
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

    def _record(self, method: str, body: Any | None = None) -> tuple[str, dict[str, list[str]]]:
        parsed = urlparse(self.path)
        query = parse_qs(parsed.query)
        self.__class__.requests.append(
            {
                "method": method,
                "path": parsed.path,
                "query": parsed.query,
                "params": query,
                "auth": self.headers.get("Authorization"),
                "api_key": self.headers.get("X-MAKE-API-KEY"),
                "webhook_base": self.headers.get("X-Webhook-Base-Url"),
                "content_type": self.headers.get("Content-Type"),
                "body": body,
            }
        )
        return parsed.path, query

    def do_OPTIONS(self) -> None:  # noqa: N802
        path, _query = self._record("OPTIONS")
        if path in {"/api/v1/scenarios/scenario-123/execute", "/api/v1/executions/run"}:
            self.send_response(204)
            self.send_header("Allow", "OPTIONS, POST")
            self.end_headers()
            return
        self._send_json(404, {"message": "not found"})

    def do_GET(self) -> None:  # noqa: N802
        path, query = self._record("GET")
        if path == "/health":
            self._send_json(200, {"ok": True, "status": "ready"})
            return
        if path == "/api/v1/organizations" and query.get("limit") == ["2"]:
            self._send_json(200, {"organizations": LIVE_ORGANIZATIONS})
            return
        if path == "/api/v1/teams" and query.get("limit") == ["2"]:
            self._send_json(200, {"teams": LIVE_TEAMS})
            return
        if path == "/api/v1/scenarios" and query.get("limit") == ["2"] and query.get("status") == ["active"]:
            self._send_json(200, {"scenarios": LIVE_SCENARIOS})
            return
        if path == "/api/v1/scenarios/scenario-123":
            self._send_json(200, {"scenario": LIVE_SCENARIOS[0]})
            return
        if path == "/api/v1/connections" and query.get("limit") == ["2"]:
            self._send_json(200, {"connections": LIVE_CONNECTIONS})
            return
        if path == "/api/v1/executions" and query.get("limit") == ["2"] and query.get("scenario_id") == ["scenario-123"]:
            self._send_json(200, {"executions": [LIVE_EXECUTIONS[0]]})
            return
        if path == "/api/v1/executions/exec-123":
            self._send_json(200, {"execution": LIVE_EXECUTIONS[0]})
            return
        self._send_json(404, {"message": "not found"})

    def do_POST(self) -> None:  # noqa: N802
        content_length = int(self.headers.get("Content-Length") or "0")
        body_text = self.rfile.read(content_length).decode("utf-8") if content_length else ""
        body = json.loads(body_text) if body_text else {}
        path, _query = self._record("POST", body=body)

        if path == "/api/v1/scenarios/scenario-123/execute":
            self._send_json(200, {"status": "queued", "executionId": "exec-123", "result": "accepted"})
            return
        if path == "/api/v1/executions/run":
            self._send_json(200, {"status": "queued", "executionId": "exec-999", "result": "accepted"})
            return
        self._send_json(404, {"message": "not found"})


@contextmanager
def mock_make_server():
    MockMakeHandler.requests = []
    server = ThreadingHTTPServer(("127.0.0.1", 0), MockMakeHandler)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    try:
        yield {
            "base_url": f"http://127.0.0.1:{server.server_address[1]}",
            "requests": MockMakeHandler.requests,
        }
    finally:
        server.shutdown()
        server.server_close()
        thread.join(timeout=5)


def _set_live_env(monkeypatch, base_url: str) -> None:
    monkeypatch.setenv("MAKE_API_URL", base_url)
    monkeypatch.setenv("MAKE_API_KEY", "make-secret-key")
    monkeypatch.setenv("MAKE_WEBHOOK_BASE_URL", f"{base_url}/hooks")
    monkeypatch.setenv("MAKE_ORGANIZATION_NAME", "Ops Org")
    monkeypatch.setenv("MAKE_TEAM_NAME", "Ops Team")
    monkeypatch.setenv("MAKE_SCENARIO_ID", "scenario-123")
    monkeypatch.setenv("MAKE_SCENARIO_NAME", "Onboarding Sync")
    monkeypatch.setenv("MAKE_SCENARIO_STATUS", "active")
    monkeypatch.setenv("MAKE_CONNECTION_NAME", "HubSpot")
    monkeypatch.setenv("MAKE_EXECUTION_ID", "exec-123")
    monkeypatch.setenv("MAKE_RUN_ID", "exec-123")


def invoke_json(args: list[str]) -> dict[str, Any]:
    result = CliRunner().invoke(cli, ["--json", *args])
    assert result.exit_code == 0, result.output
    return json.loads(result.output)


def test_manifest_and_permissions_are_in_sync():
    manifest = json.loads(CONNECTOR_PATH.read_text())
    permissions = json.loads(PERMISSIONS_PATH.read_text())["permissions"]
    manifest_command_ids = [command["id"] for command in manifest["commands"]]

    assert set(manifest_command_ids) == set(permissions.keys())
    assert "scenario.list" in manifest_command_ids
    assert "scenario.trigger" in manifest_command_ids
    assert "execution.run" in manifest_command_ids
    assert manifest["backend"] == "make-live-bridge"
    assert manifest["scope"]["live_read_available"] is True
    assert manifest["scope"]["write_bridge_available"] is True
    assert manifest["scope"]["live_write_smoke_tested"] is False
    assert manifest["scope"]["required"] == ["MAKE_API_URL", "MAKE_API_KEY"]
    assert manifest["scope"]["write_bridge_available"] is True


def test_capabilities_json_matches_manifest():
    result = CliRunner().invoke(cli, ["--json", "capabilities"])
    assert result.exit_code == 0

    envelope = json.loads(result.output)
    payload = envelope["data"]
    manifest = json.loads(CONNECTOR_PATH.read_text())

    assert envelope["tool"] == "aos-make"
    assert envelope["command"] == "capabilities"
    assert payload["tool"] == manifest["tool"]
    assert payload["backend"] == manifest["backend"]
    assert payload["manifest_schema_version"] == manifest["manifest_schema_version"]
    assert payload["connector"] == manifest["connector"]
    assert payload["scope"] == manifest["scope"]
    assert payload["auth"] == manifest["auth"]
    assert payload["commands"] == manifest["commands"]


def test_health_reports_needs_setup_without_env(monkeypatch):
    for key in (
        "MAKE_API_URL",
        "MAKE_API_KEY",
        "MAKE_WEBHOOK_BASE_URL",
        "MAKE_ORGANIZATION_NAME",
        "MAKE_TEAM_NAME",
        "MAKE_SCENARIO_ID",
        "MAKE_SCENARIO_NAME",
        "MAKE_SCENARIO_STATUS",
        "MAKE_CONNECTION_NAME",
        "MAKE_EXECUTION_ID",
        "MAKE_RUN_ID",
    ):
        monkeypatch.delenv(key, raising=False)

    payload = invoke_json(["health"])
    assert payload["data"]["status"] == "needs_setup"
    assert payload["data"]["live_backend_available"] is False
    assert payload["data"]["write_bridge_available"] is False
    assert "MAKE_API_URL" in payload["data"]["checks"][0]["details"]["missing_keys"]


def test_config_show_reports_live_bridges_truthfully(monkeypatch):
    with mock_make_server() as server:
        _set_live_env(monkeypatch, server["base_url"])

        result = CliRunner().invoke(cli, ["--json", "config", "show"])
        assert result.exit_code == 0
        assert "make-secret-key" not in result.output

        payload = json.loads(result.output)["data"]
        assert payload["backend"] == "make-live-bridge"
        assert payload["runtime_ready"] is True
        assert payload["live_backend_available"] is True
        assert payload["live_read_available"] is True
        assert payload["write_bridge_available"] is True
        assert payload["scaffold_only"] is False
        assert payload["api_probe"]["ok"] is True
        assert payload["write_probe"]["ok"] is True
        assert payload["auth"]["sources"]["MAKE_API_URL"] == "env_fallback"
        assert payload["auth"]["sources"]["MAKE_API_KEY"] == "env_fallback"


def test_config_show_prefers_operator_service_keys_over_local_env(monkeypatch, tmp_path):
    with mock_make_server() as server:
        monkeypatch.setenv("MAKE_API_URL", "https://env.example.com")
        monkeypatch.setenv("MAKE_API_KEY", "env-secret-key")
        monkeypatch.setenv("MAKE_WEBHOOK_BASE_URL", "https://env-hooks.example.com")
        monkeypatch.setattr(
            service_keys,
            "SERVICE_KEYS_PATH",
            write_service_keys(
                tmp_path,
                {
                    "MAKE_API_URL": server["base_url"],
                    "MAKE_API_KEY": "operator-make-key",
                    "MAKE_WEBHOOK_BASE_URL": f"{server['base_url']}/hooks",
                },
            ),
        )

        payload = invoke_json(["config", "show"])
        serialized = json.dumps(payload)
        assert "operator-make-key" not in serialized
        assert "env-secret-key" not in serialized
        assert payload["data"]["auth"]["sources"]["MAKE_API_URL"] == "repo-service-key"
        assert payload["data"]["auth"]["sources"]["MAKE_API_KEY"] == "repo-service-key"
        assert any(
            request["method"] == "GET"
            and request["path"] == "/health"
            and request["api_key"] == "operator-make-key"
            for request in server["requests"]
        )


def test_encrypted_repo_service_key_decrypts_with_master_key(monkeypatch, tmp_path):
    home = tmp_path / "home"
    key_dir = home / ".argentos"
    key_dir.mkdir(parents=True, exist_ok=True)
    (key_dir / ".master-key").write_text("11" * 32)
    monkeypatch.setenv("HOME", str(home))
    encrypted = encrypt_secret(tmp_path, "operator-make-key")
    monkeypatch.setattr(
        service_keys,
        "SERVICE_KEYS_PATH",
        write_service_keys(tmp_path, {"MAKE_API_KEY": encrypted}),
    )

    runtime = make_config.resolve_runtime_values({})
    assert runtime["api_key"] == "operator-make-key"
    assert runtime["api_key_source"] == "repo-service-key"
    assert runtime["api_key_usable"] is True


def test_unreadable_encrypted_repo_service_key_falls_back_to_env_like_core_resolver(monkeypatch, tmp_path):
    monkeypatch.setenv("MAKE_API_KEY", "env-make-key")
    monkeypatch.setattr(
        service_keys,
        "SERVICE_KEYS_PATH",
        write_service_keys(tmp_path, {"MAKE_API_KEY": "enc:v1:abc:def:ghi"}),
    )

    runtime = make_config.resolve_runtime_values({})
    assert runtime["api_key"] == "env-make-key"
    assert runtime["api_key_source"] == "env_fallback"
    assert runtime["api_key_usable"] is True


def test_scoped_repo_service_key_blocks_env_fallback(monkeypatch, tmp_path):
    monkeypatch.setenv("MAKE_API_KEY", "env-make-key")
    monkeypatch.setattr(
        service_keys,
        "SERVICE_KEYS_PATH",
        write_service_keys(tmp_path, {"MAKE_API_KEY": "repo-make-key"}, extra={"allowedRoles": ["operator"]}),
    )

    runtime = make_config.resolve_runtime_values({})
    assert runtime["api_key"] is None
    assert runtime["api_key_source"] == "repo-service-key-scoped"
    assert runtime["api_key_usable"] is False


def test_organization_and_team_lists_use_live_api(monkeypatch):
    with mock_make_server() as server:
        _set_live_env(monkeypatch, server["base_url"])

        org_payload = invoke_json(["organization", "list", "--limit", "2"])
        team_payload = invoke_json([
            "team",
            "list",
            "--limit",
            "2",
            "--organization-name",
            "Ops Org",
        ])

        assert org_payload["data"]["count"] == 2
        assert team_payload["data"]["count"] == 2
        assert any(
            request["method"] == "GET"
            and request["path"] == "/api/v1/organizations"
            and request["params"].get("limit") == ["2"]
            and request["api_key"] == "make-secret-key"
            for request in server["requests"]
        )
        assert any(
            request["method"] == "GET"
            and request["path"] == "/api/v1/teams"
            and request["params"].get("organization_name") == ["Ops Org"]
            for request in server["requests"]
        )


def test_live_read_uses_operator_context_keys():
    with mock_make_server() as server:
        result = CliRunner().invoke(
            cli,
            ["--json", "organization", "list", "--limit", "2"],
            obj={
                "service_keys": {
                    "aos-make": {
                        "api_url": server["base_url"],
                        "api_key": "operator-context-key",
                        "webhook_base_url": f"{server['base_url']}/hooks",
                    }
                }
            },
        )

        assert result.exit_code == 0
        payload = json.loads(result.output)["data"]
        assert payload["count"] == 2
        assert any(
            request["method"] == "GET"
            and request["path"] == "/api/v1/organizations"
            and request["api_key"] == "operator-context-key"
            for request in server["requests"]
        )


def test_scenario_and_execution_reads_use_live_api(monkeypatch):
    with mock_make_server() as server:
        _set_live_env(monkeypatch, server["base_url"])

        scenario_list_payload = invoke_json(["scenario", "list", "--limit", "2", "--status", "active"])
        scenario_status_payload = invoke_json(["scenario", "status", "scenario-123"])
        connection_payload = invoke_json(["connection", "list", "--limit", "2"])
        execution_list_payload = invoke_json([
            "execution",
            "list",
            "--limit",
            "2",
            "--scenario-id",
            "scenario-123",
        ])
        execution_status_payload = invoke_json(["execution", "status", "exec-123"])

        assert scenario_list_payload["data"]["count"] == 2
        assert scenario_status_payload["data"]["scenario"]["id"] == "scenario-123"
        assert connection_payload["data"]["count"] == 2
        assert execution_list_payload["data"]["count"] == 1
        assert execution_status_payload["data"]["execution"]["id"] == "exec-123"
        assert any(request["method"] == "GET" and request["path"] == "/api/v1/scenarios/scenario-123" for request in server["requests"])
        assert any(request["method"] == "GET" and request["path"] == "/api/v1/executions/exec-123" for request in server["requests"])


def test_scenario_trigger_posts_live_payload(monkeypatch):
    with mock_make_server() as server:
        _set_live_env(monkeypatch, server["base_url"])

        payload = invoke_json([
            "--mode",
            "write",
            "scenario",
            "trigger",
            "scenario-123",
            "--event",
            "manual",
            "--payload",
            "source=agent",
            "--payload",
            "reason=follow-up",
            "--organization-name",
            "CLI Org",
            "--team-name",
            "CLI Team",
            "--connection-id",
            "cli-conn",
        ])

        assert payload["data"]["execution"]["ok"] is True
        assert payload["data"]["execution"]["execution_id"] == "exec-123"
        assert any(
            request["method"] == "POST"
            and request["path"] == "/api/v1/scenarios/scenario-123/execute"
            and request["body"]["payload"] == {"source": "agent", "reason": "follow-up"}
            and request["body"]["organization_name"] == "CLI Org"
            and request["body"]["team_name"] == "CLI Team"
            and request["body"]["connection_id"] == "cli-conn"
            for request in server["requests"]
        )


def test_live_write_uses_operator_context_keys():
    with mock_make_server() as server:
        result = CliRunner().invoke(
            cli,
            [
                "--json",
                "--mode",
                "write",
                "scenario",
                "trigger",
                "scenario-123",
                "--event",
                "manual",
                "--payload",
                "source=operator",
            ],
            obj={
                "service_keys": {
                    "aos-make": {
                        "api_url": server["base_url"],
                        "api_key": "operator-write-key",
                        "webhook_base_url": f"{server['base_url']}/hooks",
                        "scenario_id": "scenario-123",
                    }
                }
            },
        )

        assert result.exit_code == 0
        payload = json.loads(result.output)["data"]
        assert payload["execution"]["execution_id"] == "exec-123"
        assert any(
            request["method"] == "OPTIONS"
            and request["path"] == "/api/v1/scenarios/scenario-123/execute"
            and request["api_key"] == "operator-write-key"
            for request in server["requests"]
        )
        assert any(
            request["method"] == "POST"
            and request["path"] == "/api/v1/scenarios/scenario-123/execute"
            and request["api_key"] == "operator-write-key"
            and request["body"]["payload"] == {"source": "operator"}
            for request in server["requests"]
        )


def test_execution_run_posts_live_payload_without_scenario_id(monkeypatch):
    with mock_make_server() as server:
        _set_live_env(monkeypatch, server["base_url"])

        payload = invoke_json([
            "--mode",
            "write",
            "execution",
            "run",
            "--event",
            "replay",
            "--payload-json",
            '{"source":"agent","reason":"replay"}',
        ])

        assert payload["data"]["run"]["ok"] is True
        assert payload["data"]["run"]["execution_id"] == "exec-999"
        assert any(
            request["method"] == "POST"
            and request["path"] == "/api/v1/executions/run"
            and request["body"]["payload"] == {"source": "agent", "reason": "replay"}
            for request in server["requests"]
        )
