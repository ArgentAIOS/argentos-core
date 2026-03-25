from __future__ import annotations

from dataclasses import dataclass
import os
from typing import Iterable

from .constants import (
    DEFAULT_BASE_URL,
    DEFAULT_GRAPHQL_URL,
    ENV_ACCOUNT_ID,
    ENV_API_KEYS,
    ENV_BASE_URL,
    ENV_CHANNEL_ID,
    ENV_GRAPHQL_URL,
    ENV_POST_ID,
    ENV_POST_TEXT,
    ENV_PROFILE_ID,
)


@dataclass(frozen=True)
class BufferConfig:
    api_key: str | None
    base_url: str
    graphql_url: str
    account_id: str | None
    channel_id: str | None
    profile_id: str | None
    post_id: str | None
    post_text: str | None


@dataclass(frozen=True)
class BufferScopePreview:
    selection_surface: str
    command_id: str
    channel_id: str | None = None
    profile_id: str | None = None
    post_id: str | None = None
    post_text: str | None = None


@dataclass(frozen=True)
class BufferConnectorContext:
    config: BufferConfig
    scope_preview: BufferScopePreview | None = None


def first_configured_value(names: Iterable[str]) -> str | None:
    for name in names:
        value = os.getenv(name)
        if value:
            return value
    return None


def resolve_config() -> BufferConfig:
    return BufferConfig(
        api_key=first_configured_value(ENV_API_KEYS),
        base_url=os.getenv(ENV_BASE_URL, DEFAULT_BASE_URL),
        graphql_url=os.getenv(ENV_GRAPHQL_URL, DEFAULT_GRAPHQL_URL),
        account_id=os.getenv(ENV_ACCOUNT_ID),
        channel_id=os.getenv(ENV_CHANNEL_ID),
        profile_id=os.getenv(ENV_PROFILE_ID),
        post_id=os.getenv(ENV_POST_ID),
        post_text=os.getenv(ENV_POST_TEXT),
    )


def redact_config(config: BufferConfig) -> dict[str, object]:
    return {
        "api_key": "<redacted>" if config.api_key else None,
        "base_url": config.base_url,
        "graphql_url": config.graphql_url,
        "account_id": config.account_id,
        "channel_id": config.channel_id,
        "profile_id": config.profile_id,
        "post_id": config.post_id,
        "post_text": "<redacted>" if config.post_text else None,
    }
