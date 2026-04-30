from __future__ import annotations

import json
import subprocess
from pathlib import Path
from typing import Any

from click.testing import CliRunner
import pytest

from cli_aos.airtable.cli import cli
from cli_aos.airtable import client as airtable_client
from cli_aos.airtable import config as airtable_config
from cli_aos.airtable import service_keys


AGENT_HARNESS_ROOT = Path(__file__).resolve().parents[1]
CONNECTOR_PATH = AGENT_HARNESS_ROOT.parent / "connector.json"
PERMISSIONS_PATH = AGENT_HARNESS_ROOT / "permissions.json"
ALL_ENV_KEYS = (
    "AIRTABLE_API_TOKEN",
    "AOS_AIRTABLE_API_TOKEN",
    "AIRTABLE_BASE_ID",
    "AOS_AIRTABLE_BASE_ID",
    "AIRTABLE_TABLE_NAME",
    "AOS_AIRTABLE_TABLE_NAME",
    "AIRTABLE_WORKSPACE_ID",
    "AOS_AIRTABLE_WORKSPACE_ID",
    "AIRTABLE_API_BASE_URL",
)


@pytest.fixture(autouse=True)
def no_operator_service_keys_by_default(monkeypatch, tmp_path):
    monkeypatch.setattr(service_keys, "SERVICE_KEYS_PATH", tmp_path / "missing-service-keys.json")
    for key in ALL_ENV_KEYS:
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


class FakeResponse:
    def __init__(self, payload: dict[str, Any], status: int = 200) -> None:
        self._payload = json.dumps(payload).encode("utf-8")
        self.status = status

    def read(self) -> bytes:
        return self._payload

    def getcode(self) -> int:
        return self.status

    def __enter__(self) -> "FakeResponse":
        return self

    def __exit__(self, exc_type, exc, tb) -> bool:
        return False


def invoke_json(args: list[str], monkeypatch, transport=None, service_keys: dict[str, str] | None = None) -> dict[str, Any]:
    if monkeypatch is not None:
        real_resolver = airtable_config.resolve_named_value

        def resolver(*names: str, ctx_obj=None, default=None):
            for name in names:
                if name in (service_keys or {}):
                    return {"value": service_keys[name], "present": True, "usable": True, "source": "operator:service_keys", "variable": name}
            return real_resolver(*names, ctx_obj=ctx_obj, default=default)

        monkeypatch.setattr(airtable_config, "resolve_named_value", resolver)
        monkeypatch.setattr(airtable_client, "resolve_named_value", resolver)
    if transport is not None:
        monkeypatch.setattr(airtable_client, "urlopen", transport)
    result = CliRunner().invoke(cli, ["--json", *args])
    assert result.exit_code == 0, result.output
    return json.loads(result.output)


def transport_for(routes: dict[str, dict[str, Any]]):
    def _transport(request, timeout=30):  # noqa: ARG001
        url = getattr(request, "full_url", str(request))
        for needle, payload in routes.items():
            if needle in url:
                return FakeResponse(payload)
        raise AssertionError(f"unexpected Airtable request: {url}")

    return _transport


def write_transport_for(*, method: str, path: str, expected_body: dict[str, Any], response: dict[str, Any]):
    def _transport(request, timeout=30):  # noqa: ARG001
        url = getattr(request, "full_url", str(request))
        assert getattr(request, "method", "") == method
        assert path in url
        assert json.loads((request.data or b"{}").decode("utf-8")) == expected_body
        return FakeResponse(response)

    return _transport


def test_manifest_and_permissions_are_in_sync():
    manifest = json.loads(CONNECTOR_PATH.read_text())
    permissions = json.loads(PERMISSIONS_PATH.read_text())["permissions"]
    manifest_command_ids = [command["id"] for command in manifest["commands"]]

    assert "capabilities" in manifest_command_ids
    assert "doctor" in manifest_command_ids
    assert set(manifest_command_ids) == set(permissions.keys())
    assert manifest["scope"]["kind"] == "base-table-record"
    assert manifest["scope"]["live_write_smoke_tested"] is False
    assert manifest["auth"]["service_keys"] == ["AIRTABLE_API_TOKEN", "AIRTABLE_BASE_ID"]
    assert "AIRTABLE_API_BASE_URL" in manifest["auth"]["optional_service_keys"]
    assert manifest["scope"]["commandDefaults"]["record.list"]["options"]["table"] == "AIRTABLE_TABLE_NAME"


def test_capabilities_json_includes_manifest_metadata():
    payload = invoke_json(["capabilities"], monkeypatch=None)
    assert payload["tool"] == "aos-airtable"
    assert payload["manifest_schema_version"] == "1.0.0"
    assert "record.create" in json.dumps(payload)
    assert "read_support" in payload
    assert payload["scope"]["commandDefaults"]["table.read"]["args"] == ["AIRTABLE_TABLE_NAME"]


def test_health_reports_needs_setup_without_env(monkeypatch):
    monkeypatch.delenv("AIRTABLE_API_TOKEN", raising=False)
    monkeypatch.delenv("AIRTABLE_BASE_ID", raising=False)
    payload = invoke_json(["health"], monkeypatch)
    data = payload["data"]
    assert data["status"] == "needs_setup"
    assert data["live_backend_ready"] is False
    assert data["base_scoped_read_ready"] is False
    assert "AIRTABLE_API_TOKEN" in json.dumps(data)


def test_health_reports_partial_ready_when_token_present_but_base_missing(monkeypatch):
    monkeypatch.setenv("AIRTABLE_API_TOKEN", "pat_test_123")
    monkeypatch.delenv("AIRTABLE_BASE_ID", raising=False)
    payload = invoke_json(["health"], monkeypatch)
    data = payload["data"]
    assert data["status"] == "partial_ready"
    assert data["live_backend_ready"] is True
    assert data["base_scoped_read_ready"] is False


def test_health_reports_ready_when_setup_present(monkeypatch):
    monkeypatch.setenv("AIRTABLE_API_TOKEN", "pat_test_123")
    monkeypatch.setenv("AIRTABLE_BASE_ID", "app123")
    payload = invoke_json(["health"], monkeypatch)
    data = payload["data"]
    assert data["status"] == "ready"
    assert data["live_backend_ready"] is True
    assert data["base_scoped_read_ready"] is True


def test_config_show_redacts_sensitive_values(monkeypatch):
    monkeypatch.setenv("AIRTABLE_API_TOKEN", "pat_super_secret")
    monkeypatch.setenv("AIRTABLE_BASE_ID", "app123")
    monkeypatch.setenv("AIRTABLE_TABLE_NAME", "Projects")
    monkeypatch.setenv("AIRTABLE_WORKSPACE_ID", "wsp456")
    payload = invoke_json(["config", "show"], monkeypatch)
    data = payload["data"]
    assert "pat_super_secret" not in json.dumps(data)
    assert data["runtime"]["implementation_mode"] == "live_read_with_live_writes"
    assert data["read_support"]["base.list"] is True
    assert data["read_support"]["record.read"] is True
    assert data["write_support"]["live_writes_enabled"] is True
    assert data["write_support"]["scaffold_only"] is False
    assert data["scope"]["table_name"] == "Projects"
    assert data["scope"]["commandDefaults"]["record.list"]["options"]["table"] == "Projects"


def test_config_show_prefers_operator_service_keys(monkeypatch):
    monkeypatch.setenv("AIRTABLE_API_TOKEN", "env_token")
    monkeypatch.setenv("AIRTABLE_BASE_ID", "env_base")
    monkeypatch.setenv("AIRTABLE_TABLE_NAME", "Env Table")

    payload = invoke_json(
        ["config", "show"],
        monkeypatch,
        service_keys={
            "AIRTABLE_API_TOKEN": "operator_token",
            "AIRTABLE_BASE_ID": "operator_base",
            "AIRTABLE_TABLE_NAME": "Operator Table",
        },
    )
    data = payload["data"]
    assert "operator_token" not in json.dumps(data)
    assert "env_token" not in json.dumps(data)
    assert data["auth"]["sources"]["AIRTABLE_API_TOKEN"] == "operator:service_keys"
    assert data["scope"]["base_id"] == "operator_base"
    assert data["scope"]["table_name"] == "Operator Table"


def test_encrypted_repo_service_key_decrypts_with_master_key(monkeypatch, tmp_path):
    encrypted = encrypt_secret(tmp_path, "pat_encrypted")
    path = write_service_keys(tmp_path, {"AIRTABLE_API_TOKEN": encrypted})
    monkeypatch.setattr(service_keys, "SERVICE_KEYS_PATH", path)
    monkeypatch.setenv("HOME", str(tmp_path / "home"))

    details = service_keys.service_key_details("AIRTABLE_API_TOKEN")

    assert details["value"] == "pat_encrypted"
    assert details["source"] == "repo-service-key"


def test_unreadable_encrypted_repo_service_key_falls_back_to_env_like_core_resolver(monkeypatch, tmp_path):
    path = write_service_keys(tmp_path, {"AIRTABLE_API_TOKEN": "enc:v1:bad:bad:bad"})
    monkeypatch.setattr(service_keys, "SERVICE_KEYS_PATH", path)
    monkeypatch.setenv("AIRTABLE_API_TOKEN", "env-token")

    details = service_keys.service_key_details("AIRTABLE_API_TOKEN")

    assert details["value"] == "env-token"
    assert details["source"] == "env_fallback"


def test_scoped_repo_service_key_blocks_env_and_legacy_alias_fallback(monkeypatch, tmp_path):
    path = write_service_keys(
        tmp_path,
        {
            "AIRTABLE_API_TOKEN": "scoped-token",
            "AIRTABLE_BASE_ID": "scoped-base",
        },
        extra={"allowedRoles": ["operator"]},
    )
    monkeypatch.setattr(service_keys, "SERVICE_KEYS_PATH", path)
    monkeypatch.setenv("AIRTABLE_API_TOKEN", "env-token")
    monkeypatch.setenv("AOS_AIRTABLE_API_TOKEN", "legacy-env-token")
    monkeypatch.setenv("AIRTABLE_BASE_ID", "env-base")
    monkeypatch.setenv("AOS_AIRTABLE_BASE_ID", "legacy-env-base")

    token = service_keys.resolve_named_value("AIRTABLE_API_TOKEN", "AOS_AIRTABLE_API_TOKEN")
    base = service_keys.resolve_named_value("AIRTABLE_BASE_ID", "AOS_AIRTABLE_BASE_ID")

    assert token["value"] == ""
    assert token["source"] == "repo-service-key-scoped"
    assert token["blocked"] is True
    assert base["value"] == ""
    assert base["source"] == "repo-service-key-scoped"


def test_operator_table_default_reaches_live_record_command(monkeypatch):
    transport = transport_for(
        {
            "/v0/operator_base/Operator%20Table?pageSize=2": {
                "records": [
                    {"id": "rec1", "createdTime": "2026-03-18T00:00:00.000Z", "fields": {"Name": "Alpha"}},
                ]
            }
        }
    )

    payload = invoke_json(
        ["record", "list", "--limit", "2"],
        monkeypatch,
        transport=transport,
        service_keys={
            "AIRTABLE_API_TOKEN": "operator_token",
            "AIRTABLE_BASE_ID": "operator_base",
            "AIRTABLE_TABLE_NAME": "Operator Table",
        },
    )

    data = payload["data"]
    assert data["status"] == "live_read"
    assert data["table"] == "Operator Table"
    assert data["record_count"] == 1


def test_doctor_reports_live_read_support_when_setup_present(monkeypatch):
    monkeypatch.setenv("AIRTABLE_API_TOKEN", "pat_test_123")
    monkeypatch.setenv("AIRTABLE_BASE_ID", "app123")
    monkeypatch.setenv("AIRTABLE_TABLE_NAME", "Projects")
    payload = invoke_json(["doctor"], monkeypatch)
    data = payload["data"]
    assert data["status"] == "ready"
    assert data["runtime"]["command_readiness"]["table.read"] is True
    assert data["runtime"]["base_scoped_read_ready"] is True
    assert data["runtime"]["table_name_present"] is True
    assert data["checks"][1]["details"]["implementation_mode"] == "live_read_with_live_writes"


def test_base_list_reads_live_bases(monkeypatch):
    monkeypatch.setenv("AIRTABLE_API_TOKEN", "pat_test_123")
    monkeypatch.delenv("AIRTABLE_BASE_ID", raising=False)
    transport = transport_for(
        {
            "/v0/meta/bases": {
                "bases": [
                    {"id": "app111", "name": "Projects"},
                    {"id": "app222", "name": "Operations"},
                ]
            }
        }
    )
    payload = invoke_json(["base", "list", "--limit", "1"], monkeypatch, transport=transport)
    data = payload["data"]
    assert data["status"] == "live_read"
    assert data["base_count"] == 1
    assert data["bases"][0]["name"] == "Projects"
    assert data["picker"]["kind"] == "base"
    assert data["picker"]["items"][0]["label"] == "Projects (app111)"
    assert data["scope"]["preview"]["base_id"] is None
    assert data["scope"]["preview"]["table_name"] is None
    assert data["scope"]["preview"]["picker"]["kind"] == "base"


def test_base_list_marks_configured_base_as_selected(monkeypatch):
    monkeypatch.setenv("AIRTABLE_API_TOKEN", "pat_test_123")
    monkeypatch.setenv("AIRTABLE_BASE_ID", "app222")
    transport = transport_for(
        {
            "/v0/meta/bases": {
                "bases": [
                    {"id": "app111", "name": "Projects"},
                    {"id": "app222", "name": "Operations"},
                ]
            }
        }
    )
    payload = invoke_json(["base", "list"], monkeypatch, transport=transport)
    data = payload["data"]
    selected = next(item for item in data["picker"]["items"] if item["id"] == "app222")
    assert selected["selected"] is True


def test_base_read_returns_live_schema(monkeypatch):
    monkeypatch.setenv("AIRTABLE_API_TOKEN", "pat_test_123")
    monkeypatch.delenv("AIRTABLE_BASE_ID", raising=False)
    transport = transport_for(
        {
            "/v0/meta/bases/app123/tables": {
                "tables": [
                    {
                        "id": "tbl123",
                        "name": "Projects",
                        "fields": [{"id": "fld1", "name": "Name", "type": "singleLineText"}],
                        "views": [{"id": "viw1", "name": "Grid view"}],
                    }
                ]
            }
        }
    )
    payload = invoke_json(["base", "read", "app123"], monkeypatch, transport=transport)
    data = payload["data"]
    assert data["status"] == "live_read"
    assert data["base"]["id"] == "app123"
    assert data["table_count"] == 1
    assert data["tables"][0]["name"] == "Projects"
    assert data["base"]["table_picker"][0]["label"] == "Projects (tbl123)"
    assert data["base"]["selected_table_name"] is None
    assert data["scope"]["preview"]["base_id"] == "app123"
    assert data["scope"]["preview"]["table_name"] is None
    assert data["scope"]["preview"]["picker"]["kind"] == "table"


def test_base_read_uses_default_base_id_when_argument_is_omitted(monkeypatch):
    monkeypatch.setenv("AIRTABLE_API_TOKEN", "pat_test_123")
    monkeypatch.setenv("AIRTABLE_BASE_ID", "app123")
    transport = transport_for(
        {
            "/v0/meta/bases/app123/tables": {
                "tables": [
                    {"id": "tbl123", "name": "Projects", "fields": [], "views": []},
                ]
            }
        }
    )
    payload = invoke_json(["base", "read"], monkeypatch, transport=transport)
    data = payload["data"]
    assert data["status"] == "live_read"
    assert data["base"]["id"] == "app123"


def test_table_list_reads_live_schema(monkeypatch):
    monkeypatch.setenv("AIRTABLE_API_TOKEN", "pat_test_123")
    monkeypatch.setenv("AIRTABLE_BASE_ID", "app123")
    monkeypatch.setenv("AIRTABLE_TABLE_NAME", "Projects")
    transport = transport_for(
        {
            "/v0/meta/bases/app123/tables": {
                "tables": [
                    {"id": "tbl123", "name": "Projects", "fields": [], "views": []},
                    {"id": "tbl456", "name": "Tasks", "fields": [], "views": []},
                ]
            }
        }
    )
    payload = invoke_json(["table", "list"], monkeypatch, transport=transport)
    data = payload["data"]
    assert data["status"] == "live_read"
    assert data["table_count"] == 2
    assert [table["name"] for table in data["tables"]] == ["Projects", "Tasks"]
    assert data["base"]["selected_table_name"] == "Projects"
    assert data["table_picker"][0]["field_count"] == 0
    assert data["scope"]["preview"]["table_name"] == "Projects"
    assert data["scope"]["preview"]["picker"]["kind"] == "table"


def test_table_read_returns_live_table_schema(monkeypatch):
    monkeypatch.setenv("AIRTABLE_API_TOKEN", "pat_test_123")
    monkeypatch.setenv("AIRTABLE_BASE_ID", "app123")
    monkeypatch.setenv("AIRTABLE_TABLE_NAME", "Projects")
    transport = transport_for(
        {
            "/v0/meta/bases/app123/tables": {
                "tables": [
                    {"id": "tbl123", "name": "Projects", "fields": [], "views": []},
                    {"id": "tbl456", "name": "Tasks", "fields": [], "views": []},
                ]
            }
        }
    )
    payload = invoke_json(["table", "read", "Tasks"], monkeypatch, transport=transport)
    data = payload["data"]
    assert data["status"] == "live_read"
    assert data["table"]["name"] == "Tasks"
    assert data["base"]["id"] == "app123"
    assert data["table_picker"]["name"] == "Tasks"
    assert data["scope"]["preview"]["table_name"] == "Tasks"
    assert data["scope"]["preview"]["picker"]["kind"] == "table"


def test_table_read_uses_default_table_when_argument_is_omitted(monkeypatch):
    monkeypatch.setenv("AIRTABLE_API_TOKEN", "pat_test_123")
    monkeypatch.setenv("AIRTABLE_BASE_ID", "app123")
    monkeypatch.setenv("AIRTABLE_TABLE_NAME", "Projects")
    transport = transport_for(
        {
            "/v0/meta/bases/app123/tables": {
                "tables": [
                    {"id": "tbl123", "name": "Projects", "fields": [], "views": []},
                    {"id": "tbl456", "name": "Tasks", "fields": [], "views": []},
                ]
            }
        }
    )
    payload = invoke_json(["table", "read"], monkeypatch, transport=transport)
    data = payload["data"]
    assert data["status"] == "live_read"
    assert data["table"]["name"] == "Projects"


def test_record_list_reads_live_records(monkeypatch):
    monkeypatch.setenv("AIRTABLE_API_TOKEN", "pat_test_123")
    monkeypatch.setenv("AIRTABLE_BASE_ID", "app123")
    monkeypatch.setenv("AIRTABLE_TABLE_NAME", "Projects")
    transport = transport_for(
        {
            "/v0/app123/Projects?pageSize=2": {
                "records": [
                    {"id": "rec1", "createdTime": "2026-03-18T00:00:00.000Z", "fields": {"Name": "Alpha"}},
                    {"id": "rec2", "createdTime": "2026-03-18T00:00:00.000Z", "fields": {"Name": "Beta"}},
                ]
            }
        }
    )
    payload = invoke_json(["record", "list", "--limit", "2", "--table", "Projects"], monkeypatch, transport=transport)
    data = payload["data"]
    assert data["status"] == "live_read"
    assert data["record_count"] == 2
    assert [record["id"] for record in data["records"]] == ["rec1", "rec2"]
    assert data["base_id"] == "app123"
    assert data["scope"]["preview"]["table_name"] == "Projects"
    assert data["scope"]["preview"]["table_scope"]["record_readiness"]["record.list"] is True


def test_record_search_reads_and_filters_live_records(monkeypatch):
    monkeypatch.setenv("AIRTABLE_API_TOKEN", "pat_test_123")
    monkeypatch.setenv("AIRTABLE_BASE_ID", "app123")
    monkeypatch.setenv("AIRTABLE_TABLE_NAME", "Projects")
    transport = transport_for(
        {
            "/v0/app123/Projects?pageSize=100": {
                "records": [
                    {"id": "rec1", "fields": {"Name": "Alpha"}},
                    {"id": "rec2", "fields": {"Name": "Launch Plan"}},
                ]
            }
        }
    )
    payload = invoke_json(["record", "search", "--table", "Projects", "--query", "launch"], monkeypatch, transport=transport)
    data = payload["data"]
    assert data["status"] == "live_read"
    assert data["record_count"] == 1
    assert data["records"][0]["id"] == "rec2"
    assert data["search_strategy"] == "client_side_contains"


def test_record_list_uses_default_table_when_option_is_omitted(monkeypatch):
    monkeypatch.setenv("AIRTABLE_API_TOKEN", "pat_test_123")
    monkeypatch.setenv("AIRTABLE_BASE_ID", "app123")
    monkeypatch.setenv("AIRTABLE_TABLE_NAME", "Projects")
    transport = transport_for(
        {
            "/v0/app123/Projects?pageSize=2": {
                "records": [
                    {"id": "rec1", "createdTime": "2026-03-18T00:00:00.000Z", "fields": {"Name": "Alpha"}},
                    {"id": "rec2", "createdTime": "2026-03-18T00:00:00.000Z", "fields": {"Name": "Beta"}},
                ]
            }
        }
    )
    payload = invoke_json(["record", "list", "--limit", "2"], monkeypatch, transport=transport)
    data = payload["data"]
    assert data["status"] == "live_read"
    assert data["table"] == "Projects"
    assert data["record_count"] == 2


def test_record_search_uses_default_table_when_option_is_omitted(monkeypatch):
    monkeypatch.setenv("AIRTABLE_API_TOKEN", "pat_test_123")
    monkeypatch.setenv("AIRTABLE_BASE_ID", "app123")
    monkeypatch.setenv("AIRTABLE_TABLE_NAME", "Projects")
    transport = transport_for(
        {
            "/v0/app123/Projects?pageSize=100": {
                "records": [
                    {"id": "rec1", "fields": {"Name": "Alpha"}},
                    {"id": "rec2", "fields": {"Name": "Launch Plan"}},
                ]
            }
        }
    )
    payload = invoke_json(["record", "search", "--query", "launch"], monkeypatch, transport=transport)
    data = payload["data"]
    assert data["status"] == "live_read"
    assert data["table"] == "Projects"
    assert data["record_count"] == 1


def test_record_read_returns_live_record(monkeypatch):
    monkeypatch.setenv("AIRTABLE_API_TOKEN", "pat_test_123")
    monkeypatch.setenv("AIRTABLE_BASE_ID", "app123")
    monkeypatch.setenv("AIRTABLE_TABLE_NAME", "Projects")
    transport = transport_for(
        {
            "/v0/app123/Projects/rec1": {
                "id": "rec1",
                "createdTime": "2026-03-18T00:00:00.000Z",
                "fields": {"Name": "Alpha"},
            }
        }
    )
    payload = invoke_json(["record", "read", "rec1", "--table", "Projects"], monkeypatch, transport=transport)
    data = payload["data"]
    assert data["status"] == "live_read"
    assert data["record"]["id"] == "rec1"
    assert data["record"]["fields"]["Name"] == "Alpha"


def test_record_read_uses_default_table_when_option_is_omitted(monkeypatch):
    monkeypatch.setenv("AIRTABLE_API_TOKEN", "pat_test_123")
    monkeypatch.setenv("AIRTABLE_BASE_ID", "app123")
    monkeypatch.setenv("AIRTABLE_TABLE_NAME", "Projects")
    transport = transport_for(
        {
            "/v0/app123/Projects/rec1": {
                "id": "rec1",
                "createdTime": "2026-03-18T00:00:00.000Z",
                "fields": {"Name": "Alpha"},
            }
        }
    )
    payload = invoke_json(["record", "read", "rec1"], monkeypatch, transport=transport)
    data = payload["data"]
    assert data["status"] == "live_read"
    assert data["table"] == "Projects"
    assert data["record"]["id"] == "rec1"


def test_permission_denied_for_write_path_in_readonly():
    result = CliRunner().invoke(
        cli,
        [
            "--json",
            "--mode",
            "readonly",
            "record",
            "create",
            "--table",
            "Projects",
            "--field",
            "Name=New Project",
        ],
    )
    assert result.exit_code == 3
    assert "PERMISSION_DENIED" in result.output
    assert "requires mode=write" in result.output


def test_record_create_writes_live_record(monkeypatch):
    monkeypatch.setenv("AIRTABLE_API_TOKEN", "pat_test_123")
    monkeypatch.setenv("AIRTABLE_BASE_ID", "app123")
    transport = write_transport_for(
        method="POST",
        path="/v0/app123/Projects",
        expected_body={"fields": {"Status": "Draft", "Name": "New Project"}, "typecast": True},
        response={
            "id": "rec_new",
            "createdTime": "2026-03-18T00:00:00.000Z",
            "fields": {"Name": "New Project", "Status": "Draft"},
        },
    )
    payload = invoke_json(
        [
            "--mode",
            "write",
            "record",
            "create",
            "--table",
            "Projects",
            "--field",
            "Name=New Project",
            "--fields-json",
            '{"Status":"Draft"}',
            "--typecast",
        ],
        monkeypatch,
        transport=transport,
    )
    data = payload["data"]
    assert data["status"] == "live_write"
    assert data["record_id"] == "rec_new"
    assert data["record"]["fields"]["Name"] == "New Project"
    assert data["write_support"]["live_writes_enabled"] is True


def test_record_update_writes_live_record(monkeypatch):
    monkeypatch.setenv("AIRTABLE_API_TOKEN", "pat_test_123")
    monkeypatch.setenv("AIRTABLE_BASE_ID", "app123")
    transport = write_transport_for(
        method="PATCH",
        path="/v0/app123/Projects/rec123",
        expected_body={"fields": {"Status": "Draft"}},
        response={
            "id": "rec123",
            "createdTime": "2026-03-18T00:00:00.000Z",
            "fields": {"Status": "Draft"},
        },
    )
    payload = invoke_json(
        [
            "--mode",
            "write",
            "record",
            "update",
            "rec123",
            "--table",
            "Projects",
            "--field",
            "Status=Draft",
        ],
        monkeypatch,
        transport=transport,
    )
    data = payload["data"]
    assert data["status"] == "live_write"
    assert data["record_id"] == "rec123"
    assert data["record"]["fields"]["Status"] == "Draft"
