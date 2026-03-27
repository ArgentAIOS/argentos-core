from __future__ import annotations

import json
from pathlib import Path
from typing import Any

from click.testing import CliRunner

import cli_aos.blacksmith.runtime as runtime
from cli_aos.blacksmith.cli import cli


AGENT_HARNESS_ROOT = Path(__file__).resolve().parents[1]
CONNECTOR_PATH = AGENT_HARNESS_ROOT.parent / "connector.json"
PERMISSIONS_PATH = AGENT_HARNESS_ROOT / "permissions.json"


class FakeBlacksmithClient:
    def list_runners(self) -> dict[str, Any]:
        return {
            "runners": [
                {"id": "runner-1", "name": "linux-x64", "status": "idle", "raw": {}},
                {"id": "runner-2", "name": "macos-arm", "status": "busy", "raw": {}},
            ],
            "count": 2,
            "raw": {},
        }

    def runner_status(self) -> dict[str, Any]:
        return {
            "status": "healthy",
            "runners": [{"id": "runner-1", "name": "linux-x64", "status": "idle", "raw": {}}],
            "raw": {},
        }

    def list_builds(self, *, repo: str | None = None, workflow_name: str | None = None, limit: int = 10) -> dict[str, Any]:
        return {
            "builds": [
                {"id": "build-1", "workflow": workflow_name or "ci", "status": "success", "run_id": "run-1", "raw": {"repo": repo}},
                {"id": "build-2", "workflow": workflow_name or "ci", "status": "failed", "run_id": "run-2", "raw": {"repo": repo}},
            ][:limit],
            "count": 2,
            "raw": {},
        }

    def get_build(self, *, run_id: str) -> dict[str, Any]:
        return {"build": {"id": run_id, "workflow": "ci", "status": "success", "raw": {}}, "raw": {}}

    def get_build_logs(self, *, run_id: str) -> dict[str, Any]:
        return {"run_id": run_id, "logs": "line 1\nline 2\n", "bytes_count": 14, "content_type": "text/plain", "raw": {}}

    def list_cache(self, *, repo: str | None = None) -> dict[str, Any]:
        return {
            "entries": [
                {"id": "cache-1", "name": "deps-cache", "status": "hit", "raw": {"repo": repo}},
                {"id": "cache-2", "name": "build-cache", "status": "miss", "raw": {"repo": repo}},
            ],
            "count": 2,
            "raw": {},
        }

    def cache_stats(self, *, repo: str | None = None) -> dict[str, Any]:
        return {"repo": repo, "stats": {"hits": 42, "misses": 7}, "raw": {}}

    def usage_summary(self, *, date_range: str | None = None) -> dict[str, Any]:
        return {"summary": {"date_range": date_range or "last_7_days", "minutes": 128}, "raw": {}}

    def usage_billing(self, *, date_range: str | None = None) -> dict[str, Any]:
        return {"billing": {"date_range": date_range or "last_7_days", "cost_usd": 12.34}, "raw": {}}


def invoke_json(args: list[str]) -> dict[str, Any]:
    result = CliRunner().invoke(cli, ["--json", *args])
    assert result.exit_code == 0, result.output
    return json.loads(result.output)


def test_manifest_and_permissions_are_in_sync():
    manifest = json.loads(CONNECTOR_PATH.read_text())
    permissions = json.loads(PERMISSIONS_PATH.read_text())["permissions"]
    command_ids = [command["id"] for command in manifest["commands"]]
    assert set(command_ids) == set(permissions.keys())
    assert all(command["required_mode"] == "readonly" for command in manifest["commands"])


def test_capabilities_exposes_manifest():
    payload = invoke_json(["capabilities"])
    assert payload["tool"] == "aos-blacksmith"
    assert payload["data"]["backend"] == "blacksmith-api"
    assert "runner.list" in json.dumps(payload["data"])
    assert "usage.billing" in json.dumps(payload["data"])


def test_health_requires_credentials(monkeypatch):
    monkeypatch.delenv("BLACKSMITH_API_KEY", raising=False)
    payload = invoke_json(["health"])
    assert payload["data"]["status"] == "needs_setup"
    assert "BLACKSMITH_API_KEY" in json.dumps(payload["data"])


def test_health_ready_with_credentials(monkeypatch):
    monkeypatch.setenv("BLACKSMITH_API_KEY", "token-123")
    payload = invoke_json(["health"])
    assert payload["data"]["status"] == "ready"
    assert payload["data"]["probe"]["ok"] is True
    assert payload["data"]["connector"]["scaffold_only"] is True


def test_config_show_redacts_credentials(monkeypatch):
    monkeypatch.setenv("BLACKSMITH_API_KEY", "secret-token")
    payload = invoke_json(["config", "show"])
    encoded = json.dumps(payload["data"])
    assert "secret-token" not in encoded
    assert payload["data"]["auth"]["api_key_present"] is True


def test_runner_list_uses_fake_client(monkeypatch):
    monkeypatch.setenv("BLACKSMITH_API_KEY", "token-123")
    monkeypatch.setattr(runtime, "create_client", lambda ctx_obj: FakeBlacksmithClient())
    payload = invoke_json(["runner", "list"])
    assert len(payload["data"]["runners"]) == 2
    assert payload["data"]["picker"]["kind"] == "blacksmith_runner"


def test_build_get_uses_fake_client(monkeypatch):
    monkeypatch.setenv("BLACKSMITH_API_KEY", "token-123")
    monkeypatch.setenv("BLACKSMITH_RUN_ID", "run-env")
    monkeypatch.setattr(runtime, "create_client", lambda ctx_obj: FakeBlacksmithClient())
    payload = invoke_json(["build", "get"])
    assert payload["data"]["build"]["id"] == "run-env"
    assert payload["data"]["scope_preview"]["command_id"] == "build.get"


def test_build_logs_uses_fake_client(monkeypatch):
    monkeypatch.setenv("BLACKSMITH_API_KEY", "token-123")
    monkeypatch.setattr(runtime, "create_client", lambda ctx_obj: FakeBlacksmithClient())
    payload = invoke_json(["build", "logs", "run-7"])
    assert payload["data"]["logs"]["logs"].startswith("line 1")
    assert payload["data"]["scope_preview"]["command_id"] == "build.logs"


def test_usage_summary_uses_fake_client(monkeypatch):
    monkeypatch.setenv("BLACKSMITH_API_KEY", "token-123")
    monkeypatch.setattr(runtime, "create_client", lambda ctx_obj: FakeBlacksmithClient())
    payload = invoke_json(["usage", "summary", "--date-range", "last_30_days"])
    assert payload["data"]["usage_summary"]["date_range"] == "last_30_days"
    assert payload["data"]["scope_preview"]["command_id"] == "usage.summary"
