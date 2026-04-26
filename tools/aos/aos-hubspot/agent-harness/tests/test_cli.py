import json

from click.testing import CliRunner

import cli_aos.hubspot.bridge as bridge
import cli_aos.hubspot.commands as commands
import cli_aos.hubspot.config as config
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


def test_config_show_uses_service_key_resolver_when_env_missing(monkeypatch):
    monkeypatch.delenv("HUBSPOT_PORTAL_ID", raising=False)
    monkeypatch.delenv("HUBSPOT_ACCESS_TOKEN", raising=False)
    monkeypatch.setattr(
        config,
        "service_key_env",
        lambda name, default=None: {"HUBSPOT_PORTAL_ID": "123", "HUBSPOT_ACCESS_TOKEN": "service-token"}.get(name, default),
    )
    monkeypatch.setattr(
        bridge,
        "probe_api",
        lambda _ctx: {"ok": True, "code": "OK", "message": "probe ok", "details": {"portal_id": "123"}},
    )

    result = CliRunner().invoke(cli, ["--json", "config", "show"])
    assert result.exit_code == 0
    assert '"portal_id": "123"' in result.output
    assert '"access_token_present": true' in result.output
    assert '"auth_ready": true' in result.output


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
