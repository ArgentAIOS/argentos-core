from __future__ import annotations

from dataclasses import dataclass
import os
from .service_keys import service_key_env

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
    base_url: str
    dartboard_id: str | None
    task_id: str | None
    doc_id: str | None


@dataclass(frozen=True)
class DartConnectorContext:
    config: DartConfig


def resolve_config() -> DartConfig:
    return DartConfig(
        api_key=service_key_env(ENV_API_KEY),
        base_url=service_key_env(ENV_BASE_URL, DEFAULT_BASE_URL),
        dartboard_id=service_key_env(ENV_DARTBOARD_ID),
        task_id=service_key_env(ENV_TASK_ID),
        doc_id=service_key_env(ENV_DOC_ID),
    )


def redact_config(config: DartConfig) -> dict[str, object]:
    return {
        "api_key": "<redacted>" if config.api_key else None,
        "base_url": config.base_url,
        "dartboard_id": config.dartboard_id,
        "task_id": config.task_id,
        "doc_id": config.doc_id,
    }
