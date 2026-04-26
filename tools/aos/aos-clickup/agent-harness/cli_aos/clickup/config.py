from __future__ import annotations

from dataclasses import dataclass
import os
from .service_keys import service_key_env
from typing import Iterable

from .constants import (
    DEFAULT_BASE_URL,
    ENV_ACCESS_TOKEN,
    ENV_API_TOKEN,
    ENV_BASE_URL,
    ENV_LIST_ID,
    ENV_SPACE_ID,
    ENV_TASK_ID,
    ENV_WORKSPACE_ID,
)


@dataclass(frozen=True)
class ClickUpConfig:
    api_token: str | None
    base_url: str
    workspace_id: str | None
    space_id: str | None
    list_id: str | None
    task_id: str | None


@dataclass(frozen=True)
class ClickUpConnectorContext:
    config: ClickUpConfig


def first_configured_value(names: Iterable[str]) -> str | None:
    for name in names:
        value = service_key_env(name)
        if value:
            return value
    return None


def resolve_config() -> ClickUpConfig:
    return ClickUpConfig(
        api_token=first_configured_value([ENV_API_TOKEN, ENV_ACCESS_TOKEN]),
        base_url=service_key_env(ENV_BASE_URL, DEFAULT_BASE_URL),
        workspace_id=service_key_env(ENV_WORKSPACE_ID),
        space_id=service_key_env(ENV_SPACE_ID),
        list_id=service_key_env(ENV_LIST_ID),
        task_id=service_key_env(ENV_TASK_ID),
    )


def redact_config(config: ClickUpConfig) -> dict[str, object]:
    return {
        "api_token": "<redacted>" if config.api_token else None,
        "base_url": config.base_url,
        "workspace_id": config.workspace_id,
        "space_id": config.space_id,
        "list_id": config.list_id,
        "task_id": config.task_id,
    }
