from __future__ import annotations

import os
from typing import Any

from .constants import (
    BACKEND_NAME,
    DEFAULT_BASE_URL,
    ENV_API_KEYS,
    ENV_BASE_URL,
    ENV_CHANNEL_ID,
    ENV_ORGANIZATION_ID,
    ENV_POST_ID,
    ENV_POST_TEXT,
    ENV_PROFILE_ID,
)
from .service_keys import service_key_value


def _normalize(value: str | None) -> str:
    return (value or "").strip()


def _resolve_named_value(names: tuple[str, ...] | list[str], *, ctx_obj: dict[str, Any] | None = None) -> dict[str, str]:
    for name in names:
        value, source = service_key_value(name, ctx_obj=ctx_obj)
        if _normalize(value) and source in {"operator_ctx", "service_key"}:
            return {"value": _normalize(value), "source": source, "env": name}
    for name in names:
        value, source = service_key_value(name, ctx_obj=ctx_obj)
        if _normalize(value):
            return {"value": _normalize(value), "source": source, "env": name}
    first = names[0] if names else ""
    return {"value": "", "source": "missing", "env": first}


def _resolve_env_only(name: str, default: str = "") -> dict[str, str]:
    value = _normalize(os.getenv(name))
    if value:
        return {"value": value, "source": "env_fallback", "env": name}
    if default:
        return {"value": default, "source": "default", "env": name}
    return {"value": "", "source": "missing", "env": name}


def resolve_runtime_values(ctx_obj: dict[str, Any] | None = None) -> dict[str, Any]:
    ctx_obj = ctx_obj or {}
    access_token = _resolve_named_value(ENV_API_KEYS, ctx_obj=ctx_obj)
    organization_id = _resolve_named_value((ENV_ORGANIZATION_ID,), ctx_obj=ctx_obj)
    channel_id = _resolve_named_value((ENV_CHANNEL_ID,), ctx_obj=ctx_obj)
    profile_id = _resolve_named_value((ENV_PROFILE_ID,), ctx_obj=ctx_obj)
    post_id = _resolve_named_value((ENV_POST_ID,), ctx_obj=ctx_obj)
    post_text = _resolve_env_only(ENV_POST_TEXT)
    base_url = _resolve_env_only(ENV_BASE_URL, default=DEFAULT_BASE_URL)

    resolved_channel_id = channel_id if channel_id["value"] else profile_id

    return {
        "backend": BACKEND_NAME,
        "base_url": base_url["value"],
        "base_url_env": base_url["env"],
        "base_url_source": base_url["source"],
        "access_token": access_token["value"],
        "access_token_env": access_token["env"],
        "access_token_source": access_token["source"],
        "organization_id": organization_id["value"],
        "organization_id_env": organization_id["env"],
        "organization_id_source": organization_id["source"],
        "channel_id": channel_id["value"],
        "channel_id_env": channel_id["env"],
        "channel_id_source": channel_id["source"],
        "profile_id": profile_id["value"],
        "profile_id_env": profile_id["env"],
        "profile_id_source": profile_id["source"],
        "post_id": post_id["value"],
        "post_id_env": post_id["env"],
        "post_id_source": post_id["source"],
        "post_text": post_text["value"],
        "post_text_env": post_text["env"],
        "post_text_source": post_text["source"],
        "resolved_channel_id": resolved_channel_id["value"],
        "resolved_channel_id_source": resolved_channel_id["source"],
        "access_token_present": bool(access_token["value"]),
        "organization_id_present": bool(organization_id["value"]),
        "channel_id_present": bool(channel_id["value"]),
        "profile_id_present": bool(profile_id["value"]),
        "post_id_present": bool(post_id["value"]),
        "post_text_present": bool(post_text["value"]),
        "service_key_precedence": "operator-service-keys-first-with-env-fallback",
    }


def redacted_config_snapshot(ctx_obj: dict[str, Any] | None = None) -> dict[str, Any]:
    runtime = resolve_runtime_values(ctx_obj)
    return {
        "backend": runtime["backend"],
        "base_url": runtime["base_url"],
        "access_token": "<redacted>" if runtime["access_token"] else "",
        "organization_id": runtime["organization_id"],
        "channel_id": runtime["channel_id"],
        "profile_id": runtime["profile_id"],
        "post_id": runtime["post_id"],
        "post_text": "<redacted>" if runtime["post_text"] else "",
    }


def config_snapshot(ctx_obj: dict[str, Any] | None = None) -> dict[str, Any]:
    runtime = resolve_runtime_values(ctx_obj)
    command_defaults = {
        "account.read": {"selection_surface": "account"},
        "channel.list": {"selection_surface": "channel", "args": [runtime["organization_id_env"]], "limit": 10},
        "channel.read": {"selection_surface": "channel", "args": [runtime["channel_id_env"]]},
        "profile.list": {"selection_surface": "profile", "args": [runtime["organization_id_env"]], "limit": 10},
        "profile.read": {"selection_surface": "profile", "args": [runtime["profile_id_env"]]},
        "post.list": {
            "selection_surface": "post",
            "args": [runtime["organization_id_env"], runtime["channel_id_env"]],
            "limit": 10,
        },
        "post.read": {"selection_surface": "post", "args": [runtime["post_id_env"], runtime["organization_id_env"]]},
        "post.create_draft": {"selection_surface": "post", "args": [runtime["channel_id_env"], runtime["post_text_env"]]},
        "post.schedule": {"selection_surface": "post", "args": [runtime["channel_id_env"], runtime["post_text_env"]]},
    }
    picker_scopes = {
        "account": {
            "selected": {"account_id": "authenticated account"},
            "pickers": {"account": {"command": "account.read", "selection_surface": "account"}},
        },
        "channel": {
            "selected": {
                "organization_id": runtime["organization_id"],
                "channel_id": runtime["channel_id"],
            },
            "pickers": {"channel": {"command": "channel.list", "selection_surface": "channel"}},
        },
        "profile": {
            "selected": {
                "organization_id": runtime["organization_id"],
                "profile_id": runtime["profile_id"],
            },
            "pickers": {"profile": {"command": "profile.list", "selection_surface": "profile"}},
        },
        "post": {
            "selected": {
                "organization_id": runtime["organization_id"],
                "channel_id": runtime["resolved_channel_id"],
                "post_id": runtime["post_id"],
            },
            "pickers": {"post": {"command": "post.list", "selection_surface": "post"}},
        },
    }
    return {
        "tool": "aos-buffer",
        "backend": BACKEND_NAME,
        "auth": {
            "api_key_envs": list(ENV_API_KEYS),
            "access_token_source": runtime["access_token_source"],
            "service_key_precedence": runtime["service_key_precedence"],
            "development_fallback": list(ENV_API_KEYS),
        },
        "runtime": {
            "implementation_mode": "live_graphql_read_with_scaffolded_writes",
            "graphql_endpoint": runtime["base_url"],
            "service_key_precedence": runtime["service_key_precedence"],
            "command_defaults": command_defaults,
            "picker_scopes": picker_scopes,
            "live_read_commands": [
                "account.read",
                "channel.list",
                "channel.read",
                "profile.list",
                "profile.read",
                "post.list",
                "post.read",
            ],
            "scaffolded_write_commands": ["post.create_draft", "post.schedule"],
        },
        "scope": redacted_config_snapshot(ctx_obj),
    }
