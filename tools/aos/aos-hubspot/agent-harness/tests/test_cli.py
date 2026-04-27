import json
from pathlib import Path
import subprocess

from click.testing import CliRunner
import pytest

import cli_aos.hubspot.bridge as bridge
import cli_aos.hubspot.commands as commands
import cli_aos.hubspot.config as hubspot_config
import cli_aos.hubspot.runtime as runtime
import cli_aos.hubspot.service_keys as service_keys
from cli_aos.hubspot.cli import cli


AGENT_HARNESS_ROOT = Path(__file__).resolve().parents[1]
CONNECTOR_PATH = AGENT_HARNESS_ROOT.parent / "connector.json"
PERMISSIONS_PATH = AGENT_HARNESS_ROOT / "permissions.json"
ALL_ENV_KEYS = (
    "HUBSPOT_ACCESS_TOKEN",
    "AOS_HUBSPOT_ACCESS_TOKEN",
    "HUBSPOT_PORTAL_ID",
    "AOS_HUBSPOT_PORTAL_ID",
    "HUBSPOT_ACCOUNT_ALIAS",
    "AOS_HUBSPOT_ACCOUNT_ALIAS",
    "HUBSPOT_APP_ID",
    "AOS_HUBSPOT_APP_ID",
    "HUBSPOT_WEBHOOK_SECRET",
    "AOS_HUBSPOT_WEBHOOK_SECRET",
    "HUBSPOT_BASE_URL",
    "AOS_HUBSPOT_BASE_URL",
)


def invoke_json(args: list[str]) -> dict:
    result = CliRunner().invoke(cli, ["--json", *args])
    assert result.exit_code == 0, result.output
    return json.loads(result.output)


def write_service_keys(tmp_path: Path, values: dict[str, str], *, extra: dict | None = None) -> Path:
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


def _service_key_details_map(values: dict[str, str]):
    def fake_service_key_details(variable: str, ctx_obj=None, default=None):  # noqa: ANN001
        value = values.get(variable)
        if value:
            return {"value": value, "present": True, "usable": True, "source": "service-keys", "variable": variable}
        fallback = default or ""
        if fallback:
            return {"value": fallback, "present": False, "usable": True, "source": "default", "variable": variable}
        return {"value": "", "present": False, "usable": False, "source": "missing", "variable": variable}

    return fake_service_key_details


def _clear_env(monkeypatch) -> None:
    for key in ALL_ENV_KEYS:
        monkeypatch.delenv(key, raising=False)


@pytest.fixture(autouse=True)
def no_operator_service_keys_by_default(monkeypatch, tmp_path):
    monkeypatch.setattr(service_keys, "SERVICE_KEYS_PATH", tmp_path / "missing-service-keys.json")
    _clear_env(monkeypatch)


def test_manifest_and_permissions_are_in_sync():
    manifest = json.loads(CONNECTOR_PATH.read_text())
    permissions = json.loads(PERMISSIONS_PATH.read_text())["permissions"]
    manifest_command_ids = [command["id"] for command in manifest["commands"]]

    assert "capabilities" in manifest_command_ids
    assert "health" in manifest_command_ids
    assert "config.show" in manifest_command_ids
    assert "doctor" in manifest_command_ids
    assert set(manifest_command_ids) == set(permissions.keys())
    assert manifest["scope"]["live_read_available"] is True
    assert manifest["scope"]["write_bridge_available"] is True
    assert manifest["scope"]["live_write_smoke_tested"] is False
    assert "HUBSPOT_ACCESS_TOKEN" in manifest["scope"]["required"]


def test_capabilities_json():
    payload = invoke_json(["capabilities"])
    command_ids = {command["id"] for command in payload["data"]["commands"]}
    manifest = json.loads(CONNECTOR_PATH.read_text())

    assert payload["tool"] == "aos-hubspot"
    assert payload["data"]["manifest_schema_version"] == "1.0.0"
    assert payload["data"]["auth"] == manifest["auth"]
    assert payload["data"]["scope"] == manifest["scope"]
    assert payload["data"]["scope"]["live_read_available"] is True
    assert payload["data"]["scope"]["write_bridge_available"] is True
    assert payload["data"]["scope"]["live_write_smoke_tested"] is False
    assert payload["data"]["scope"]["required"] == ["HUBSPOT_ACCESS_TOKEN", "HUBSPOT_PORTAL_ID"]
    assert "contact.list" in command_ids
    assert "capabilities" in command_ids
    assert "doctor" in command_ids


def test_health_reports_needs_setup_without_env():
    payload = invoke_json(["health"])
    assert payload["data"]["status"] == "needs_setup"


def test_health_reports_probe_failure(monkeypatch):
    monkeypatch.setenv("HUBSPOT_PORTAL_ID", "123")
    monkeypatch.setenv("HUBSPOT_ACCESS_TOKEN", "token")
    monkeypatch.setattr(
        bridge,
        "probe_api",
        lambda _ctx: {"ok": False, "code": "HUBSPOT_AUTH_ERROR", "message": "bad token", "details": {}},
    )
    payload = invoke_json(["health"])
    assert payload["data"]["status"] == "auth_error"
    assert payload["data"]["checks"][2]["details"] == {}
    assert "bad token" in payload["data"]["summary"]


def test_permission_gate_blocks_write_for_readonly():
    result = CliRunner().invoke(
        cli,
        [
            "--json",
            "--mode",
            "readonly",
            "contact",
            "create",
            "--property",
            "email=test@example.com",
        ],
    )
    assert result.exit_code == 3
    assert "PERMISSION_DENIED" in result.output


def test_config_show_redacts_token_value(monkeypatch):
    monkeypatch.setenv("HUBSPOT_PORTAL_ID", "123")
    monkeypatch.setenv("HUBSPOT_ACCESS_TOKEN", "super-secret-token")
    monkeypatch.setattr(
        bridge,
        "probe_api",
        lambda _ctx: {"ok": True, "code": "OK", "message": "probe ok", "details": {"portal_id": "123"}},
    )
    payload = invoke_json(["config", "show"])
    serialized = json.dumps(payload)
    assert "super-secret-token" not in serialized
    assert payload["data"]["access_token_present"] is True
    assert payload["data"]["auth_ready"] is True
    assert payload["data"]["runtime_ready"] is True
    assert payload["data"]["api_probe"]["message"] == "probe ok"


def test_config_show_uses_service_key_resolver_when_env_missing(monkeypatch):
    monkeypatch.delenv("HUBSPOT_PORTAL_ID", raising=False)
    monkeypatch.delenv("HUBSPOT_ACCESS_TOKEN", raising=False)
    monkeypatch.setattr(
        service_keys,
        "service_key_details",
        _service_key_details_map({"HUBSPOT_PORTAL_ID": "123", "HUBSPOT_ACCESS_TOKEN": "service-token"}),
    )
    monkeypatch.setattr(
        bridge,
        "probe_api",
        lambda _ctx: {"ok": True, "code": "OK", "message": "probe ok", "details": {"portal_id": "123"}},
    )

    payload = invoke_json(["config", "show"])
    assert payload["data"]["portal_id"] == "123"
    assert payload["data"]["access_token_present"] is True
    assert payload["data"]["auth_ready"] is True
    assert payload["data"]["portal_id_source_kind"] == "service-keys"
    assert payload["data"]["access_token_source_kind"] == "service-keys"


def test_config_show_prefers_operator_service_keys_over_local_env(monkeypatch):
    monkeypatch.setenv("HUBSPOT_PORTAL_ID", "env-portal")
    monkeypatch.setenv("HUBSPOT_ACCESS_TOKEN", "env-token")
    monkeypatch.setattr(
        service_keys,
        "service_key_details",
        _service_key_details_map({"HUBSPOT_PORTAL_ID": "svc-portal", "HUBSPOT_ACCESS_TOKEN": "svc-token"}),
    )
    monkeypatch.setattr(
        bridge,
        "probe_api",
        lambda _ctx: {"ok": True, "code": "OK", "message": "probe ok", "details": {"portal_id": "svc-portal"}},
    )

    payload = invoke_json(["config", "show"])
    serialized = json.dumps(payload)
    assert "svc-token" not in serialized
    assert "env-token" not in serialized
    assert payload["data"]["portal_id"] == "svc-portal"
    assert payload["data"]["portal_id_source_kind"] == "service-keys"
    assert payload["data"]["access_token_source_kind"] == "service-keys"


def test_encrypted_repo_service_key_decrypts_with_master_key(monkeypatch, tmp_path):
    home = tmp_path / "home"
    key_dir = home / ".argentos"
    key_dir.mkdir(parents=True, exist_ok=True)
    (key_dir / ".master-key").write_text("11" * 32)
    monkeypatch.setenv("HOME", str(home))
    encrypted = encrypt_secret(tmp_path, "operator-token")
    monkeypatch.setattr(
        service_keys,
        "SERVICE_KEYS_PATH",
        write_service_keys(tmp_path, {"HUBSPOT_ACCESS_TOKEN": encrypted}),
    )

    resolved = hubspot_config.resolve_runtime_values({})
    assert resolved["access_token"] == "operator-token"
    assert resolved["access_token_source_kind"] == "repo-service-key"
    assert resolved["access_token_usable"] is True


def test_unreadable_encrypted_repo_service_key_falls_back_to_env_like_core_resolver(monkeypatch, tmp_path):
    monkeypatch.setenv("HUBSPOT_ACCESS_TOKEN", "env-token")
    monkeypatch.setattr(
        service_keys,
        "SERVICE_KEYS_PATH",
        write_service_keys(tmp_path, {"HUBSPOT_ACCESS_TOKEN": "enc:v1:abc:def:ghi"}),
    )

    resolved = hubspot_config.resolve_runtime_values({})
    assert resolved["access_token"] == "env-token"
    assert resolved["access_token_source_kind"] == "env_fallback"
    assert resolved["access_token_usable"] is True


def test_scoped_repo_service_key_blocks_env_fallback(monkeypatch, tmp_path):
    monkeypatch.setenv("HUBSPOT_ACCESS_TOKEN", "env-token")
    monkeypatch.setattr(
        service_keys,
        "SERVICE_KEYS_PATH",
        write_service_keys(tmp_path, {"HUBSPOT_ACCESS_TOKEN": "repo-token"}, extra={"allowedRoles": ["operator"]}),
    )

    resolved = hubspot_config.resolve_runtime_values({})
    assert resolved["access_token"] is None
    assert resolved["access_token_source_kind"] == "repo-service-key-scoped"
    assert resolved["access_token_usable"] is False


def test_live_read_uses_operator_context_keys(monkeypatch):
    calls: list[dict] = []

    def fake_urlopen(req, timeout):  # noqa: ANN001
        calls.append(
            {
                "url": req.full_url,
                "auth": req.headers.get("Authorization"),
                "method": req.get_method(),
                "timeout": timeout,
            }
        )

        class FakeResponse:
            class Headers:
                def get_content_charset(self, default):
                    return default

            headers = Headers()

            def __enter__(self):
                return self

            def __exit__(self, *_args):
                return None

            def read(self):
                return json.dumps({"results": [{"id": "1", "properties": {"email": "ada@example.com"}}]}).encode()

        return FakeResponse()

    monkeypatch.setattr(runtime.request, "urlopen", fake_urlopen)
    payload = runtime.list_objects(
        {
            "service_keys": {
                "aos-hubspot": {
                    "access_token": "operator-context-token",
                    "portal_id": "portal-123",
                    "base_url": "https://operator.example.test",
                }
            }
        },
        resource="contact",
        limit=1,
        after=None,
        properties=["email"],
    )

    assert payload["count"] == 1
    assert calls[0]["method"] == "GET"
    assert calls[0]["url"].startswith("https://operator.example.test/crm/v3/objects/contacts")
    assert calls[0]["auth"] == "Bearer operator-context-token"


def test_live_write_uses_operator_context_keys(monkeypatch):
    calls: list[dict] = []

    def fake_urlopen(req, timeout):  # noqa: ANN001
        calls.append(
            {
                "url": req.full_url,
                "auth": req.headers.get("Authorization"),
                "method": req.get_method(),
                "timeout": timeout,
                "body": json.loads(req.data.decode()) if req.data else None,
            }
        )

        class FakeResponse:
            class Headers:
                def get_content_charset(self, default):
                    return default

            headers = Headers()

            def __enter__(self):
                return self

            def __exit__(self, *_args):
                return None

            def read(self):
                return json.dumps(
                    {
                        "id": "contact-1",
                        "createdAt": "2026-03-18T00:00:00Z",
                        "updatedAt": "2026-03-18T00:00:00Z",
                        "properties": {"email": "ada@example.com"},
                    }
                ).encode()

        return FakeResponse()

    monkeypatch.setattr(runtime.request, "urlopen", fake_urlopen)
    payload = runtime.create_object(
        {
            "service_keys": {
                "aos-hubspot": {
                    "access_token": "operator-write-token",
                    "portal_id": "portal-123",
                    "base_url": "https://operator.example.test",
                }
            }
        },
        resource="contact",
        properties={"email": "ada@example.com"},
        command_id="contact.create",
    )

    assert payload["executed"] is True
    assert calls[0]["method"] == "POST"
    assert calls[0]["url"] == "https://operator.example.test/crm/v3/objects/contacts"
    assert calls[0]["auth"] == "Bearer operator-write-token"
    assert calls[0]["body"] == {"properties": {"email": "ada@example.com"}}


def test_contact_list_uses_runtime(monkeypatch):
    monkeypatch.setattr(
        commands,
        "list_objects",
        lambda *_args, **_kwargs: {"status": "ok", "resource": "contact", "operation": "list", "results": [{"id": "1"}]},
    )
    result = CliRunner().invoke(cli, ["--json", "contact", "list", "--limit", "1"])
    assert result.exit_code == 0
    assert '"resource": "contact"' in result.output
    assert '"operation": "list"' in result.output
    assert '"id": "1"' in result.output


def test_owner_list_exposes_picker_options_and_scope_preview(monkeypatch):
    monkeypatch.setenv("HUBSPOT_PORTAL_ID", "123")
    monkeypatch.setenv("HUBSPOT_ACCESS_TOKEN", "token")
    monkeypatch.setenv("HUBSPOT_ACCOUNT_ALIAS", "north-america-crm")
    monkeypatch.setattr(
        runtime,
        "_request_json",
        lambda *_args, **_kwargs: {
            "results": [
                {"id": "11", "firstName": "Ada", "lastName": "Lovelace", "email": "ada@example.com", "teams": [{"id": "t1"}]},
                {"id": "12", "firstName": "Grace", "lastName": "Hopper", "email": "grace@example.com", "teams": []},
            ],
            "paging": {},
        },
    )

    result = CliRunner().invoke(cli, ["--json", "owner", "list", "--limit", "2"])
    assert result.exit_code == 0
    payload = json.loads(result.output)["data"]
    assert payload["scope"]["portal_id"] == "123"
    assert payload["scope"]["preview"]["command_id"] == "owner.list"
    assert payload["scope"]["preview"]["picker"]["kind"] == "owner"
    assert payload["scope_candidates"][0]["kind"] == "portal"
    assert payload["scope_candidates"][0]["label"] == "Portal 123"
    assert any(candidate["kind"] == "account_alias" and candidate["label"] == "north-america-crm" for candidate in payload["scope_candidates"])
    assert any(candidate["kind"] == "team" and candidate["value"] == "t1" for candidate in payload["scope_candidates"])
    assert any(candidate["kind"] == "owner" and candidate["label"] == "Ada Lovelace" for candidate in payload["scope_candidates"])
    assert payload["picker_options"][0]["label"] == "Ada Lovelace"
    assert payload["picker_options"][0]["subtitle"] == "ada@example.com | t1 | teams=1"
    assert payload["scope_preview"]["candidate_count"] == 2
    assert payload["scope_preview"]["scope_candidate_count"] == 5


def test_pipeline_list_exposes_picker_options(monkeypatch):
    monkeypatch.setenv("HUBSPOT_PORTAL_ID", "123")
    monkeypatch.setenv("HUBSPOT_ACCESS_TOKEN", "token")
    monkeypatch.setenv("HUBSPOT_ACCOUNT_ALIAS", "north-america-crm")
    monkeypatch.setattr(
        runtime,
        "_request_json",
        lambda *_args, **_kwargs: {
            "results": [
                {
                    "id": "default",
                    "label": "Sales Pipeline",
                    "displayOrder": 0,
                    "stages": [{"id": "1", "label": "Open"}, {"id": "2", "label": "Closed"}],
                }
            ]
        },
    )

    result = CliRunner().invoke(cli, ["--json", "pipeline", "list", "--object-type", "deal"])
    assert result.exit_code == 0
    payload = json.loads(result.output)["data"]
    assert payload["object_type"] == "deal"
    assert payload["scope"]["preview"]["picker"]["kind"] == "pipeline"
    assert any(candidate["kind"] == "portal" for candidate in payload["scope_candidates"])
    assert any(candidate["kind"] == "account_alias" and candidate["label"] == "north-america-crm" for candidate in payload["scope_candidates"])
    assert any(candidate["kind"] == "object_type" and candidate["label"] == "deal pipelines" for candidate in payload["scope_candidates"])
    assert payload["picker_options"][0]["label"] == "Sales Pipeline"
    assert payload["picker_options"][0]["subtitle"] == "stages=2 | Open"
    assert payload["scope_preview"]["candidate_count"] == 1
    assert payload["scope_preview"]["scope_candidate_count"] == 4


def test_contact_search_uses_runtime(monkeypatch):
    monkeypatch.setattr(
        commands,
        "search_objects",
        lambda *_args, **_kwargs: {"status": "ok", "resource": "contact", "operation": "search", "results": [{"id": "2"}]},
    )
    result = CliRunner().invoke(cli, ["--json", "contact", "search", "--query", "someone@example.com"])
    assert result.exit_code == 0
    assert '"operation": "search"' in result.output
    assert '"id": "2"' in result.output


def test_contact_list_exposes_picker_options(monkeypatch):
    monkeypatch.setenv("HUBSPOT_PORTAL_ID", "123")
    monkeypatch.setenv("HUBSPOT_ACCESS_TOKEN", "token")
    monkeypatch.setenv("HUBSPOT_ACCOUNT_ALIAS", "north-america-crm")

    def fake_request_json(ctx_obj, method, path, *, query=None, payload=None):
        if path == "/crm/v3/objects/contacts":
            return {
                "results": [
                    {
                        "id": "1",
                        "createdAt": "2026-03-18T00:00:00Z",
                        "updatedAt": "2026-03-18T00:00:00Z",
                        "properties": {
                            "firstname": "Ada",
                            "lastname": "Lovelace",
                            "email": "ada@example.com",
                            "hubspot_owner_id": "11",
                        },
                    }
                ],
                "paging": {},
            }
        raise AssertionError(path)

    monkeypatch.setattr(runtime, "_request_json", fake_request_json)

    result = CliRunner().invoke(cli, ["--json", "contact", "list", "--limit", "1"])
    assert result.exit_code == 0
    payload = json.loads(result.output)["data"]
    assert payload["scope"]["preview"]["picker"]["kind"] == "contact"
    assert any(candidate["kind"] == "portal" for candidate in payload["scope_candidates"])
    assert any(candidate["kind"] == "owner" and candidate["value"] == "11" for candidate in payload["scope_candidates"])
    assert any(candidate["kind"] == "contact" and candidate["label"] == "Ada" for candidate in payload["scope_candidates"])
    assert payload["picker_options"][0]["label"] == "Ada"
    assert payload["picker_options"][0]["resource"] == "contact"
    assert payload["scope_preview"]["candidate_count"] == 1
    assert payload["scope_preview"]["scope_candidate_count"] == 4


def test_deal_list_exposes_pipeline_owner_and_scope_preview(monkeypatch):
    monkeypatch.setenv("HUBSPOT_PORTAL_ID", "123")
    monkeypatch.setenv("HUBSPOT_ACCESS_TOKEN", "token")
    monkeypatch.setenv("HUBSPOT_ACCOUNT_ALIAS", "north-america-crm")

    def fake_request_json(_ctx_obj, method, path, *, query=None, payload=None):
        assert method == "GET"
        assert path == "/crm/v3/objects/deals"
        return {
            "results": [
                {
                    "id": "deal-1",
                    "createdAt": "2026-03-18T00:00:00Z",
                    "updatedAt": "2026-03-18T00:00:00Z",
                    "properties": {
                        "dealname": "Enterprise Renewal",
                        "dealstage": "open",
                        "pipeline": "default",
                        "hubspot_owner_id": "11",
                    },
                }
            ],
            "paging": {},
        }

    monkeypatch.setattr(runtime, "_request_json", fake_request_json)

    result = CliRunner().invoke(cli, ["--json", "deal", "list", "--limit", "1"])
    assert result.exit_code == 0
    payload = json.loads(result.output)["data"]
    assert payload["scope"]["preview"]["picker"]["kind"] == "deal"
    assert any(candidate["kind"] == "portal" for candidate in payload["scope_candidates"])
    assert any(candidate["kind"] == "account_alias" and candidate["label"] == "north-america-crm" for candidate in payload["scope_candidates"])
    assert any(candidate["kind"] == "owner" and candidate["value"] == "11" for candidate in payload["scope_candidates"])
    assert any(candidate["kind"] == "pipeline" and candidate["value"] == "default" for candidate in payload["scope_candidates"])
    assert payload["picker_options"][0]["label"] == "Enterprise Renewal"
    assert payload["picker_options"][0]["subtitle"] == "open | default | 11"
    assert payload["scope_preview"]["candidate_count"] == 1
    assert payload["scope_preview"]["scope_candidate_count"] == 5


def test_ticket_read_exposes_pipeline_owner_scope_candidates(monkeypatch):
    monkeypatch.setenv("HUBSPOT_PORTAL_ID", "123")
    monkeypatch.setenv("HUBSPOT_ACCESS_TOKEN", "token")
    monkeypatch.setenv("HUBSPOT_ACCOUNT_ALIAS", "north-america-crm")

    def fake_request_json(_ctx_obj, method, path, *, query=None, payload=None):
        assert method == "GET"
        assert path == "/crm/v3/objects/tickets/77"
        return {
            "id": "77",
            "createdAt": "2026-03-18T00:00:00Z",
            "updatedAt": "2026-03-18T00:00:00Z",
            "properties": {
                "subject": "Escalation",
                "hs_pipeline": "support",
                "hs_pipeline_stage": "waiting",
                "hubspot_owner_id": "77",
            },
        }

    monkeypatch.setattr(runtime, "_request_json", fake_request_json)

    result = CliRunner().invoke(cli, ["--json", "ticket", "read", "77"])
    assert result.exit_code == 0
    payload = json.loads(result.output)["data"]
    assert payload["scope"]["preview"]["picker"]["kind"] == "ticket"
    assert any(candidate["kind"] == "portal" for candidate in payload["scope_candidates"])
    assert any(candidate["kind"] == "account_alias" and candidate["label"] == "north-america-crm" for candidate in payload["scope_candidates"])
    assert any(candidate["kind"] == "owner" and candidate["value"] == "77" for candidate in payload["scope_candidates"])
    assert any(candidate["kind"] == "pipeline" and candidate["value"] == "support" for candidate in payload["scope_candidates"])
    assert any(candidate["kind"] == "queue" and candidate["value"] == "waiting" for candidate in payload["scope_candidates"])
    assert payload["picker_options"][0]["label"] == "Escalation"
    assert payload["picker_options"][0]["subtitle"] == "support | waiting | 77"
    assert payload["scope_preview"]["candidate_count"] == 1
    assert payload["scope_preview"]["scope_candidate_count"] == 6


def test_company_read_uses_runtime(monkeypatch):
    monkeypatch.setattr(
        commands,
        "read_object",
        lambda *_args, **_kwargs: {"status": "ok", "resource": "company", "operation": "read", "result": {"id": "3"}},
    )
    result = CliRunner().invoke(cli, ["--json", "company", "read", "3"])
    assert result.exit_code == 0
    assert '"resource": "company"' in result.output
    assert '"id": "3"' in result.output


def test_contact_create_executes_live_write(monkeypatch):
    def fake_request_json(_ctx_obj, method, path, *, query=None, payload=None):
        assert method == "POST"
        assert path == "/crm/v3/objects/contacts"
        assert payload == {"properties": {"email": "test@example.com", "firstname": "Ada"}}
        return {
            "id": "contact-1",
            "createdAt": "2026-03-18T00:00:00Z",
            "updatedAt": "2026-03-18T00:00:00Z",
            "properties": {"email": "test@example.com", "firstname": "Ada"},
        }

    monkeypatch.setattr(runtime, "_request_json", fake_request_json)

    result = CliRunner().invoke(
        cli,
        [
            "--json",
            "--mode",
            "write",
            "contact",
            "create",
            "--property",
            "email=test@example.com",
            "--property",
            "firstname=Ada",
        ],
    )
    assert result.exit_code == 0
    assert '"command_id": "contact.create"' in result.output
    assert '"executed": true' in result.output
    assert '"id": "contact-1"' in result.output


def test_owner_assign_executes_live_write(monkeypatch):
    def fake_request_json(_ctx_obj, method, path, *, query=None, payload=None):
        assert method == "PATCH"
        assert path == "/crm/v3/objects/deals/deal-42"
        assert payload == {"properties": {"hubspot_owner_id": "11"}}
        return {
            "id": "deal-42",
            "createdAt": "2026-03-18T00:00:00Z",
            "updatedAt": "2026-03-18T00:00:00Z",
            "properties": {"dealname": "Renewal", "hubspot_owner_id": "11"},
        }

    monkeypatch.setattr(runtime, "_request_json", fake_request_json)

    result = CliRunner().invoke(
        cli,
        ["--json", "--mode", "write", "owner", "assign", "deal", "deal-42", "--owner-id", "11"],
    )
    assert result.exit_code == 0
    assert '"command_id": "owner.assign"' in result.output
    assert '"record_type": "deal"' in result.output
    assert '"owner_id": "11"' in result.output


def test_note_create_executes_live_write_and_association(monkeypatch):
    calls: list[dict] = []

    def fake_request_json(_ctx_obj, method, path, *, query=None, payload=None):
        calls.append({"method": method, "path": path, "query": query, "payload": payload})
        if method == "POST":
            return {
                "id": "note-9",
                "createdAt": "2026-03-18T00:00:00Z",
                "updatedAt": "2026-03-18T00:00:00Z",
                "properties": {
                    "hs_note_body": "Followed up",
                    "hs_timestamp": "2026-03-18T00:00:00.000Z",
                },
            }
        return {}

    monkeypatch.setattr(runtime, "_request_json", fake_request_json)

    result = CliRunner().invoke(
        cli,
        [
            "--json",
            "--mode",
            "write",
            "note",
            "create",
            "--object-type",
            "contact",
            "--object-id",
            "123",
            "--body",
            "Followed up",
        ],
    )
    assert result.exit_code == 0
    assert calls[0]["method"] == "POST"
    assert calls[0]["path"] == "/crm/v3/objects/notes"
    assert calls[0]["payload"]["properties"]["hs_note_body"] == "Followed up"
    assert calls[1]["method"] == "PUT"
    assert calls[1]["path"] == "/crm/v3/objects/notes/note-9/associations/contact/123/202"
    assert '"command_id": "note.create"' in result.output
    assert '"association_type_id": 202' in result.output


def test_deal_update_stage_requires_full_mode():
    result = CliRunner().invoke(
        cli,
        ["--json", "--mode", "write", "deal", "update-stage", "deal-42", "--stage-id", "closedwon"],
    )
    assert result.exit_code == 3
    assert "PERMISSION_DENIED" in result.output


def test_runtime_list_encodes_properties_as_csv(monkeypatch):
    calls: list[dict] = []

    def fake_request_json(_ctx, method, path, *, query=None, payload=None):
        calls.append({"method": method, "path": path, "query": query, "payload": payload})
        return {
            "results": [
                {"id": "101", "properties": {"email": "person@example.com"}, "createdAt": "2026-01-01T00:00:00Z"}
            ]
        }

    monkeypatch.setattr(runtime, "_request_json", fake_request_json)

    payload = runtime.list_objects(
        {},
        resource="contact",
        limit=10,
        after="42",
        properties=["email", "firstname"],
    )

    assert payload["status"] == "ok"
    assert payload["count"] == 1
    assert calls[0]["method"] == "GET"
    assert calls[0]["path"] == "/crm/v3/objects/contacts"
    assert calls[0]["query"]["properties"] == "email,firstname"
    assert calls[0]["query"]["after"] == 42


def test_runtime_search_posts_query_and_filters(monkeypatch):
    calls: list[dict] = []

    def fake_request_json(_ctx, method, path, *, query=None, payload=None):
        calls.append({"method": method, "path": path, "query": query, "payload": payload})
        return {"results": [{"id": "55", "properties": {"dealname": "Big Deal"}}]}

    monkeypatch.setattr(runtime, "_request_json", fake_request_json)

    payload = runtime.search_objects(
        {},
        resource="deal",
        query_text="Acme",
        limit=5,
        after="7",
        properties=["dealname"],
        filters=[{"propertyName": "pipeline", "operator": "EQ", "value": "default"}],
    )

    assert payload["status"] == "ok"
    assert payload["results"][0]["id"] == "55"
    assert calls[0]["method"] == "POST"
    assert calls[0]["path"] == "/crm/v3/objects/deals/search"
    assert calls[0]["payload"]["query"] == "Acme"
    assert calls[0]["payload"]["after"] == 7
    assert calls[0]["payload"]["filterGroups"][0]["filters"][0]["propertyName"] == "pipeline"


def test_runtime_read_requests_default_properties(monkeypatch):
    calls: list[dict] = []

    def fake_request_json(_ctx, method, path, *, query=None, payload=None):
        calls.append({"method": method, "path": path, "query": query, "payload": payload})
        return {"id": "77", "properties": {"name": "Acme Co"}}

    monkeypatch.setattr(runtime, "_request_json", fake_request_json)

    payload = runtime.read_object({}, resource="company", object_id="77", properties=None)

    assert payload["status"] == "ok"
    assert payload["result"]["id"] == "77"
    assert calls[0]["path"] == "/crm/v3/objects/companies/77"
    assert calls[0]["query"]["properties"] == "name,domain,phone,city,state,country,hs_object_id"


def test_probe_api_returns_success_when_request_succeeds(monkeypatch):
    monkeypatch.setenv("HUBSPOT_PORTAL_ID", "123")
    monkeypatch.setenv("HUBSPOT_ACCESS_TOKEN", "token")
    monkeypatch.setattr(runtime, "_request_json", lambda *_args, **_kwargs: {"results": [{"id": "1"}]})

    payload = runtime.probe_api({})

    assert payload["ok"] is True
    assert payload["details"]["owner_count"] == 1
