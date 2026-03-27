from __future__ import annotations

import json
from pathlib import Path
from typing import Any

from click.testing import CliRunner

from cli_aos.square.cli import cli
import cli_aos.square.runtime as runtime


AGENT_HARNESS_ROOT = Path(__file__).resolve().parents[1]
CONNECTOR_PATH = AGENT_HARNESS_ROOT.parent / "connector.json"
PERMISSIONS_PATH = AGENT_HARNESS_ROOT / "permissions.json"


class FakeSquareClient:
    def list_locations(self) -> dict[str, Any]:
        return {
            "locations": [
                {"id": "LOC_1", "name": "Main Store", "address": {"locality": "Austin"}, "status": "ACTIVE", "timezone": "America/Chicago", "currency": "USD"},
            ]
        }

    def list_payments(self, *, location_id: str | None = None, limit: int = 10) -> dict[str, Any]:
        return {
            "payments": [
                {"id": "PAY_1", "amount_money": {"amount": 1000, "currency": "USD"}, "status": "COMPLETED", "source_type": "CARD", "created_at": "2026-03-01T12:00:00Z", "order_id": "ORD_1"},
            ]
        }

    def get_payment(self, payment_id: str) -> dict[str, Any]:
        return {"id": payment_id, "amount_money": {"amount": 1000, "currency": "USD"}, "status": "COMPLETED"}

    def list_customers(self, *, limit: int = 10) -> dict[str, Any]:
        return {
            "customers": [
                {"id": "CUST_1", "given_name": "Jane", "family_name": "Doe", "email_address": "jane@example.com", "created_at": "2026-01-01T00:00:00Z"},
            ]
        }

    def get_customer(self, customer_id: str) -> dict[str, Any]:
        return {"id": customer_id, "given_name": "Jane", "family_name": "Doe", "email_address": "jane@example.com"}

    def list_orders(self, *, location_id: str, limit: int = 10) -> dict[str, Any]:
        return {
            "orders": [
                {"id": "ORD_1", "state": "COMPLETED", "total_money": {"amount": 2500, "currency": "USD"}, "created_at": "2026-03-01T12:00:00Z", "line_items": []},
            ]
        }

    def get_order(self, order_id: str) -> dict[str, Any]:
        return {"id": order_id, "state": "COMPLETED", "total_money": {"amount": 2500, "currency": "USD"}}

    def list_items(self, *, limit: int = 10) -> dict[str, Any]:
        return {
            "items": [
                {"id": "ITEM_1", "name": "Widget", "type": "ITEM", "variations": [], "updated_at": "2026-03-01T00:00:00Z"},
            ]
        }

    def get_item(self, item_id: str) -> dict[str, Any]:
        return {"id": item_id, "name": "Widget", "type": "ITEM"}

    def list_invoices(self, *, location_id: str, limit: int = 10) -> dict[str, Any]:
        return {
            "invoices": [
                {"id": "INV_1", "status": "DRAFT", "invoice_number": "001", "payment_requests": [], "created_at": "2026-03-01T00:00:00Z"},
            ]
        }


def invoke_json(args: list[str]) -> dict[str, Any]:
    result = CliRunner().invoke(cli, ["--json", *args])
    assert result.exit_code == 0, result.output
    return json.loads(result.output)


def test_manifest_and_permissions_are_in_sync():
    manifest = json.loads(CONNECTOR_PATH.read_text())
    permissions = json.loads(PERMISSIONS_PATH.read_text())["permissions"]
    command_ids = [command["id"] for command in manifest["commands"]]
    assert set(command_ids) == set(permissions.keys())
    assert manifest["scope"]["kind"] == "commerce"


def test_capabilities_exposes_manifest():
    payload = invoke_json(["capabilities"])
    assert payload["tool"] == "aos-square"
    assert payload["data"]["backend"] == "square-api"
    assert "payment.list" in json.dumps(payload["data"])
    assert "location.list" in json.dumps(payload["data"])


def test_health_requires_access_token(monkeypatch):
    monkeypatch.delenv("SQUARE_ACCESS_TOKEN", raising=False)
    monkeypatch.setattr(runtime, "resolve_runtime_binary", lambda: None)
    payload = invoke_json(["health"])
    assert payload["data"]["status"] == "needs_setup"
    assert "SQUARE_ACCESS_TOKEN" in json.dumps(payload["data"])


def test_health_ready_with_fake_client(monkeypatch):
    monkeypatch.setenv("SQUARE_ACCESS_TOKEN", "tok_test_abc")
    monkeypatch.setenv("SQUARE_LOCATION_ID", "LOC_1")
    monkeypatch.setattr(runtime, "resolve_runtime_binary", lambda: "/tmp/aos-square")
    monkeypatch.setattr(runtime, "create_client", lambda ctx_obj=None: FakeSquareClient())
    payload = invoke_json(["health"])
    assert payload["data"]["status"] == "ready"
    assert payload["data"]["probe"]["ok"] is True


def test_location_list_returns_picker(monkeypatch):
    monkeypatch.setenv("SQUARE_ACCESS_TOKEN", "tok_test_abc")
    monkeypatch.setattr(runtime, "create_client", lambda ctx_obj=None: FakeSquareClient())
    payload = invoke_json(["location", "list"])
    data = payload["data"]
    assert data["location_count"] == 1
    assert data["picker"]["kind"] == "location"
    assert data["picker"]["items"][0]["id"] == "LOC_1"


def test_payment_list_returns_picker(monkeypatch):
    monkeypatch.setenv("SQUARE_ACCESS_TOKEN", "tok_test_abc")
    monkeypatch.setattr(runtime, "create_client", lambda ctx_obj=None: FakeSquareClient())
    payload = invoke_json(["payment", "list"])
    data = payload["data"]
    assert data["payment_count"] == 1
    assert data["picker"]["kind"] == "payment"


def test_customer_get_requires_id(monkeypatch):
    monkeypatch.setenv("SQUARE_ACCESS_TOKEN", "tok_test_abc")
    monkeypatch.delenv("SQUARE_CUSTOMER_ID", raising=False)
    monkeypatch.setattr(runtime, "create_client", lambda ctx_obj=None: FakeSquareClient())
    payload = invoke_json(["customer", "get"])
    assert "error" in payload
    assert payload["error"]["code"] == "SQUARE_CUSTOMER_REQUIRED"


def test_customer_list_returns_picker(monkeypatch):
    monkeypatch.setenv("SQUARE_ACCESS_TOKEN", "tok_test_abc")
    monkeypatch.setattr(runtime, "create_client", lambda ctx_obj=None: FakeSquareClient())
    payload = invoke_json(["customer", "list"])
    data = payload["data"]
    assert data["customer_count"] == 1
    assert data["customers"][0]["email_address"] == "jane@example.com"


def test_payment_create_is_scaffolded(monkeypatch):
    monkeypatch.setenv("SQUARE_ACCESS_TOKEN", "tok_test_abc")
    payload = invoke_json(["payment", "create", "--amount", "1000"])
    assert payload["data"]["status"] == "scaffold_write_only"


def test_config_show_redacts_token(monkeypatch):
    monkeypatch.setenv("SQUARE_ACCESS_TOKEN", "secret-token")
    monkeypatch.setenv("SQUARE_LOCATION_ID", "LOC_1")
    payload = invoke_json(["config", "show"])
    data = payload["data"]
    assert "secret-token" not in json.dumps(data)
    assert data["scope"]["location_id"] == "LOC_1"
