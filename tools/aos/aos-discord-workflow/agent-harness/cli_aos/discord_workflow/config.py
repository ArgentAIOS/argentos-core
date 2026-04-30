from __future__ import annotations

from typing import Any

from . import service_keys
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


def _string_value(value: Any) -> str:
    return value.strip() if isinstance(value, str) else ""


def _mapping_value(mapping: Any, *keys: str) -> str:
    if not isinstance(mapping, dict):
        return ""
    for key in keys:
        value = _string_value(mapping.get(key))
        if value:
            return value
    return ""


def _operator_service_key_value(ctx_obj: dict[str, Any], service_key_name: str) -> tuple[str, str]:
    service_key_key = service_key_name.lower()
    for field_name in ("service_keys", "service_key_values", "api_keys", "secrets"):
        container = ctx_obj.get(field_name)
        value = _mapping_value(container, service_key_name, service_key_key)
        if value:
            return value, f"operator:{field_name}"

        tool_scoped = None
        if isinstance(container, dict):
            tool_scoped = (
                container.get("aos-discord-workflow")
                or container.get("discord_workflow")
                or container.get("discord")
            )
        value = _mapping_value(tool_scoped, service_key_name, service_key_key)
        if value:
            return value, f"operator:{field_name}:tool"

    value = _mapping_value(ctx_obj, service_key_name, service_key_key)
    if value:
        return value, "operator:context"

    return "", "missing"


def _resolve_value(
    ctx_obj: dict[str, Any],
    *,
    service_key_name: str | None,
    env_name: str,
    default: str = "",
) -> dict[str, Any]:
    if service_key_name:
        operator_value, operator_source = _operator_service_key_value(ctx_obj, service_key_name)
        if operator_value:
            return {
                "value": operator_value,
                "present": True,
                "source": operator_source,
                "service_key_name": service_key_name,
                "env_name": env_name,
            }

        service_key_detail = service_keys.service_key_details(service_key_name)
        if service_key_detail["present"]:
            return {
                "value": service_key_detail["value"],
                "present": bool(service_key_detail["value"]),
                "source": service_key_detail["source"],
                "service_key_name": service_key_name,
                "env_name": env_name,
                "usable": service_key_detail["usable"],
                "blocked": service_key_detail.get("blocked", False),
            }

    env_detail = service_keys.service_key_details(env_name)
    if env_detail["present"]:
        return {
            "value": env_detail["value"],
            "present": bool(env_detail["value"]),
            "source": env_detail["source"],
            "service_key_name": service_key_name,
            "env_name": env_name,
            "usable": env_detail["usable"],
            "blocked": env_detail.get("blocked", False),
        }

    return {
        "value": default,
        "present": bool(default),
        "source": "default" if default else "missing",
        "service_key_name": service_key_name,
        "env_name": env_name,
    }


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

    bot_token = _resolve_value(ctx_obj, service_key_name=DISCORD_BOT_TOKEN_ENV, env_name=bot_token_env)
    api_base_url = _resolve_value(ctx_obj, service_key_name=DISCORD_API_BASE_URL_ENV, env_name=api_base_url_env, default=DEFAULT_API_BASE_URL)
    guild_id = _resolve_value(ctx_obj, service_key_name=DISCORD_GUILD_ID_ENV, env_name=guild_id_env)
    channel_id = _resolve_value(ctx_obj, service_key_name=DISCORD_CHANNEL_ID_ENV, env_name=channel_id_env)
    message_id = _resolve_value(ctx_obj, service_key_name=DISCORD_MESSAGE_ID_ENV, env_name=message_id_env)
    webhook_url = _resolve_value(ctx_obj, service_key_name=DISCORD_WEBHOOK_URL_ENV, env_name=webhook_url_env)
    content = _resolve_value(ctx_obj, service_key_name=DISCORD_CONTENT_ENV, env_name=content_env)
    embed_json = _resolve_value(ctx_obj, service_key_name=DISCORD_EMBED_JSON_ENV, env_name=embed_json_env)
    role_id = _resolve_value(ctx_obj, service_key_name=DISCORD_ROLE_ID_ENV, env_name=role_id_env)
    member_id = _resolve_value(ctx_obj, service_key_name=DISCORD_MEMBER_ID_ENV, env_name=member_id_env)
    thread_name = _resolve_value(ctx_obj, service_key_name=DISCORD_THREAD_NAME_ENV, env_name=thread_name_env)
    channel_name = _resolve_value(ctx_obj, service_key_name=DISCORD_CHANNEL_NAME_ENV, env_name=channel_name_env)
    reaction = _resolve_value(ctx_obj, service_key_name=DISCORD_REACTION_ENV, env_name=reaction_env)

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
        "bot_token": bot_token["value"],
        "bot_token_source": bot_token["source"],
        "api_base_url": api_base_url["value"].rstrip("/"),
        "api_base_url_source": api_base_url["source"],
        "guild_id": guild_id["value"],
        "guild_id_source": guild_id["source"],
        "channel_id": channel_id["value"],
        "channel_id_source": channel_id["source"],
        "message_id": message_id["value"],
        "message_id_source": message_id["source"],
        "webhook_url": webhook_url["value"],
        "webhook_url_source": webhook_url["source"],
        "content": content["value"],
        "content_source": content["source"],
        "embed_json": embed_json["value"],
        "embed_json_source": embed_json["source"],
        "role_id": role_id["value"],
        "role_id_source": role_id["source"],
        "member_id": member_id["value"],
        "member_id_source": member_id["source"],
        "thread_name": thread_name["value"],
        "thread_name_source": thread_name["source"],
        "channel_name": channel_name["value"],
        "channel_name_source": channel_name["source"],
        "reaction": reaction["value"],
        "reaction_source": reaction["source"],
        "bot_token_present": bot_token["present"],
        "guild_id_present": guild_id["present"],
        "channel_id_present": channel_id["present"],
        "message_id_present": message_id["present"],
        "webhook_url_present": webhook_url["present"],
        "role_id_present": role_id["present"],
        "member_id_present": member_id["present"],
        "runtime_ready": bot_token["present"],
    }


def config_snapshot(ctx_obj: dict[str, Any], *, probe: dict[str, Any] | None = None) -> dict[str, Any]:
    runtime = resolve_runtime_values(ctx_obj)
    implementation_mode = "live_read_write" if runtime["bot_token_present"] else ("webhook_write_only" if runtime["webhook_url_present"] else "configuration_only")
    return {
        "backend": BACKEND_NAME,
        "auth": {
            "kind": "service-key",
            "bot_token_env": runtime["bot_token_env"],
            "bot_token_present": runtime["bot_token_present"],
            "bot_token_source": runtime["bot_token_source"],
            "bot_token_masked": _mask(runtime["bot_token"]),
            "webhook_url_env": runtime["webhook_url_env"],
            "webhook_url_present": runtime["webhook_url_present"],
            "webhook_url_source": runtime["webhook_url_source"],
            "webhook_url_masked": _mask(runtime["webhook_url"]),
            "sources": {
                DISCORD_BOT_TOKEN_ENV: runtime["bot_token_source"],
                DISCORD_WEBHOOK_URL_ENV: runtime["webhook_url_source"],
            },
            "resolution_order": ["operator-context", "service-keys", "process.env", "default"],
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
            "sources": {
                DISCORD_GUILD_ID_ENV: runtime["guild_id_source"],
                DISCORD_CHANNEL_ID_ENV: runtime["channel_id_source"],
                DISCORD_MESSAGE_ID_ENV: runtime["message_id_source"],
                DISCORD_CONTENT_ENV: runtime["content_source"],
                DISCORD_EMBED_JSON_ENV: runtime["embed_json_source"],
                DISCORD_ROLE_ID_ENV: runtime["role_id_source"],
                DISCORD_MEMBER_ID_ENV: runtime["member_id_source"],
                DISCORD_THREAD_NAME_ENV: runtime["thread_name_source"],
                DISCORD_CHANNEL_NAME_ENV: runtime["channel_name_source"],
                DISCORD_REACTION_ENV: runtime["reaction_source"],
            },
        },
        "runtime": {
            "implementation_mode": implementation_mode,
            "runtime_ready": bool(probe["ok"]) if probe else runtime["runtime_ready"],
            "bot_runtime_ready": bool(probe["ok"]) if probe else runtime["bot_token_present"],
            "webhook_write_ready": runtime["webhook_url_present"],
            "live_write_smoke_tested": False,
        },
        "probe": probe,
    }
