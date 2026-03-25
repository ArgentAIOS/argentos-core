from __future__ import annotations

from dataclasses import dataclass
import os
from typing import Iterable

from .constants import (
    DEFAULT_BASE_URL,
    ENV_ACCESS_TOKEN,
    ENV_API_TOKEN,
    ENV_BASE_URL,
    ENV_FOLDER_ID,
    ENV_LIST_ID,
    ENV_SPACE_ID,
    ENV_TASK_ID,
    ENV_TEAM_ID,
    ENV_WORKSPACE_ID,
)


@dataclass(frozen=True)
class ClickUpConfig:
    api_token: str | None
    base_url: str
    workspace_id: str | None
    team_id: str | None
    space_id: str | None
    folder_id: str | None
    list_id: str | None
    task_id: str | None


@dataclass(frozen=True)
class ClickUpConnectorContext:
    config: ClickUpConfig


def first_configured_value(names: Iterable[str]) -> str | None:
    for name in names:
        value = os.getenv(name)
        if value:
            return value
    return None


def resolve_config() -> ClickUpConfig:
    return ClickUpConfig(
        api_token=first_configured_value([ENV_API_TOKEN, ENV_ACCESS_TOKEN]),
        base_url=os.getenv(ENV_BASE_URL, DEFAULT_BASE_URL),
        workspace_id=os.getenv(ENV_WORKSPACE_ID),
        team_id=os.getenv(ENV_TEAM_ID),
        space_id=os.getenv(ENV_SPACE_ID),
        folder_id=os.getenv(ENV_FOLDER_ID),
        list_id=os.getenv(ENV_LIST_ID),
        task_id=os.getenv(ENV_TASK_ID),
    )


def resolve_workspace_id(config: ClickUpConfig) -> str | None:
    return config.workspace_id or config.team_id


def redact_config(config: ClickUpConfig) -> dict[str, object]:
    return {
        "api_token": "<redacted>" if config.api_token else None,
        "base_url": config.base_url,
        "workspace_id": config.workspace_id,
        "team_id": config.team_id,
        "space_id": config.space_id,
        "folder_id": config.folder_id,
        "list_id": config.list_id,
        "task_id": config.task_id,
        "resolved_workspace_id": resolve_workspace_id(config),
    }
