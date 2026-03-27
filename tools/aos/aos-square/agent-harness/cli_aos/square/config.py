from __future__ import annotations

from dataclasses import dataclass
import os

from .constants import (
    DEFAULT_BASE_URL,
    ENV_ACCESS_TOKEN,
    ENV_AMOUNT,
    ENV_CURRENCY,
    ENV_CUSTOMER_ID,
    ENV_EMAIL,
    ENV_ENVIRONMENT,
    ENV_INVOICE_ID,
    ENV_ITEM_ID,
    ENV_ITEM_NAME,
    ENV_LOCATION_ID,
    ENV_ORDER_ID,
    ENV_PAYMENT_ID,
    SANDBOX_BASE_URL,
)


@dataclass(frozen=True)
class SquareConfig:
    access_token: str | None
    base_url: str
    environment: str
    location_id: str | None
    customer_id: str | None
    order_id: str | None
    payment_id: str | None
    item_id: str | None
    invoice_id: str | None
    amount: str | None
    currency: str | None
    email: str | None
    item_name: str | None


@dataclass(frozen=True)
class SquareScopePreview:
    selection_surface: str
    command_id: str
    location_id: str | None = None
    customer_id: str | None = None
    order_id: str | None = None
    payment_id: str | None = None
    item_id: str | None = None
    invoice_id: str | None = None


@dataclass(frozen=True)
class SquareConnectorContext:
    config: SquareConfig
    scope_preview: SquareScopePreview | None = None


def resolve_config() -> SquareConfig:
    environment = os.getenv(ENV_ENVIRONMENT, "production")
    base_url = SANDBOX_BASE_URL if environment == "sandbox" else DEFAULT_BASE_URL
    return SquareConfig(
        access_token=os.getenv(ENV_ACCESS_TOKEN),
        base_url=base_url,
        environment=environment,
        location_id=os.getenv(ENV_LOCATION_ID),
        customer_id=os.getenv(ENV_CUSTOMER_ID),
        order_id=os.getenv(ENV_ORDER_ID),
        payment_id=os.getenv(ENV_PAYMENT_ID),
        item_id=os.getenv(ENV_ITEM_ID),
        invoice_id=os.getenv(ENV_INVOICE_ID),
        amount=os.getenv(ENV_AMOUNT),
        currency=os.getenv(ENV_CURRENCY, "USD"),
        email=os.getenv(ENV_EMAIL),
        item_name=os.getenv(ENV_ITEM_NAME),
    )


def redact_config(config: SquareConfig) -> dict[str, object]:
    return {
        "access_token": "<redacted>" if config.access_token else None,
        "base_url": config.base_url,
        "environment": config.environment,
        "location_id": config.location_id,
        "customer_id": config.customer_id,
        "order_id": config.order_id,
        "payment_id": config.payment_id,
        "item_id": config.item_id,
        "invoice_id": config.invoice_id,
        "currency": config.currency,
        "email": config.email,
        "item_name": config.item_name,
    }
