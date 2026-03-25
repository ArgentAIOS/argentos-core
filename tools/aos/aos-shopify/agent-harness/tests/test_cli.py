from __future__ import annotations

import json
from pathlib import Path

import pytest
from click.testing import CliRunner

import cli_aos.shopify.runtime as runtime
from cli_aos.shopify.cli import cli


class FakeShopifyAdminClient:
    probe_calls = 0
    calls: list[tuple[str, str | int | None]] = []

    def __init__(self, *, api_version: str = "latest") -> None:
        self.api_version = api_version

    @classmethod
    def from_env(cls, *, api_version: str = "latest") -> FakeShopifyAdminClient:
        cls.probe_calls += 1
        return cls(api_version=api_version)

    def shop(self) -> dict[str, object]:
        self.__class__.calls.append(("shop", self.api_version))
        return {
            "id": 123456789,
            "name": "Demo Shop",
            "shop_owner": "Ada Example",
            "domain": "example.myshopify.com",
            "primary_domain": {"host": "example.com"},
            "currency": "USD",
            "timezone": "America/Chicago",
        }

    def products(self, *, limit: int, status: str | None = None) -> tuple[list[dict[str, object]], dict[str, object]]:
        self.__class__.calls.append(("products", limit, status))
        return (
            [
                {"id": 101, "title": "Blue Tee", "handle": "blue-tee"},
                {"id": 102, "title": "Green Cap", "handle": "green-cap"},
            ],
            {"has_next_page": True, "next_page_info": "cursor-products", "api_call_limit": "1/80"},
        )

    def product(self, product_id: str) -> dict[str, object]:
        self.__class__.calls.append(("product", product_id))
        return {"id": int(_normalize_shopify_id(product_id)), "title": "Blue Tee", "handle": "blue-tee"}

    def orders(
        self,
        *,
        limit: int,
        status: str | None = None,
        created_after: str | None = None,
        created_before: str | None = None,
    ) -> tuple[list[dict[str, object]], dict[str, object]]:
        self.__class__.calls.append(("orders", limit, status, created_after, created_before))
        return (
            [
                {"id": 201, "name": "#1001", "financial_status": "paid"},
                {"id": 202, "name": "#1002", "financial_status": "pending"},
            ],
            {"has_next_page": False, "api_call_limit": "2/80"},
        )

    def order(self, order_id: str) -> dict[str, object]:
        self.__class__.calls.append(("order", order_id))
        return {"id": int(_normalize_shopify_id(order_id)), "name": "#1002", "financial_status": "paid"}

    def customers(
        self,
        *,
        limit: int,
        email: str | None = None,
        created_after: str | None = None,
        created_before: str | None = None,
    ) -> tuple[list[dict[str, object]], dict[str, object]]:
        self.__class__.calls.append(("customers", limit, email, created_after, created_before))
        return (
            [
                {"id": 301, "first_name": "Jane", "last_name": "Doe", "email": "jane@example.com"},
                {"id": 302, "first_name": "John", "last_name": "Smith", "email": "john@example.com"},
            ],
            {"has_next_page": False, "api_call_limit": "3/80"},
        )

    def customer(self, customer_id: str) -> dict[str, object]:
        self.__class__.calls.append(("customer", customer_id))
        return {"id": int(_normalize_shopify_id(customer_id)), "first_name": "Jane", "last_name": "Doe", "email": "jane@example.com"}


def _normalize_shopify_id(value: str) -> str:
    if value.startswith("gid://shopify/"):
        return value.rsplit("/", 1)[-1]
    return value


@pytest.fixture()
def fake_shopify_client(monkeypatch: pytest.MonkeyPatch) -> FakeShopifyAdminClient:
    FakeShopifyAdminClient.probe_calls = 0
    FakeShopifyAdminClient.calls = []
    monkeypatch.setattr(runtime, "ShopifyAdminClient", FakeShopifyAdminClient)
    return FakeShopifyAdminClient


def test_capabilities_json_matches_manifest():
    result = CliRunner().invoke(cli, ["--json", "capabilities"])
    assert result.exit_code == 0

    envelope = json.loads(result.output)
    payload = envelope["data"] if envelope.get("data") else envelope
    manifest = json.loads((Path(__file__).resolve().parents[2] / "connector.json").read_text())

    assert envelope["tool"] == "aos-shopify"
    assert payload["tool"] == manifest["tool"]
    assert payload["backend"] == manifest["backend"]
    assert payload["manifest_schema_version"] == manifest["manifest_schema_version"]
    assert payload["connector"] == manifest["connector"]
    assert payload["scope"] == manifest["scope"]
    assert payload["auth"] == manifest["auth"]
    assert payload["commands"] == manifest["commands"]


def test_health_reports_live_when_probe_succeeds(monkeypatch: pytest.MonkeyPatch, fake_shopify_client: FakeShopifyAdminClient):
    monkeypatch.setenv("SHOPIFY_SHOP_DOMAIN", "example.myshopify.com")
    monkeypatch.setenv("SHOPIFY_ADMIN_ACCESS_TOKEN", "shpat_secret")

    result = CliRunner().invoke(cli, ["--json", "health"])
    assert result.exit_code == 0

    payload = json.loads(result.output)["data"]
    assert payload["status"] == "live"
    assert payload["runtime_ready"] is True
    assert payload["live_backend_available"] is True
    assert payload["probe"]["ok"] is True
    assert payload["probe"]["details"]["shop_name"] == "Demo Shop"
    assert fake_shopify_client.probe_calls == 1
    assert fake_shopify_client.calls == [("shop", "latest")]


def test_doctor_reports_ready_when_probe_succeeds(monkeypatch: pytest.MonkeyPatch, fake_shopify_client: FakeShopifyAdminClient):
    monkeypatch.setenv("SHOPIFY_SHOP_DOMAIN", "example.myshopify.com")
    monkeypatch.setenv("SHOPIFY_ADMIN_ACCESS_TOKEN", "shpat_secret")

    result = CliRunner().invoke(cli, ["--json", "doctor"])
    assert result.exit_code == 0

    payload = json.loads(result.output)["data"]
    assert payload["status"] == "ready"
    assert payload["runtime_ready"] is True
    assert payload["setup_complete"] is True
    assert payload["live_backend_available"] is True
    assert "shop.read" in payload["supported_read_commands"]
    assert "product.update" in payload["scaffolded_commands"]
    assert fake_shopify_client.probe_calls == 1


def test_config_show_reports_live_read_capability(monkeypatch: pytest.MonkeyPatch):
    monkeypatch.setenv("SHOPIFY_SHOP_DOMAIN", "example.myshopify.com")
    monkeypatch.setenv("SHOPIFY_ADMIN_ACCESS_TOKEN", "shpat_secret")
    monkeypatch.setenv("SHOPIFY_API_VERSION", "2025-10")
    monkeypatch.setenv("SHOPIFY_APP_NAME", "Worker App")
    monkeypatch.setenv("SHOPIFY_PRODUCT_STATUS", "active")
    monkeypatch.setenv("SHOPIFY_ORDER_STATUS", "open")
    monkeypatch.setenv("SHOPIFY_CUSTOMER_EMAIL", "vip@example.com")
    monkeypatch.setenv("SHOPIFY_CREATED_AFTER", "2026-01-01")
    monkeypatch.setenv("SHOPIFY_CREATED_BEFORE", "2026-01-31")

    result = CliRunner().invoke(cli, ["--json", "config", "show"])
    assert result.exit_code == 0

    payload = json.loads(result.output)["data"]
    assert "shpat_secret" not in result.output
    assert payload["runtime_ready"] is True
    assert payload["live_reads_enabled"] is True
    assert payload["scaffold_only"] is False
    assert payload["runtime"]["api_version"] == "2025-10"
    assert payload["runtime"]["api_version_source"] == "env"
    assert payload["runtime"]["live_backend_available"] is True
    assert payload["runtime"]["live_writes_enabled"] is False
    assert payload["scope"]["kind"] == "store-catalog"
    assert payload["runtime"]["scope"]["product_status"] == "active"
    assert payload["runtime"]["scope"]["order_status"] == "open"
    assert payload["runtime"]["scope"]["customer_email"] == "vip@example.com"
    assert payload["runtime"]["command_defaults"]["product.list"]["status"] == "active"
    assert payload["runtime"]["command_defaults"]["order.list"]["created_after"] == "2026-01-01"
    assert payload["runtime"]["command_defaults"]["customer.list"]["email"] == "vip@example.com"


@pytest.mark.parametrize(
    ("command", "args", "expected_key", "expected_summary"),
    [
        ("shop", ["read"], "record", "Read shop Demo Shop"),
        ("product", ["list", "--limit", "2"], "records", "Listed 2 products"),
        ("product", ["read", "gid://shopify/Product/101"], "record", "Read product 101: Blue Tee"),
        ("order", ["list", "--limit", "2"], "records", "Listed 2 orders"),
        ("order", ["read", "gid://shopify/Order/202"], "record", "Read order #1002"),
        ("customer", ["list", "--limit", "2"], "records", "Listed 2 customers"),
        ("customer", ["read", "gid://shopify/Customer/301"], "record", "Read customer jane@example.com"),
    ],
)
def test_live_read_commands_return_truthful_payload(
    monkeypatch: pytest.MonkeyPatch,
    fake_shopify_client: FakeShopifyAdminClient,
    command: str,
    args: list[str],
    expected_key: str,
    expected_summary: str,
):
    monkeypatch.setenv("SHOPIFY_SHOP_DOMAIN", "example.myshopify.com")
    monkeypatch.setenv("SHOPIFY_ADMIN_ACCESS_TOKEN", "shpat_secret")

    result = CliRunner().invoke(cli, ["--json", command, *args])
    assert result.exit_code == 0

    payload = json.loads(result.output)["data"]
    assert payload["status"] == "live"
    assert payload["scaffold_only"] is False
    assert payload["live_backend_available"] is True
    assert expected_key in payload
    assert expected_summary in payload["summary"]
    assert fake_shopify_client.probe_calls == 1


@pytest.mark.parametrize(
    ("command", "args", "expected_option"),
    [
        ("shop", ["read"], None),
        (
            "product",
            ["list", "--limit", "2"],
            {"value": "101", "label": "Blue Tee", "resource": "product", "subtitle": "blue-tee"},
        ),
        (
            "order",
            ["list", "--limit", "2"],
            {"value": "201", "label": "#1001", "resource": "order", "subtitle": "paid"},
        ),
        (
            "customer",
            ["list", "--limit", "2"],
            {"value": "301", "label": "jane@example.com", "resource": "customer", "subtitle": "jane@example.com"},
        ),
    ],
)
def test_picker_friendly_live_reads_expose_store_scope_and_options(
    monkeypatch: pytest.MonkeyPatch,
    fake_shopify_client: FakeShopifyAdminClient,
    command: str,
    args: list[str],
    expected_option: dict[str, str] | None,
):
    monkeypatch.setenv("SHOPIFY_SHOP_DOMAIN", "example.myshopify.com")
    monkeypatch.setenv("SHOPIFY_ADMIN_ACCESS_TOKEN", "shpat_secret")

    result = CliRunner().invoke(cli, ["--json", command, *args])
    assert result.exit_code == 0

    payload = json.loads(result.output)["data"]
    if command == "shop":
        assert payload["store_scope"]["shop"] == {
            "id": "123456789",
            "name": "Demo Shop",
            "owner": "Ada Example",
            "domain": "example.myshopify.com",
            "primary_domain": "example.com",
            "currency": "USD",
            "timezone": "America/Chicago",
        }
        assert payload["store_scope"]["scope"]["shop_domain"] == "example.myshopify.com"
        assert payload["store_scope"]["command_defaults"]["product.list"] == {"status": None}
    else:
        assert payload["picker_options"]
        assert payload["picker_options"][0] == expected_option
    assert fake_shopify_client.probe_calls == 1


@pytest.mark.parametrize(
    ("command", "args", "env", "expected_call"),
    [
        (
            "product",
            ["list", "--limit", "2"],
            {"SHOPIFY_PRODUCT_STATUS": "active"},
            ("products", 2, "active"),
        ),
        (
            "order",
            ["list", "--limit", "2"],
            {
                "SHOPIFY_ORDER_STATUS": "open",
                "SHOPIFY_CREATED_AFTER": "2026-01-01",
                "SHOPIFY_CREATED_BEFORE": "2026-01-31",
            },
            ("orders", 2, "open", "2026-01-01", "2026-01-31"),
        ),
        (
            "customer",
            ["list", "--limit", "2"],
            {
                "SHOPIFY_CUSTOMER_EMAIL": "vip@example.com",
                "SHOPIFY_CREATED_AFTER": "2026-01-01",
                "SHOPIFY_CREATED_BEFORE": "2026-01-31",
            },
            ("customers", 2, "vip@example.com", "2026-01-01", "2026-01-31"),
        ),
    ],
)
def test_scope_defaults_apply_to_live_read_commands(
    monkeypatch: pytest.MonkeyPatch,
    fake_shopify_client: FakeShopifyAdminClient,
    command: str,
    args: list[str],
    env: dict[str, str],
    expected_call: tuple[object, ...],
):
    monkeypatch.setenv("SHOPIFY_SHOP_DOMAIN", "example.myshopify.com")
    monkeypatch.setenv("SHOPIFY_ADMIN_ACCESS_TOKEN", "shpat_secret")
    for key, value in env.items():
        monkeypatch.setenv(key, value)

    result = CliRunner().invoke(cli, ["--json", command, *args])
    assert result.exit_code == 0

    payload = json.loads(result.output)["data"]
    assert payload["status"] == "live"
    assert fake_shopify_client.calls[-1] == expected_call
    if command == "product":
        assert payload["inputs"]["status"] == "active"
    elif command == "order":
        assert payload["inputs"]["status"] == "open"
        assert payload["inputs"]["created_after"] == "2026-01-01"
        assert payload["inputs"]["created_before"] == "2026-01-31"
    elif command == "customer":
        assert payload["inputs"]["email"] == "vip@example.com"
        assert payload["inputs"]["created_after"] == "2026-01-01"
        assert payload["inputs"]["created_before"] == "2026-01-31"


def test_customer_list_filters_created_window_in_client(monkeypatch: pytest.MonkeyPatch):
    client = runtime.ShopifyAdminClient(shop_domain="example.myshopify.com", access_token="shpat_secret")

    def fake_request_json(self, path: str, *, params: dict[str, object] | None = None):
        assert path == "customers.json"
        assert params == {"limit": 10, "created_at_min": "2026-01-01", "created_at_max": "2026-01-31"}
        return (
            {
                "customers": [
                    {"id": 301, "email": "jane@example.com", "created_at": "2026-01-15T12:00:00Z"},
                    {"id": 302, "email": "john@example.com", "created_at": "2026-02-01T12:00:00Z"},
                ]
            },
            {},
            200,
        )

    monkeypatch.setattr(runtime.ShopifyAdminClient, "_request_json", fake_request_json)
    records, pagination = client.customers(limit=10, created_after="2026-01-01", created_before="2026-01-31")

    assert [record["id"] for record in records] == [301]
    assert pagination == {"has_next_page": False}


def test_write_command_stays_scaffolded_in_write_mode(monkeypatch: pytest.MonkeyPatch):
    monkeypatch.setenv("SHOPIFY_SHOP_DOMAIN", "example.myshopify.com")
    monkeypatch.setenv("SHOPIFY_ADMIN_ACCESS_TOKEN", "shpat_secret")

    result = CliRunner().invoke(
        cli,
        ["--json", "--mode", "write", "product", "update", "gid://shopify/Product/1", "--title", "New Title"],
    )
    assert result.exit_code == 0
    assert '"status": "scaffold"' in result.output
    assert '"command_id": "product.update"' in result.output
    assert '"executed": false' in result.output


def test_permission_gate_blocks_write_for_readonly():
    result = CliRunner().invoke(cli, ["--json", "--mode", "readonly", "fulfillment", "create", "gid://shopify/Order/1"])
    assert result.exit_code == 3
    assert "PERMISSION_DENIED" in result.output
