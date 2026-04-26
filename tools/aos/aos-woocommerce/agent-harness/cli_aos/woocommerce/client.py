from __future__ import annotations

import base64
from dataclasses import dataclass
import json
from typing import Any
from urllib.error import HTTPError, URLError
from urllib.parse import urlencode
from urllib.request import Request, urlopen

from .constants import DEFAULT_TIMEOUT_SECONDS
from .errors import WooCommerceAPIError


@dataclass(frozen=True)
class WooCommerceResponse:
    status: int
    data: Any
    headers: dict[str, str]


class WooCommerceClient:
    def __init__(self, *, consumer_key: str, consumer_secret: str, base_url: str, timeout: int = DEFAULT_TIMEOUT_SECONDS) -> None:
        self.consumer_key = consumer_key
        self.consumer_secret = consumer_secret
        self.base_url = base_url.rstrip("/")
        self.timeout = timeout

    def _auth_header(self) -> str:
        credentials = f"{self.consumer_key}:{self.consumer_secret}"
        encoded = base64.b64encode(credentials.encode("utf-8")).decode("utf-8")
        return f"Basic {encoded}"

    def _request(
        self,
        method: str,
        path: str,
        *,
        params: dict[str, str | int | None] | None = None,
        body: dict[str, Any] | None = None,
    ) -> WooCommerceResponse:
        url = f"{self.base_url}/{path.lstrip('/')}"
        if params:
            encoded = urlencode({key: value for key, value in params.items() if value is not None})
            if encoded:
                url = f"{url}?{encoded}"
        headers = {
            "Authorization": self._auth_header(),
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
                return WooCommerceResponse(
                    status=getattr(response, "status", 200),
                    data=payload,
                    headers={key: value for key, value in response.headers.items()},
                )
        except HTTPError as exc:
            raw = exc.read().decode("utf-8") if hasattr(exc, "read") else ""
            raise WooCommerceAPIError(f"WooCommerce API request failed: {exc.code} {exc.reason}: {raw or exc}") from exc
        except URLError as exc:
            raise WooCommerceAPIError(f"WooCommerce API request failed: {exc.reason}") from exc

    def list_orders(self, *, status: str | None = None, customer_id: str | None = None, limit: int = 10) -> dict[str, Any]:
        params: dict[str, str | int | None] = {"per_page": limit}
        if status:
            params["status"] = status
        if customer_id:
            params["customer"] = customer_id
        response = self._request("GET", "/orders", params=params)
        return {"orders": response.data or []}

    def get_order(self, order_id: str) -> dict[str, Any]:
        response = self._request("GET", f"/orders/{order_id}")
        return response.data or {}

    def list_products(self, *, status: str | None = None, sku: str | None = None, limit: int = 10) -> dict[str, Any]:
        params: dict[str, str | int | None] = {"per_page": limit}
        if status:
            params["status"] = status
        if sku:
            params["sku"] = sku
        response = self._request("GET", "/products", params=params)
        return {"products": response.data or []}

    def get_product(self, product_id: str) -> dict[str, Any]:
        response = self._request("GET", f"/products/{product_id}")
        return response.data or {}

    def list_customers(self, *, limit: int = 10) -> dict[str, Any]:
        response = self._request("GET", "/customers", params={"per_page": limit})
        return {"customers": response.data or []}

    def get_customer(self, customer_id: str) -> dict[str, Any]:
        response = self._request("GET", f"/customers/{customer_id}")
        return response.data or {}

    def list_coupons(self, *, limit: int = 10) -> dict[str, Any]:
        response = self._request("GET", "/coupons", params={"per_page": limit})
        return {"coupons": response.data or []}

    def report_sales(self) -> dict[str, Any]:
        response = self._request("GET", "/reports/sales")
        return response.data[0] if isinstance(response.data, list) and response.data else response.data or {}

    def report_top_sellers(self) -> dict[str, Any]:
        response = self._request("GET", "/reports/top_sellers")
        return {"top_sellers": response.data or []}
