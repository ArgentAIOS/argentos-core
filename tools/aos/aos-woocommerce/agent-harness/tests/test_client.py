from __future__ import annotations

from typing import Any

from cli_aos.woocommerce.client import WooCommerceClient


class FakeResponse:
    def __init__(self, data: Any, status: int = 200):
        self._data = data
        self.status = status
        self.headers = {"Content-Type": "application/json"}

    def read(self) -> bytes:
        import json

        return json.dumps(self._data).encode("utf-8")

    def __enter__(self):
        return self

    def __exit__(self, exc_type, exc, tb):
        return False


class FakeURLLib:
    def __init__(self):
        self.requests: list[dict[str, Any]] = []

    def __call__(self, request, timeout=None):
        url = request.full_url
        self.requests.append({"url": url, "method": request.method, "headers": dict(request.headers), "timeout": timeout})
        if url.endswith("/orders") or "orders?" in url:
            return FakeResponse([{"id": 1234, "number": "1234", "status": "processing", "total": "59.99"}])
        if "/orders/1234" in url:
            return FakeResponse({"id": 1234, "status": "processing"})
        if url.endswith("/products") or "products?" in url:
            return FakeResponse([{"id": 567, "name": "Widget Pro", "sku": "WOO-001"}])
        if "/products/567" in url:
            return FakeResponse({"id": 567, "name": "Widget Pro"})
        if url.endswith("/customers") or "customers?" in url:
            return FakeResponse([{"id": 89, "email": "jane@example.com"}])
        if "/customers/89" in url:
            return FakeResponse({"id": 89, "email": "jane@example.com"})
        if url.endswith("/coupons") or "coupons?" in url:
            return FakeResponse([{"id": 10, "code": "SAVE10"}])
        if "reports/sales" in url:
            return FakeResponse([{"total_sales": "12500.00", "total_orders": 150}])
        if "reports/top_sellers" in url:
            return FakeResponse([{"name": "Widget Pro", "quantity": 120}])
        return FakeResponse({"ok": True})


def test_woocommerce_client_reads_orders_and_products(monkeypatch):
    fake = FakeURLLib()
    monkeypatch.setattr("cli_aos.woocommerce.client.urlopen", fake)
    client = WooCommerceClient(consumer_key="ck_test", consumer_secret="cs_test", base_url="https://mystore.example.com/wp-json/wc/v3")
    orders = client.list_orders()
    products = client.list_products()
    customer = client.get_customer("89")
    sales = client.report_sales()
    assert len(orders["orders"]) == 1
    assert orders["orders"][0]["id"] == 1234
    assert len(products["products"]) == 1
    assert products["products"][0]["name"] == "Widget Pro"
    assert customer["id"] == 89
    assert sales["total_orders"] == 150
    # verify Basic auth header
    assert all("Basic" in r["headers"].get("Authorization", "") for r in fake.requests)
