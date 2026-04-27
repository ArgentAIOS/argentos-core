from __future__ import annotations

import json
from pathlib import Path
from typing import Any

from click.testing import CliRunner
import pytest

from cli_aos.zapier import runtime as runtime_module
from cli_aos.zapier.cli import cli
from cli_aos.zapier import service_keys as service_keys_module


AGENT_HARNESS_ROOT = Path(__file__).resolve().parents[1]
CONNECTOR_PATH = AGENT_HARNESS_ROOT.parent / "connector.json"
PERMISSIONS_PATH = AGENT_HARNESS_ROOT / "permissions.json"
ZAPIER_ENV_KEYS = (
    "ZAPIER_API_URL",
    "ZAPIER_API_KEY",
    "ZAPIER_WEBHOOK_BASE_URL",
    "ZAPIER_WORKSPACE_NAME",
    "ZAPIER_ZAP_ID",
    "ZAPIER_ZAP_NAME",
    "ZAPIER_ZAP_STATUS",
)


@pytest.fixture(autouse=True)
def no_operator_service_key_by_default(monkeypatch, tmp_path):
    monkeypatch.setattr(service_keys_module, "SERVICE_KEYS_PATH", tmp_path / "missing-service-keys.json")
    for key in ZAPIER_ENV_KEYS:
        monkeypatch.delenv(key, raising=False)


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


@pytest.fixture(autouse=True)
def no_operator_service_key_by_default(monkeypatch):
    monkeypatch.setattr(service_keys_module, "resolve_service_key", lambda variable: None)


class FakeZapierClient:
    def __init__(
        self,
        *,
        list_response: dict | list | None = None,
        status_response: dict | list | None = None,
        trigger_probe_ok: bool = True,
        trigger_response: dict | list | None = None,
    ):
        self.list_response = list_response or {
            "zaps": [
                {
                    "id": "zap-123",
                    "name": "Weekly Ops Sync",
                    "status": "on",
                    "workspace_name": "Ops",
                },
                {
                    "id": "zap-456",
                    "name": "Finance Watch",
                    "status": "off",
                    "workspace_name": "Finance",
                },
            ]
        }
        self.status_response = status_response or {
            "zap": {
                "id": "zap-123",
                "name": "Weekly Ops Sync",
                "status": "on",
                "workspace_name": "Ops",
            }
        }
        self.calls: list[tuple] = []
        self.trigger_probe_ok = trigger_probe_ok
        self.trigger_response = trigger_response or {
            "status": "accepted",
            "job_id": "job-001",
            "message": "Zap trigger queued",
        }

    def probe(self) -> dict[str, object]:
        self.calls.append(("probe",))
        return {"endpoint": "/health", "payload": {"ok": True}}

    def probe_trigger(self) -> dict[str, object]:
        self.calls.append(("probe_trigger",))
        if not self.trigger_probe_ok:
            raise runtime_module.ZapierApiError(
                code="ZAPIER_TRIGGER_ENDPOINT_NOT_FOUND",
                message="Configured Zapier bridge did not expose a trigger endpoint",
                exit_code=5,
                details={"write_bridge_available": False},
            )
        return {"endpoint": "/trigger", "available": True, "method": "OPTIONS", "allow": "POST"}

    def list_zaps(self, *, limit: int, status: str | None, workspace_name: str | None):
        self.calls.append(("list_zaps", limit, status, workspace_name))
        return self.list_response

    def get_zap(self, zap_id: str, *, status: str | None, workspace_name: str | None):
        self.calls.append(("get_zap", zap_id, status, workspace_name))
        if isinstance(self.status_response, dict) and "zap" in self.status_response:
            return self.status_response
        return self.status_response

    def trigger_zap(self, zap_id: str, *, event: str, payload: dict | None, workspace_name: str | None):
        self.calls.append(("trigger_zap", zap_id, event, payload, workspace_name))
        response = self.trigger_response
        if isinstance(response, dict):
            return {
                **response,
                "zap_id": zap_id,
                "event": event,
                "payload": payload or {},
                "workspace_name": workspace_name,
            }
        return response


def test_manifest_and_permissions_are_in_sync():
    manifest = json.loads(CONNECTOR_PATH.read_text())
    permissions = json.loads(PERMISSIONS_PATH.read_text())["permissions"]
    manifest_command_ids = [command["id"] for command in manifest["commands"]]

    assert set(manifest_command_ids) == set(permissions.keys())
    assert "zap.list" in manifest_command_ids
    assert "zap.trigger" in manifest_command_ids


def test_capabilities_json_matches_manifest():
    result = CliRunner().invoke(cli, ["--json", "capabilities"])
    assert result.exit_code == 0

    envelope = json.loads(result.output)
    payload = envelope["data"]
    manifest = json.loads(CONNECTOR_PATH.read_text())

    assert envelope["tool"] == "aos-zapier"
    assert envelope["command"] == "capabilities"
    assert payload["tool"] == manifest["tool"]
    assert payload["backend"] == manifest["backend"]
    assert payload["manifest_schema_version"] == manifest["manifest_schema_version"]
    assert payload["connector"] == manifest["connector"]
    assert payload["scope"] == manifest["scope"]
    assert payload["auth"] == manifest["auth"]
    assert payload["commands"] == manifest["commands"]
    assert payload["scope"]["live_write_smoke_tested"] is False


def test_health_reports_needs_setup_without_env(monkeypatch):
    monkeypatch.delenv("ZAPIER_API_URL", raising=False)
    monkeypatch.delenv("ZAPIER_API_KEY", raising=False)
    monkeypatch.delenv("ZAPIER_WEBHOOK_BASE_URL", raising=False)
    monkeypatch.delenv("ZAPIER_WORKSPACE_NAME", raising=False)
    monkeypatch.delenv("ZAPIER_ZAP_ID", raising=False)
    monkeypatch.delenv("ZAPIER_ZAP_NAME", raising=False)
    monkeypatch.delenv("ZAPIER_ZAP_STATUS", raising=False)

    result = CliRunner().invoke(cli, ["--json", "health"])
    assert result.exit_code == 0

    payload = json.loads(result.output)
    assert payload["data"]["status"] == "needs_setup"
    assert payload["data"]["live_backend_available"] is False
    assert "ZAPIER_API_URL" in payload["data"]["checks"][0]["details"]["missing_keys"]


def test_health_reports_ready_with_live_bridge(monkeypatch):
    fake_client = FakeZapierClient()
    monkeypatch.setattr(runtime_module, "_client", lambda _ctx: fake_client)
    monkeypatch.setenv("ZAPIER_API_URL", "https://example.zapier.invalid")
    monkeypatch.setenv("ZAPIER_API_KEY", "super-secret-key")
    monkeypatch.setenv("ZAPIER_WEBHOOK_BASE_URL", "https://hooks.example.invalid")
    monkeypatch.setenv("ZAPIER_WORKSPACE_NAME", "Ops")

    result = CliRunner().invoke(cli, ["--json", "health"])
    assert result.exit_code == 0

    payload = json.loads(result.output)["data"]
    assert payload["status"] == "ready"
    assert payload["runtime_ready"] is True
    assert payload["connector"]["live_backend_available"] is True
    assert payload["connector"]["live_read_available"] is True
    assert payload["connector"]["write_bridge_available"] is True
    assert payload["checks"][1]["ok"] is True
    assert payload["checks"][2]["ok"] is True
    assert payload["probe"]["details"]["read_probe"]["details"]["endpoint"] == "/health"
    assert payload["probe"]["details"]["write_bridge_available"] is True


def test_health_reports_partial_ready_when_trigger_bridge_is_missing(monkeypatch):
    fake_client = FakeZapierClient(trigger_probe_ok=False)
    monkeypatch.setattr(runtime_module, "_client", lambda _ctx: fake_client)
    monkeypatch.setenv("ZAPIER_API_URL", "https://example.zapier.invalid")
    monkeypatch.setenv("ZAPIER_API_KEY", "super-secret-key")

    result = CliRunner().invoke(cli, ["--json", "health"])
    assert result.exit_code == 0

    payload = json.loads(result.output)["data"]
    assert payload["status"] == "partial_ready"
    assert payload["runtime_ready"] is False
    assert payload["connector"]["live_read_available"] is True
    assert payload["connector"]["write_bridge_available"] is False
    assert payload["checks"][1]["ok"] is True
    assert payload["checks"][2]["ok"] is False


def test_config_show_redacts_tokens_and_reports_live_runtime(monkeypatch):
    fake_client = FakeZapierClient()
    monkeypatch.setattr(runtime_module, "_client", lambda _ctx: fake_client)
    monkeypatch.setenv("ZAPIER_API_URL", "https://example.zapier.invalid")
    monkeypatch.setenv("ZAPIER_API_KEY", "super-secret-key")
    monkeypatch.setenv("ZAPIER_WEBHOOK_BASE_URL", "https://hooks.example.invalid")
    monkeypatch.setenv("ZAPIER_WORKSPACE_NAME", "Ops")
    monkeypatch.setenv("ZAPIER_ZAP_ID", "zap-123")
    monkeypatch.setenv("ZAPIER_ZAP_NAME", "Weekly Ops Sync")
    monkeypatch.setenv("ZAPIER_ZAP_STATUS", "on")

    result = CliRunner().invoke(cli, ["--json", "config", "show"])
    assert result.exit_code == 0
    assert "super-secret-key" not in result.output
    assert '"scaffold_only": false' in result.output
    assert '"runtime_ready": true' in result.output
    assert '"live_read_available": true' in result.output
    assert '"write_bridge_available": true' in result.output
    assert '"trigger_builder"' in result.output
    assert '"suggested_values": [' in result.output
    assert '"zap_name": "Weekly Ops Sync"' in result.output


def test_health_prefers_operator_service_keys_over_env_fallback(monkeypatch, tmp_path):
    fake_client = FakeZapierClient()
    operator_values = {
        "ZAPIER_API_URL": "https://operator.zapier.invalid",
        "ZAPIER_API_KEY": "operator-secret-key",
        "ZAPIER_WEBHOOK_BASE_URL": "https://hooks.operator.invalid",
    }
    monkeypatch.setattr(service_keys_module, "SERVICE_KEYS_PATH", write_service_keys(tmp_path, operator_values))
    monkeypatch.setattr(runtime_module, "_client", lambda _ctx: fake_client)
    monkeypatch.setenv("ZAPIER_API_URL", "https://env.zapier.invalid")
    monkeypatch.setenv("ZAPIER_API_KEY", "env-secret-key")
    monkeypatch.setenv("ZAPIER_WEBHOOK_BASE_URL", "https://hooks.env.invalid")

    result = CliRunner().invoke(cli, ["--json", "health"])
    assert result.exit_code == 0

    payload = json.loads(result.output)["data"]
    assert payload["status"] == "ready"
    assert payload["auth"]["api_url_source"] == "repo-service-key"
    assert payload["auth"]["api_key_source"] == "repo-service-key"
    assert payload["auth"]["webhook_base_url_source"] == "repo-service-key"
    assert payload["auth"]["resolution_order"] == ["operator-context", "service-keys", "process.env"]


def test_encrypted_repo_service_key_falls_back_to_env_like_core_resolver(monkeypatch, tmp_path):
    monkeypatch.setenv("ZAPIER_API_URL", "https://env.zapier.invalid")
    monkeypatch.setenv("ZAPIER_API_KEY", "env-secret-key")
    monkeypatch.setattr(
        service_keys_module,
        "SERVICE_KEYS_PATH",
        write_service_keys(tmp_path, {"ZAPIER_API_KEY": "enc:v1:abc:def:ghi"}),
    )

    result = CliRunner().invoke(cli, ["--json", "config", "show"])
    assert result.exit_code == 0

    payload = json.loads(result.output)["data"]
    assert payload["auth"]["api_key_source"] == "env_fallback"
    assert payload["auth"]["api_key_present"] is True
    assert payload["auth"]["api_key_usable"] is True
    assert payload["auth"]["api_key_redacted"] == "env...key"


def test_scoped_repo_service_key_blocks_env_fallback(monkeypatch, tmp_path):
    monkeypatch.setenv("ZAPIER_API_URL", "https://env.zapier.invalid")
    monkeypatch.setenv("ZAPIER_API_KEY", "env-secret-key")
    monkeypatch.setattr(
        service_keys_module,
        "SERVICE_KEYS_PATH",
        write_service_keys(tmp_path, {"ZAPIER_API_KEY": "repo-secret-key"}, extra={"allowedRoles": ["operator"]}),
    )

    result = CliRunner().invoke(cli, ["--json", "config", "show"])
    assert result.exit_code == 0

    payload = json.loads(result.output)["data"]
    assert payload["auth"]["api_key_source"] == "repo-service-key-scoped"
    assert payload["auth"]["api_key_present"] is False
    assert payload["auth"]["api_key_usable"] is False
    assert payload["auth"]["api_key_redacted"] is None


def test_operator_context_can_supply_tool_scoped_keys():
    runtime = runtime_module.resolve_runtime_values(
        {
            "service_keys": {
                "aos-zapier": {
                    "api_url": "https://operator-context.zapier.invalid",
                    "api_key": "operator-context-key",
                    "workspace_name": "Ops",
                }
            }
        }
    )

    assert runtime["api_url"] == "https://operator-context.zapier.invalid"
    assert runtime["api_key"] == "operator-context-key"
    assert runtime["workspace_name"] == "Ops"
    assert runtime["api_url_source"] == "operator:service_keys:tool"
    assert runtime["workspace_name_source"] == "operator:service_keys:tool"


def test_doctor_reports_live_runtime_status_and_permissions(monkeypatch):
    fake_client = FakeZapierClient()
    monkeypatch.setattr(runtime_module, "_client", lambda _ctx: fake_client)
    monkeypatch.setenv("ZAPIER_API_URL", "https://example.zapier.invalid")
    monkeypatch.setenv("ZAPIER_API_KEY", "super-secret-key")

    result = CliRunner().invoke(cli, ["--json", "doctor"])
    assert result.exit_code == 0

    payload = json.loads(result.output)
    assert payload["data"]["status"] == "ready"
    assert payload["data"]["scaffold_only"] is False
    assert payload["data"]["runtime_ready"] is True
    assert payload["data"]["write_bridge_available"] is True
    assert payload["data"]["checks"][2]["ok"] is True
    assert payload["data"]["permissions"] == [
        "capabilities",
        "config.show",
        "doctor",
        "health",
        "zap.list",
        "zap.status",
        "zap.trigger",
    ]


def test_zap_list_exposes_picker_options_and_scope_preview(monkeypatch):
    fake_client = FakeZapierClient()
    monkeypatch.setattr(runtime_module, "_client", lambda _ctx: fake_client)
    monkeypatch.setenv("ZAPIER_API_URL", "https://example.zapier.invalid")
    monkeypatch.setenv("ZAPIER_API_KEY", "super-secret-key")
    monkeypatch.setenv("ZAPIER_ZAP_ID", "zap-123")
    monkeypatch.setenv("ZAPIER_ZAP_NAME", "Weekly Ops Sync")
    monkeypatch.setenv("ZAPIER_ZAP_STATUS", "on")
    monkeypatch.setenv("ZAPIER_WORKSPACE_NAME", "Ops")

    result = CliRunner().invoke(cli, ["--json", "zap", "list"])
    assert result.exit_code == 0

    payload = json.loads(result.output)["data"]
    assert payload["status"] == "live"
    assert payload["live_read_available"] is True
    assert payload["count"] == 2
    assert payload["scope"]["preview"]["surface"] == "zap"
    assert payload["scope_preview"]["candidate_count"] == 2
    assert payload["picker_options"][0]["label"] == "Weekly Ops Sync"
    assert payload["picker_options"][0]["subtitle"] == "on | Ops"
    assert payload["results"][0]["id"] == "zap-123"
    assert fake_client.calls[1][0] == "list_zaps"


def test_zap_status_uses_configured_zap_target(monkeypatch):
    fake_client = FakeZapierClient()
    monkeypatch.setattr(runtime_module, "_client", lambda _ctx: fake_client)
    monkeypatch.setenv("ZAPIER_API_URL", "https://example.zapier.invalid")
    monkeypatch.setenv("ZAPIER_API_KEY", "super-secret-key")
    monkeypatch.setenv("ZAPIER_ZAP_ID", "zap-123")
    monkeypatch.setenv("ZAPIER_ZAP_NAME", "Weekly Ops Sync")
    monkeypatch.setenv("ZAPIER_ZAP_STATUS", "on")

    result = CliRunner().invoke(cli, ["--json", "zap", "status"])
    assert result.exit_code == 0

    payload = json.loads(result.output)["data"]
    assert payload["status"] == "live"
    assert payload["zap"]["id"] == "zap-123"
    assert payload["zap"]["name"] == "Weekly Ops Sync"
    assert payload["scope_preview"]["operation"] == "status"
    assert payload["picker_options"][0]["value"] == "zap-123"
    assert payload["results"]["id"] == "zap-123"
    assert fake_client.calls[1][0] == "get_zap"


def test_zap_trigger_executes_via_live_bridge(monkeypatch):
    fake_client = FakeZapierClient(trigger_response={"status": "accepted", "job_id": "job-002", "message": "queued"})
    monkeypatch.setattr(runtime_module, "_client", lambda _ctx: fake_client)
    monkeypatch.setenv("ZAPIER_API_URL", "https://example.zapier.invalid")
    monkeypatch.setenv("ZAPIER_API_KEY", "super-secret-key")
    monkeypatch.setenv("ZAPIER_WORKSPACE_NAME", "Ops")

    result = CliRunner().invoke(
        cli,
        [
            "--json",
            "--mode",
            "write",
            "zap",
            "trigger",
            "zap-123",
            "--event",
            "manual",
            "--payload-json",
            '{"source":"ui","reason":"builder"}',
            "--payload",
            "source=agent",
            "--payload",
            "priority=high",
        ],
    )
    assert result.exit_code == 0

    payload = json.loads(result.output)["data"]
    assert payload["status"] == "live"
    assert payload["command_id"] == "zap.trigger"
    assert payload["executed"] is True
    assert payload["live_read_available"] is True
    assert payload["write_bridge_available"] is True
    assert payload["acknowledged"] == "accepted"
    assert payload["response"]["job_id"] == "job-002"
    assert payload["trigger_builder"]["event"]["suggested_values"] == [
        "manual",
        "scheduled",
        "webhook",
        "test",
    ]
    assert payload["trigger_builder"]["payload"]["payload_keys"] == ["priority", "reason", "source"]
    assert payload["trigger_builder"]["request_template"]["request_method"] == "POST"
    assert payload["response_normalization"]["normalized"]["acknowledged"] == "accepted"
    assert payload["inputs"]["payload"] == {"source": "agent", "reason": "builder", "priority": "high"}
    assert '"request_method": "POST"' in result.output
    assert '"source": "agent"' in result.output
    assert fake_client.calls[:3] == [
        ("probe",),
        ("probe_trigger",),
        ("trigger_zap", "zap-123", "manual", {"source": "agent", "reason": "builder", "priority": "high"}, "Ops"),
    ]


def test_zap_trigger_requires_write_mode(monkeypatch):
    fake_client = FakeZapierClient()
    monkeypatch.setattr(runtime_module, "_client", lambda _ctx: fake_client)
    monkeypatch.setenv("ZAPIER_API_URL", "https://example.zapier.invalid")
    monkeypatch.setenv("ZAPIER_API_KEY", "super-secret-key")

    result = CliRunner().invoke(cli, ["--json", "zap", "trigger", "zap-123"])
    assert result.exit_code == 3

    payload = json.loads(result.output)
    assert payload["ok"] is False
    assert payload["command"] == "zap.trigger"
    assert payload["error"]["code"] == "PERMISSION_DENIED"
    assert payload["error"]["details"] == {"required_mode": "write", "actual_mode": "readonly"}
    assert fake_client.calls == []


def test_zap_trigger_rejects_non_object_payload_json(monkeypatch):
    monkeypatch.setenv("ZAPIER_API_URL", "https://example.zapier.invalid")
    monkeypatch.setenv("ZAPIER_API_KEY", "super-secret-key")

    result = CliRunner().invoke(
        cli,
        ["--json", "--mode", "write", "zap", "trigger", "zap-123", "--payload-json", '["not","an","object"]'],
    )
    assert result.exit_code == 2

    payload = json.loads(result.output)
    assert payload["ok"] is False
    assert payload["command"] == "unknown"
    assert payload["error"]["code"] == "INVALID_USAGE"
    assert "--payload-json must decode to a JSON object" in payload["error"]["message"]
