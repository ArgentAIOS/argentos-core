from __future__ import annotations

import json
from typing import Any

from .client import DiscordApiError, DiscordClient
from .config import config_snapshot, resolve_runtime_values
from .constants import BACKEND_NAME, CONNECTOR_PATH
from .errors import CliError


CHANNEL_TYPE_MAP = {
    "text": 0,
    "voice": 2,
    "category": 4,
    "announcement": 5,
    "public_thread": 11,
    "private_thread": 12,
    "forum": 15,
}


def _load_manifest() -> dict[str, Any]:
    return json.loads(CONNECTOR_PATH.read_text())


def _scope_preview(command_id: str, resource: str, extra: dict[str, Any] | None = None) -> dict[str, Any]:
    payload = {"selection_surface": resource, "command_id": command_id, "backend": BACKEND_NAME}
    if extra:
        payload.update(extra)
    return payload


def _picker(items: list[dict[str, Any]], *, kind: str, label_key: str = "label") -> dict[str, Any]:
    return {"kind": kind, "items": items, "count": len(items), "label_key": label_key}


def _parse_embed_json(embed_json: str | None) -> dict[str, Any] | None:
    if not embed_json:
        return None
    try:
        payload = json.loads(embed_json)
    except json.JSONDecodeError as err:
        raise CliError(
            code="DISCORD_EMBED_JSON_INVALID",
            message="embed_json must be valid JSON",
            exit_code=4,
            details={"error": str(err)},
        ) from err
    if not isinstance(payload, dict):
        raise CliError(
            code="DISCORD_EMBED_JSON_INVALID",
            message="embed_json must decode to an object",
            exit_code=4,
            details={"type": type(payload).__name__},
        )
    return payload


def _require_arg(value: str | None, *, code: str, message: str, detail_key: str, detail_value: str) -> str:
    resolved = (value or "").strip()
    if resolved:
        return resolved
    raise CliError(code=code, message=message, exit_code=4, details={detail_key: detail_value})


def _parse_channel_type(channel_type: str | int | None) -> int:
    if channel_type is None:
        return 0
    if isinstance(channel_type, int):
        return channel_type
    value = str(channel_type).strip().lower()
    if value.isdigit():
        return int(value)
    if value in CHANNEL_TYPE_MAP:
        return CHANNEL_TYPE_MAP[value]
    raise CliError(
        code="DISCORD_CHANNEL_TYPE_INVALID",
        message="channel_type must be a Discord numeric type or a supported alias",
        exit_code=4,
        details={"allowed_values": sorted(CHANNEL_TYPE_MAP.keys()), "received": channel_type},
    )


def capabilities_snapshot() -> dict[str, Any]:
    manifest = _load_manifest()
    read_support = {}
    write_support = {}
    for command in manifest["commands"]:
        if command["required_mode"] == "readonly":
            read_support[command["id"]] = True
        else:
            write_support[command["id"]] = True
    return {
        "tool": manifest["tool"],
        "backend": manifest["backend"],
        "manifest_schema_version": manifest.get("manifest_schema_version", "1.0.0"),
        "connector": manifest["connector"],
        "auth": manifest["auth"],
        "scope": manifest.get("scope", {}),
        "commands": manifest["commands"],
        "read_support": read_support,
        "write_support": write_support,
    }


def create_client(ctx_obj: dict[str, Any], *, require_bot_token: bool = True) -> DiscordClient:
    runtime = resolve_runtime_values(ctx_obj)
    if require_bot_token and not runtime["bot_token_present"]:
        raise CliError(
            code="DISCORD_SETUP_REQUIRED",
            message="Discord connector is missing required credentials",
            exit_code=4,
            details={"missing_keys": [runtime["bot_token_env"]]},
        )
    return DiscordClient(bot_token=runtime["bot_token"], api_base_url=runtime["api_base_url"])


def probe_runtime(ctx_obj: dict[str, Any]) -> dict[str, Any]:
    runtime = resolve_runtime_values(ctx_obj)
    if not runtime["bot_token_present"]:
        return {
            "ok": False,
            "code": "DISCORD_SETUP_REQUIRED",
            "message": "Discord connector is missing required credentials",
            "details": {"missing_keys": [runtime["bot_token_env"]], "live_backend_available": False},
        }
    try:
        client = create_client(ctx_obj)
        bot_user = client.read_bot_user()
    except CliError as err:
        return {"ok": False, "code": err.code, "message": err.message, "details": err.details}
    except DiscordApiError as err:
        code = "DISCORD_AUTH_FAILED" if err.status_code in {401, 403} else "DISCORD_API_ERROR"
        return {
            "ok": False,
            "code": code,
            "message": err.message,
            "details": {**(err.details or {}), "status_code": err.status_code, "live_backend_available": False},
        }
    return {
        "ok": True,
        "code": "OK",
        "message": "Discord live runtime is ready",
        "details": {
            "live_backend_available": True,
            "bot_user": bot_user,
            "guild_id": runtime["guild_id"] or None,
        },
    }


def health_snapshot(ctx_obj: dict[str, Any]) -> dict[str, Any]:
    runtime = resolve_runtime_values(ctx_obj)
    probe = probe_runtime(ctx_obj)
    webhook_ready = runtime["webhook_url_present"]
    if probe["ok"]:
        status = "ready"
    elif webhook_ready and probe["code"] == "DISCORD_SETUP_REQUIRED":
        status = "partial_ready"
    else:
        status = "needs_setup" if probe["code"] == "DISCORD_SETUP_REQUIRED" else "degraded"
    return {
        "status": status,
        "summary": probe["message"],
        "connector": {
            "backend": BACKEND_NAME,
            "live_backend_available": bool(probe.get("ok")),
            "live_read_available": bool(probe.get("ok")),
            "write_bridge_available": bool(probe.get("ok")) or webhook_ready,
            "live_write_smoke_tested": False,
            "scaffold_only": False,
        },
        "auth": {
            "bot_token_env": runtime["bot_token_env"],
            "bot_token_present": runtime["bot_token_present"],
            "bot_token_source": runtime["bot_token_source"],
            "webhook_url_env": runtime["webhook_url_env"],
            "webhook_url_present": runtime["webhook_url_present"],
            "webhook_url_source": runtime["webhook_url_source"],
        },
        "scope": {
            "api_base_url": runtime["api_base_url"],
            "guild_id": runtime["guild_id"] or None,
            "channel_id": runtime["channel_id"] or None,
            "message_id": runtime["message_id"] or None,
            "webhook_url_present": runtime["webhook_url_present"],
        },
        "checks": [
            {
                "name": "required_env",
                "ok": runtime["bot_token_present"],
                "details": {"missing_keys": [] if runtime["bot_token_present"] else [runtime["bot_token_env"]]},
            },
            {
                "name": "webhook_scope",
                "ok": runtime["webhook_url_present"],
                "details": {"env": runtime["webhook_url_env"], "source": runtime["webhook_url_source"]},
            },
            {"name": "live_backend", "ok": bool(probe.get("ok")), "details": probe.get("details", {})},
        ],
        "runtime_ready": bool(probe.get("ok")),
        "live_backend_available": bool(probe.get("ok")),
        "live_read_available": bool(probe.get("ok")),
        "write_bridge_available": bool(probe.get("ok")) or webhook_ready,
        "live_write_smoke_tested": False,
        "scaffold_only": False,
        "probe": probe,
        "next_steps": [
            f"Add {runtime['bot_token_env']} as an operator-controlled service key for bot-scoped Discord reads and writes.",
            f"Add {runtime['webhook_url_env']} as an operator-controlled service key when using webhook.send without bot auth.",
            f"Set {runtime['guild_id_env']} and {runtime['channel_id_env']} as scoped operator linking keys for worker flows; use local env only as a harness fallback.",
        ],
    }


def doctor_snapshot(ctx_obj: dict[str, Any]) -> dict[str, Any]:
    runtime = resolve_runtime_values(ctx_obj)
    probe = probe_runtime(ctx_obj)
    ready = bool(probe.get("ok"))
    webhook_ready = runtime["webhook_url_present"]
    if ready:
        status = "ready"
    elif webhook_ready and probe.get("code") == "DISCORD_SETUP_REQUIRED":
        status = "partial_ready"
    else:
        status = "needs_setup" if probe.get("code") == "DISCORD_SETUP_REQUIRED" else "degraded"
    return {
        "status": status,
        "summary": "Discord connector diagnostics.",
        "runtime": {
            "implementation_mode": "live_read_write" if ready else ("webhook_write_only" if webhook_ready else "configuration_only"),
            "command_readiness": {
                "message.send": ready and runtime["channel_id_present"],
                "message.edit": ready and runtime["channel_id_present"] and runtime["message_id_present"],
                "message.delete": ready and runtime["channel_id_present"] and runtime["message_id_present"],
                "reaction.add": ready and runtime["channel_id_present"] and runtime["message_id_present"],
                "channel.list": ready and runtime["guild_id_present"],
                "channel.create": ready and runtime["guild_id_present"],
                "thread.create": ready and runtime["channel_id_present"],
                "embed.send": ready and runtime["channel_id_present"],
                "role.list": ready and runtime["guild_id_present"],
                "role.assign": ready and runtime["guild_id_present"] and runtime["member_id_present"] and runtime["role_id_present"],
                "member.list": ready and runtime["guild_id_present"],
                "webhook.send": runtime["webhook_url_present"],
            },
        },
        "checks": [
            {"name": "required_env", "ok": runtime["bot_token_present"]},
            {"name": "guild_id", "ok": runtime["guild_id_present"], "details": {"env": runtime["guild_id_env"]}},
            {"name": "channel_id", "ok": runtime["channel_id_present"], "details": {"env": runtime["channel_id_env"]}},
            {"name": "webhook_url", "ok": runtime["webhook_url_present"], "details": {"env": runtime["webhook_url_env"]}},
            {"name": "live_backend", "ok": ready, "details": probe.get("details", {})},
        ],
        "supported_read_commands": ["capabilities", "health", "config.show", "doctor", "channel.list", "role.list", "member.list"],
        "supported_write_commands": [
            "message.send",
            "message.edit",
            "message.delete",
            "reaction.add",
            "channel.create",
            "thread.create",
            "embed.send",
            "role.assign",
            "webhook.send",
        ],
        "next_steps": [
            f"Add {runtime['bot_token_env']} in operator-controlled service keys for bot-backed Discord commands.",
            f"Add {runtime['webhook_url_env']} when the workflow should send via webhook without a bot token.",
            f"Set {runtime['guild_id_env']}, {runtime['channel_id_env']}, {runtime['message_id_env']}, {runtime['role_id_env']}, and {runtime['member_id_env']} as operator linking keys for stable worker scope defaults.",
        ],
    }


def message_send_result(ctx_obj: dict[str, Any], *, channel_id: str | None, content: str | None) -> dict[str, Any]:
    runtime = resolve_runtime_values(ctx_obj)
    resolved_channel_id = _require_arg(
        channel_id or runtime["channel_id"],
        code="DISCORD_CHANNEL_REQUIRED",
        message="channel_id is required",
        detail_key="env",
        detail_value=runtime["channel_id_env"],
    )
    resolved_content = _require_arg(
        content or runtime["content"],
        code="DISCORD_CONTENT_REQUIRED",
        message="content is required",
        detail_key="env",
        detail_value=runtime["content_env"],
    )
    client = create_client(ctx_obj)
    message = client.send_message(channel_id=resolved_channel_id, content=resolved_content)
    return {
        "status": "live_write",
        "backend": BACKEND_NAME,
        "summary": f"Sent message to channel {resolved_channel_id}.",
        "message": message,
        "scope_preview": _scope_preview("message.send", "message", {"channel_id": resolved_channel_id}),
        "live_write_smoke_tested": False,
    }


def message_edit_result(ctx_obj: dict[str, Any], *, channel_id: str | None, message_id: str | None, content: str | None) -> dict[str, Any]:
    runtime = resolve_runtime_values(ctx_obj)
    resolved_channel_id = _require_arg(channel_id or runtime["channel_id"], code="DISCORD_CHANNEL_REQUIRED", message="channel_id is required", detail_key="env", detail_value=runtime["channel_id_env"])
    resolved_message_id = _require_arg(message_id or runtime["message_id"], code="DISCORD_MESSAGE_REQUIRED", message="message_id is required", detail_key="env", detail_value=runtime["message_id_env"])
    resolved_content = _require_arg(content or runtime["content"], code="DISCORD_CONTENT_REQUIRED", message="content is required", detail_key="env", detail_value=runtime["content_env"])
    client = create_client(ctx_obj)
    message = client.edit_message(channel_id=resolved_channel_id, message_id=resolved_message_id, content=resolved_content)
    return {
        "status": "live_write",
        "backend": BACKEND_NAME,
        "summary": f"Edited message {resolved_message_id}.",
        "message": message,
        "scope_preview": _scope_preview("message.edit", "message", {"channel_id": resolved_channel_id, "message_id": resolved_message_id}),
        "live_write_smoke_tested": False,
    }


def message_delete_result(ctx_obj: dict[str, Any], *, channel_id: str | None, message_id: str | None) -> dict[str, Any]:
    runtime = resolve_runtime_values(ctx_obj)
    resolved_channel_id = _require_arg(channel_id or runtime["channel_id"], code="DISCORD_CHANNEL_REQUIRED", message="channel_id is required", detail_key="env", detail_value=runtime["channel_id_env"])
    resolved_message_id = _require_arg(message_id or runtime["message_id"], code="DISCORD_MESSAGE_REQUIRED", message="message_id is required", detail_key="env", detail_value=runtime["message_id_env"])
    client = create_client(ctx_obj)
    result = client.delete_message(channel_id=resolved_channel_id, message_id=resolved_message_id)
    return {
        "status": "live_write",
        "backend": BACKEND_NAME,
        "summary": f"Deleted message {resolved_message_id}.",
        "result": result,
        "scope_preview": _scope_preview("message.delete", "message", {"channel_id": resolved_channel_id, "message_id": resolved_message_id}),
        "live_write_smoke_tested": False,
    }


def reaction_add_result(ctx_obj: dict[str, Any], *, channel_id: str | None, message_id: str | None, emoji: str | None) -> dict[str, Any]:
    runtime = resolve_runtime_values(ctx_obj)
    resolved_channel_id = _require_arg(channel_id or runtime["channel_id"], code="DISCORD_CHANNEL_REQUIRED", message="channel_id is required", detail_key="env", detail_value=runtime["channel_id_env"])
    resolved_message_id = _require_arg(message_id or runtime["message_id"], code="DISCORD_MESSAGE_REQUIRED", message="message_id is required", detail_key="env", detail_value=runtime["message_id_env"])
    resolved_emoji = _require_arg(emoji or runtime["reaction"], code="DISCORD_REACTION_REQUIRED", message="emoji is required", detail_key="env", detail_value=runtime["reaction_env"])
    client = create_client(ctx_obj)
    result = client.add_reaction(channel_id=resolved_channel_id, message_id=resolved_message_id, emoji=resolved_emoji)
    return {
        "status": "live_write",
        "backend": BACKEND_NAME,
        "summary": f"Added reaction to message {resolved_message_id}.",
        "result": result,
        "scope_preview": _scope_preview("reaction.add", "reaction", {"channel_id": resolved_channel_id, "message_id": resolved_message_id}),
        "live_write_smoke_tested": False,
    }


def channel_list_result(ctx_obj: dict[str, Any], *, guild_id: str | None, limit: int) -> dict[str, Any]:
    runtime = resolve_runtime_values(ctx_obj)
    resolved_guild_id = _require_arg(guild_id or runtime["guild_id"], code="DISCORD_GUILD_REQUIRED", message="guild_id is required", detail_key="env", detail_value=runtime["guild_id_env"])
    client = create_client(ctx_obj)
    channels = client.list_channels(guild_id=resolved_guild_id)
    picker_items = [
        {
            "value": item["id"],
            "label": item["name"] or item["id"],
            "subtitle": item.get("topic"),
            "selected": False,
        }
        for item in channels["channels"][:limit]
    ]
    return {
        "status": "live_read",
        "backend": BACKEND_NAME,
        "summary": f"Listed {len(picker_items)} channel(s).",
        "channels": channels,
        "picker": _picker(picker_items, kind="discord_channel"),
        "scope_preview": _scope_preview("channel.list", "channel", {"guild_id": resolved_guild_id, "limit": limit}),
    }


def channel_create_result(ctx_obj: dict[str, Any], *, guild_id: str | None, name: str | None, channel_type: str | int | None, topic: str | None) -> dict[str, Any]:
    runtime = resolve_runtime_values(ctx_obj)
    resolved_guild_id = _require_arg(guild_id or runtime["guild_id"], code="DISCORD_GUILD_REQUIRED", message="guild_id is required", detail_key="env", detail_value=runtime["guild_id_env"])
    resolved_name = _require_arg(name or runtime["channel_name"], code="DISCORD_CHANNEL_NAME_REQUIRED", message="name is required", detail_key="env", detail_value=runtime["channel_name_env"])
    client = create_client(ctx_obj)
    channel = client.create_channel(guild_id=resolved_guild_id, name=resolved_name, channel_type=_parse_channel_type(channel_type), topic=topic)
    return {
        "status": "live_write",
        "backend": BACKEND_NAME,
        "summary": f"Created channel {resolved_name}.",
        "channel": channel,
        "scope_preview": _scope_preview("channel.create", "channel", {"guild_id": resolved_guild_id, "name": resolved_name}),
        "live_write_smoke_tested": False,
    }


def thread_create_result(ctx_obj: dict[str, Any], *, channel_id: str | None, message_id: str | None, name: str | None, content: str | None) -> dict[str, Any]:
    runtime = resolve_runtime_values(ctx_obj)
    resolved_channel_id = _require_arg(channel_id or runtime["channel_id"], code="DISCORD_CHANNEL_REQUIRED", message="channel_id is required", detail_key="env", detail_value=runtime["channel_id_env"])
    resolved_name = _require_arg(name or runtime["thread_name"] or runtime["content"], code="DISCORD_THREAD_NAME_REQUIRED", message="name is required", detail_key="env", detail_value=runtime["thread_name_env"])
    resolved_message_id = message_id or runtime["message_id"] or None
    initial_content = content or runtime["content"] or None
    client = create_client(ctx_obj)
    thread = client.create_thread(channel_id=resolved_channel_id, message_id=resolved_message_id, name=resolved_name)
    result: dict[str, Any] = {
        "status": "live_write",
        "backend": BACKEND_NAME,
        "summary": f"Created thread {resolved_name}.",
        "thread": thread,
        "scope_preview": _scope_preview("thread.create", "thread", {"channel_id": resolved_channel_id, "message_id": resolved_message_id}),
        "live_write_smoke_tested": False,
    }
    if initial_content:
        result["initial_message"] = client.send_message(channel_id=thread["id"], content=initial_content)
    return result


def embed_send_result(ctx_obj: dict[str, Any], *, channel_id: str | None, embed_json: str | None, content: str | None) -> dict[str, Any]:
    runtime = resolve_runtime_values(ctx_obj)
    resolved_channel_id = _require_arg(channel_id or runtime["channel_id"], code="DISCORD_CHANNEL_REQUIRED", message="channel_id is required", detail_key="env", detail_value=runtime["channel_id_env"])
    embed = _parse_embed_json(embed_json or runtime["embed_json"])
    if embed is None:
        raise CliError(code="DISCORD_EMBED_JSON_REQUIRED", message="embed_json is required", exit_code=4, details={"env": runtime["embed_json_env"]})
    client = create_client(ctx_obj)
    message = client.send_embed(channel_id=resolved_channel_id, embed=embed, content=content or runtime["content"] or None)
    return {
        "status": "live_write",
        "backend": BACKEND_NAME,
        "summary": f"Sent embed to channel {resolved_channel_id}.",
        "message": message,
        "scope_preview": _scope_preview("embed.send", "embed", {"channel_id": resolved_channel_id}),
        "live_write_smoke_tested": False,
    }


def role_list_result(ctx_obj: dict[str, Any], *, guild_id: str | None, limit: int) -> dict[str, Any]:
    runtime = resolve_runtime_values(ctx_obj)
    resolved_guild_id = _require_arg(guild_id or runtime["guild_id"], code="DISCORD_GUILD_REQUIRED", message="guild_id is required", detail_key="env", detail_value=runtime["guild_id_env"])
    client = create_client(ctx_obj)
    roles = client.list_roles(guild_id=resolved_guild_id)
    picker_items = [
        {
            "value": item["id"],
            "label": item["name"] or item["id"],
            "subtitle": str(item.get("position")) if item.get("position") is not None else None,
            "selected": False,
        }
        for item in roles["roles"][:limit]
    ]
    return {
        "status": "live_read",
        "backend": BACKEND_NAME,
        "summary": f"Listed {len(picker_items)} role(s).",
        "roles": roles,
        "picker": _picker(picker_items, kind="discord_role"),
        "scope_preview": _scope_preview("role.list", "role", {"guild_id": resolved_guild_id, "limit": limit}),
    }


def role_assign_result(ctx_obj: dict[str, Any], *, guild_id: str | None, member_id: str | None, role_id: str | None) -> dict[str, Any]:
    runtime = resolve_runtime_values(ctx_obj)
    resolved_guild_id = _require_arg(guild_id or runtime["guild_id"], code="DISCORD_GUILD_REQUIRED", message="guild_id is required", detail_key="env", detail_value=runtime["guild_id_env"])
    resolved_member_id = _require_arg(member_id or runtime["member_id"], code="DISCORD_MEMBER_REQUIRED", message="member_id is required", detail_key="env", detail_value=runtime["member_id_env"])
    resolved_role_id = _require_arg(role_id or runtime["role_id"], code="DISCORD_ROLE_REQUIRED", message="role_id is required", detail_key="env", detail_value=runtime["role_id_env"])
    client = create_client(ctx_obj)
    result = client.assign_role(guild_id=resolved_guild_id, member_id=resolved_member_id, role_id=resolved_role_id)
    return {
        "status": "live_write",
        "backend": BACKEND_NAME,
        "summary": f"Assigned role {resolved_role_id} to member {resolved_member_id}.",
        "result": result,
        "scope_preview": _scope_preview("role.assign", "role", {"guild_id": resolved_guild_id, "member_id": resolved_member_id, "role_id": resolved_role_id}),
        "live_write_smoke_tested": False,
    }


def member_list_result(ctx_obj: dict[str, Any], *, guild_id: str | None, limit: int) -> dict[str, Any]:
    runtime = resolve_runtime_values(ctx_obj)
    resolved_guild_id = _require_arg(guild_id or runtime["guild_id"], code="DISCORD_GUILD_REQUIRED", message="guild_id is required", detail_key="env", detail_value=runtime["guild_id_env"])
    client = create_client(ctx_obj)
    members = client.list_members(guild_id=resolved_guild_id, limit=limit)
    picker_items = [
        {
            "value": item["id"],
            "label": item["display_name"] or item.get("username") or item["id"],
            "subtitle": item.get("joined_at"),
            "selected": False,
        }
        for item in members["members"][:limit]
    ]
    return {
        "status": "live_read",
        "backend": BACKEND_NAME,
        "summary": f"Listed {len(picker_items)} member(s).",
        "members": members,
        "picker": _picker(picker_items, kind="discord_member"),
        "scope_preview": _scope_preview("member.list", "member", {"guild_id": resolved_guild_id, "limit": limit}),
    }


def webhook_send_result(ctx_obj: dict[str, Any], *, webhook_url: str | None, content: str | None, embed_json: str | None, username: str | None, avatar_url: str | None) -> dict[str, Any]:
    runtime = resolve_runtime_values(ctx_obj)
    resolved_webhook_url = _require_arg(webhook_url or runtime["webhook_url"], code="DISCORD_WEBHOOK_URL_REQUIRED", message="webhook_url is required", detail_key="env", detail_value=runtime["webhook_url_env"])
    embed = _parse_embed_json(embed_json or runtime["embed_json"])
    resolved_content = content or runtime["content"] or None
    if embed is None and not resolved_content:
        raise CliError(
            code="DISCORD_WEBHOOK_BODY_REQUIRED",
            message="webhook.send requires content or embed_json",
            exit_code=4,
            details={"content_env": runtime["content_env"], "embed_json_env": runtime["embed_json_env"]},
        )
    client = create_client(ctx_obj, require_bot_token=False)
    result = client.send_webhook(
        webhook_url=resolved_webhook_url,
        content=resolved_content,
        embed=embed,
        username=username,
        avatar_url=avatar_url,
    )
    return {
        "status": "live_write",
        "backend": BACKEND_NAME,
        "summary": "Sent Discord webhook message.",
        "result": result,
        "scope_preview": _scope_preview("webhook.send", "webhook", {"webhook_url_present": True}),
        "live_write_smoke_tested": False,
    }


def config_show_result(ctx_obj: dict[str, Any]) -> dict[str, Any]:
    return config_snapshot(ctx_obj, probe=probe_runtime(ctx_obj))
