from __future__ import annotations

from typing import Any

from . import service_keys
from .constants import (
    BACKEND_NAME,
    DEFAULT_BASE_URL,
    SLACK_APP_TOKEN_ENV,
    SLACK_BASE_URL_ENV,
    SLACK_BOT_TOKEN_ENV,
    SLACK_CANVAS_CHANGES_ENV,
    SLACK_CANVAS_CONTENT_ENV,
    SLACK_CANVAS_ID_ENV,
    SLACK_CANVAS_TITLE_ENV,
    SLACK_CHANNEL_ID_ENV,
    SLACK_CHANNEL_NAME_ENV,
    SLACK_EMOJI_ENV,
    SLACK_FILE_PATH_ENV,
    SLACK_FILE_TITLE_ENV,
    SLACK_REMINDER_TEXT_ENV,
    SLACK_REMINDER_TIME_ENV,
    SLACK_REMINDER_USER_ENV,
    SLACK_TEXT_ENV,
    SLACK_THREAD_TS_ENV,
    SLACK_USER_ID_ENV,
)


def _mask(value: str | None) -> str | None:
    if not value:
        return None
    if len(value) <= 8:
        return "*" * len(value)
    return f"{value[:4]}***{value[-4:]}"


def resolve_runtime_values(ctx_obj: dict[str, Any]) -> dict[str, Any]:
    bot_token_env = ctx_obj.get("bot_token_env") or SLACK_BOT_TOKEN_ENV
    app_token_env = ctx_obj.get("app_token_env") or SLACK_APP_TOKEN_ENV
    base_url_env = ctx_obj.get("base_url_env") or SLACK_BASE_URL_ENV
    channel_id_env = ctx_obj.get("channel_id_env") or SLACK_CHANNEL_ID_ENV
    thread_ts_env = ctx_obj.get("thread_ts_env") or SLACK_THREAD_TS_ENV
    text_env = ctx_obj.get("text_env") or SLACK_TEXT_ENV
    emoji_env = ctx_obj.get("emoji_env") or SLACK_EMOJI_ENV
    user_id_env = ctx_obj.get("user_id_env") or SLACK_USER_ID_ENV
    channel_name_env = ctx_obj.get("channel_name_env") or SLACK_CHANNEL_NAME_ENV
    canvas_id_env = ctx_obj.get("canvas_id_env") or SLACK_CANVAS_ID_ENV
    canvas_title_env = ctx_obj.get("canvas_title_env") or SLACK_CANVAS_TITLE_ENV
    canvas_content_env = ctx_obj.get("canvas_content_env") or SLACK_CANVAS_CONTENT_ENV
    canvas_changes_env = ctx_obj.get("canvas_changes_env") or SLACK_CANVAS_CHANGES_ENV
    file_path_env = ctx_obj.get("file_path_env") or SLACK_FILE_PATH_ENV
    file_title_env = ctx_obj.get("file_title_env") or SLACK_FILE_TITLE_ENV
    reminder_text_env = ctx_obj.get("reminder_text_env") or SLACK_REMINDER_TEXT_ENV
    reminder_time_env = ctx_obj.get("reminder_time_env") or SLACK_REMINDER_TIME_ENV
    reminder_user_env = ctx_obj.get("reminder_user_env") or SLACK_REMINDER_USER_ENV

    bot_token_detail = service_keys.service_key_details(bot_token_env, ctx_obj)
    app_token_detail = service_keys.service_key_details(app_token_env, ctx_obj)
    base_url_detail = service_keys.service_key_details(base_url_env, ctx_obj, default=DEFAULT_BASE_URL)
    channel_id_detail = service_keys.service_key_details(channel_id_env, ctx_obj)
    thread_ts_detail = service_keys.service_key_details(thread_ts_env, ctx_obj)
    text_detail = service_keys.service_key_details(text_env, ctx_obj)
    emoji_detail = service_keys.service_key_details(emoji_env, ctx_obj)
    user_id_detail = service_keys.service_key_details(user_id_env, ctx_obj)
    channel_name_detail = service_keys.service_key_details(channel_name_env, ctx_obj)
    canvas_id_detail = service_keys.service_key_details(canvas_id_env, ctx_obj)
    canvas_title_detail = service_keys.service_key_details(canvas_title_env, ctx_obj)
    canvas_content_detail = service_keys.service_key_details(canvas_content_env, ctx_obj)
    canvas_changes_detail = service_keys.service_key_details(canvas_changes_env, ctx_obj)
    file_path_detail = service_keys.service_key_details(file_path_env, ctx_obj)
    file_title_detail = service_keys.service_key_details(file_title_env, ctx_obj)
    reminder_text_detail = service_keys.service_key_details(reminder_text_env, ctx_obj)
    reminder_time_detail = service_keys.service_key_details(reminder_time_env, ctx_obj)
    reminder_user_detail = service_keys.service_key_details(reminder_user_env, ctx_obj)

    bot_token = (bot_token_detail["value"] or "").strip()
    app_token = (app_token_detail["value"] or "").strip()
    base_url = (base_url_detail["value"] or DEFAULT_BASE_URL).strip().rstrip("/")
    channel_id = (channel_id_detail["value"] or "").strip()
    thread_ts = (thread_ts_detail["value"] or "").strip()
    text = (text_detail["value"] or "").strip()
    emoji = (emoji_detail["value"] or "").strip()
    user_id = (user_id_detail["value"] or "").strip()
    channel_name = (channel_name_detail["value"] or "").strip()
    canvas_id = (canvas_id_detail["value"] or "").strip()
    canvas_title = (canvas_title_detail["value"] or "").strip()
    canvas_content = (canvas_content_detail["value"] or "").strip()
    canvas_changes = (canvas_changes_detail["value"] or "").strip()
    file_path = (file_path_detail["value"] or "").strip()
    file_title = (file_title_detail["value"] or "").strip()
    reminder_text = (reminder_text_detail["value"] or "").strip()
    reminder_time = (reminder_time_detail["value"] or "").strip()
    reminder_user = (reminder_user_detail["value"] or "").strip()

    return {
        "backend": BACKEND_NAME,
        "bot_token_env": bot_token_env,
        "app_token_env": app_token_env,
        "base_url_env": base_url_env,
        "channel_id_env": channel_id_env,
        "thread_ts_env": thread_ts_env,
        "text_env": text_env,
        "emoji_env": emoji_env,
        "user_id_env": user_id_env,
        "channel_name_env": channel_name_env,
        "canvas_id_env": canvas_id_env,
        "canvas_title_env": canvas_title_env,
        "canvas_content_env": canvas_content_env,
        "canvas_changes_env": canvas_changes_env,
        "file_path_env": file_path_env,
        "file_title_env": file_title_env,
        "reminder_text_env": reminder_text_env,
        "reminder_time_env": reminder_time_env,
        "reminder_user_env": reminder_user_env,
        "bot_token": bot_token,
        "bot_token_usable": bot_token_detail["usable"],
        "bot_token_source": bot_token_detail["source"],
        "app_token": app_token,
        "app_token_usable": app_token_detail["usable"],
        "app_token_source": app_token_detail["source"],
        "base_url": base_url,
        "base_url_usable": base_url_detail["usable"],
        "base_url_source": base_url_detail["source"],
        "channel_id": channel_id,
        "channel_id_source": channel_id_detail["source"] if channel_id_detail["present"] else None,
        "thread_ts": thread_ts,
        "thread_ts_source": thread_ts_detail["source"] if thread_ts_detail["present"] else None,
        "text": text,
        "text_source": text_detail["source"] if text_detail["present"] else None,
        "emoji": emoji,
        "emoji_source": emoji_detail["source"] if emoji_detail["present"] else None,
        "user_id": user_id,
        "user_id_source": user_id_detail["source"] if user_id_detail["present"] else None,
        "channel_name": channel_name,
        "channel_name_source": channel_name_detail["source"] if channel_name_detail["present"] else None,
        "canvas_id": canvas_id,
        "canvas_id_source": canvas_id_detail["source"] if canvas_id_detail["present"] else None,
        "canvas_title": canvas_title,
        "canvas_title_source": canvas_title_detail["source"] if canvas_title_detail["present"] else None,
        "canvas_content": canvas_content,
        "canvas_content_source": canvas_content_detail["source"] if canvas_content_detail["present"] else None,
        "canvas_changes": canvas_changes,
        "canvas_changes_source": canvas_changes_detail["source"] if canvas_changes_detail["present"] else None,
        "file_path": file_path,
        "file_path_source": file_path_detail["source"] if file_path_detail["present"] else None,
        "file_title": file_title,
        "file_title_source": file_title_detail["source"] if file_title_detail["present"] else None,
        "reminder_text": reminder_text,
        "reminder_text_source": reminder_text_detail["source"] if reminder_text_detail["present"] else None,
        "reminder_time": reminder_time,
        "reminder_time_source": reminder_time_detail["source"] if reminder_time_detail["present"] else None,
        "reminder_user": reminder_user,
        "reminder_user_source": reminder_user_detail["source"] if reminder_user_detail["present"] else None,
        "bot_token_present": bool(bot_token),
        "app_token_present": bool(app_token),
        "channel_id_present": bool(channel_id),
        "thread_ts_present": bool(thread_ts),
        "text_present": bool(text),
        "emoji_present": bool(emoji),
        "user_id_present": bool(user_id),
        "channel_name_present": bool(channel_name),
        "canvas_id_present": bool(canvas_id),
        "canvas_title_present": bool(canvas_title),
        "canvas_content_present": bool(canvas_content),
        "canvas_changes_present": bool(canvas_changes),
        "file_path_present": bool(file_path),
        "file_title_present": bool(file_title),
        "reminder_text_present": bool(reminder_text),
        "reminder_time_present": bool(reminder_time),
        "reminder_user_present": bool(reminder_user),
        "runtime_ready": bool(bot_token),
    }


def config_snapshot(ctx_obj: dict[str, Any], *, probe: dict[str, Any] | None = None) -> dict[str, Any]:
    runtime = resolve_runtime_values(ctx_obj)
    return {
        "backend": BACKEND_NAME,
        "auth": {
            "bot_token_env": runtime["bot_token_env"],
            "bot_token_present": runtime["bot_token_present"],
            "bot_token_usable": runtime["bot_token_usable"],
            "bot_token_masked": _mask(runtime["bot_token"]),
            "bot_token_source": runtime["bot_token_source"],
            "app_token_env": runtime["app_token_env"],
            "app_token_present": runtime["app_token_present"],
            "app_token_usable": runtime["app_token_usable"],
            "app_token_masked": _mask(runtime["app_token"]),
            "app_token_source": runtime["app_token_source"],
            "base_url_env": runtime["base_url_env"],
            "base_url": runtime["base_url"],
            "base_url_source": runtime["base_url_source"],
            "sources": {
                runtime["bot_token_env"]: runtime["bot_token_source"],
                runtime["app_token_env"]: runtime["app_token_source"],
                runtime["base_url_env"]: runtime["base_url_source"],
            },
            "resolution_order": ["operator-context", "service-keys", "process.env", "default"],
        },
        "scope": {
            "base_url": runtime["base_url"],
            "channel_id": runtime["channel_id"] or None,
            "thread_ts": runtime["thread_ts"] or None,
            "user_id": runtime["user_id"] or None,
            "channel_name": runtime["channel_name"] or None,
            "canvas_id": runtime["canvas_id"] or None,
            "canvas_title": runtime["canvas_title"] or None,
            "file_path": runtime["file_path"] or None,
        },
        "runtime": {
            "implementation_mode": "live_read_write",
            "runtime_ready": bool(probe["ok"]) if probe else runtime["runtime_ready"],
            "text_present": runtime["text_present"],
            "emoji_present": runtime["emoji_present"],
            "reminder_time_present": runtime["reminder_time_present"],
        },
        "probe": probe,
    }
