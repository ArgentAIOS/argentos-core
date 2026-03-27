from __future__ import annotations

import json
from pathlib import Path

from click.testing import CliRunner

import cli_aos.stripe.runtime as runtime
from cli_aos.stripe.cli import cli


AGENT_HARNESS_ROOT = Path(__file__).resolve().parents[1]
CONNECTOR_PATH = AGENT_HARNESS_ROOT.parent / "connector.json"
PERMISSIONS_PATH = AGENT_HARNESS_ROOT / "permissions.json"


def _set_secret_env(monkeypatch) -> None:
    monkeypatch.setenv("STRIPE_SECRET_KEY", "sk_test_123")
    monkeypatch.setenv("STRIPE_ACCOUNT_ID", "acct_123")
    monkeypatch.delenv("STRIPE_WEBHOOK_SECRET", raising=False)


def _fake_stripe_request_factory(call_log: list[dict[str, object]]):
    def fake_request_json(ctx_obj, method, path, *, query=None):
        call_log.append({"ctx_obj": ctx_obj, "method": method, "path": path, "query": query or {}})
        if path == "/v1/balance":
            return {
                "object": "balance",
                "livemode": False,
                "available": [{"amount": 1250, "currency": "usd", "source_types": {"card": 1250}}],
                "pending": [{"amount": 250, "currency": "usd", "source_types": {"card": 250}}],
            }
        if path == "/v1/account":
            return {
                "id": "acct_123",
                "object": "account",
                "business_profile": {"name": "Example Stripe Account"},
                "charges_enabled": True,
                "country": "US",
                "default_currency": "usd",
                "details_submitted": True,
                "display_name": "Example Account",
                "email": "owner@example.com",
                "livemode": False,
                "payouts_enabled": True,
                "type": "standard",
            }
        if path == "/v1/customers":
            assert query in ({"limit": 5}, {"limit": 5, "email": "person@example.com"}, {"limit": 10}, {"limit": 10, "email": "person@example.com"})
            return {
                "object": "list",
                "has_more": False,
                "data": [
                    {
                        "id": "cus_123",
                        "object": "customer",
                        "email": "person@example.com",
                        "name": "Example Person",
                        "livemode": False,
                        "created": 1700000000,
                    }
                ],
            }
        if path == "/v1/customers/search":
            assert query == {"query": "Example Person", "limit": 10}
            return {
                "object": "search_result",
                "has_more": False,
                "data": [
                    {
                        "id": "cus_456",
                        "object": "customer",
                        "email": "search@example.com",
                        "name": "Search Result",
                        "livemode": False,
                        "created": 1700000001,
                    }
                ],
            }
        if path == "/v1/customers/cus_456":
            return {
                "id": "cus_456",
                "object": "customer",
                "email": "search@example.com",
                "name": "Search Result",
                "livemode": False,
                "created": 1700000001,
            }
        if path == "/v1/payment_intents":
            assert query is not None
            return {
                "object": "list",
                "has_more": False,
                "data": [
                    {
                        "id": "pi_123",
                        "object": "payment_intent",
                        "amount": 5000,
                        "currency": "usd",
                        "status": "succeeded",
                        "livemode": False,
                        "created": 1700000100,
                    }
                ],
            }
        if path == "/v1/payment_intents/pi_123":
            return {
                "id": "pi_123",
                "object": "payment_intent",
                "amount": 5000,
                "currency": "usd",
                "status": "succeeded",
                "livemode": False,
                "created": 1700000100,
            }
        if path == "/v1/invoices":
            assert query is not None
            return {
                "object": "list",
                "has_more": False,
                "data": [
                    {
                        "id": "in_123",
                        "object": "invoice",
                        "status": "draft",
                        "currency": "usd",
                        "amount_due": 2500,
                        "amount_paid": 0,
                        "amount_remaining": 2500,
                        "livemode": False,
                        "created": 1700000200,
                    }
                ],
            }
        if path == "/v1/invoices/in_123":
            return {
                "id": "in_123",
                "object": "invoice",
                "status": "open",
                "currency": "usd",
                "amount_due": 2500,
                "amount_paid": 0,
                "amount_remaining": 2500,
                "livemode": False,
                "created": 1700000200,
            }
        raise AssertionError(f"Unexpected Stripe path in test: {path}")

    return fake_request_json


def test_manifest_and_permissions_are_in_sync():
    manifest = json.loads(CONNECTOR_PATH.read_text())
    permissions = json.loads(PERMISSIONS_PATH.read_text())["permissions"]
    manifest_command_ids = [command["id"] for command in manifest["commands"]]

    assert "capabilities" in manifest_command_ids
    assert "doctor" in manifest_command_ids
    assert set(manifest_command_ids) == set(permissions.keys())
    assert manifest["scope"]["kind"] == "payments"


def test_capabilities_json_includes_manifest_metadata():
    result = CliRunner().invoke(cli, ["--json", "capabilities"])
    assert result.exit_code == 0
    payload = json.loads(result.output)
    manifest = json.loads(CONNECTOR_PATH.read_text())
    assert payload["tool"] == "aos-stripe"
    assert payload["manifest_schema_version"] == "1.0.0"
    assert payload["backend"] == manifest["backend"]
    assert payload["connector"] == manifest["connector"]
    assert payload["scope"] == manifest["scope"]
    assert payload["auth"] == manifest["auth"]
    assert any(command["id"] == "subscription.create" for command in payload["commands"])


def test_health_reports_needs_setup_without_secret(monkeypatch):
    monkeypatch.delenv("STRIPE_SECRET_KEY", raising=False)
    monkeypatch.delenv("STRIPE_WEBHOOK_SECRET", raising=False)
    monkeypatch.delenv("STRIPE_ACCOUNT_ID", raising=False)

    result = CliRunner().invoke(cli, ["--json", "health"])
    assert result.exit_code == 0
    assert '"status": "needs_setup"' in result.output
    assert "STRIPE_SECRET_KEY" in result.output


def test_health_reports_live_read_ready_when_probe_succeeds(monkeypatch):
    _set_secret_env(monkeypatch)
    calls: list[dict[str, object]] = []
    monkeypatch.setattr(runtime, "_request_json", _fake_stripe_request_factory(calls))

    result = CliRunner().invoke(cli, ["--json", "health"])

    assert result.exit_code == 0
    payload = json.loads(result.output)
    assert payload["data"]["status"] == "ok"
    assert payload["data"]["checks"][3]["ok"] is True
    assert payload["data"]["checks"][3]["details"]["probe_mode"] == "live_balance_read"
    assert calls[0]["path"] == "/v1/balance"


def test_doctor_reports_probe_failure(monkeypatch):
    monkeypatch.setenv("STRIPE_SECRET_KEY", "sk_test_123")
    monkeypatch.setattr(
        runtime,
        "probe_runtime",
        lambda _ctx: {"ok": False, "code": "STRIPE_AUTH_ERROR", "message": "bad token", "details": {"status": 401}},
    )

    result = CliRunner().invoke(cli, ["--json", "doctor"])
    assert result.exit_code == 0
    assert '"status": "auth_error"' in result.output
    assert "bad token" in result.output


def test_config_show_redacts_secret_values(monkeypatch):
    _set_secret_env(monkeypatch)
    monkeypatch.setenv("STRIPE_WEBHOOK_SECRET", "whsec_secret")
    monkeypatch.setenv("STRIPE_CUSTOMER_FOCUS", "cus_123")
    monkeypatch.setenv("STRIPE_INVOICE_STATUS", "draft")
    monkeypatch.setenv("STRIPE_CREATED_AFTER", "2026-01-01")
    monkeypatch.setenv("STRIPE_CREATED_BEFORE", "2026-01-31")
    monkeypatch.setattr(
        runtime,
        "probe_runtime",
        lambda _ctx: {"ok": True, "code": "OK", "message": "probe ok", "details": {"account_id_present": True}},
    )

    result = CliRunner().invoke(cli, ["--json", "config", "show"])
    assert result.exit_code == 0
    assert "sk_test_123" not in result.output
    assert "whsec_secret" not in result.output
    assert '"secret_key_present": true' in result.output
    assert '"runtime_ready": true' in result.output
    assert "probe ok" in result.output


def test_balance_read_hits_live_runtime(monkeypatch):
    _set_secret_env(monkeypatch)
    calls: list[dict[str, object]] = []
    monkeypatch.setattr(runtime, "_request_json", _fake_stripe_request_factory(calls))

    result = CliRunner().invoke(cli, ["--json", "balance", "read"])

    assert result.exit_code == 0
    payload = json.loads(result.output)
    assert payload["data"]["resource"] == "balance"
    assert payload["data"]["result"]["available"][0]["amount"] == 1250
    assert calls[0]["path"] == "/v1/balance"
    assert calls[0]["ctx_obj"]["mode"] == "readonly"


def test_account_read_hits_live_runtime(monkeypatch):
    _set_secret_env(monkeypatch)
    calls: list[dict[str, object]] = []
    monkeypatch.setattr(runtime, "_request_json", _fake_stripe_request_factory(calls))

    result = CliRunner().invoke(cli, ["--json", "account", "read"])

    assert result.exit_code == 0
    payload = json.loads(result.output)
    assert payload["data"]["resource"] == "account"
    assert payload["data"]["result"]["id"] == "acct_123"
    assert payload["data"]["result"]["display_name"] == "Example Account"
    assert calls[0]["path"] == "/v1/account"


def test_customer_list_uses_live_runtime(monkeypatch):
    _set_secret_env(monkeypatch)
    calls: list[dict[str, object]] = []
    monkeypatch.setattr(runtime, "_request_json", _fake_stripe_request_factory(calls))

    result = CliRunner().invoke(cli, ["--json", "customer", "list", "--limit", "5"])

    assert result.exit_code == 0
    payload = json.loads(result.output)
    assert payload["data"]["resource"] == "customer"
    assert payload["data"]["count"] == 1
    assert payload["data"]["results"][0]["email"] == "person@example.com"
    assert payload["data"]["options"][0]["value"] == "cus_123"
    assert payload["data"]["options"][0]["label"] == "Example Person"
    assert calls[0]["path"] == "/v1/customers"
    assert calls[0]["query"]["limit"] == 5


def test_customer_list_scopes_by_email(monkeypatch):
    _set_secret_env(monkeypatch)
    calls: list[dict[str, object]] = []
    monkeypatch.setattr(runtime, "_request_json", _fake_stripe_request_factory(calls))

    result = CliRunner().invoke(
        cli,
        ["--json", "customer", "list", "--limit", "5", "--email", "person@example.com"],
    )

    assert result.exit_code == 0
    assert calls[0]["path"] == "/v1/customers"
    assert calls[0]["query"]["email"] == "person@example.com"


def test_payment_read_uses_live_runtime(monkeypatch):
    _set_secret_env(monkeypatch)
    calls: list[dict[str, object]] = []
    monkeypatch.setattr(runtime, "_request_json", _fake_stripe_request_factory(calls))

    result = CliRunner().invoke(cli, ["--json", "payment", "read", "pi_123"])

    assert result.exit_code == 0
    payload = json.loads(result.output)
    assert payload["data"]["resource"] == "payment"
    assert payload["data"]["result"]["status"] == "succeeded"
    assert calls[0]["path"] == "/v1/payment_intents/pi_123"


def test_payment_list_uses_customer_and_created_filters(monkeypatch):
    _set_secret_env(monkeypatch)
    calls: list[dict[str, object]] = []
    monkeypatch.setattr(runtime, "_request_json", _fake_stripe_request_factory(calls))

    result = CliRunner().invoke(
        cli,
        [
            "--json",
            "payment",
            "list",
            "--limit",
            "5",
            "--customer-id",
            "cus_123",
            "--created-after",
            "2026-01-01",
            "--created-before",
            "2026-01-31",
        ],
    )

    assert result.exit_code == 0
    assert calls[0]["path"] == "/v1/payment_intents"
    assert calls[0]["query"]["limit"] == 5
    assert calls[0]["query"]["customer"] == "cus_123"
    assert "created[gte]" in calls[0]["query"]
    assert "created[lte]" in calls[0]["query"]


def test_invoice_read_uses_live_runtime(monkeypatch):
    _set_secret_env(monkeypatch)
    calls: list[dict[str, object]] = []
    monkeypatch.setattr(runtime, "_request_json", _fake_stripe_request_factory(calls))

    result = CliRunner().invoke(cli, ["--json", "invoice", "read", "in_123"])

    assert result.exit_code == 0
    payload = json.loads(result.output)
    assert payload["data"]["resource"] == "invoice"
    assert payload["data"]["result"]["status"] == "open"
    assert calls[0]["path"] == "/v1/invoices/in_123"


def test_invoice_list_uses_status_and_created_filters(monkeypatch):
    _set_secret_env(monkeypatch)
    calls: list[dict[str, object]] = []
    monkeypatch.setattr(runtime, "_request_json", _fake_stripe_request_factory(calls))

    result = CliRunner().invoke(
        cli,
        [
            "--json",
            "invoice",
            "list",
            "--limit",
            "5",
            "--customer-id",
            "cus_123",
            "--status",
            "draft",
            "--created-after",
            "2026-01-01",
            "--created-before",
            "2026-01-31",
        ],
    )

    assert result.exit_code == 0
    assert calls[0]["path"] == "/v1/invoices"
    assert calls[0]["query"]["limit"] == 5
    assert calls[0]["query"]["customer"] == "cus_123"
    assert calls[0]["query"]["status"] == "draft"
    assert "created[gte]" in calls[0]["query"]
    assert "created[lte]" in calls[0]["query"]
