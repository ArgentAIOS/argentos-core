from __future__ import annotations

import json
from pathlib import Path
from typing import Any

from click.testing import CliRunner

from cli_aos.xero.cli import cli
import cli_aos.xero.runtime as runtime


AGENT_HARNESS_ROOT = Path(__file__).resolve().parents[1]
CONNECTOR_PATH = AGENT_HARNESS_ROOT.parent / "connector.json"
PERMISSIONS_PATH = AGENT_HARNESS_ROOT / "permissions.json"


class FakeXeroClient:
    def connections(self) -> dict[str, Any]:
        return [{"tenantId": "tenant-123", "tenantName": "ArgentOS Books"}]

    def list_invoices(self, *, limit: int = 25, statuses: list[str] | None = None) -> dict[str, Any]:
        return {
            "Invoices": [
                {
                    "InvoiceID": "inv-1",
                    "InvoiceNumber": "INV-001",
                    "Contact": {"Name": "Acme Corp"},
                    "Status": "AUTHORISED",
                    "Total": 1500.0,
                    "AmountDue": 250.0,
                    "CurrencyCode": "USD",
                    "DateString": "2026-03-26",
                    "DueDateString": "2026-04-25",
                }
            ][:limit]
        }

    def get_invoice(self, invoice_id: str) -> dict[str, Any]:
        return {
            "Invoices": [
                {
                    "InvoiceID": invoice_id,
                    "InvoiceNumber": "INV-001",
                    "Contact": {"Name": "Acme Corp"},
                    "Status": "AUTHORISED",
                    "Total": 1500.0,
                    "AmountDue": 250.0,
                    "CurrencyCode": "USD",
                }
            ]
        }

    def list_contacts(self, *, limit: int = 25) -> dict[str, Any]:
        return {
            "Contacts": [
                {
                    "ContactID": "contact-1",
                    "Name": "Acme Corp",
                    "EmailAddress": "finance@acme.example",
                    "IsCustomer": True,
                    "IsSupplier": False,
                    "AccountsReceivableOutstanding": 250.0,
                }
            ][:limit]
        }

    def get_contact(self, contact_id: str) -> dict[str, Any]:
        return {"Contacts": [{"ContactID": contact_id, "Name": "Acme Corp", "EmailAddress": "finance@acme.example"}]}

    def list_payments(self, *, limit: int = 25) -> dict[str, Any]:
        return {
            "Payments": [
                {
                    "PaymentID": "pay-1",
                    "Invoice": {"InvoiceID": "inv-1"},
                    "Amount": 100.0,
                    "CurrencyCode": "USD",
                    "DateString": "2026-03-26",
                    "Status": "AUTHORISED",
                    "PaymentType": "ACCRECPAYMENT",
                }
            ][:limit]
        }

    def get_payment(self, payment_id: str) -> dict[str, Any]:
        return {"Payments": [{"PaymentID": payment_id, "Amount": 100.0, "CurrencyCode": "USD", "Status": "AUTHORISED"}]}

    def list_accounts(self, *, limit: int = 100) -> dict[str, Any]:
        return {"Accounts": [{"Code": "200", "Name": "Sales", "Type": "REVENUE", "Status": "ACTIVE"}][:limit]}

    def list_bank_transactions(self, *, limit: int = 25) -> dict[str, Any]:
        return {"BankTransactions": [{"BankTransactionID": "bt-1", "Type": "RECEIVE", "Total": 100.0, "Status": "AUTHORISED"}][:limit]}

    def profit_and_loss_report(self, *, date: str | None = None) -> dict[str, Any]:
        return {"Reports": [{"ReportName": "ProfitAndLoss", "Date": date or "2026-03-26"}]}

    def balance_sheet_report(self, *, date: str | None = None) -> dict[str, Any]:
        return {"Reports": [{"ReportName": "BalanceSheet", "Date": date or "2026-03-26"}]}

    def list_quotes(self, *, limit: int = 25) -> dict[str, Any]:
        return {"Quotes": [{"QuoteID": "quote-1", "QuoteNumber": "Q-001", "Contact": {"Name": "Acme Corp"}, "QuoteStatus": "DRAFT"}][:limit]}


def invoke_json(args: list[str]) -> dict[str, Any]:
    result = CliRunner().invoke(cli, ["--json", *args])
    assert result.exit_code == 0, result.output
    return json.loads(result.output)


def invoke_json_with_mode(mode: str, args: list[str]) -> dict[str, Any]:
    result = CliRunner().invoke(cli, ["--json", "--mode", mode, *args])
    assert result.exit_code == 0, result.output
    return json.loads(result.output)


def test_manifest_and_permissions_are_in_sync():
    manifest = json.loads(CONNECTOR_PATH.read_text())
    permissions = json.loads(PERMISSIONS_PATH.read_text())["permissions"]
    command_ids = [command["id"] for command in manifest["commands"]]
    assert set(command_ids) == set(permissions.keys())
    assert manifest["scope"]["kind"] == "accounting"


def test_capabilities_exposes_manifest():
    payload = invoke_json(["capabilities"])
    assert payload["tool"] == "aos-xero"
    assert payload["data"]["backend"] == "xero-api"
    assert "invoice.create" in json.dumps(payload["data"])
    assert "report.balance_sheet" in json.dumps(payload["data"])


def test_health_requires_credentials(monkeypatch):
    for key in ["XERO_CLIENT_ID", "XERO_CLIENT_SECRET", "XERO_REFRESH_TOKEN", "XERO_TENANT_ID"]:
        monkeypatch.delenv(key, raising=False)
    payload = invoke_json(["health"])
    assert payload["data"]["status"] == "needs_setup"
    assert "XERO_CLIENT_ID" in json.dumps(payload["data"])


def test_health_ready_with_fake_client(monkeypatch):
    monkeypatch.setenv("XERO_CLIENT_ID", "client-id")
    monkeypatch.setenv("XERO_CLIENT_SECRET", "client-secret")
    monkeypatch.setenv("XERO_REFRESH_TOKEN", "refresh-token")
    monkeypatch.setenv("XERO_TENANT_ID", "tenant-123")
    monkeypatch.setattr(runtime, "create_client", lambda ctx_obj: FakeXeroClient())
    payload = invoke_json(["health"])
    assert payload["data"]["status"] == "ready"
    assert payload["data"]["probe"]["ok"] is True
    assert payload["data"]["probe"]["details"]["connections"][0]["tenantId"] == "tenant-123"


def test_config_show_redacts_credentials(monkeypatch):
    monkeypatch.setenv("XERO_CLIENT_ID", "client-id-secret")
    monkeypatch.setenv("XERO_CLIENT_SECRET", "client-secret-value")
    monkeypatch.setenv("XERO_REFRESH_TOKEN", "refresh-token-value")
    monkeypatch.setenv("XERO_TENANT_ID", "tenant-123")
    payload = invoke_json(["config", "show"])
    encoded = json.dumps(payload["data"])
    assert "client-id-secret" not in encoded
    assert "client-secret-value" not in encoded
    assert payload["data"]["auth"]["tenant_id_present"] is True


def test_invoice_list_returns_picker(monkeypatch):
    monkeypatch.setenv("XERO_CLIENT_ID", "client-id")
    monkeypatch.setenv("XERO_CLIENT_SECRET", "client-secret")
    monkeypatch.setenv("XERO_REFRESH_TOKEN", "refresh-token")
    monkeypatch.setenv("XERO_TENANT_ID", "tenant-123")
    monkeypatch.setattr(runtime, "create_client", lambda ctx_obj: FakeXeroClient())
    payload = invoke_json(["invoice", "list"])
    assert payload["data"]["invoices"][0]["number"] == "INV-001"
    assert payload["data"]["picker"]["kind"] == "xero_invoice"


def test_invoice_create_is_scaffolded_in_write_mode(monkeypatch):
    monkeypatch.setenv("XERO_CLIENT_ID", "client-id")
    monkeypatch.setenv("XERO_CLIENT_SECRET", "client-secret")
    monkeypatch.setenv("XERO_REFRESH_TOKEN", "refresh-token")
    monkeypatch.setenv("XERO_TENANT_ID", "tenant-123")
    result = CliRunner().invoke(cli, ["--json", "--mode", "write", "invoice", "create"])
    payload = json.loads(result.output)
    assert payload["ok"] is False
    assert payload["error"]["code"] == "NOT_IMPLEMENTED"


def test_contact_get_uses_runtime_default(monkeypatch):
    monkeypatch.setenv("XERO_CLIENT_ID", "client-id")
    monkeypatch.setenv("XERO_CLIENT_SECRET", "client-secret")
    monkeypatch.setenv("XERO_REFRESH_TOKEN", "refresh-token")
    monkeypatch.setenv("XERO_TENANT_ID", "tenant-123")
    monkeypatch.setenv("XERO_CONTACT_ID", "contact-1")
    monkeypatch.setattr(runtime, "create_client", lambda ctx_obj: FakeXeroClient())
    payload = invoke_json(["contact", "get"])
    assert payload["data"]["contact"]["id"] == "contact-1"


def test_report_balance_sheet_returns_report(monkeypatch):
    monkeypatch.setenv("XERO_CLIENT_ID", "client-id")
    monkeypatch.setenv("XERO_CLIENT_SECRET", "client-secret")
    monkeypatch.setenv("XERO_REFRESH_TOKEN", "refresh-token")
    monkeypatch.setenv("XERO_TENANT_ID", "tenant-123")
    monkeypatch.setattr(runtime, "create_client", lambda ctx_obj: FakeXeroClient())
    payload = invoke_json(["report", "balance-sheet"])
    assert payload["data"]["report"]["Reports"][0]["ReportName"] == "BalanceSheet"


def test_quote_list_returns_picker(monkeypatch):
    monkeypatch.setenv("XERO_CLIENT_ID", "client-id")
    monkeypatch.setenv("XERO_CLIENT_SECRET", "client-secret")
    monkeypatch.setenv("XERO_REFRESH_TOKEN", "refresh-token")
    monkeypatch.setenv("XERO_TENANT_ID", "tenant-123")
    monkeypatch.setattr(runtime, "create_client", lambda ctx_obj: FakeXeroClient())
    payload = invoke_json(["quote", "list"])
    assert payload["data"]["quotes"][0]["id"] == "quote-1"
    assert payload["data"]["picker"]["kind"] == "xero_quote"
