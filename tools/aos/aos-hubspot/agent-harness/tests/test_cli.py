from click.testing import CliRunner

import cli_aos.hubspot.bridge as bridge
import cli_aos.hubspot.commands as commands
import cli_aos.hubspot.runtime as runtime
from cli_aos.hubspot.cli import cli


def test_capabilities_json():
    result = CliRunner().invoke(cli, ["--json", "capabilities"])
    assert result.exit_code == 0
    assert '"tool": "aos-hubspot"' in result.output
    assert '"contact.list"' in result.output
    assert '"manifest_schema_version": "1.0.0"' in result.output


def test_health_reports_needs_setup_without_env():
    result = CliRunner().invoke(cli, ["--json", "health"])
    assert result.exit_code == 0
    assert '"status": "needs_setup"' in result.output


def test_health_reports_probe_failure(monkeypatch):
    monkeypatch.setenv("HUBSPOT_PORTAL_ID", "123")
    monkeypatch.setenv("HUBSPOT_ACCESS_TOKEN", "token")
    monkeypatch.setattr(
        bridge,
        "probe_api",
        lambda _ctx: {"ok": False, "code": "HUBSPOT_AUTH_ERROR", "message": "bad token", "details": {}},
    )
    result = CliRunner().invoke(cli, ["--json", "health"])
    assert result.exit_code == 0
    assert '"status": "auth_error"' in result.output
    assert 'bad token' in result.output


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
    result = CliRunner().invoke(cli, ["--json", "config", "show"])
    assert result.exit_code == 0
    assert "super-secret-token" not in result.output
    assert '"access_token_present": true' in result.output
    assert '"auth_ready": true' in result.output
    assert '"runtime_ready": true' in result.output
    assert 'probe ok' in result.output


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


def test_write_command_stays_stubbed():
    result = CliRunner().invoke(
        cli,
        ["--json", "--mode", "write", "ticket", "create", "--property", "subject=Need help"],
    )
    assert result.exit_code == 0
    assert '"status": "scaffold"' in result.output
    assert '"executed": false' in result.output


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
