from __future__ import annotations

from typing import Any

from cli_aos.square.client import SquareClient


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
        if url.endswith("/locations"):
            return FakeResponse({"locations": [{"id": "LOC_1", "name": "Main Store", "status": "ACTIVE"}]})
        if url.endswith("/payments") or "payments?" in url:
            return FakeResponse({"payments": [{"id": "PAY_1", "status": "COMPLETED"}]})
        if "/payments/PAY_1" in url:
            return FakeResponse({"payment": {"id": "PAY_1", "status": "COMPLETED"}})
        if url.endswith("/customers") or "customers?" in url:
            return FakeResponse({"customers": [{"id": "CUST_1", "given_name": "Jane"}]})
        if "/customers/CUST_1" in url:
            return FakeResponse({"customer": {"id": "CUST_1", "given_name": "Jane"}})
        if "catalog/list" in url:
            return FakeResponse({"objects": [{"id": "ITEM_1", "name": "Widget", "type": "ITEM"}]})
        if "catalog/object/ITEM_1" in url:
            return FakeResponse({"object": {"id": "ITEM_1", "name": "Widget"}})
        if url.endswith("/orders/search"):
            return FakeResponse({"orders": [{"id": "ORD_1", "state": "COMPLETED"}]})
        if "/orders/ORD_1" in url:
            return FakeResponse({"order": {"id": "ORD_1", "state": "COMPLETED"}})
        if url.endswith("/invoices") or "invoices?" in url:
            return FakeResponse({"invoices": [{"id": "INV_1", "status": "DRAFT"}]})
        return FakeResponse({"ok": True})


def test_square_client_reads_locations_and_payments(monkeypatch):
    fake = FakeURLLib()
    monkeypatch.setattr("cli_aos.square.client.urlopen", fake)
    client = SquareClient(access_token="tok_123", base_url="https://connect.squareup.com/v2")
    locations = client.list_locations()
    payments = client.list_payments()
    customer = client.get_customer("CUST_1")
    items = client.list_items()
    assert len(locations["locations"]) == 1
    assert locations["locations"][0]["id"] == "LOC_1"
    assert len(payments["payments"]) == 1
    assert customer["id"] == "CUST_1"
    assert len(items["items"]) == 1
