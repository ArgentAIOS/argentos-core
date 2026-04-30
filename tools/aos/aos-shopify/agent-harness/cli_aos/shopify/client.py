from __future__ import annotations

import json
import re
from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Any, Mapping
from urllib.error import HTTPError, URLError
from urllib.parse import urlencode
from urllib.request import Request, urlopen

from .service_keys import service_key_env


_GID_PATTERN = re.compile(r"^gid://shopify/[^/]+/(?P<id>[^/?#]+)$")
_PRODUCT_STATUSES = {"active", "draft", "archived"}
_ORDER_CANCEL_REASONS = {"customer", "inventory", "fraud", "declined", "other"}


class ShopifyApiError(Exception):
    def __init__(self, *, code: str, message: str, status_code: int | None = None, details: dict[str, Any] | None = None) -> None:
        super().__init__(message)
        self.code = code
        self.message = message
        self.status_code = status_code
        self.details = details or {}


@dataclass(slots=True)
class ShopifyAdminClient:
    shop_domain: str
    access_token: str
    api_version: str = "latest"
    timeout: float = 15.0

    @classmethod
    def from_env(cls, *, api_version: str = "latest") -> ShopifyAdminClient:
        shop_domain = (service_key_env("SHOPIFY_SHOP_DOMAIN", "") or "").strip()
        access_token = (service_key_env("SHOPIFY_ADMIN_ACCESS_TOKEN", "") or "").strip()
        if not shop_domain or not access_token:
            missing = []
            if not shop_domain:
                missing.append("SHOPIFY_SHOP_DOMAIN")
            if not access_token:
                missing.append("SHOPIFY_ADMIN_ACCESS_TOKEN")
            raise ShopifyApiError(
                code="SHOPIFY_SETUP_REQUIRED",
                message="Shopify connector is not configured yet",
                details={"missing_keys": missing},
            )
        return cls(shop_domain=shop_domain, access_token=access_token, api_version=api_version or "latest")

    @property
    def base_url(self) -> str:
        return f"https://{self.shop_domain}/admin/api/{self.api_version}"

    def _request_json(
        self,
        path: str,
        *,
        params: Mapping[str, Any] | None = None,
        method: str = "GET",
        body: Mapping[str, Any] | None = None,
    ) -> tuple[dict[str, Any], dict[str, str], int]:
        normalized_path = path.lstrip("/")
        url = f"{self.base_url}/{normalized_path}"
        if params:
            query = urlencode([(key, str(value)) for key, value in params.items() if value is not None])
            if query:
                url = f"{url}?{query}"
        payload_bytes = json.dumps(body).encode("utf-8") if body is not None else None

        request = Request(
            url,
            data=payload_bytes,
            headers={
                "Accept": "application/json",
                "Content-Type": "application/json",
                "X-Shopify-Access-Token": self.access_token,
            },
            method=method,
        )

        try:
            with urlopen(request, timeout=self.timeout) as response:
                body = response.read().decode("utf-8")
                payload = json.loads(body) if body else {}
                headers = {key.lower(): value for key, value in response.headers.items()}
                return payload, headers, int(getattr(response, "status", 200))
        except HTTPError as exc:
            body = exc.read().decode("utf-8", errors="replace")
            details: dict[str, Any] = {
                "url": url,
                "response_body": body,
                "response_headers": {key.lower(): value for key, value in exc.headers.items()} if exc.headers else {},
            }
            try:
                parsed = json.loads(body)
            except json.JSONDecodeError:
                parsed = None
            if isinstance(parsed, dict):
                details["response_json"] = parsed
            code = _error_code_from_status(exc.code)
            message = _error_message_from_status(exc.code, parsed, body)
            raise ShopifyApiError(code=code, message=message, status_code=exc.code, details=details) from exc
        except URLError as exc:
            raise ShopifyApiError(
                code="SHOPIFY_UNREACHABLE",
                message=f"Unable to reach Shopify: {exc.reason}",
                details={"url": url},
            ) from exc

    def shop(self) -> dict[str, Any]:
        payload, _, _ = self._request_json("shop.json")
        return payload.get("shop", payload)

    def products(self, *, limit: int, status: str | None = None) -> tuple[list[dict[str, Any]], dict[str, Any]]:
        params: dict[str, Any] = {"limit": limit}
        if status:
            params["status"] = status.strip()
        payload, headers, _ = self._request_json("products.json", params=params)
        return payload.get("products", []), _pagination_from_headers(headers)

    def product(self, product_id: str) -> dict[str, Any]:
        payload, _, _ = self._request_json(f"products/{_normalize_identifier(product_id)}.json")
        return payload.get("product", payload)

    def update_product(self, product_id: str, *, title: str | None = None, status: str | None = None) -> dict[str, Any]:
        product: dict[str, Any] = {"id": int(_normalize_identifier(product_id))}
        normalized_title = (title or "").strip()
        normalized_status = _normalize_product_status(status)
        if normalized_title:
            product["title"] = normalized_title
        if normalized_status:
            product["status"] = normalized_status
        if len(product) == 1:
            raise ShopifyApiError(
                code="SHOPIFY_INVALID_INPUT",
                message="Provide at least one mutable product field",
                details={"allowed_fields": ["title", "status"]},
            )
        payload, _, _ = self._request_json(
            f"products/{product['id']}.json",
            method="PUT",
            body={"product": product},
        )
        return payload.get("product", payload)

    def orders(
        self,
        *,
        limit: int,
        status: str | None = None,
        created_after: str | None = None,
        created_before: str | None = None,
    ) -> tuple[list[dict[str, Any]], dict[str, Any]]:
        params: dict[str, Any] = {"limit": limit}
        if status:
            params["status"] = status.strip()
        if created_after:
            params["created_at_min"] = created_after.strip()
        if created_before:
            params["created_at_max"] = created_before.strip()
        payload, headers, _ = self._request_json("orders.json", params=params)
        return payload.get("orders", []), _pagination_from_headers(headers)

    def order(self, order_id: str) -> dict[str, Any]:
        payload, _, _ = self._request_json(f"orders/{_normalize_identifier(order_id)}.json")
        return payload.get("order", payload)

    def cancel_order(self, order_id: str, *, reason: str | None = None) -> dict[str, Any]:
        normalized_order_id = _normalize_identifier(order_id)
        payload, _, _ = self._request_json(
            f"orders/{normalized_order_id}/cancel.json",
            method="POST",
            body={
                "email": False,
                "reason": _normalize_cancel_reason(reason),
            },
        )
        return payload.get("order", payload)

    def customers(
        self,
        *,
        limit: int,
        email: str | None = None,
        created_after: str | None = None,
        created_before: str | None = None,
    ) -> tuple[list[dict[str, Any]], dict[str, Any]]:
        if email:
            payload, headers, _ = self._request_json(
                "customers/search.json",
                params={"query": f"email:{email.strip()}", "limit": limit},
            )
            results = payload.get("customers", [])
        else:
            params: dict[str, Any] = {"limit": limit}
            if created_after:
                params["created_at_min"] = created_after.strip()
            if created_before:
                params["created_at_max"] = created_before.strip()
            payload, headers, _ = self._request_json("customers.json", params=params)
            results = payload.get("customers", [])
        if created_after or created_before:
            results = [
                item
                for item in results
                if isinstance(item, dict)
                and _date_in_range(
                    item.get("created_at"),
                    created_after=created_after,
                    created_before=created_before,
                )
            ]
        return results, _pagination_from_headers(headers)

    def customer(self, customer_id: str) -> dict[str, Any]:
        payload, _, _ = self._request_json(f"customers/{_normalize_identifier(customer_id)}.json")
        return payload.get("customer", payload)

    def fulfillment_orders(self, order_id: str) -> list[dict[str, Any]]:
        payload, _, _ = self._request_json(f"orders/{_normalize_identifier(order_id)}/fulfillment_orders.json")
        return payload.get("fulfillment_orders", [])

    def create_fulfillment(self, *, fulfillment_order_id: str | int, tracking_number: str | None = None) -> dict[str, Any]:
        normalized_fulfillment_order_id = int(_normalize_identifier(str(fulfillment_order_id)))
        fulfillment: dict[str, Any] = {
            "notify_customer": False,
            "line_items_by_fulfillment_order": [{"fulfillment_order_id": normalized_fulfillment_order_id}],
        }
        normalized_tracking_number = (tracking_number or "").strip()
        if normalized_tracking_number:
            fulfillment["tracking_info"] = {"number": normalized_tracking_number}
        payload, _, _ = self._request_json(
            "fulfillments.json",
            method="POST",
            body={"fulfillment": fulfillment},
        )
        return payload.get("fulfillment", payload)


def _normalize_identifier(value: str) -> str:
    raw = value.strip()
    match = _GID_PATTERN.match(raw)
    if match:
        raw = match.group("id")
    if not raw.isdigit():
        raise ShopifyApiError(
            code="SHOPIFY_INVALID_ID",
            message=f"Expected a Shopify numeric id or gid, got {value!r}",
            details={"input": value},
        )
    return raw


def _pagination_from_headers(headers: Mapping[str, str]) -> dict[str, Any]:
    link_header = headers.get("link", "")
    next_page_info = None
    if link_header:
        for part in link_header.split(","):
            if 'rel="next"' not in part:
                continue
            match = re.search(r"[?&]page_info=([^&>]+)", part)
            if match:
                next_page_info = match.group(1)
                break
    pagination: dict[str, Any] = {"has_next_page": bool(next_page_info)}
    if next_page_info:
        pagination["next_page_info"] = next_page_info
    call_limit = headers.get("x-shopify-shop-api-call-limit")
    if call_limit:
        pagination["api_call_limit"] = call_limit
    return pagination


def _normalize_product_status(value: str | None) -> str | None:
    normalized = (value or "").strip().lower()
    if not normalized:
        return None
    if normalized not in _PRODUCT_STATUSES:
        raise ShopifyApiError(
            code="SHOPIFY_INVALID_INPUT",
            message=f"Unsupported product status {value!r}",
            details={"allowed_statuses": sorted(_PRODUCT_STATUSES), "input": value},
        )
    return normalized


def _normalize_cancel_reason(value: str | None) -> str:
    normalized = (value or "other").strip().lower()
    if normalized not in _ORDER_CANCEL_REASONS:
        raise ShopifyApiError(
            code="SHOPIFY_INVALID_INPUT",
            message=f"Unsupported order cancel reason {value!r}",
            details={"allowed_reasons": sorted(_ORDER_CANCEL_REASONS), "input": value},
        )
    return normalized


def _parse_iso_datetime(value: str | None) -> datetime | None:
    raw = str(value or "").strip()
    if not raw:
        return None
    if raw.isdigit():
        return datetime.fromtimestamp(int(raw), tz=timezone.utc)
    normalized = raw.replace("Z", "+00:00")
    try:
        parsed = datetime.fromisoformat(normalized)
    except ValueError as exc:
        raise ShopifyApiError(
            code="SHOPIFY_INVALID_SCOPE",
            message=f"Expected an ISO-8601 timestamp or unix epoch, got {value!r}",
            details={"input": value},
        ) from exc
    if parsed.tzinfo is None:
        return parsed.replace(tzinfo=timezone.utc)
    return parsed.astimezone(timezone.utc)


def _date_in_range(
    value: str | int | None,
    *,
    created_after: str | None = None,
    created_before: str | None = None,
) -> bool:
    if value is None:
        return True
    if isinstance(value, int):
        candidate = datetime.fromtimestamp(value, tz=timezone.utc)
    else:
        candidate = _parse_iso_datetime(str(value))
        if candidate is None:
            return True
    if created_after:
        after = _parse_iso_datetime(created_after)
        if after and candidate < after:
            return False
    if created_before:
        before = _parse_iso_datetime(created_before)
        if before and candidate > before:
            return False
    return True


def _error_code_from_status(status_code: int) -> str:
    if status_code in {401, 403}:
        return "SHOPIFY_AUTH_FAILED"
    if status_code == 404:
        return "SHOPIFY_NOT_FOUND"
    if status_code == 429:
        return "SHOPIFY_RATE_LIMITED"
    if status_code >= 500:
        return "SHOPIFY_UPSTREAM_ERROR"
    return "SHOPIFY_API_ERROR"


def _error_message_from_status(status_code: int, parsed: Any, body: str) -> str:
    if isinstance(parsed, dict):
        errors = parsed.get("errors")
        if isinstance(errors, str):
            return errors
        if isinstance(errors, list) and errors:
            return "; ".join(str(item) for item in errors)
        if isinstance(errors, dict) and errors:
            return "; ".join(f"{key}: {value}" for key, value in errors.items())
    return f"Shopify API request failed with HTTP {status_code}: {body[:200]}"
