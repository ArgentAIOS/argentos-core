from __future__ import annotations

import json
from pathlib import Path
from typing import Any

from click.testing import CliRunner

from cli_aos.coderabbit.cli import cli
import cli_aos.coderabbit.runtime as runtime


AGENT_HARNESS_ROOT = Path(__file__).resolve().parents[1]
CONNECTOR_PATH = AGENT_HARNESS_ROOT.parent / "connector.json"
PERMISSIONS_PATH = AGENT_HARNESS_ROOT / "permissions.json"


class FakeCodeRabbitClient:
    def metrics_reviews(
        self,
        *,
        start_date: str,
        end_date: str,
        organization_ids: str | None = None,
        repository_ids: str | None = None,
        user_ids: str | None = None,
        format: str = "json",
        limit: int = 1000,
        cursor: str | None = None,
    ) -> dict[str, Any]:
        reports = [
            {
                "pr_url": "https://github.com/ArgentAIOS/argentos/pull/42",
                "author_id": "user-1",
                "author_username": "ada",
                "organization_id": "org-1",
                "organization_name": "ArgentAIOS",
                "repository_id": "repo-1",
                "repository_name": "argentos",
                "created_at": "2026-03-20T00:00:00Z",
                "estimated_complexity": 7,
                "estimated_review_minutes": 12,
                "coderabbit_comments": {"total": {"posted": 3, "accepted": 2}},
            }
        ]
        return {"reports": reports[:limit], "next_cursor": "cursor-1", "raw": {"data": reports}}

    def report_generate(self, payload: dict[str, Any]) -> list[dict[str, Any]]:
        return [
            {"group": "Developer Activity", "report": f"Generated report for {payload['from']} to {payload['to']}"},
            {"group": "Code Quality", "report": "No critical issues found."},
        ]


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
    assert manifest["scope"]["kind"] == "code-review"


def test_capabilities_exposes_manifest():
    payload = invoke_json(["capabilities"])
    assert payload["tool"] == "aos-coderabbit"
    assert payload["data"]["backend"] == "coderabbit-api"
    assert "review.request" in json.dumps(payload["data"])
    assert "report.list" in json.dumps(payload["data"])


def test_health_requires_credentials(monkeypatch):
    monkeypatch.delenv("CODERABBIT_API_KEY", raising=False)
    payload = invoke_json(["health"])
    assert payload["data"]["status"] == "needs_setup"
    assert "CODERABBIT_API_KEY" in json.dumps(payload["data"])


def test_health_ready_with_fake_client(monkeypatch):
    monkeypatch.setenv("CODERABBIT_API_KEY", "cr-secret")
    monkeypatch.setenv("CODERABBIT_REPO", "ArgentAIOS/argentos")
    monkeypatch.setattr(runtime, "create_client", lambda ctx_obj: FakeCodeRabbitClient())
    payload = invoke_json(["health"])
    assert payload["data"]["status"] == "ready"
    assert payload["data"]["probe"]["ok"] is True
    assert payload["data"]["probe"]["details"]["report_count"] == 1


def test_config_show_redacts_credentials(monkeypatch):
    monkeypatch.setenv("CODERABBIT_API_KEY", "secret-token")
    monkeypatch.setenv("CODERABBIT_REPO", "ArgentAIOS/argentos")
    monkeypatch.setattr(runtime, "probe_runtime", lambda _config: {"ok": True, "code": "OK", "message": "probe ok", "details": {"report_count": 1}})
    payload = invoke_json(["config", "show"])
    assert "secret-token" not in json.dumps(payload["data"])
    assert payload["data"]["scope"]["repo"] == "ArgentAIOS/argentos"


def test_review_request_requires_write_mode(monkeypatch):
    monkeypatch.setenv("CODERABBIT_API_KEY", "secret-token")
    monkeypatch.setenv("CODERABBIT_REPO", "ArgentAIOS/argentos")
    result = CliRunner().invoke(cli, ["--json", "--mode", "readonly", "review", "request"])
    payload = json.loads(result.output)
    assert result.exit_code == 3
    assert payload["error"]["code"] == "PERMISSION_DENIED"


def test_review_request_writes_local_bridge_state(monkeypatch, tmp_path):
    monkeypatch.setenv("CODERABBIT_API_KEY", "secret-token")
    monkeypatch.setenv("CODERABBIT_REPO", "ArgentAIOS/argentos")
    monkeypatch.setenv("CODERABBIT_STATE_PATH", str(tmp_path / "state.json"))
    payload = invoke_json_with_mode("write", ["review", "request", "--pr-number", "42", "--full-review"])
    assert payload["data"]["status"] == "requested"
    state = json.loads(Path(tmp_path / "state.json").read_text())
    assert state["last_request"]["pr_number"] == "42"
    assert state["last_request"]["full_review"] is True


def test_review_status_uses_bridge_state(monkeypatch, tmp_path):
    monkeypatch.setenv("CODERABBIT_API_KEY", "secret-token")
    monkeypatch.setenv("CODERABBIT_REPO", "ArgentAIOS/argentos")
    monkeypatch.setenv("CODERABBIT_STATE_PATH", str(tmp_path / "state.json"))
    payload = invoke_json_with_mode("write", ["review", "request", "--pr-number", "42"])
    review_id = payload["data"]["request"]["review_id"]
    status = invoke_json(["review", "status", "--review-id", review_id])
    assert status["data"]["review"]["review_id"] == review_id
    assert status["data"]["review"]["status"] == "requested"


def test_report_list_uses_live_metrics(monkeypatch):
    monkeypatch.setenv("CODERABBIT_API_KEY", "secret-token")
    monkeypatch.setenv("CODERABBIT_REPO", "ArgentAIOS/argentos")
    monkeypatch.setattr(runtime, "create_client", lambda ctx_obj: FakeCodeRabbitClient())
    payload = invoke_json(["report", "list", "--limit", "5"])
    assert payload["data"]["reports"][0]["repository_name"] == "argentos"
    assert payload["data"]["picker"]["kind"] == "report"
    assert payload["data"]["scope_preview"]["command_id"] == "report.list"


def test_report_get_generates_summary(monkeypatch):
    monkeypatch.setenv("CODERABBIT_API_KEY", "secret-token")
    monkeypatch.setenv("CODERABBIT_REPO", "ArgentAIOS/argentos")
    monkeypatch.setattr(runtime, "create_client", lambda ctx_obj: FakeCodeRabbitClient())
    payload = invoke_json(["report", "get"])
    assert "Generated report" in payload["data"]["report_markdown"]
    assert payload["data"]["scope_preview"]["command_id"] == "report.get"


def test_config_update_persists_repository_yaml(monkeypatch, tmp_path):
    monkeypatch.setenv("CODERABBIT_API_KEY", "secret-token")
    monkeypatch.setenv("CODERABBIT_REPO", "ArgentAIOS/argentos")
    monkeypatch.setenv("CODERABBIT_CONFIG_PATH", str(tmp_path / ".coderabbit.yaml"))
    payload = invoke_json_with_mode("write", ["config", "update", "--content", "reviews:\n  auto: true\n"])
    assert payload["data"]["status"] == "bridge_write"
    assert Path(tmp_path / ".coderabbit.yaml").read_text() == "reviews:\n  auto: true\n"
    config_payload = invoke_json(["config", "get"])
    assert "auto: true" in config_payload["data"]["config"]["content"]
