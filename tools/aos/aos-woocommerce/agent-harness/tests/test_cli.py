from __future__ import annotations

import json
from pathlib import Path
from typing import Any

from click.testing import CliRunner

from cli_aos.woocommerce.cli import cli
import cli_aos.woocommerce.runtime as runtime


AGENT_HARNESS_ROOT = Path(__file__).resolve().parents[1]
CONNECTOR_PATH = AGENT_HARNESS_ROOT.parent / "connector.json"
PERMISSIONS_PATH = AGENT_HARNESS_ROOT / "permissions.json"


class FakeWooCommerceClient:
    def list_orders(self, *, status: str | None = None, customer_id: str | None = None, limit: int = 10) -> dict[str, Any]:
        return {
            "orders": [
                {"id": 1234, "number": "1234", "status": "processing", "total": "59.99", "currency": "USD", "date_created": "2026-03-01T12:00:00", "billing": {"email": "jane@example.com"}},
            ]
        }

    def get_order(self, order_id: str) -> dict[str, Any]:
        return {"id": int(order_id), "number": order_id, "status": "processing", "total": "59.99"}

    def list_products(self, *, status: str | None = None, sku: str | None = None, limit: int = 10) -> dict[str, Any]:
        return {
            "products": [
                {"id": 567, "name": "Widget Pro", "sku": "WOO-001", "status": "publish", "price": "29.99", "stock_status": "instock", "type": "simple"},
            ]
        }

    def get_product(self, product_id: str) -> dict[str, Any]:
        return {"id": int(product_id), "name": "Widget Pro", "sku": "WOO-001", "status": "publish"}

    def list_customers(self, *, limit: int = 10) -> dict[str, Any]:
        return {
            "customers": [
                {"id": 89, "email": "jane@example.com", "first_name": "Jane", "last_name": "Doe", "date_created": "2026-01-01T00:00:00", "orders_count": 5},
            ]
        }

    def get_customer(self, customer_id: str) -> dict[str, Any]:
        return {"id": int(customer_id), "email": "jane@example.com", "first_name": "Jane", "last_name": "Doe"}

    def list_coupons(self, *, limit: int = 10) -> dict[str, Any]:
        return {
            "coupons": [
                {"id": 10, "code": "SAVE10", "discount_type": "percent", "amount": "10.00", "usage_count": 42, "date_expires": "2026-12-31T23:59:59"},
            ]
        }

    def report_sales(self) -> dict[str, Any]:
        return {"total_sales": "12500.00", "net_sales": "11000.00", "total_orders": 150, "total_items": 320, "total_customers": 85}

    def report_top_sellers(self) -> dict[str, Any]:
        return {"top_sellers": [{"name": "Widget Pro", "product_id": 567, "quantity": 120}]}


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
    assert payload["tool"] == "aos-woocommerce"
    assert payload["data"]["backend"] == "woocommerce-rest-api"
    assert "order.list" in json.dumps(payload["data"])
    assert "report.sales" in json.dumps(payload["data"])


def test_health_requires_credentials(monkeypatch):
    monkeypatch.delenv("WOO_CONSUMER_KEY", raising=False)
    monkeypatch.delenv("WOO_CONSUMER_SECRET", raising=False)
    monkeypatch.delenv("WOO_STORE_URL", raising=False)
    monkeypatch.setattr(runtime, "resolve_runtime_binary", lambda: None)
    payload = invoke_json(["health"])
    assert payload["data"]["status"] == "needs_setup"
    assert "WOO_CONSUMER_KEY" in json.dumps(payload["data"])


def test_health_ready_with_fake_client(monkeypatch):
    monkeypatch.setenv("WOO_CONSUMER_KEY", "ck_test")
    monkeypatch.setenv("WOO_CONSUMER_SECRET", "cs_test")
    monkeypatch.setenv("WOO_STORE_URL", "https://mystore.example.com")
    monkeypatch.setattr(runtime, "resolve_runtime_binary", lambda: "/tmp/aos-woocommerce")
    monkeypatch.setattr(runtime, "create_client", lambda ctx_obj=None: FakeWooCommerceClient())
    payload = invoke_json(["health"])
    assert payload["data"]["status"] == "ready"
    assert payload["data"]["probe"]["ok"] is True


def test_order_list_returns_picker(monkeypatch):
    monkeypatch.setenv("WOO_CONSUMER_KEY", "ck_test")
    monkeypatch.setenv("WOO_CONSUMER_SECRET", "cs_test")
    monkeypatch.setenv("WOO_STORE_URL", "https://mystore.example.com")
    monkeypatch.setattr(runtime, "create_client", lambda ctx_obj=None: FakeWooCommerceClient())
    payload = invoke_json(["order", "list"])
    data = payload["data"]
    assert data["order_count"] == 1
    assert data["picker"]["kind"] == "order"


def test_product_list_returns_picker(monkeypatch):
    monkeypatch.setenv("WOO_CONSUMER_KEY", "ck_test")
    monkeypatch.setenv("WOO_CONSUMER_SECRET", "cs_test")
    monkeypatch.setenv("WOO_STORE_URL", "https://mystore.example.com")
    monkeypatch.setattr(runtime, "create_client", lambda ctx_obj=None: FakeWooCommerceClient())
    payload = invoke_json(["product", "list"])
    data = payload["data"]
    assert data["product_count"] == 1
    assert data["products"][0]["sku"] == "WOO-001"


def test_order_get_requires_id(monkeypatch):
    monkeypatch.setenv("WOO_CONSUMER_KEY", "ck_test")
    monkeypatch.setenv("WOO_CONSUMER_SECRET", "cs_test")
    monkeypatch.setenv("WOO_STORE_URL", "https://mystore.example.com")
    monkeypatch.delenv("WOO_ORDER_ID", raising=False)
    monkeypatch.setattr(runtime, "create_client", lambda ctx_obj=None: FakeWooCommerceClient())
    payload = invoke_json(["order", "get"])
    assert "error" in payload
    assert payload["error"]["code"] == "WOO_ORDER_REQUIRED"


def test_order_create_is_scaffolded(monkeypatch):
    monkeypatch.setenv("WOO_CONSUMER_KEY", "ck_test")
    monkeypatch.setenv("WOO_CONSUMER_SECRET", "cs_test")
    monkeypatch.setenv("WOO_STORE_URL", "https://mystore.example.com")
    payload = invoke_json(["order", "create"])
    assert payload["data"]["status"] == "scaffold_write_only"


def test_report_sales_returns_data(monkeypatch):
    monkeypatch.setenv("WOO_CONSUMER_KEY", "ck_test")
    monkeypatch.setenv("WOO_CONSUMER_SECRET", "cs_test")
    monkeypatch.setenv("WOO_STORE_URL", "https://mystore.example.com")
    monkeypatch.setattr(runtime, "create_client", lambda ctx_obj=None: FakeWooCommerceClient())
    payload = invoke_json(["report", "sales"])
    assert payload["data"]["report"]["total_orders"] == 150


def test_config_show_redacts_secrets(monkeypatch):
    monkeypatch.setenv("WOO_CONSUMER_KEY", "ck_secret")
    monkeypatch.setenv("WOO_CONSUMER_SECRET", "cs_secret")
    monkeypatch.setenv("WOO_STORE_URL", "https://mystore.example.com")
    payload = invoke_json(["config", "show"])
    data = payload["data"]
    assert "ck_secret" not in json.dumps(data)
    assert "cs_secret" not in json.dumps(data)
    assert data["scope"]["store_url"] == "https://mystore.example.com"
