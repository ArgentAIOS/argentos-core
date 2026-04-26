from __future__ import annotations

import os
from .service_keys import service_key_env
from typing import Any

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

    bot_token = (service_key_env(bot_token_env) or "").strip()
    app_token = (service_key_env(app_token_env) or "").strip()
    base_url = (service_key_env(base_url_env) or DEFAULT_BASE_URL).strip().rstrip("/")
    channel_id = (service_key_env(channel_id_env) or "").strip()
    thread_ts = (service_key_env(thread_ts_env) or "").strip()
    text = (service_key_env(text_env) or "").strip()
    emoji = (service_key_env(emoji_env) or "").strip()
    user_id = (service_key_env(user_id_env) or "").strip()
    channel_name = (service_key_env(channel_name_env) or "").strip()
    canvas_id = (service_key_env(canvas_id_env) or "").strip()
    canvas_title = (service_key_env(canvas_title_env) or "").strip()
    canvas_content = (service_key_env(canvas_content_env) or "").strip()
    canvas_changes = (service_key_env(canvas_changes_env) or "").strip()
    file_path = (service_key_env(file_path_env) or "").strip()
    file_title = (service_key_env(file_title_env) or "").strip()
    reminder_text = (service_key_env(reminder_text_env) or "").strip()
    reminder_time = (service_key_env(reminder_time_env) or "").strip()
    reminder_user = (service_key_env(reminder_user_env) or "").strip()

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
        "app_token": app_token,
        "base_url": base_url,
        "channel_id": channel_id,
        "thread_ts": thread_ts,
        "text": text,
        "emoji": emoji,
        "user_id": user_id,
        "channel_name": channel_name,
        "canvas_id": canvas_id,
        "canvas_title": canvas_title,
        "canvas_content": canvas_content,
        "canvas_changes": canvas_changes,
        "file_path": file_path,
        "file_title": file_title,
        "reminder_text": reminder_text,
        "reminder_time": reminder_time,
        "reminder_user": reminder_user,
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
            "bot_token_masked": _mask(runtime["bot_token"]),
            "app_token_env": runtime["app_token_env"],
            "app_token_present": runtime["app_token_present"],
            "app_token_masked": _mask(runtime["app_token"]),
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
