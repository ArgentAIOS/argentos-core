from __future__ import annotations

from dataclasses import dataclass
from .service_keys import service_key_details

from .constants import (
    DEFAULT_BASE_URL,
    ENV_API_KEY,
    ENV_BASE_URL,
    ENV_DARTBOARD_ID,
    ENV_DOC_ID,
    ENV_TASK_ID,
)


@dataclass(frozen=True)
class DartConfig:
    api_key: str | None
    api_key_source: str | None
    api_key_present: bool
    api_key_usable: bool
    base_url: str
    base_url_source: str
    dartboard_id: str | None
    dartboard_id_source: str | None
    task_id: str | None
    task_id_source: str | None
    doc_id: str | None
    doc_id_source: str | None


@dataclass(frozen=True)
class DartConnectorContext:
    config: DartConfig


def resolve_config(ctx_obj: dict | None = None) -> DartConfig:
    api_key = service_key_details(ENV_API_KEY, ctx_obj)
    base_url = service_key_details(ENV_BASE_URL, ctx_obj, default=DEFAULT_BASE_URL)
    dartboard_id = service_key_details(ENV_DARTBOARD_ID, ctx_obj)
    task_id = service_key_details(ENV_TASK_ID, ctx_obj)
    doc_id = service_key_details(ENV_DOC_ID, ctx_obj)
    return DartConfig(
        api_key=api_key["value"] or None,
        api_key_source=api_key["source"] if api_key["present"] else None,
        api_key_present=api_key["present"],
        api_key_usable=api_key["usable"],
        base_url=base_url["value"] or DEFAULT_BASE_URL,
        base_url_source=base_url["source"],
        dartboard_id=dartboard_id["value"] or None,
        dartboard_id_source=dartboard_id["source"] if dartboard_id["present"] else None,
        task_id=task_id["value"] or None,
        task_id_source=task_id["source"] if task_id["present"] else None,
        doc_id=doc_id["value"] or None,
        doc_id_source=doc_id["source"] if doc_id["present"] else None,
    )


def redact_config(config: DartConfig) -> dict[str, object]:
    return {
        "api_key": "<redacted>" if config.api_key else None,
        "base_url": config.base_url,
        "base_url_source": config.base_url_source,
        "dartboard_id": config.dartboard_id,
        "dartboard_id_source": config.dartboard_id_source,
        "task_id": config.task_id,
        "task_id_source": config.task_id_source,
        "doc_id": config.doc_id,
        "doc_id_source": config.doc_id_source,
    }
