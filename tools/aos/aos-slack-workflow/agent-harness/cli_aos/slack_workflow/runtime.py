from __future__ import annotations

import json
from pathlib import Path
from typing import Any

from .client import SlackApiError, SlackClient
from .config import config_snapshot, resolve_runtime_values
from .constants import BACKEND_NAME, CONNECTOR_PATH
from .errors import CliError


def _load_manifest() -> dict[str, Any]:
    return json.loads(CONNECTOR_PATH.read_text())


def _picker(items: list[dict[str, Any]], *, kind: str, label_key: str = "label") -> dict[str, Any]:
    return {"kind": kind, "items": items, "count": len(items), "label_key": label_key}


def _scope_preview(command_id: str, surface: str, extra: dict[str, Any] | None = None) -> dict[str, Any]:
    preview = {"selection_surface": surface, "command_id": command_id, "backend": BACKEND_NAME}
    if extra:
        preview.update(extra)
    return preview


def _require_arg(value: str | None, *, code: str, message: str, detail_key: str, detail_value: str) -> str:
    resolved = (value or "").strip()
    if resolved:
        return resolved
    raise CliError(code=code, message=message, exit_code=4, details={detail_key: detail_value})


def _parse_json_or_error(value: str | None, *, code: str, message: str) -> Any:
    if not value:
        return None
    try:
        return json.loads(value)
    except json.JSONDecodeError as err:
        raise CliError(code=code, message=message, exit_code=4, details={"error": str(err)}) from err


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


def create_client(ctx_obj: dict[str, Any]) -> SlackClient:
    runtime = resolve_runtime_values(ctx_obj)
    if not runtime["bot_token_present"]:
        raise CliError(
            code="SLACK_SETUP_REQUIRED",
            message="Slack connector is missing the required bot token",
            exit_code=4,
            details={"missing_keys": [runtime["bot_token_env"]]},
        )
    return SlackClient(bot_token=runtime["bot_token"], base_url=runtime["base_url"])


def probe_runtime(ctx_obj: dict[str, Any]) -> dict[str, Any]:
    runtime = resolve_runtime_values(ctx_obj)
    if not runtime["bot_token_present"]:
        return {
            "ok": False,
            "code": "SLACK_SETUP_REQUIRED",
            "message": "Slack connector is missing the required bot token",
            "details": {"missing_keys": [runtime["bot_token_env"]], "live_backend_available": False},
        }
    try:
        client = create_client(ctx_obj)
        auth = client.auth_test()
    except CliError as err:
        return {"ok": False, "code": err.code, "message": err.message, "details": err.details}
    except SlackApiError as err:
        code = "SLACK_AUTH_FAILED" if err.status_code in {401, 403} else "SLACK_API_ERROR"
        return {
            "ok": False,
            "code": code,
            "message": err.message,
            "details": {**(err.details or {}), "status_code": err.status_code, "live_backend_available": False},
        }
    return {
        "ok": True,
        "code": "OK",
        "message": "Slack live runtime is ready",
        "details": {"live_backend_available": True, "team_id": auth.get("team_id"), "user_id": auth.get("user_id")},
    }


def health_snapshot(ctx_obj: dict[str, Any]) -> dict[str, Any]:
    runtime = resolve_runtime_values(ctx_obj)
    probe = probe_runtime(ctx_obj)
    status = "ready" if probe["ok"] else ("needs_setup" if probe["code"] == "SLACK_SETUP_REQUIRED" else "degraded")
    return {
        "status": status,
        "summary": probe["message"],
        "connector": {
            "backend": BACKEND_NAME,
            "live_backend_available": bool(probe.get("ok")),
            "live_read_available": bool(probe.get("ok")),
            "write_bridge_available": bool(probe.get("ok")),
            "live_write_smoke_tested": False,
            "scaffold_only": False,
        },
        "auth": {
            "bot_token_env": runtime["bot_token_env"],
            "bot_token_present": runtime["bot_token_present"],
            "bot_token_usable": runtime["bot_token_usable"],
            "bot_token_source": runtime["bot_token_source"],
            "app_token_env": runtime["app_token_env"],
            "app_token_present": runtime["app_token_present"],
            "app_token_usable": runtime["app_token_usable"],
            "app_token_source": runtime["app_token_source"],
            "base_url_env": runtime["base_url_env"],
            "base_url_source": runtime["base_url_source"],
        },
        "scope": {
            "base_url": runtime["base_url"],
            "channel_id": runtime["channel_id"] or None,
            "thread_ts": runtime["thread_ts"] or None,
            "user_id": runtime["user_id"] or None,
            "channel_name": runtime["channel_name"] or None,
        },
        "checks": [
            {
                "name": "required_env",
                "ok": runtime["bot_token_present"],
                "details": {"missing_keys": [] if runtime["bot_token_present"] else [runtime["bot_token_env"]]},
            },
            {"name": "live_backend", "ok": bool(probe.get("ok")), "details": probe.get("details", {})},
        ],
        "runtime_ready": bool(probe.get("ok")),
        "live_backend_available": bool(probe.get("ok")),
        "live_read_available": bool(probe.get("ok")),
        "write_bridge_available": bool(probe.get("ok")),
        "live_write_smoke_tested": False,
        "scaffold_only": False,
        "probe": probe,
        "next_steps": [
            f"Bind {runtime['bot_token_env']} as an operator-controlled service key.",
            f"Optionally bind {runtime['channel_id_env']} and {runtime['thread_ts_env']} as service-key scope defaults for worker flows.",
            "Add the bot to any private channels before posting, archiving, or uploading there.",
        ],
    }


def doctor_snapshot(ctx_obj: dict[str, Any]) -> dict[str, Any]:
    runtime = resolve_runtime_values(ctx_obj)
    probe = probe_runtime(ctx_obj)
    ready = bool(probe.get("ok"))
    return {
        "status": "ready" if ready else ("needs_setup" if probe.get("code") == "SLACK_SETUP_REQUIRED" else "degraded"),
        "summary": "Slack connector diagnostics.",
        "runtime": {
            "implementation_mode": "live_read_write",
            "live_write_smoke_tested": False,
            "command_readiness": {
                "message.post": ready and runtime["channel_id_present"] and runtime["text_present"],
                "message.update": ready and runtime["channel_id_present"] and runtime["thread_ts_present"] and runtime["text_present"],
                "message.delete": ready and runtime["channel_id_present"] and runtime["thread_ts_present"],
                "reaction.add": ready and runtime["channel_id_present"] and runtime["thread_ts_present"] and runtime["emoji_present"],
                "channel.list": ready,
                "channel.create": ready and runtime["channel_name_present"],
                "channel.archive": ready and runtime["channel_id_present"],
                "thread.reply": ready and runtime["channel_id_present"] and runtime["thread_ts_present"] and runtime["text_present"],
                "canvas.create": ready and runtime["canvas_title_present"],
                "canvas.update": ready and runtime["canvas_id_present"],
                "user.list": ready,
                "reminder.create": ready and runtime["reminder_text_present"] and runtime["reminder_time_present"],
                "file.upload": ready and runtime["file_path_present"],
            },
        },
        "checks": [
            {"name": "required_env", "ok": runtime["bot_token_present"]},
            {"name": "live_backend", "ok": ready, "details": probe.get("details", {})},
        ],
        "supported_read_commands": ["capabilities", "health", "config.show", "doctor", "channel.list", "user.list"],
        "supported_write_commands": [
            "message.post",
            "message.update",
            "message.delete",
            "reaction.add",
            "channel.create",
            "channel.archive",
            "thread.reply",
            "canvas.create",
            "canvas.update",
            "reminder.create",
            "file.upload",
        ],
        "next_steps": [
            f"Bind {runtime['bot_token_env']} through operator service keys to enable live Slack calls.",
            "Provide channel and thread defaults as service keys where message mutations are expected.",
            "Invite the bot to private channels before trying to create, archive, or upload there.",
        ],
    }


def config_show_result(ctx_obj: dict[str, Any]) -> dict[str, Any]:
    return config_snapshot(ctx_obj, probe=probe_runtime(ctx_obj))


def channel_list_result(ctx_obj: dict[str, Any], *, limit: int, cursor: str | None = None) -> dict[str, Any]:
    client = create_client(ctx_obj)
    response = client.list_channels(limit=limit, cursor=cursor)
    picker_items = [
        {
            "value": item["id"],
            "label": item["name"] or item["id"],
            "subtitle": item.get("topic"),
            "selected": False,
        }
        for item in response["channels"]
    ]
    return {
        "status": "live_read",
        "backend": BACKEND_NAME,
        "summary": f"Listed {len(response['channels'])} channel(s).",
        "channels": response,
        "picker": _picker(picker_items, kind="channel"),
        "scope_preview": _scope_preview("channel.list", "channel", {"limit": limit}),
        "live_write_smoke_tested": False,
    }


def user_list_result(ctx_obj: dict[str, Any], *, limit: int, cursor: str | None = None) -> dict[str, Any]:
    client = create_client(ctx_obj)
    response = client.list_users(limit=limit, cursor=cursor)
    picker_items = [
        {
            "value": item["id"],
            "label": item["real_name"] or item["name"] or item["id"],
            "subtitle": item.get("email"),
            "selected": False,
        }
        for item in response["users"]
    ]
    return {
        "status": "live_read",
        "backend": BACKEND_NAME,
        "summary": f"Listed {len(response['users'])} user(s).",
        "users": response,
        "picker": _picker(picker_items, kind="user"),
        "scope_preview": _scope_preview("user.list", "user", {"limit": limit}),
        "live_write_smoke_tested": False,
    }


def message_post_result(ctx_obj: dict[str, Any], *, channel_id: str | None, text: str | None, thread_ts: str | None = None) -> dict[str, Any]:
    runtime = resolve_runtime_values(ctx_obj)
    resolved_channel = _require_arg(channel_id or runtime["channel_id"], code="SLACK_CHANNEL_REQUIRED", message="channel_id is required", detail_key="env", detail_value=runtime["channel_id_env"])
    resolved_text = _require_arg(text or runtime["text"], code="SLACK_TEXT_REQUIRED", message="text is required", detail_key="env", detail_value=runtime["text_env"])
    client = create_client(ctx_obj)
    message = client.post_message(channel_id=resolved_channel, text=resolved_text, thread_ts=thread_ts or runtime["thread_ts"] or None)
    return {
        "status": "live_write",
        "backend": BACKEND_NAME,
        "summary": f"Posted message to {resolved_channel}.",
        "message": message,
        "scope_preview": _scope_preview("message.post", "channel", {"channel_id": resolved_channel}),
        "live_write_smoke_tested": False,
    }


def message_update_result(ctx_obj: dict[str, Any], *, channel_id: str | None, thread_ts: str | None, text: str | None) -> dict[str, Any]:
    runtime = resolve_runtime_values(ctx_obj)
    resolved_channel = _require_arg(channel_id or runtime["channel_id"], code="SLACK_CHANNEL_REQUIRED", message="channel_id is required", detail_key="env", detail_value=runtime["channel_id_env"])
    resolved_ts = _require_arg(thread_ts or runtime["thread_ts"], code="SLACK_THREAD_TS_REQUIRED", message="thread_ts is required", detail_key="env", detail_value=runtime["thread_ts_env"])
    resolved_text = _require_arg(text or runtime["text"], code="SLACK_TEXT_REQUIRED", message="text is required", detail_key="env", detail_value=runtime["text_env"])
    client = create_client(ctx_obj)
    message = client.update_message(channel_id=resolved_channel, ts=resolved_ts, text=resolved_text)
    return {
        "status": "live_write",
        "backend": BACKEND_NAME,
        "summary": f"Updated message in {resolved_channel}.",
        "message": message,
        "scope_preview": _scope_preview("message.update", "channel", {"channel_id": resolved_channel, "thread_ts": resolved_ts}),
        "live_write_smoke_tested": False,
    }


def message_delete_result(ctx_obj: dict[str, Any], *, channel_id: str | None, thread_ts: str | None) -> dict[str, Any]:
    runtime = resolve_runtime_values(ctx_obj)
    resolved_channel = _require_arg(channel_id or runtime["channel_id"], code="SLACK_CHANNEL_REQUIRED", message="channel_id is required", detail_key="env", detail_value=runtime["channel_id_env"])
    resolved_ts = _require_arg(thread_ts or runtime["thread_ts"], code="SLACK_THREAD_TS_REQUIRED", message="thread_ts is required", detail_key="env", detail_value=runtime["thread_ts_env"])
    client = create_client(ctx_obj)
    result = client.delete_message(channel_id=resolved_channel, ts=resolved_ts)
    return {
        "status": "live_write",
        "backend": BACKEND_NAME,
        "summary": f"Deleted message in {resolved_channel}.",
        "message": result,
        "scope_preview": _scope_preview("message.delete", "channel", {"channel_id": resolved_channel, "thread_ts": resolved_ts}),
        "live_write_smoke_tested": False,
    }


def reaction_add_result(ctx_obj: dict[str, Any], *, channel_id: str | None, thread_ts: str | None, emoji: str | None) -> dict[str, Any]:
    runtime = resolve_runtime_values(ctx_obj)
    resolved_channel = _require_arg(channel_id or runtime["channel_id"], code="SLACK_CHANNEL_REQUIRED", message="channel_id is required", detail_key="env", detail_value=runtime["channel_id_env"])
    resolved_ts = _require_arg(thread_ts or runtime["thread_ts"], code="SLACK_THREAD_TS_REQUIRED", message="thread_ts is required", detail_key="env", detail_value=runtime["thread_ts_env"])
    resolved_emoji = _require_arg(emoji or runtime["emoji"], code="SLACK_EMOJI_REQUIRED", message="emoji is required", detail_key="env", detail_value=runtime["emoji_env"])
    client = create_client(ctx_obj)
    result = client.add_reaction(channel_id=resolved_channel, timestamp=resolved_ts, emoji=resolved_emoji)
    return {
        "status": "live_write",
        "backend": BACKEND_NAME,
        "summary": f"Added :{resolved_emoji}: reaction in {resolved_channel}.",
        "reaction": result,
        "scope_preview": _scope_preview("reaction.add", "message", {"channel_id": resolved_channel, "thread_ts": resolved_ts}),
        "live_write_smoke_tested": False,
    }


def channel_create_result(ctx_obj: dict[str, Any], *, name: str | None, is_private: bool) -> dict[str, Any]:
    runtime = resolve_runtime_values(ctx_obj)
    resolved_name = _require_arg(name or runtime["channel_name"], code="SLACK_CHANNEL_NAME_REQUIRED", message="channel name is required", detail_key="env", detail_value=runtime["channel_name_env"])
    client = create_client(ctx_obj)
    result = client.create_channel(name=resolved_name, is_private=is_private)
    return {
        "status": "live_write",
        "backend": BACKEND_NAME,
        "summary": f"Created channel {resolved_name}.",
        "channel": result,
        "scope_preview": _scope_preview("channel.create", "channel", {"channel_name": resolved_name}),
        "live_write_smoke_tested": False,
    }


def channel_archive_result(ctx_obj: dict[str, Any], *, channel_id: str | None) -> dict[str, Any]:
    runtime = resolve_runtime_values(ctx_obj)
    resolved_channel = _require_arg(channel_id or runtime["channel_id"], code="SLACK_CHANNEL_REQUIRED", message="channel_id is required", detail_key="env", detail_value=runtime["channel_id_env"])
    client = create_client(ctx_obj)
    result = client.archive_channel(channel_id=resolved_channel)
    return {
        "status": "live_write",
        "backend": BACKEND_NAME,
        "summary": f"Archived channel {resolved_channel}.",
        "channel": result,
        "scope_preview": _scope_preview("channel.archive", "channel", {"channel_id": resolved_channel}),
        "live_write_smoke_tested": False,
    }


def thread_reply_result(ctx_obj: dict[str, Any], *, channel_id: str | None, thread_ts: str | None, text: str | None) -> dict[str, Any]:
    runtime = resolve_runtime_values(ctx_obj)
    resolved_channel = _require_arg(channel_id or runtime["channel_id"], code="SLACK_CHANNEL_REQUIRED", message="channel_id is required", detail_key="env", detail_value=runtime["channel_id_env"])
    resolved_ts = _require_arg(thread_ts or runtime["thread_ts"], code="SLACK_THREAD_TS_REQUIRED", message="thread_ts is required", detail_key="env", detail_value=runtime["thread_ts_env"])
    resolved_text = _require_arg(text or runtime["text"], code="SLACK_TEXT_REQUIRED", message="text is required", detail_key="env", detail_value=runtime["text_env"])
    client = create_client(ctx_obj)
    message = client.post_message(channel_id=resolved_channel, text=resolved_text, thread_ts=resolved_ts)
    return {
        "status": "live_write",
        "backend": BACKEND_NAME,
        "summary": f"Replied in thread {resolved_ts}.",
        "message": message,
        "scope_preview": _scope_preview("thread.reply", "thread", {"channel_id": resolved_channel, "thread_ts": resolved_ts}),
        "live_write_smoke_tested": False,
    }


def canvas_create_result(ctx_obj: dict[str, Any], *, title: str | None, content: str | None, channel_id: str | None, owner_id: str | None) -> dict[str, Any]:
    runtime = resolve_runtime_values(ctx_obj)
    resolved_title = _require_arg(title or runtime["canvas_title"], code="SLACK_CANVAS_TITLE_REQUIRED", message="title is required", detail_key="env", detail_value=runtime["canvas_title_env"])
    resolved_content = content or runtime["canvas_content"] or None
    resolved_channel = channel_id or runtime["channel_id"] or None
    client = create_client(ctx_obj)
    result = client.create_canvas(title=resolved_title, content=resolved_content, channel_id=resolved_channel, owner_id=owner_id or runtime["user_id"] or None)
    return {
        "status": "live_write",
        "backend": BACKEND_NAME,
        "summary": f"Created canvas {resolved_title}.",
        "canvas": result,
        "scope_preview": _scope_preview("canvas.create", "canvas", {"title": resolved_title, "channel_id": resolved_channel}),
        "live_write_smoke_tested": False,
    }


def canvas_update_result(ctx_obj: dict[str, Any], *, canvas_id: str | None, content: str | None, changes_json: str | None) -> dict[str, Any]:
    runtime = resolve_runtime_values(ctx_obj)
    resolved_canvas_id = _require_arg(canvas_id or runtime["canvas_id"], code="SLACK_CANVAS_ID_REQUIRED", message="canvas_id is required", detail_key="env", detail_value=runtime["canvas_id_env"])
    client = create_client(ctx_obj)
    result = client.update_canvas(canvas_id=resolved_canvas_id, content=content or runtime["canvas_content"] or None, changes_json=changes_json or runtime["canvas_changes"] or None)
    return {
        "status": "live_write",
        "backend": BACKEND_NAME,
        "summary": f"Updated canvas {resolved_canvas_id}.",
        "canvas": result,
        "scope_preview": _scope_preview("canvas.update", "canvas", {"canvas_id": resolved_canvas_id}),
        "live_write_smoke_tested": False,
    }


def reminder_create_result(ctx_obj: dict[str, Any], *, text: str | None, time_value: str | None, user_id: str | None) -> dict[str, Any]:
    runtime = resolve_runtime_values(ctx_obj)
    resolved_text = _require_arg(text or runtime["reminder_text"], code="SLACK_REMINDER_TEXT_REQUIRED", message="text is required", detail_key="env", detail_value=runtime["reminder_text_env"])
    resolved_time = _require_arg(time_value or runtime["reminder_time"], code="SLACK_REMINDER_TIME_REQUIRED", message="time is required", detail_key="env", detail_value=runtime["reminder_time_env"])
    client = create_client(ctx_obj)
    result = client.create_reminder(text=resolved_text, time_value=resolved_time, user_id=user_id or runtime["reminder_user"] or None)
    return {
        "status": "live_write",
        "backend": BACKEND_NAME,
        "summary": f"Created reminder for {resolved_time}.",
        "reminder": result,
        "scope_preview": _scope_preview("reminder.create", "reminder", {"time": resolved_time}),
        "live_write_smoke_tested": False,
    }


def file_upload_result(
    ctx_obj: dict[str, Any],
    *,
    file_path: str | None,
    filename: str | None,
    channel_id: str | None,
    thread_ts: str | None,
    title: str | None,
    initial_comment: str | None,
) -> dict[str, Any]:
    runtime = resolve_runtime_values(ctx_obj)
    resolved_file_path = _require_arg(file_path or runtime["file_path"], code="SLACK_FILE_PATH_REQUIRED", message="file_path is required", detail_key="env", detail_value=runtime["file_path_env"])
    if not Path(resolved_file_path).expanduser().exists():
        raise CliError(code="SLACK_FILE_NOT_FOUND", message="file_path does not exist", exit_code=4, details={"file_path": resolved_file_path})
    client = create_client(ctx_obj)
    result = client.upload_file(
        file_path=resolved_file_path,
        filename=filename or runtime["file_title"] or None,
        channel_id=channel_id or runtime["channel_id"] or None,
        thread_ts=thread_ts or runtime["thread_ts"] or None,
        title=title or runtime["file_title"] or None,
        initial_comment=initial_comment or runtime["text"] or None,
    )
    return {
        "status": "live_write",
        "backend": BACKEND_NAME,
        "summary": f"Uploaded file {resolved_file_path}.",
        "file": result,
        "scope_preview": _scope_preview("file.upload", "file", {"file_path": resolved_file_path, "channel_id": channel_id or runtime["channel_id"] or None}),
        "live_write_smoke_tested": False,
    }
