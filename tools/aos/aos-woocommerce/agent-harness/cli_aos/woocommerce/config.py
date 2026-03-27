from __future__ import annotations

from dataclasses import dataclass
import os

from .constants import (
    API_VERSION,
    ENV_CONSUMER_KEY,
    ENV_CONSUMER_SECRET,
    ENV_CUSTOMER_ID,
    ENV_ORDER_ID,
    ENV_ORDER_STATUS,
    ENV_PRODUCT_ID,
    ENV_PRODUCT_STATUS,
    ENV_SKU,
    ENV_STORE_URL,
)


@dataclass(frozen=True)
class WooCommerceConfig:
    consumer_key: str | None
    consumer_secret: str | None
    store_url: str | None
    base_url: str | None
    order_id: str | None
    product_id: str | None
    customer_id: str | None
    order_status: str | None
    product_status: str | None
    sku: str | None


@dataclass(frozen=True)
class WooCommerceScopePreview:
    selection_surface: str
    command_id: str
    order_id: str | None = None
    product_id: str | None = None
    customer_id: str | None = None


@dataclass(frozen=True)
class WooCommerceConnectorContext:
    config: WooCommerceConfig
    scope_preview: WooCommerceScopePreview | None = None


def resolve_config() -> WooCommerceConfig:
    store_url = os.getenv(ENV_STORE_URL)
    base_url = f"{store_url.rstrip('/')}/wp-json/{API_VERSION}" if store_url else None
    return WooCommerceConfig(
        consumer_key=os.getenv(ENV_CONSUMER_KEY),
        consumer_secret=os.getenv(ENV_CONSUMER_SECRET),
        store_url=store_url,
        base_url=base_url,
        order_id=os.getenv(ENV_ORDER_ID),
        product_id=os.getenv(ENV_PRODUCT_ID),
        customer_id=os.getenv(ENV_CUSTOMER_ID),
        order_status=os.getenv(ENV_ORDER_STATUS),
        product_status=os.getenv(ENV_PRODUCT_STATUS),
        sku=os.getenv(ENV_SKU),
    )


def redact_config(config: WooCommerceConfig) -> dict[str, object]:
    return {
        "consumer_key": "<redacted>" if config.consumer_key else None,
        "consumer_secret": "<redacted>" if config.consumer_secret else None,
        "store_url": config.store_url,
        "base_url": config.base_url,
        "order_id": config.order_id,
        "product_id": config.product_id,
        "customer_id": config.customer_id,
        "order_status": config.order_status,
        "product_status": config.product_status,
        "sku": config.sku,
    }
