from __future__ import annotations

import json
from pathlib import Path
from typing import Any

from click.testing import CliRunner

from cli_aos.holace.cli import cli
from cli_aos.holace.config import config_snapshot, resolve_runtime_values
import cli_aos.holace.runtime as runtime

AGENT_HARNESS_ROOT = Path(__file__).resolve().parents[1]
CONNECTOR_PATH = AGENT_HARNESS_ROOT.parent / "connector.json"
PERMISSIONS_PATH = AGENT_HARNESS_ROOT / "permissions.json"


class FakeHolaceClient:
    def list_cases(self, *, attorney_id: str | None = None, client_id: str | None = None, case_type: str | None = None, limit: int = 25) -> dict[str, Any]:
        cases = [
            {"id": "case_1", "title": "Doe v. Driver", "client_name": "Jane Doe", "case_type": "personal_injury", "status": "open"},
            {"id": "case_2", "title": "Smith v. Carrier", "client_name": "John Smith", "case_type": "motor_vehicle", "status": "settlement"},
        ]
        return {"cases": cases[:limit], "total": len(cases), "filters": {"attorney_id": attorney_id, "client_id": client_id, "case_type": case_type}}

    def get_case(self, case_id: str) -> dict[str, Any]:
        return {"id": case_id, "title": "Doe v. Driver", "status": "open"}

    def case_timeline(self, case_id: str) -> dict[str, Any]:
        return {"case_id": case_id, "events": [{"id": "evt_1", "type": "intake"}]}

    def list_clients(self, *, limit: int = 50) -> dict[str, Any]:
        return {"clients": [{"id": "client_1", "name": "Jane Doe", "email": "jane@example.test"}][:limit]}

    def get_client(self, client_id: str) -> dict[str, Any]:
        return {"id": client_id, "name": "Jane Doe"}

    def list_documents(self, *, case_id: str | None = None, limit: int = 25) -> dict[str, Any]:
        return {"documents": [{"id": "doc_1", "title": "Demand Letter", "case_id": case_id, "status": "draft"}][:limit]}

    def get_document(self, document_id: str) -> dict[str, Any]:
        return {"id": document_id, "title": "Demand Letter"}

    def list_deadlines(self, *, case_id: str | None = None, limit: int = 20) -> dict[str, Any]:
        return {"deadlines": [{"id": "deadline_1", "title": "SOL", "case_id": case_id, "status": "open"}][:limit]}

    def check_statute(self, *, state: str, case_type: str | None = None) -> dict[str, Any]:
        return {"state": state, "case_type": case_type, "limitations_years": 2}

    def list_settlements(self, *, case_id: str | None = None, limit: int = 10) -> dict[str, Any]:
        return {"settlements": [{"id": "settlement_1", "case_id": case_id, "amount": 100000, "status": "negotiating"}][:limit]}

    def get_settlement(self, settlement_id: str) -> dict[str, Any]:
        return {"id": settlement_id, "amount": 100000}

    def settlement_tracker(self) -> dict[str, Any]:
        return {"stages": [{"name": "demand_sent", "count": 12}]}

    def list_billing(self, *, case_id: str | None = None, limit: int = 25) -> dict[str, Any]:
        return {"billing": [{"id": "bill_1", "case_id": case_id, "amount": 1250}][:limit]}

    def list_communications(self, *, case_id: str | None = None, limit: int = 25) -> dict[str, Any]:
        return {"communications": [{"id": "comm_1", "case_id": case_id, "channel": "phone"}][:limit]}

    def case_status_report(self, *, case_id: str | None = None) -> dict[str, Any]:
        return {"case_id": case_id, "status": "open"}

    def pipeline_report(self, *, attorney_id: str | None = None) -> dict[str, Any]:
        return {"attorney_id": attorney_id, "open_cases": 24}


def invoke_json(args: list[str]) -> dict[str, Any]:
    result = CliRunner().invoke(cli, ["--json", *args])
    assert result.exit_code == 0, result.output
    return json.loads(result.output)


def test_manifest_and_permissions_are_in_sync() -> None:
    manifest = json.loads(CONNECTOR_PATH.read_text())
    permissions = json.loads(PERMISSIONS_PATH.read_text())["permissions"]
    command_ids = [command["id"] for command in manifest["commands"]]
    assert set(command_ids) == set(permissions.keys())
    assert manifest["scope"]["kind"] == "legal-practice"
    assert manifest["scope"]["scaffold_only"] is False
    assert manifest["scope"]["write_bridge_available"] is False


def test_manifest_has_no_write_commands() -> None:
    manifest = json.loads(CONNECTOR_PATH.read_text())
    assert all(command["action_class"] == "read" for command in manifest["commands"])
    assert all(command["required_mode"] == "readonly" for command in manifest["commands"])
    assert "case.create" not in manifest["scope"]["worker_visible_actions"]
    assert "document.generate" not in manifest["scope"]["worker_visible_actions"]


def test_worker_fields_cover_manifest_fields() -> None:
    manifest = json.loads(CONNECTOR_PATH.read_text())
    worker_fields = set(manifest["scope"]["workerFields"])
    field_ids = {field["id"] for field in manifest["scope"]["fields"]}
    assert field_ids <= worker_fields


def test_capabilities_exposes_read_only_truth() -> None:
    payload = invoke_json(["capabilities"])
    assert payload["data"]["tool"] == "aos-holace"
    assert payload["data"]["write_support"]["live_writes_enabled"] is False
    assert payload["data"]["write_support"]["scaffolded_commands"] == []
    assert payload["data"]["read_support"]["case.list"] is True


def test_health_requires_operator_service_keys(monkeypatch) -> None:
    monkeypatch.delenv("HOLACE_API_KEY", raising=False)
    monkeypatch.delenv("HOLACE_API_BASE_URL", raising=False)
    payload = invoke_json(["health"])
    assert payload["data"]["status"] == "needs_setup"
    assert set(payload["data"]["auth"]["missing_service_keys"]) == {"HOLACE_API_KEY", "HOLACE_API_BASE_URL"}


def test_operator_context_precedes_env(monkeypatch) -> None:
    monkeypatch.setenv("HOLACE_API_KEY", "env-key")
    monkeypatch.setenv("HOLACE_API_BASE_URL", "https://env.example.test")
    runtime_values = resolve_runtime_values({"service_keys": {"aos-holace": {"HOLACE_API_KEY": "operator-key", "HOLACE_API_BASE_URL": "https://operator.example.test"}}})
    assert runtime_values["api_key"] == "operator-key"
    assert runtime_values["api_base_url"] == "https://operator.example.test"
    assert runtime_values["details"]["HOLACE_API_KEY"]["source"] == "operator:service_keys:tool"


def test_repo_service_key_precedes_env(monkeypatch) -> None:
    monkeypatch.setenv("HOLACE_API_KEY", "env-key")
    monkeypatch.setenv("HOLACE_API_BASE_URL", "https://env.example.test")

    def fake_repo_key(variable: str) -> str | None:
        return {
            "HOLACE_API_KEY": "repo-key",
            "HOLACE_API_BASE_URL": "https://repo.example.test",
        }.get(variable)

    monkeypatch.setattr("cli_aos.holace.service_keys.resolve_service_key", fake_repo_key)
    runtime_values = resolve_runtime_values()
    assert runtime_values["api_key"] == "repo-key"
    assert runtime_values["api_base_url"] == "https://repo.example.test"
    assert runtime_values["details"]["HOLACE_API_KEY"]["source"] == "repo-service-key"
    assert runtime_values["details"]["HOLACE_API_BASE_URL"]["source"] == "repo-service-key"


def test_operator_context_precedes_repo_service_key(monkeypatch) -> None:
    def fake_repo_key(variable: str) -> str | None:
        return {
            "HOLACE_API_KEY": "repo-key",
            "HOLACE_API_BASE_URL": "https://repo.example.test",
        }.get(variable)

    monkeypatch.setattr("cli_aos.holace.service_keys.resolve_service_key", fake_repo_key)
    runtime_values = resolve_runtime_values(
        {
            "service_keys": {
                "aos-holace": {
                    "HOLACE_API_KEY": "operator-key",
                    "HOLACE_API_BASE_URL": "https://operator.example.test",
                }
            }
        }
    )
    assert runtime_values["api_key"] == "operator-key"
    assert runtime_values["api_base_url"] == "https://operator.example.test"
    assert runtime_values["details"]["HOLACE_API_KEY"]["source"] == "operator:service_keys:tool"
    assert runtime_values["details"]["HOLACE_API_BASE_URL"]["source"] == "operator:service_keys:tool"


def test_config_show_redacts_key_and_reports_sources(monkeypatch) -> None:
    monkeypatch.setenv("HOLACE_API_KEY", "holace-secret")
    monkeypatch.setenv("HOLACE_API_BASE_URL", "https://holace.example.test")
    payload = invoke_json(["config", "show"])
    assert "holace-secret" not in json.dumps(payload)
    assert payload["data"]["scope"]["api_key"] == "<redacted>"
    assert payload["data"]["scope"]["api_base_url"] == "https://holace.example.test"
    assert payload["data"]["runtime"]["implementation_mode"] == "live_read_only"


def test_config_snapshot_accepts_operator_scope_defaults() -> None:
    payload = config_snapshot({"service_keys": {"aos-holace": {"api_key": "operator-key", "base_url": "https://operator.example.test", "case_id": "case_1"}}})
    assert payload["scope"]["case_id"] == "case_1"
    assert payload["scope"]["case_id_source"] == "operator:service_keys:tool"


def test_case_list_returns_picker_metadata(monkeypatch) -> None:
    monkeypatch.setenv("HOLACE_API_KEY", "holace-key")
    monkeypatch.setenv("HOLACE_API_BASE_URL", "https://holace.example.test")
    monkeypatch.setattr(runtime, "create_client", lambda ctx_obj: FakeHolaceClient())
    payload = invoke_json(["case", "list", "--limit", "1"])
    assert payload["data"]["case_count"] == 1
    assert payload["data"]["picker"]["kind"] == "case"
    assert payload["data"]["picker"]["items"][0]["value"] == "case_1"


def test_case_get_uses_scoped_case(monkeypatch) -> None:
    monkeypatch.setenv("HOLACE_API_KEY", "holace-key")
    monkeypatch.setenv("HOLACE_API_BASE_URL", "https://holace.example.test")
    monkeypatch.setenv("HOLACE_CASE_ID", "case_1")
    monkeypatch.setattr(runtime, "create_client", lambda ctx_obj: FakeHolaceClient())
    payload = invoke_json(["case", "get"])
    assert payload["data"]["case"]["id"] == "case_1"
    assert payload["data"]["scope_preview"]["case_id"] == "case_1"


def test_deadline_statute_uses_scope_defaults(monkeypatch) -> None:
    monkeypatch.setenv("HOLACE_API_KEY", "holace-key")
    monkeypatch.setenv("HOLACE_API_BASE_URL", "https://holace.example.test")
    monkeypatch.setenv("HOLACE_STATUTE_STATE", "CA")
    monkeypatch.setenv("HOLACE_CASE_TYPE", "personal_injury")
    monkeypatch.setattr(runtime, "create_client", lambda ctx_obj: FakeHolaceClient())
    payload = invoke_json(["deadline", "check-statute"])
    assert payload["data"]["statute"]["state"] == "CA"
    assert payload["data"]["statute"]["case_type"] == "personal_injury"


def test_report_pipeline(monkeypatch) -> None:
    monkeypatch.setenv("HOLACE_API_KEY", "holace-key")
    monkeypatch.setenv("HOLACE_API_BASE_URL", "https://holace.example.test")
    monkeypatch.setenv("HOLACE_ATTORNEY_ID", "attorney_1")
    monkeypatch.setattr(runtime, "create_client", lambda ctx_obj: FakeHolaceClient())
    payload = invoke_json(["report", "pipeline"])
    assert payload["data"]["report"]["open_cases"] == 24
    assert payload["data"]["scope_preview"]["attorney_id"] == "attorney_1"


def test_health_ready_labels_sampled_probe_truthfully(monkeypatch) -> None:
    monkeypatch.setenv("HOLACE_API_KEY", "holace-key")
    monkeypatch.setenv("HOLACE_API_BASE_URL", "https://holace.example.test")
    monkeypatch.setattr(runtime, "create_client", lambda ctx_obj: FakeHolaceClient())
    monkeypatch.setattr(runtime, "HolaceClient", lambda api_key, base_url: FakeHolaceClient())
    payload = invoke_json(["health"])
    assert payload["data"]["status"] == "ready"
    assert payload["data"]["connector"]["live_backend_available"] is True
    assert payload["data"]["connector"]["live_backend_probe_ok"] is True
    assert payload["data"]["connector"]["sampled_read_probe_ok"] is True
    assert "sampled case/client read probe" in payload["data"]["summary"]
    assert "not separately tenant-smoked" in json.dumps(payload["data"]["next_steps"])


def test_doctor_supported_read_commands_match_manifest() -> None:
    manifest = json.loads(CONNECTOR_PATH.read_text())
    command_ids = {command["id"] for command in manifest["commands"] if command["resource"] != "connector"}
    payload = invoke_json(["doctor"])
    assert set(payload["data"]["runtime"]["supported_read_commands"]) == command_ids
    assert payload["data"]["runtime"]["tenant_smoke_tested"] is False
    assert payload["data"]["runtime"]["sampled_probe_commands"] == ["case.list", "client.list"]
    assert payload["data"]["manifest"]["valid_json"] is True
    assert payload["data"]["manifest"]["command_count"] == len(manifest["commands"])
