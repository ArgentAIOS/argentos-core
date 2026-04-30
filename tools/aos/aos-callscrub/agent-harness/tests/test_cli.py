from __future__ import annotations

import json
from pathlib import Path
import tempfile
from typing import Any

from click.testing import CliRunner

from cli_aos.callscrub.cli import cli
from cli_aos.callscrub.config import config_snapshot, resolve_runtime_values
import cli_aos.callscrub.runtime as runtime

AGENT_HARNESS_ROOT = Path(__file__).resolve().parents[1]
CONNECTOR_PATH = AGENT_HARNESS_ROOT.parent / "connector.json"
PERMISSIONS_PATH = AGENT_HARNESS_ROOT / "permissions.json"


class FakeCallScrubClient:
    def list_calls(self, *, team_id: str | None = None, agent_name: str | None = None, date_range: str | None = None, limit: int = 25) -> dict[str, Any]:
        calls = [
            {"id": "call_1", "agent_name": "Avery", "date": "2026-04-20", "score": 92, "disposition": "won"},
            {"id": "call_2", "agent_name": "Blake", "date": "2026-04-21", "score": 81, "disposition": "follow_up"},
        ]
        return {"calls": calls[:limit], "filters": {"team_id": team_id, "agent_name": agent_name, "date_range": date_range}}

    def get_call(self, call_id: str) -> dict[str, Any]:
        return {"id": call_id, "agent_name": "Avery", "score": 92}

    def get_transcript(self, call_id: str) -> dict[str, Any]:
        return {"call_id": call_id, "segments": [{"speaker": "agent", "text": "Thanks for calling."}]}

    def search_transcripts(self, *, query: str, limit: int = 20) -> dict[str, Any]:
        return {"results": [{"id": "call_1", "query": query, "snippet": "pricing objection"}][:limit]}

    def list_coaching(self, *, limit: int = 10) -> dict[str, Any]:
        return {"coaching": [{"id": "coach_1", "call_id": "call_1", "agent_name": "Avery", "summary": "Improve discovery"}][:limit]}

    def get_coaching(self, coaching_id: str) -> dict[str, Any]:
        return {"id": coaching_id, "summary": "Improve discovery"}

    def list_agents(self, *, limit: int = 50) -> dict[str, Any]:
        return {"agents": [{"id": "agent_1", "name": "Avery", "team": "Revenue", "avg_score": "92"}][:limit]}

    def agent_stats(self, *, agent_name: str, date_range: str | None = None) -> dict[str, Any]:
        return {"agent_name": agent_name, "date_range": date_range, "calls": 44, "avg_score": 90}

    def agent_scorecard(self, *, agent_name: str) -> dict[str, Any]:
        return {"agent_name": agent_name, "score": 92}

    def list_teams(self, *, limit: int = 20) -> dict[str, Any]:
        return {"teams": [{"id": "team_1", "name": "Revenue", "agent_count": "8", "avg_score": "88"}][:limit]}

    def team_stats(self, *, team_id: str, date_range: str | None = None) -> dict[str, Any]:
        return {"team_id": team_id, "date_range": date_range, "calls": 300}

    def list_reports(self, *, report_type: str | None = None, date_range: str | None = None, limit: int = 10) -> dict[str, Any]:
        return {"reports": [{"id": "report_1", "report_type": report_type or "weekly_scorecard", "date_range": date_range}][:limit]}


def invoke_json(args: list[str]) -> dict[str, Any]:
    result = CliRunner().invoke(cli, ["--json", *args])
    assert result.exit_code == 0, result.output
    return json.loads(result.output)


def test_manifest_and_permissions_are_in_sync() -> None:
    manifest = json.loads(CONNECTOR_PATH.read_text())
    permissions = json.loads(PERMISSIONS_PATH.read_text())["permissions"]
    command_ids = [command["id"] for command in manifest["commands"]]
    assert set(command_ids) == set(permissions.keys())
    assert {command["id"]: command["required_mode"] for command in manifest["commands"]} == permissions
    assert manifest["scope"]["kind"] == "sales-analytics"
    assert manifest["scope"]["scaffold_only"] is False
    assert manifest["scope"]["write_bridge_available"] is False


def test_manifest_has_no_write_commands() -> None:
    manifest = json.loads(CONNECTOR_PATH.read_text())
    assert all(command["action_class"] == "read" for command in manifest["commands"])
    assert all(command["required_mode"] == "readonly" for command in manifest["commands"])
    assert "call.upload" not in manifest["scope"]["worker_visible_actions"]
    assert "coaching.generate" not in manifest["scope"]["worker_visible_actions"]
    assert "report.generate" not in manifest["scope"]["worker_visible_actions"]


def test_worker_fields_cover_manifest_fields() -> None:
    manifest = json.loads(CONNECTOR_PATH.read_text())
    worker_fields = set(manifest["scope"]["workerFields"])
    field_ids = {field["id"] for field in manifest["scope"]["fields"]}
    assert field_ids <= worker_fields


def test_capabilities_exposes_read_only_truth() -> None:
    payload = invoke_json(["capabilities"])
    assert payload["data"]["tool"] == "aos-callscrub"
    assert payload["data"]["write_support"]["live_writes_enabled"] is False
    assert payload["data"]["write_support"]["scaffolded_commands"] == []
    assert payload["data"]["read_support"]["call.list"] is True


def test_health_requires_operator_service_keys(monkeypatch) -> None:
    monkeypatch.delenv("CALLSCRUB_API_KEY", raising=False)
    monkeypatch.delenv("CALLSCRUB_API_BASE_URL", raising=False)
    payload = invoke_json(["health"])
    assert payload["data"]["status"] == "needs_setup"
    assert set(payload["data"]["auth"]["missing_service_keys"]) == {"CALLSCRUB_API_KEY", "CALLSCRUB_API_BASE_URL"}


def test_operator_context_precedes_env(monkeypatch) -> None:
    monkeypatch.setenv("CALLSCRUB_API_KEY", "env-key")
    monkeypatch.setenv("CALLSCRUB_API_BASE_URL", "https://env.example.test")
    runtime_values = resolve_runtime_values({"service_keys": {"aos-callscrub": {"CALLSCRUB_API_KEY": "operator-key", "CALLSCRUB_API_BASE_URL": "https://operator.example.test"}}})
    assert runtime_values["api_key"] == "operator-key"
    assert runtime_values["api_base_url"] == "https://operator.example.test"
    assert runtime_values["details"]["CALLSCRUB_API_KEY"]["source"] == "operator:service_keys:tool"


def test_repo_service_key_precedes_env(monkeypatch) -> None:
    monkeypatch.setenv("CALLSCRUB_API_KEY", "env-key")
    monkeypatch.setenv("CALLSCRUB_API_BASE_URL", "https://env.example.test")
    monkeypatch.setattr("cli_aos.callscrub.service_keys.SERVICE_KEYS_PATH", _write_service_keys(monkeypatch, {"CALLSCRUB_API_KEY": "repo-key", "CALLSCRUB_API_BASE_URL": "https://repo.example.test"}))
    runtime_values = resolve_runtime_values()
    assert runtime_values["api_key"] == "repo-key"
    assert runtime_values["api_base_url"] == "https://repo.example.test"
    assert runtime_values["details"]["CALLSCRUB_API_KEY"]["source"] == "repo-service-key"


def test_operator_context_precedes_repo_service_key(monkeypatch) -> None:
    monkeypatch.setattr("cli_aos.callscrub.service_keys.SERVICE_KEYS_PATH", _write_service_keys(monkeypatch, {"CALLSCRUB_API_KEY": "repo-key", "CALLSCRUB_API_BASE_URL": "https://repo.example.test"}))
    runtime_values = resolve_runtime_values({"service_keys": {"aos-callscrub": {"api_key": "operator-key", "base_url": "https://operator.example.test"}}})
    assert runtime_values["api_key"] == "operator-key"
    assert runtime_values["api_base_url"] == "https://operator.example.test"
    assert runtime_values["details"]["CALLSCRUB_API_KEY"]["source"] == "operator:service_keys:tool"


def test_encrypted_repo_service_key_falls_back_to_env(monkeypatch) -> None:
    monkeypatch.setenv("CALLSCRUB_API_KEY", "env-key")
    monkeypatch.setenv("CALLSCRUB_API_BASE_URL", "https://env.example.test")
    monkeypatch.setattr("cli_aos.callscrub.service_keys.SERVICE_KEYS_PATH", _write_service_keys(monkeypatch, {"CALLSCRUB_API_KEY": "enc:v1:abc:def:ghi", "CALLSCRUB_API_BASE_URL": "enc:v1:abc:def:ghi"}))
    runtime_values = resolve_runtime_values()
    assert runtime_values["api_key"] == "env-key"
    assert runtime_values["api_base_url"] == "https://env.example.test"
    assert runtime_values["details"]["CALLSCRUB_API_KEY"]["source"] == "env_fallback"


def test_config_show_redacts_key_and_reports_sources(monkeypatch) -> None:
    monkeypatch.setenv("CALLSCRUB_API_KEY", "callscrub-secret")
    monkeypatch.setenv("CALLSCRUB_API_BASE_URL", "https://callscrub.example.test")
    payload = invoke_json(["config", "show"])
    assert "callscrub-secret" not in json.dumps(payload)
    assert payload["data"]["scope"]["api_key"] == "<redacted>"
    assert payload["data"]["scope"]["api_base_url"] == "https://callscrub.example.test"
    assert payload["data"]["runtime"]["implementation_mode"] == "live_read_only"


def test_config_snapshot_accepts_operator_scope_defaults() -> None:
    payload = config_snapshot({"service_keys": {"aos-callscrub": {"api_key": "operator-key", "base_url": "https://operator.example.test", "call_id": "call_1"}}})
    assert payload["scope"]["call_id"] == "call_1"
    assert payload["scope"]["call_id_source"] == "operator:service_keys:tool"


def test_call_list_returns_picker_metadata(monkeypatch) -> None:
    monkeypatch.setenv("CALLSCRUB_API_KEY", "callscrub-key")
    monkeypatch.setenv("CALLSCRUB_API_BASE_URL", "https://callscrub.example.test")
    monkeypatch.setattr(runtime, "create_client", lambda ctx_obj: FakeCallScrubClient())
    payload = invoke_json(["call", "list", "--limit", "1"])
    assert payload["data"]["call_count"] == 1
    assert payload["data"]["picker"]["kind"] == "call"
    assert payload["data"]["picker"]["items"][0]["value"] == "call_1"


def test_call_get_uses_scoped_call(monkeypatch) -> None:
    monkeypatch.setenv("CALLSCRUB_API_KEY", "callscrub-key")
    monkeypatch.setenv("CALLSCRUB_API_BASE_URL", "https://callscrub.example.test")
    monkeypatch.setenv("CALLSCRUB_CALL_ID", "call_1")
    monkeypatch.setattr(runtime, "create_client", lambda ctx_obj: FakeCallScrubClient())
    payload = invoke_json(["call", "get"])
    assert payload["data"]["call"]["id"] == "call_1"
    assert payload["data"]["scope_preview"]["call_id"] == "call_1"


def test_transcript_search_uses_scope_query(monkeypatch) -> None:
    monkeypatch.setenv("CALLSCRUB_API_KEY", "callscrub-key")
    monkeypatch.setenv("CALLSCRUB_API_BASE_URL", "https://callscrub.example.test")
    monkeypatch.setenv("CALLSCRUB_SEARCH_QUERY", "pricing objection")
    monkeypatch.setattr(runtime, "create_client", lambda ctx_obj: FakeCallScrubClient())
    payload = invoke_json(["transcript", "search"])
    assert payload["data"]["result_count"] == 1
    assert payload["data"]["scope_preview"]["query"] == "pricing objection"


def test_agent_stats_uses_scope_defaults(monkeypatch) -> None:
    monkeypatch.setenv("CALLSCRUB_API_KEY", "callscrub-key")
    monkeypatch.setenv("CALLSCRUB_API_BASE_URL", "https://callscrub.example.test")
    monkeypatch.setenv("CALLSCRUB_AGENT_NAME", "Avery")
    monkeypatch.setenv("CALLSCRUB_DATE_RANGE", "last_7d")
    monkeypatch.setattr(runtime, "create_client", lambda ctx_obj: FakeCallScrubClient())
    payload = invoke_json(["agent", "stats"])
    assert payload["data"]["stats"]["agent_name"] == "Avery"
    assert payload["data"]["scope_preview"]["date_range"] == "last_7d"


def test_health_ready_labels_sampled_probe_truthfully(monkeypatch) -> None:
    monkeypatch.setenv("CALLSCRUB_API_KEY", "callscrub-key")
    monkeypatch.setenv("CALLSCRUB_API_BASE_URL", "https://callscrub.example.test")
    monkeypatch.setattr(runtime, "CallScrubClient", lambda api_key, base_url: FakeCallScrubClient())
    payload = invoke_json(["health"])
    assert payload["data"]["status"] == "ready"
    assert payload["data"]["connector"]["live_backend_available"] is True
    assert payload["data"]["connector"]["live_backend_probe_ok"] is True
    assert payload["data"]["connector"]["sampled_read_probe_ok"] is True
    assert "sampled call/agent read probe" in payload["data"]["summary"]
    assert "not separately tenant-smoked" in json.dumps(payload["data"]["next_steps"])


def test_doctor_supported_read_commands_match_manifest() -> None:
    manifest = json.loads(CONNECTOR_PATH.read_text())
    command_ids = {command["id"] for command in manifest["commands"] if command["resource"] != "connector"}
    payload = invoke_json(["doctor"])
    assert set(payload["data"]["runtime"]["supported_read_commands"]) == command_ids
    assert payload["data"]["runtime"]["tenant_smoke_tested"] is False
    assert payload["data"]["runtime"]["sampled_probe_commands"] == ["call.list", "agent.list"]
    assert payload["data"]["manifest"]["valid_json"] is True
    assert payload["data"]["manifest"]["command_count"] == len(manifest["commands"])


def _write_service_keys(monkeypatch, values: dict[str, str]) -> Path:
    path = Path(tempfile.mkdtemp(prefix="callscrub-service-keys-")) / "service-keys.json"
    path.write_text(
        json.dumps(
            {
                "version": 1,
                "keys": [
                    {"id": f"sk-{key}", "name": key, "variable": key, "value": value, "enabled": True}
                    for key, value in values.items()
                ],
            }
        )
    )
    return path
