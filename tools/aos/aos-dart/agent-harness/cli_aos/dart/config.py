from __future__ import annotations

from dataclasses import dataclass
import os

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
        api_key=os.getenv(ENV_API_KEY),
        base_url=os.getenv(ENV_BASE_URL, DEFAULT_BASE_URL),
        dartboard_id=os.getenv(ENV_DARTBOARD_ID),
        task_id=os.getenv(ENV_TASK_ID),
        doc_id=os.getenv(ENV_DOC_ID),
    )


def redact_config(config: DartConfig) -> dict[str, object]:
    return {
        "api_key": "<redacted>" if config.api_key else None,
        "base_url": config.base_url,
        "dartboard_id": config.dartboard_id,
        "task_id": config.task_id,
        "doc_id": config.doc_id,
    }
