from __future__ import annotations

import json
from pathlib import Path
import tempfile
from typing import Any

from click.testing import CliRunner

from cli_aos.paypunch.client import PayPunchApiError
from cli_aos.paypunch.cli import cli
from cli_aos.paypunch.config import config_snapshot, resolve_runtime_values
import cli_aos.paypunch.runtime as runtime

AGENT_HARNESS_ROOT = Path(__file__).resolve().parents[1]
CONNECTOR_PATH = AGENT_HARNESS_ROOT.parent / "connector.json"
PERMISSIONS_PATH = AGENT_HARNESS_ROOT / "permissions.json"


class FakePayPunchClient:
    def list_timesheets(
        self,
        *,
        tenant_id: str | None = None,
        company_id: str | None = None,
        employee_id: str | None = None,
        pay_period: str | None = None,
        limit: int = 50,
    ) -> dict[str, Any]:
        timesheets = [
            {
                "id": "ts_1",
                "employee_name": "Avery Lee",
                "date": "2026-04-20",
                "hours": 8,
                "status": "submitted",
                "company": "Northwind",
            },
            {
                "id": "ts_2",
                "employee_name": "Blake Fox",
                "date": "2026-04-21",
                "hours": 7.5,
                "status": "draft",
                "company": "Northwind",
            },
        ]
        return {
            "timesheets": timesheets[:limit],
            "filters": {
                "tenant_id": tenant_id,
                "company_id": company_id,
                "employee_id": employee_id,
                "pay_period": pay_period,
            },
        }

    def get_timesheet(self, timesheet_id: str) -> dict[str, Any]:
        return {"id": timesheet_id, "employee_name": "Avery Lee", "hours": 8}

    def list_employees(self, *, company_id: str | None = None, limit: int = 100) -> dict[str, Any]:
        return {
            "employees": [
                {"id": "emp_1", "name": "Avery Lee", "company": company_id or "Northwind", "role": "tech", "status": "active"}
            ][:limit]
        }

    def get_employee(self, employee_id: str) -> dict[str, Any]:
        return {"id": employee_id, "name": "Avery Lee", "status": "active"}

    def list_companies(self, *, tenant_id: str | None = None, limit: int = 50) -> dict[str, Any]:
        return {"companies": [{"id": "co_1", "name": "Northwind", "employee_count": "12", "pay_schedule": "weekly"}][:limit]}

    def get_company(self, company_id: str) -> dict[str, Any]:
        return {"id": company_id, "name": "Northwind"}

    def export_quickbooks_iif(self, *, company_id: str | None = None, pay_period: str | None = None) -> dict[str, Any]:
        return {"format": "iif", "company_id": company_id, "pay_period": pay_period, "rows": 2}

    def export_csv(self, *, company_id: str | None = None, pay_period: str | None = None) -> dict[str, Any]:
        return {"format": "csv", "company_id": company_id, "pay_period": pay_period, "rows": 2}

    def list_pay_periods(self, *, company_id: str | None = None, limit: int = 12) -> dict[str, Any]:
        return {
            "pay_periods": [
                {"id": "pp_1", "label": "Apr 1-15", "start_date": "2026-04-01", "end_date": "2026-04-15", "status": "closed"}
            ][:limit]
        }

    def current_pay_period(self, *, company_id: str | None = None) -> dict[str, Any]:
        return {"id": "pp_current", "company_id": company_id, "status": "open"}

    def hours_summary(self, *, company_id: str | None = None, pay_period: str | None = None) -> dict[str, Any]:
        return {"company_id": company_id, "pay_period": pay_period, "total_hours": 80}

    def overtime_report(self, *, company_id: str | None = None, pay_period: str | None = None) -> dict[str, Any]:
        return {"company_id": company_id, "pay_period": pay_period, "overtime_hours": 4}


class FailingPayPunchClient:
    def list_timesheets(self, **kwargs) -> dict[str, Any]:
        raise PayPunchApiError(status_code=503, code="UPSTREAM_UNAVAILABLE", message="PayPunch unavailable")


def invoke_json(args: list[str]) -> dict[str, Any]:
    result = CliRunner().invoke(cli, ["--json", *args])
    assert result.exit_code == 0, result.output
    return json.loads(result.output)


def _disable_repo_service_keys(monkeypatch) -> None:
    missing_path = Path(tempfile.mkdtemp(prefix="paypunch-missing-service-keys-")) / "service-keys.json"
    monkeypatch.setattr("cli_aos.paypunch.service_keys.SERVICE_KEYS_PATH", missing_path)


def _set_required_env(monkeypatch) -> None:
    _disable_repo_service_keys(monkeypatch)
    monkeypatch.setenv("PAYPUNCH_API_KEY", "paypunch-key")
    monkeypatch.setenv("PAYPUNCH_API_BASE_URL", "https://paypunch.example.test")


def test_manifest_and_permissions_are_in_sync() -> None:
    manifest = json.loads(CONNECTOR_PATH.read_text())
    permissions = json.loads(PERMISSIONS_PATH.read_text())["permissions"]
    command_ids = [command["id"] for command in manifest["commands"]]
    assert set(command_ids) == set(permissions.keys())
    assert {command["id"]: command["required_mode"] for command in manifest["commands"]} == permissions
    assert manifest["scope"]["kind"] == "time-tracking"
    assert manifest["scope"]["scaffold_only"] is False
    assert manifest["scope"]["write_bridge_available"] is False
    assert manifest["scope"]["live_read_available"] is True


def test_manifest_command_defaults_match_runtime() -> None:
    manifest = json.loads(CONNECTOR_PATH.read_text())
    assert manifest["scope"]["commandDefaults"] == runtime.command_defaults()


def test_manifest_has_no_write_commands() -> None:
    manifest = json.loads(CONNECTOR_PATH.read_text())
    action_ids = set(manifest["scope"]["worker_visible_actions"])
    assert all(command["action_class"] == "read" for command in manifest["commands"])
    assert all(command["required_mode"] == "readonly" for command in manifest["commands"])
    assert "timesheet.approve" not in action_ids
    assert "timesheet.reject" not in action_ids
    assert "employee.create" not in action_ids


def test_worker_fields_cover_manifest_fields() -> None:
    manifest = json.loads(CONNECTOR_PATH.read_text())
    worker_fields = set(manifest["scope"]["workerFields"])
    field_ids = {field["id"] for field in manifest["scope"]["fields"]}
    assert field_ids <= worker_fields


def test_capabilities_exposes_read_only_truth() -> None:
    payload = invoke_json(["capabilities"])
    assert payload["data"]["tool"] == "aos-paypunch"
    assert payload["data"]["write_support"]["live_writes_enabled"] is False
    assert payload["data"]["write_support"]["scaffolded_commands"] == []
    assert payload["data"]["read_support"]["timesheet.list"] is True


def test_health_requires_operator_service_keys(monkeypatch) -> None:
    _disable_repo_service_keys(monkeypatch)
    monkeypatch.delenv("PAYPUNCH_API_KEY", raising=False)
    monkeypatch.delenv("PAYPUNCH_API_BASE_URL", raising=False)
    payload = invoke_json(["health"])
    assert payload["data"]["status"] == "needs_setup"
    assert set(payload["data"]["auth"]["missing_service_keys"]) == {"PAYPUNCH_API_KEY", "PAYPUNCH_API_BASE_URL"}


def test_operator_context_precedes_env(monkeypatch) -> None:
    _set_required_env(monkeypatch)
    runtime_values = resolve_runtime_values(
        {"service_keys": {"aos-paypunch": {"PAYPUNCH_API_KEY": "operator-key", "PAYPUNCH_API_BASE_URL": "https://operator.example.test"}}}
    )
    assert runtime_values["api_key"] == "operator-key"
    assert runtime_values["api_base_url"] == "https://operator.example.test"
    assert runtime_values["details"]["PAYPUNCH_API_KEY"]["source"] == "operator:service_keys:tool"


def test_repo_service_key_precedes_env(monkeypatch) -> None:
    monkeypatch.setenv("PAYPUNCH_API_KEY", "env-key")
    monkeypatch.setenv("PAYPUNCH_API_BASE_URL", "https://env.example.test")
    monkeypatch.setattr(
        "cli_aos.paypunch.service_keys.SERVICE_KEYS_PATH",
        _write_service_keys({"PAYPUNCH_API_KEY": "repo-key", "PAYPUNCH_API_BASE_URL": "https://repo.example.test"}),
    )
    runtime_values = resolve_runtime_values()
    assert runtime_values["api_key"] == "repo-key"
    assert runtime_values["api_base_url"] == "https://repo.example.test"
    assert runtime_values["details"]["PAYPUNCH_API_KEY"]["source"] == "repo-service-key"


def test_operator_context_precedes_repo_service_key(monkeypatch) -> None:
    monkeypatch.setattr(
        "cli_aos.paypunch.service_keys.SERVICE_KEYS_PATH",
        _write_service_keys({"PAYPUNCH_API_KEY": "repo-key", "PAYPUNCH_API_BASE_URL": "https://repo.example.test"}),
    )
    runtime_values = resolve_runtime_values({"service_keys": {"aos-paypunch": {"api_key": "operator-key", "base_url": "https://operator.example.test"}}})
    assert runtime_values["api_key"] == "operator-key"
    assert runtime_values["api_base_url"] == "https://operator.example.test"
    assert runtime_values["details"]["PAYPUNCH_API_KEY"]["source"] == "operator:service_keys:tool"


def test_encrypted_repo_service_key_falls_back_to_env(monkeypatch) -> None:
    monkeypatch.setenv("PAYPUNCH_API_KEY", "env-key")
    monkeypatch.setenv("PAYPUNCH_API_BASE_URL", "https://env.example.test")
    monkeypatch.setattr(
        "cli_aos.paypunch.service_keys.SERVICE_KEYS_PATH",
        _write_service_keys({"PAYPUNCH_API_KEY": "enc:v1:abc:def:ghi", "PAYPUNCH_API_BASE_URL": "enc:v1:abc:def:ghi"}),
    )
    runtime_values = resolve_runtime_values()
    assert runtime_values["api_key"] == "env-key"
    assert runtime_values["api_base_url"] == "https://env.example.test"
    assert runtime_values["details"]["PAYPUNCH_API_KEY"]["source"] == "env_fallback"


def test_config_show_redacts_key_and_reports_sources(monkeypatch) -> None:
    _set_required_env(monkeypatch)
    payload = invoke_json(["config", "show"])
    assert "paypunch-key" not in json.dumps(payload)
    assert payload["data"]["scope"]["api_key"] == "<redacted>"
    assert payload["data"]["scope"]["api_base_url"] == "https://paypunch.example.test"
    assert payload["data"]["runtime"]["implementation_mode"] == "live_read_only"


def test_config_snapshot_accepts_operator_scope_defaults() -> None:
    payload = config_snapshot(
        {
            "service_keys": {
                "aos-paypunch": {
                    "api_key": "operator-key",
                    "base_url": "https://operator.example.test",
                    "timesheet_id": "ts_1",
                    "pay_period": "pp_1",
                }
            }
        }
    )
    assert payload["scope"]["timesheet_id"] == "ts_1"
    assert payload["scope"]["timesheet_id_source"] == "operator:service_keys:tool"
    assert payload["scope"]["pay_period"] == "pp_1"


def test_timesheet_list_returns_picker_metadata(monkeypatch) -> None:
    _set_required_env(monkeypatch)
    monkeypatch.setattr(runtime, "create_client", lambda ctx_obj: FakePayPunchClient())
    payload = invoke_json(["timesheet", "list", "--limit", "1"])
    assert payload["data"]["timesheet_count"] == 1
    assert payload["data"]["picker"]["kind"] == "timesheet"
    assert payload["data"]["picker"]["items"][0]["value"] == "ts_1"


def test_api_errors_are_json_failures(monkeypatch) -> None:
    _set_required_env(monkeypatch)
    monkeypatch.setattr(runtime, "create_client", lambda ctx_obj: FailingPayPunchClient())
    result = CliRunner().invoke(cli, ["--json", "timesheet", "list"])
    assert result.exit_code == 4
    payload = json.loads(result.output)
    assert payload["ok"] is False
    assert payload["error"]["code"] == "UPSTREAM_UNAVAILABLE"
    assert payload["command"] == "timesheet.list"


def test_timesheet_get_uses_scoped_timesheet(monkeypatch) -> None:
    _set_required_env(monkeypatch)
    monkeypatch.setenv("PAYPUNCH_TIMESHEET_ID", "ts_1")
    monkeypatch.setattr(runtime, "create_client", lambda ctx_obj: FakePayPunchClient())
    payload = invoke_json(["timesheet", "get"])
    assert payload["data"]["timesheet"]["id"] == "ts_1"
    assert payload["data"]["scope_preview"]["timesheet_id"] == "ts_1"


def test_employee_and_company_lists_return_picker_metadata(monkeypatch) -> None:
    _set_required_env(monkeypatch)
    monkeypatch.setattr(runtime, "create_client", lambda ctx_obj: FakePayPunchClient())
    employee_payload = invoke_json(["employee", "list", "--limit", "1"])
    company_payload = invoke_json(["company", "list", "--limit", "1"])
    assert employee_payload["data"]["employee_count"] == 1
    assert employee_payload["data"]["picker"]["items"][0]["value"] == "emp_1"
    assert company_payload["data"]["company_count"] == 1
    assert company_payload["data"]["picker"]["items"][0]["value"] == "co_1"


def test_pay_period_exports_and_reports_use_scope_defaults(monkeypatch) -> None:
    _set_required_env(monkeypatch)
    monkeypatch.setenv("PAYPUNCH_COMPANY_ID", "co_1")
    monkeypatch.setenv("PAYPUNCH_PAY_PERIOD", "pp_1")
    monkeypatch.setattr(runtime, "create_client", lambda ctx_obj: FakePayPunchClient())
    pay_period_payload = invoke_json(["pay-period", "current"])
    export_payload = invoke_json(["export", "quickbooks-iif"])
    report_payload = invoke_json(["report", "hours-summary"])
    assert pay_period_payload["data"]["pay_period"]["company_id"] == "co_1"
    assert export_payload["data"]["export"]["pay_period"] == "pp_1"
    assert report_payload["data"]["report"]["total_hours"] == 80


def test_health_ready_labels_sampled_probe_truthfully(monkeypatch) -> None:
    _set_required_env(monkeypatch)
    monkeypatch.setattr(runtime, "PayPunchClient", lambda api_key, base_url: FakePayPunchClient())
    payload = invoke_json(["health"])
    assert payload["data"]["status"] == "ready"
    assert payload["data"]["connector"]["live_backend_available"] is True
    assert payload["data"]["connector"]["live_backend_probe_ok"] is True
    assert payload["data"]["connector"]["sampled_read_probe_ok"] is True
    assert "sampled timesheet/employee read probe" in payload["data"]["summary"]
    assert "not separately tenant-smoked" in json.dumps(payload["data"]["next_steps"])


def test_doctor_supported_read_commands_match_manifest(monkeypatch) -> None:
    _disable_repo_service_keys(monkeypatch)
    manifest = json.loads(CONNECTOR_PATH.read_text())
    command_ids = {command["id"] for command in manifest["commands"]}
    payload = invoke_json(["doctor"])
    assert set(payload["data"]["runtime"]["supported_read_commands"]) == command_ids
    assert payload["data"]["runtime"]["tenant_smoke_tested"] is False
    assert payload["data"]["runtime"]["sampled_probe_commands"] == ["timesheet.list", "employee.list"]
    assert payload["data"]["manifest"]["valid_json"] is True
    assert payload["data"]["manifest"]["command_count"] == len(manifest["commands"])


def _write_service_keys(values: dict[str, str]) -> Path:
    path = Path(tempfile.mkdtemp(prefix="paypunch-service-keys-")) / "service-keys.json"
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
