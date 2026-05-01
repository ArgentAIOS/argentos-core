from __future__ import annotations

import json

from click.testing import CliRunner

import pytest

import cli_aos.quickbooks.runtime as runtime
from cli_aos.quickbooks.cli import cli

REQUIRED_ENV = {
    "QBO_CLIENT_ID": "client-id",
    "QBO_CLIENT_SECRET": "client-secret",
    "QBO_REFRESH_TOKEN": "refresh-token",
    "QBO_REALM_ID": "realm-123",
}


def _set_required_env(monkeypatch) -> None:
    for key, value in REQUIRED_ENV.items():
        monkeypatch.setenv(key, value)


def test_capabilities_json_includes_global_commands():
    result = CliRunner().invoke(cli, ["--json", "capabilities"])
    assert result.exit_code == 0
    assert '"tool": "aos-quickbooks"' in result.output
    assert '"doctor"' in result.output
    assert '"manifest_schema_version": "1.0.0"' in result.output


def test_health_reports_needs_setup_without_env(monkeypatch):
    for key in REQUIRED_ENV:
        monkeypatch.delenv(key, raising=False)
    result = CliRunner().invoke(cli, ["--json", "health"])
    assert result.exit_code == 0
    assert '"status": "needs_setup"' in result.output
    assert "QBO_CLIENT_ID" in result.output


def test_config_show_redacts_sensitive_values(monkeypatch):
    _set_required_env(monkeypatch)
    monkeypatch.setattr(runtime, "probe_runtime", lambda _config: {"ok": True, "code": "OK", "message": "probe ok", "details": {"company_name": "Acme"}})
    result = CliRunner().invoke(cli, ["--json", "config", "show"])
    assert result.exit_code == 0
    assert "client-secret" not in result.output
    assert "refresh-token" not in result.output
    assert '"runtime_ready": true' in result.output
    assert '"probe_runtime"' not in result.output
    assert '"company_name": "Acme"' in result.output


def test_runtime_config_prefers_operator_service_keys(monkeypatch):
    for key, value in REQUIRED_ENV.items():
        monkeypatch.setenv(key, f"env-{value}")

    def fake_service_key_env(name, default=None):
        if name in REQUIRED_ENV:
            return f"service-{REQUIRED_ENV[name]}"
        return default

    monkeypatch.setattr(runtime, "service_key_env", fake_service_key_env)

    config = runtime.runtime_config()
    assert config["auth"]["configured"] == {key: True for key in REQUIRED_ENV}
    assert config["auth"]["redacted"]["QBO_CLIENT_ID"] == "se...t-id"
    assert config["auth"]["redacted"]["QBO_REFRESH_TOKEN"] == "se...oken"


def test_doctor_reports_probe_failure(monkeypatch):
    _set_required_env(monkeypatch)
    monkeypatch.setattr(
        runtime,
        "probe_runtime",
        lambda _config: {"ok": False, "code": "QBO_AUTH_ERROR", "message": "bad token", "details": {"status": 401}},
    )
    result = CliRunner().invoke(cli, ["--json", "doctor"])
    assert result.exit_code == 0
    assert '"status": "auth_error"' in result.output
    assert "bad token" in result.output


def test_permission_gate_blocks_write_for_readonly():
    result = CliRunner().invoke(cli, ["--json", "--mode", "readonly", "invoice", "create_draft"])
    assert result.exit_code == 3
    assert "PERMISSION_DENIED" in result.output


def test_bill_create_draft_posts_live_bill(monkeypatch):
    _set_required_env(monkeypatch)
    calls: list[dict[str, object]] = []
    monkeypatch.setattr(runtime, "refresh_access_token", lambda _config: {"access_token": "token"})

    def fake_request_json(method, url, *, headers=None, payload=None, timeout_seconds=None):
        calls.append({"method": method, "url": url, "headers": headers, "payload": payload})
        return {
            "Bill": {
                "Id": "bill-1",
                "DocNumber": "B-1",
                "TxnDate": "2026-01-13",
                "VendorRef": {"value": "vendor-1", "name": "Vendor Co"},
            }
        }

    monkeypatch.setattr(runtime, "_request_json", fake_request_json)

    result = CliRunner().invoke(
        cli,
        [
            "--json",
            "--mode",
            "write",
            "bill",
            "create_draft",
            "vendor_id=vendor-1",
            "account_id=acct-1",
            "amount=42.50",
            "description=hosting",
            "due_date=2026-02-01",
        ],
    )
    assert result.exit_code == 0
    assert calls[0]["method"] == "POST"
    assert "/bill?" in calls[0]["url"]
    assert calls[0]["headers"]["Authorization"] == "Bearer token"
    assert calls[0]["payload"]["VendorRef"]["value"] == "vendor-1"
    assert calls[0]["payload"]["Line"][0]["Amount"] == 42.5
    assert calls[0]["payload"]["Line"][0]["AccountBasedExpenseLineDetail"]["AccountRef"]["value"] == "acct-1"
    payload = json.loads(result.output)["data"]
    assert payload["resource"] == "bill"
    assert payload["operation"] == "create_draft"
    assert payload["picker_options"][0]["value"] == "bill-1"


def test_invoice_create_draft_requires_item_id(monkeypatch):
    _set_required_env(monkeypatch)
    result = CliRunner().invoke(
        cli,
        ["--json", "--mode", "write", "invoice", "create_draft", "customer_id=cust-1", "amount=99.00"],
    )
    assert result.exit_code == 2
    assert "Missing required option: item_id" in result.output


def test_invoice_create_draft_posts_live_invoice(monkeypatch):
    _set_required_env(monkeypatch)
    calls: list[dict[str, object]] = []
    monkeypatch.setattr(runtime, "refresh_access_token", lambda _config: {"access_token": "token"})

    def fake_request_json(method, url, *, headers=None, payload=None, timeout_seconds=None):
        calls.append({"method": method, "url": url, "headers": headers, "payload": payload})
        return {
            "Invoice": {
                "Id": "inv-1",
                "DocNumber": "INV-1",
                "TxnDate": "2026-01-14",
                "CustomerRef": {"value": "cust-1", "name": "Acme"},
            }
        }

    monkeypatch.setattr(runtime, "_request_json", fake_request_json)

    result = CliRunner().invoke(
        cli,
        [
            "--json",
            "--mode",
            "write",
            "invoice",
            "create_draft",
            "customer_id=cust-1",
            "item_id=item-1",
            "amount=99.00",
            "memo=consulting",
        ],
    )
    assert result.exit_code == 0
    assert calls[0]["method"] == "POST"
    assert "/invoice?" in calls[0]["url"]
    assert calls[0]["payload"]["CustomerRef"]["value"] == "cust-1"
    assert calls[0]["payload"]["Line"][0]["SalesItemLineDetail"]["ItemRef"]["value"] == "item-1"
    payload = json.loads(result.output)["data"]
    assert payload["resource"] == "invoice"
    assert payload["operation"] == "create_draft"


def test_customer_list_uses_live_query(monkeypatch):
    _set_required_env(monkeypatch)
    calls: list[dict[str, object]] = []
    monkeypatch.setattr(runtime, "refresh_access_token", lambda _config: {"access_token": "token"})

    def fake_request_json(method, url, *, headers=None, payload=None, timeout_seconds=None):
        calls.append(
            {
                "method": method,
                "url": url,
                "headers": headers,
                "payload": payload,
                "timeout_seconds": timeout_seconds,
            }
        )
        return {"QueryResponse": {"Customer": [{"Id": "1", "DisplayName": "Acme Corp"}]}}

    monkeypatch.setattr(runtime, "_request_json", fake_request_json)

    result = CliRunner().invoke(cli, ["--json", "customer", "list"])
    assert result.exit_code == 0
    assert '"resource": "customer"' in result.output
    assert '"Acme Corp"' in result.output
    assert "select+%2A+from+Customer" in calls[0]["url"]
    assert calls[0]["headers"]["Authorization"] == "Bearer token"


def test_invoice_list_overdue_uses_open_balance_due_date_query(monkeypatch):
    _set_required_env(monkeypatch)
    calls: list[dict[str, object]] = []
    monkeypatch.setattr(runtime, "refresh_access_token", lambda _config: {"access_token": "token"})

    def fake_request_json(method, url, *, headers=None, payload=None, timeout_seconds=None):
        calls.append({"method": method, "url": url, "headers": headers, "payload": payload})
        return {
            "QueryResponse": {
                "Invoice": [
                    {
                        "Id": "inv-1",
                        "DocNumber": "INV-1",
                        "DueDate": "2026-01-01",
                        "Balance": 125.0,
                        "CustomerRef": {"value": "cust-1", "name": "Acme"},
                    }
                ]
            }
        }

    monkeypatch.setattr(runtime, "_request_json", fake_request_json)

    result = CliRunner().invoke(cli, ["--json", "invoice", "list_overdue", "due_before=2026-02-01"])
    assert result.exit_code == 0
    assert '"resource": "invoice"' in result.output
    assert '"operation": "list_overdue"' in result.output
    assert '"due_before": "2026-02-01"' in result.output
    assert "Balance+%3E+%270%27" in calls[0]["url"]
    assert "DueDate+%3C+%272026-02-01%27" in calls[0]["url"]
    assert calls[0]["headers"]["Authorization"] == "Bearer token"


def test_customer_search_uses_query_terms(monkeypatch):
    _set_required_env(monkeypatch)
    calls: list[dict[str, object]] = []
    monkeypatch.setattr(runtime, "refresh_access_token", lambda _config: {"access_token": "token"})

    def fake_request_json(method, url, *, headers=None, payload=None, timeout_seconds=None):
        calls.append({"method": method, "url": url, "headers": headers})
        return {"QueryResponse": {"Customer": [{"Id": "2", "DisplayName": "Acme Search"}]}}

    monkeypatch.setattr(runtime, "_request_json", fake_request_json)

    result = CliRunner().invoke(cli, ["--json", "customer", "search", "Acme"])
    assert result.exit_code == 0
    assert '"operation": "search"' in result.output
    assert "LIKE+%27%25Acme%25%27" in calls[0]["url"]


def test_company_read_uses_companyinfo_endpoint(monkeypatch):
    _set_required_env(monkeypatch)
    calls: list[dict[str, object]] = []
    monkeypatch.setattr(runtime, "refresh_access_token", lambda _config: {"access_token": "token"})

    def fake_request_json(method, url, *, headers=None, payload=None, timeout_seconds=None):
        calls.append({"method": method, "url": url, "headers": headers})
        return {"CompanyInfo": {"Id": "realm-123", "CompanyName": "Acme Books"}}

    monkeypatch.setattr(runtime, "_request_json", fake_request_json)

    result = CliRunner().invoke(cli, ["--json", "company", "read"])
    assert result.exit_code == 0
    assert '"CompanyName": "Acme Books"' in result.output
    assert "/companyinfo/" in calls[0]["url"]


@pytest.mark.parametrize(
    ("command", "args", "response", "expected_label", "expected_subtitle", "expected_scope_kind"),
    [
        (
            "company",
            ["read"],
            {"CompanyInfo": {"Id": "realm-123", "CompanyName": "Acme Books", "Country": "US"}},
            "Acme Books",
            "realm-123 | US",
            "company",
        ),
        (
            "customer",
            ["list"],
            {
                "QueryResponse": {
                    "Customer": [
                        {
                            "Id": "1",
                            "DisplayName": "Ada Lovelace",
                            "PrimaryEmailAddr": {"Address": "ada@example.com"},
                        }
                    ]
                }
            },
            "Ada Lovelace",
            "ada@example.com",
            "customer",
        ),
        (
            "vendor",
            ["list"],
            {
                "QueryResponse": {
                    "Vendor": [
                        {
                            "Id": "2",
                            "CompanyName": "Vendor Co",
                            "PrimaryEmailAddr": {"Address": "vendor@example.com"},
                        }
                    ]
                }
            },
            "Vendor Co",
            "vendor@example.com | Vendor Co",
            "vendor",
        ),
        (
            "account",
            ["list"],
            {
                "QueryResponse": {
                    "Account": [
                        {"Id": "3", "Name": "Checking", "AccountType": "Bank", "AccountSubType": "Checking", "AcctNum": "1010"}
                    ]
                }
            },
            "Checking",
            "Bank | Checking | 1010",
            "account",
        ),
    ],
)
def test_picker_friendly_live_reads_expose_scope_and_candidates(
    monkeypatch,
    command: str,
    args: list[str],
    response: dict[str, object],
    expected_label: str,
    expected_subtitle: str,
    expected_scope_kind: str,
):
    _set_required_env(monkeypatch)
    monkeypatch.setattr(runtime, "refresh_access_token", lambda _config: {"access_token": "token"})
    monkeypatch.setattr(runtime, "_request_json", lambda *args, **kwargs: response)

    result = CliRunner().invoke(cli, ["--json", command, *args])
    assert result.exit_code == 0

    payload = json.loads(result.output)["data"]
    assert payload["picker_options"][0]["label"] == expected_label
    assert payload["picker_options"][0]["subtitle"] == expected_subtitle
    assert payload["scope"]["preview"]["picker"]["kind"] == command
    assert payload["scope"]["preview"]["candidate_count"] == 1
    assert any(candidate["kind"] == expected_scope_kind for candidate in payload["scope_candidates"])


def test_transaction_list_exposes_date_window_scope(monkeypatch):
    _set_required_env(monkeypatch)
    monkeypatch.setattr(runtime, "refresh_access_token", lambda _config: {"access_token": "token"})
    monkeypatch.setattr(
        runtime,
        "_request_json",
        lambda *args, **kwargs: {
            "QueryResponse": {
                "Invoice": [
                    {
                        "Id": "9",
                        "DocNumber": "INV-9",
                        "TxnDate": "2026-01-15",
                        "Line": [
                            {
                                "SalesItemLineDetail": {
                                    "AccountRef": {
                                        "value": "acct-checking",
                                        "name": "Checking",
                                        "AccountType": "Bank",
                                        "AcctNum": "1010",
                                    }
                                }
                            }
                        ],
                    },
                ]
            }
        },
    )

    result = CliRunner().invoke(
        cli,
        ["--json", "transaction", "list", "date_from=2026-01-01", "date_to=2026-01-31", "limit=1"],
    )
    assert result.exit_code == 0
    payload = json.loads(result.output)["data"]
    assert payload["scope"]["preview"]["date_window"] == {"start": "2026-01-01", "end": "2026-01-31"}
    assert payload["scope"]["preview"]["transaction"]["record_count"] == 1
    assert payload["scope"]["preview"]["transaction"]["entity_types"] == ["Invoice"]
    assert payload["scope"]["preview"]["transaction"]["account_labels"] == ["Checking"]
    assert payload["scope"]["preview"]["narrowing"]["account"]["selected"]["label"] == "Checking"
    assert payload["scope"]["preview"]["narrowing"]["company"]["kind"] == "company"
    assert payload["scope"]["preview"]["narrowing"]["date_window"]["value"] == "2026-01-01..2026-01-31"
    assert payload["scope"]["preview"]["narrowing"]["date_window"]["selected"] is True
    assert payload["scope_preview"] == "realm realm-123 · transaction.list · type Invoice · account Checking · window 2026-01-01..2026-01-31 · 1 candidate"
    assert payload["scope_candidates"][0]["kind"] == "company"
    assert any(candidate["kind"] == "date_window" and candidate["value"] == "2026-01-01..2026-01-31" for candidate in payload["scope_candidates"])
    assert any(candidate["kind"] == "account" and candidate["label"] == "Checking" for candidate in payload["scope_candidates"])
    assert payload["picker_options"][0]["label"] == "INV-9"
    assert payload["picker_options"][0]["subtitle"] == "Invoice | 2026-01-15 | Checking"


def test_transaction_list_exposes_account_scope_candidates(monkeypatch):
    _set_required_env(monkeypatch)
    monkeypatch.setattr(runtime, "refresh_access_token", lambda _config: {"access_token": "token"})
    monkeypatch.setattr(
        runtime,
        "_request_json",
        lambda *args, **kwargs: {
            "QueryResponse": {
                "Invoice": [
                    {
                        "Id": "9",
                        "DocNumber": "INV-9",
                        "TxnDate": "2026-01-11",
                        "Line": [
                            {
                                "SalesItemLineDetail": {
                                    "AccountRef": {
                                        "value": "acct-checking",
                                        "name": "Checking",
                                        "AccountType": "Bank",
                                        "AcctNum": "1010",
                                    }
                                }
                            }
                        ],
                    },
                    {
                        "Id": "10",
                        "DocNumber": "INV-10",
                        "TxnDate": "2026-01-12",
                        "Line": [
                            {
                                "SalesItemLineDetail": {
                                    "AccountRef": {
                                        "value": "acct-savings",
                                        "name": "Savings",
                                        "AccountType": "Bank",
                                        "AcctNum": "1020",
                                    }
                                }
                            }
                        ],
                    },
                ]
            }
        },
    )

    result = CliRunner().invoke(
        cli,
        ["--json", "transaction", "list", "account_name=Checking", "date_from=2026-01-01", "date_to=2026-01-31", "limit=2"],
    )
    assert result.exit_code == 0

    payload = json.loads(result.output)["data"]
    assert payload["scope"]["preview"]["transaction"]["entity_types"] == ["Invoice"]
    assert payload["scope"]["preview"]["transaction"]["account_labels"] == ["Checking", "Savings"]
    assert payload["scope"]["preview"]["narrowing"]["account"]["selected"]["label"] == "Checking"
    assert payload["scope"]["preview"]["narrowing"]["account"]["selected"]["source"] == "request"
    assert payload["scope_preview"] == "realm realm-123 · transaction.list · type Invoice · account Checking · window 2026-01-01..2026-01-31 · 2 candidates"
    assert any(candidate["kind"] == "account" and candidate["label"] == "Checking" and candidate.get("selected") for candidate in payload["scope_candidates"])
    assert any(candidate["kind"] == "account" and candidate["label"] == "Savings" and candidate["source"].startswith("results[") for candidate in payload["scope_candidates"])
    assert payload["picker_options"][0]["label"] == "INV-9"
    assert payload["picker_options"][0]["subtitle"] == "Invoice | 2026-01-11 | Checking"


def test_transaction_read_can_target_explicit_entity(monkeypatch):
    _set_required_env(monkeypatch)
    calls: list[dict[str, object]] = []
    monkeypatch.setattr(runtime, "refresh_access_token", lambda _config: {"access_token": "token"})

    def fake_request_json(method, url, *, headers=None, payload=None, timeout_seconds=None):
        calls.append({"method": method, "url": url, "headers": headers})
        return {
            "Id": "10",
            "DocNumber": "T-10",
            "TxnDate": "2026-01-13",
            "Line": [
                {
                    "SalesItemLineDetail": {
                        "AccountRef": {
                            "value": "acct-operating",
                            "name": "Operating",
                            "AccountType": "Bank",
                            "AcctNum": "2020",
                        }
                    }
                }
            ],
        }

    monkeypatch.setattr(runtime, "_request_json", fake_request_json)

    result = CliRunner().invoke(cli, ["--json", "transaction", "read", "entity=invoice", "10"])
    assert result.exit_code == 0
    assert '"entity_type": "Invoice"' in result.output
    assert "/Invoice/10" in calls[0]["url"]
    payload = json.loads(result.output)["data"]
    assert payload["scope"]["preview"]["transaction"]["entity_types"] == ["Invoice"]
    assert payload["scope"]["preview"]["transaction"]["account_labels"] == ["Operating"]
    assert payload["scope"]["preview"]["narrowing"]["account"]["selected"]["label"] == "Operating"
    assert any(candidate["kind"] == "account" and candidate["label"] == "Operating" for candidate in payload["scope_candidates"])
    assert payload["picker_options"][0]["subtitle"] == "Invoice | 2026-01-13 | Operating"
