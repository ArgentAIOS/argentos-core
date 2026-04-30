from __future__ import annotations

from dataclasses import dataclass
import os
from .service_keys import service_key_env

from .constants import (
    DEFAULT_BASE_URL,
    ENV_ACCESS_TOKEN,
    ENV_BASE_URL,
    ENV_PROJECT_GID,
    ENV_TASK_GID,
    ENV_WORKSPACE_GID,
)


@dataclass(frozen=True)
class AsanaConfig:
    access_token: str | None
    base_url: str
    workspace_gid: str | None
    project_gid: str | None
    task_gid: str | None


@dataclass(frozen=True)
class AsanaConnectorContext:
    config: AsanaConfig


def resolve_config() -> AsanaConfig:
    return AsanaConfig(
        access_token=service_key_env(ENV_ACCESS_TOKEN),
        base_url=service_key_env(ENV_BASE_URL, DEFAULT_BASE_URL),
        workspace_gid=service_key_env(ENV_WORKSPACE_GID),
        project_gid=service_key_env(ENV_PROJECT_GID),
        task_gid=service_key_env(ENV_TASK_GID),
    )


def redact_config(config: AsanaConfig) -> dict[str, object]:
    return {
        "access_token": "<redacted>" if config.access_token else None,
        "base_url": config.base_url,
        "workspace_gid": config.workspace_gid,
        "project_gid": config.project_gid,
        "task_gid": config.task_gid,
    }
