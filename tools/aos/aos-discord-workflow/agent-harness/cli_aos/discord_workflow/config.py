from __future__ import annotations

import os
from .service_keys import service_key_env
from typing import Any

from .constants import (
    BACKEND_NAME,
    DEFAULT_API_BASE_URL,
    DISCORD_API_BASE_URL_ENV,
    DISCORD_BOT_TOKEN_ENV,
    DISCORD_CHANNEL_ID_ENV,
    DISCORD_CHANNEL_NAME_ENV,
    DISCORD_CONTENT_ENV,
    DISCORD_EMBED_JSON_ENV,
    DISCORD_GUILD_ID_ENV,
    DISCORD_MEMBER_ID_ENV,
    DISCORD_MESSAGE_ID_ENV,
    DISCORD_REACTION_ENV,
    DISCORD_ROLE_ID_ENV,
    DISCORD_THREAD_NAME_ENV,
    DISCORD_WEBHOOK_URL_ENV,
)


def _mask(value: str | None) -> str | None:
    if not value:
        return None
    if len(value) <= 8:
        return "*" * len(value)
    return f"{value[:4]}***{value[-4:]}"


def _resolve_env(ctx_obj: dict[str, Any], key: str, default: str) -> str:
    return ctx_obj.get(key) or default


def resolve_runtime_values(ctx_obj: dict[str, Any]) -> dict[str, Any]:
    bot_token_env = _resolve_env(ctx_obj, "bot_token_env", DISCORD_BOT_TOKEN_ENV)
    api_base_url_env = _resolve_env(ctx_obj, "api_base_url_env", DISCORD_API_BASE_URL_ENV)
    guild_id_env = _resolve_env(ctx_obj, "guild_id_env", DISCORD_GUILD_ID_ENV)
    channel_id_env = _resolve_env(ctx_obj, "channel_id_env", DISCORD_CHANNEL_ID_ENV)
    message_id_env = _resolve_env(ctx_obj, "message_id_env", DISCORD_MESSAGE_ID_ENV)
    webhook_url_env = _resolve_env(ctx_obj, "webhook_url_env", DISCORD_WEBHOOK_URL_ENV)
    content_env = _resolve_env(ctx_obj, "content_env", DISCORD_CONTENT_ENV)
    embed_json_env = _resolve_env(ctx_obj, "embed_json_env", DISCORD_EMBED_JSON_ENV)
    role_id_env = _resolve_env(ctx_obj, "role_id_env", DISCORD_ROLE_ID_ENV)
    member_id_env = _resolve_env(ctx_obj, "member_id_env", DISCORD_MEMBER_ID_ENV)
    thread_name_env = _resolve_env(ctx_obj, "thread_name_env", DISCORD_THREAD_NAME_ENV)
    channel_name_env = _resolve_env(ctx_obj, "channel_name_env", DISCORD_CHANNEL_NAME_ENV)
    reaction_env = _resolve_env(ctx_obj, "reaction_env", DISCORD_REACTION_ENV)

    bot_token = (service_key_env(bot_token_env) or "").strip()
    api_base_url = (service_key_env(api_base_url_env) or DEFAULT_API_BASE_URL).strip().rstrip("/")
    guild_id = (service_key_env(guild_id_env) or "").strip()
    channel_id = (service_key_env(channel_id_env) or "").strip()
    message_id = (service_key_env(message_id_env) or "").strip()
    webhook_url = (service_key_env(webhook_url_env) or "").strip()
    content = (service_key_env(content_env) or "").strip()
    embed_json = (service_key_env(embed_json_env) or "").strip()
    role_id = (service_key_env(role_id_env) or "").strip()
    member_id = (service_key_env(member_id_env) or "").strip()
    thread_name = (service_key_env(thread_name_env) or "").strip()
    channel_name = (service_key_env(channel_name_env) or "").strip()
    reaction = (service_key_env(reaction_env) or "").strip()

    return {
        "backend": BACKEND_NAME,
        "bot_token_env": bot_token_env,
        "api_base_url_env": api_base_url_env,
        "guild_id_env": guild_id_env,
        "channel_id_env": channel_id_env,
        "message_id_env": message_id_env,
        "webhook_url_env": webhook_url_env,
        "content_env": content_env,
        "embed_json_env": embed_json_env,
        "role_id_env": role_id_env,
        "member_id_env": member_id_env,
        "thread_name_env": thread_name_env,
        "channel_name_env": channel_name_env,
        "reaction_env": reaction_env,
        "bot_token": bot_token,
        "api_base_url": api_base_url,
        "guild_id": guild_id,
        "channel_id": channel_id,
        "message_id": message_id,
        "webhook_url": webhook_url,
        "content": content,
        "embed_json": embed_json,
        "role_id": role_id,
        "member_id": member_id,
        "thread_name": thread_name,
        "channel_name": channel_name,
        "reaction": reaction,
        "bot_token_present": bool(bot_token),
        "guild_id_present": bool(guild_id),
        "channel_id_present": bool(channel_id),
        "message_id_present": bool(message_id),
        "webhook_url_present": bool(webhook_url),
        "runtime_ready": bool(bot_token),
    }


def config_snapshot(ctx_obj: dict[str, Any], *, probe: dict[str, Any] | None = None) -> dict[str, Any]:
    runtime = resolve_runtime_values(ctx_obj)
    return {
        "backend": BACKEND_NAME,
        "auth": {
            "bot_token_env": runtime["bot_token_env"],
            "bot_token_present": runtime["bot_token_present"],
            "bot_token_masked": _mask(runtime["bot_token"]),
        },
        "scope": {
            "api_base_url": runtime["api_base_url"],
            "guild_id": runtime["guild_id"] or None,
            "channel_id": runtime["channel_id"] or None,
            "message_id": runtime["message_id"] or None,
            "webhook_url_present": runtime["webhook_url_present"],
            "content": runtime["content"] or None,
            "embed_json_present": bool(runtime["embed_json"]),
            "role_id": runtime["role_id"] or None,
            "member_id": runtime["member_id"] or None,
            "thread_name": runtime["thread_name"] or None,
            "channel_name": runtime["channel_name"] or None,
            "reaction": runtime["reaction"] or None,
        },
        "runtime": {
            "implementation_mode": "live_read_write",
            "runtime_ready": bool(probe["ok"]) if probe else runtime["runtime_ready"],
        },
        "probe": probe,
    }
