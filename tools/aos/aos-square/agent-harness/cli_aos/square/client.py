from __future__ import annotations

from dataclasses import dataclass
import json
from typing import Any
from urllib.error import HTTPError, URLError
from urllib.parse import urlencode
from urllib.request import Request, urlopen

from .constants import DEFAULT_TIMEOUT_SECONDS
from .errors import SquareAPIError


@dataclass(frozen=True)
class SquareResponse:
    status: int
    data: Any
    headers: dict[str, str]


class SquareClient:
    def __init__(self, *, access_token: str, base_url: str, timeout: int = DEFAULT_TIMEOUT_SECONDS) -> None:
        self.access_token = access_token
        self.base_url = base_url.rstrip("/")
        self.timeout = timeout

    def _request(
        self,
        method: str,
        path: str,
        *,
        params: dict[str, str | int | None] | None = None,
        body: dict[str, Any] | None = None,
    ) -> SquareResponse:
        url = f"{self.base_url}/{path.lstrip('/')}"
        if params:
            encoded = urlencode({key: value for key, value in params.items() if value is not None})
            if encoded:
                url = f"{url}?{encoded}"
        headers = {
            "Authorization": f"Bearer {self.access_token}",
            "Square-Version": "2024-12-18",
            "Content-Type": "application/json",
        }
        data: bytes | None = None
        if body is not None:
            data = json.dumps(body).encode("utf-8")
        request = Request(url, data=data, method=method.upper(), headers=headers)
        try:
            with urlopen(request, timeout=self.timeout) as response:
                raw = response.read().decode("utf-8")
                payload = json.loads(raw) if raw else None
                return SquareResponse(
                    status=getattr(response, "status", 200),
                    data=payload,
                    headers={key: value for key, value in response.headers.items()},
                )
        except HTTPError as exc:
            raw = exc.read().decode("utf-8") if hasattr(exc, "read") else ""
            raise SquareAPIError(f"Square API request failed: {exc.code} {exc.reason}: {raw or exc}") from exc
        except URLError as exc:
            raise SquareAPIError(f"Square API request failed: {exc.reason}") from exc

    def list_locations(self) -> dict[str, Any]:
        response = self._request("GET", "/locations")
        return {"locations": (response.data or {}).get("locations", [])}

    def list_payments(self, *, location_id: str | None = None, limit: int = 10) -> dict[str, Any]:
        params: dict[str, str | int | None] = {"limit": limit}
        if location_id:
            params["location_id"] = location_id
        response = self._request("GET", "/payments", params=params)
        return {"payments": (response.data or {}).get("payments", [])}

    def get_payment(self, payment_id: str) -> dict[str, Any]:
        response = self._request("GET", f"/payments/{payment_id}")
        return (response.data or {}).get("payment", {})

    def list_customers(self, *, limit: int = 10) -> dict[str, Any]:
        response = self._request("GET", "/customers", params={"limit": limit})
        return {"customers": (response.data or {}).get("customers", [])}

    def get_customer(self, customer_id: str) -> dict[str, Any]:
        response = self._request("GET", f"/customers/{customer_id}")
        return (response.data or {}).get("customer", {})

    def list_orders(self, *, location_id: str, limit: int = 10) -> dict[str, Any]:
        body = {"location_ids": [location_id], "limit": limit}
        response = self._request("POST", "/orders/search", body=body)
        return {"orders": (response.data or {}).get("orders", [])}

    def get_order(self, order_id: str) -> dict[str, Any]:
        response = self._request("GET", f"/orders/{order_id}")
        return (response.data or {}).get("order", {})

    def list_items(self, *, limit: int = 10) -> dict[str, Any]:
        response = self._request("GET", "/catalog/list", params={"types": "ITEM", "limit": limit})
        return {"items": (response.data or {}).get("objects", [])}

    def get_item(self, item_id: str) -> dict[str, Any]:
        response = self._request("GET", f"/catalog/object/{item_id}")
        return (response.data or {}).get("object", {})

    def list_invoices(self, *, location_id: str, limit: int = 10) -> dict[str, Any]:
        response = self._request("GET", "/invoices", params={"location_id": location_id, "limit": limit})
        return {"invoices": (response.data or {}).get("invoices", [])}
