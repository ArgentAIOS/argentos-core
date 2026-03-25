from __future__ import annotations

import json
import os
from typing import Any
from urllib import error, parse, request

from .constants import (
    BACKEND,
    CONNECTOR_AUTH,
    CONNECTOR_CATEGORIES,
    CONNECTOR_CATEGORY,
    CONNECTOR_LABEL,
    CONNECTOR_RESOURCES,
    COMMAND_SPECS,
    DEFAULT_APP_TOKEN_ENV,
    DEFAULT_BOT_TOKEN_ENV,
    LEGACY_APP_TOKEN_ENV,
    LEGACY_BOT_TOKEN_ENV,
    READ_SCOPES,
    TOOL_NAME,
    WRITE_SCOPES,
)
from .errors import CliError

API_TIMEOUT_SECONDS = 20
SLACK_API_BASE_URL = "https://slack.com/api"

_AUTH_ERROR_CODES = {
    "account_inactive",
    "bad_email",
    "bot_user_not_found",
    "invalid_auth",
    "missing_scope",
    "no_permission",
    "not_allowed_token_type",
    "not_authed",
    "org_login_required",
    "token_expired",
    "token_revoked",
}
_NOT_FOUND_CODES = {
    "channel_not_found",
    "message_not_found",
    "not_found",
    "user_not_found",
}
_BACKEND_ERROR_CODES = {
    "fatal_error",
    "internal_error",
    "request_timeout",
    "service_unavailable",
}


def _resolve_env(*names: str) -> tuple[str | None, str | None]:
    for name in names:
        value = os.getenv(name)
        if value:
            return value, name
    return None, None


def runtime_config() -> dict[str, Any]:
    bot_token, bot_token_source = _resolve_env(DEFAULT_BOT_TOKEN_ENV, LEGACY_BOT_TOKEN_ENV)
    app_token, app_token_source = _resolve_env(DEFAULT_APP_TOKEN_ENV, LEGACY_APP_TOKEN_ENV)
    workspace_hint, workspace_hint_source = _resolve_env("SLACK_WORKSPACE", "AOS_SLACK_WORKSPACE")
    team_id_hint, team_id_hint_source = _resolve_env("SLACK_TEAM_ID", "AOS_SLACK_TEAM_ID")
    return {
        "backend": BACKEND,
        "tool": TOOL_NAME,
        "bot_token": bot_token,
        "bot_token_present": bool(bot_token),
        "bot_token_source": bot_token_source,
        "app_token": app_token,
        "app_token_present": bool(app_token),
        "app_token_source": app_token_source,
        "workspace_hint": workspace_hint,
        "workspace_hint_source": workspace_hint_source,
        "team_id_hint": team_id_hint,
        "team_id_hint_source": team_id_hint_source,
    }


def _headers(token: str) -> dict[str, str]:
    return {
        "Authorization": f"Bearer {token}",
        "Accept": "application/json",
        "Content-Type": "application/x-www-form-urlencoded; charset=utf-8",
        "User-Agent": "aos-slack/0.1.0",
    }


def _clean_params(params: dict[str, Any] | None) -> dict[str, Any]:
    cleaned: dict[str, Any] = {}
    for key, value in (params or {}).items():
        if value is None:
            continue
        if isinstance(value, str) and not value.strip():
            continue
        if isinstance(value, bool):
            cleaned[key] = "true" if value else "false"
            continue
        if isinstance(value, (list, tuple)):
            cleaned[key] = ",".join(str(item) for item in value if item is not None and str(item).strip())
            continue
        cleaned[key] = value
    return cleaned


def _parse_json_body(body: str, *, method_name: str) -> dict[str, Any]:
    try:
        payload = json.loads(body) if body else {}
    except json.JSONDecodeError as err:
        raise CliError(
            code="BACKEND_UNAVAILABLE",
            message="Slack API returned invalid JSON",
            exit_code=5,
            details={"method": method_name, "body": body[:200]},
        ) from err
    if not isinstance(payload, dict):
        raise CliError(
            code="BACKEND_UNAVAILABLE",
            message="Slack API returned an unexpected payload",
            exit_code=5,
            details={"method": method_name},
        )
    return payload


def _classify_slack_error(error_code: str | None, *, http_status: int | None = None) -> tuple[str, int]:
    normalized = (error_code or "").strip().lower()
    if normalized in _AUTH_ERROR_CODES:
        return "AUTH_ERROR", 4
    if normalized in _NOT_FOUND_CODES:
        return "NOT_FOUND", 6
    if normalized in _BACKEND_ERROR_CODES or http_status in {429, 500, 502, 503, 504}:
        if http_status == 429 or normalized == "ratelimited":
            return "RATE_LIMITED", 5
        return "BACKEND_UNAVAILABLE", 5
    if normalized == "ratelimited":
        return "RATE_LIMITED", 5
    return "SLACK_API_ERROR", 10


def _error_message(error_code: str | None, fallback: str) -> str:
    normalized = (error_code or "").strip().lower()
    if normalized == "missing_scope":
        return "Slack token is missing one or more required scopes"
    if normalized == "invalid_auth":
        return "Slack token is invalid"
    if normalized == "not_authed":
        return "Slack token is not configured or is empty"
    if normalized == "rate_limited":
        return "Slack API rate limited the request"
    if normalized == "channel_not_found":
        return "Slack channel was not found"
    if normalized == "message_not_found":
        return "Slack message was not found"
    if normalized == "user_not_found":
        return "Slack user was not found"
    return fallback


def _request_json(api_method: str, token: str, *, params: dict[str, Any] | None = None) -> dict[str, Any]:
    url = f"{SLACK_API_BASE_URL}/{api_method}"
    encoded = parse.urlencode(_clean_params(params), doseq=True).encode("utf-8")
    req = request.Request(url, data=encoded, method="POST", headers=_headers(token))
    try:
        with request.urlopen(req, timeout=API_TIMEOUT_SECONDS) as response:
            charset = response.headers.get_content_charset("utf-8")
            body = response.read().decode(charset or "utf-8")
            payload = _parse_json_body(body, method_name=api_method)
    except error.HTTPError as err:
        charset = err.headers.get_content_charset("utf-8") if err.headers else "utf-8"
        body = err.read().decode(charset or "utf-8", errors="replace")
        payload = _parse_json_body(body, method_name=api_method) if body else {}
        error_code = str(payload.get("error") or err.reason or "slack_api_error")
        code, exit_code = _classify_slack_error(error_code, http_status=err.code)
        raise CliError(
            code=code,
            message=_error_message(error_code, f"Slack API request failed for {api_method}"),
            exit_code=exit_code,
            details={
                "method": api_method,
                "http_status": err.code,
                "slack_error": error_code,
                "response": payload or None,
            },
        ) from err
    except error.URLError as err:
        raise CliError(
            code="BACKEND_UNAVAILABLE",
            message="Failed to reach Slack API",
            exit_code=5,
            details={"method": api_method, "reason": str(err.reason)},
        ) from err

    if payload.get("ok") is False:
        error_code = str(payload.get("error") or "slack_api_error")
        code, exit_code = _classify_slack_error(error_code)
        raise CliError(
            code=code,
            message=_error_message(error_code, f"Slack API request failed for {api_method}"),
            exit_code=exit_code,
            details={"method": api_method, "slack_error": error_code, "response": payload},
        )
    return payload


def _require_bot_token(config: dict[str, Any]) -> str:
    token = config.get("bot_token")
    if not token:
        raise CliError(
            code="AUTH_REQUIRED",
            message="SLACK_BOT_TOKEN is not configured",
            exit_code=4,
            details={
                "env": config.get("bot_token_source") or DEFAULT_BOT_TOKEN_ENV,
                "required_scope": None,
            },
        )
    return token


def _normalize_auth_payload(payload: dict[str, Any]) -> dict[str, Any]:
    return {
        "team_id": payload.get("team_id"),
        "team_name": payload.get("team"),
        "user_id": payload.get("user_id"),
        "user_name": payload.get("user"),
        "bot_id": payload.get("bot_id"),
        "url": payload.get("url"),
    }


def _normalize_channel(channel: dict[str, Any]) -> dict[str, Any]:
    return {
        "id": channel.get("id"),
        "name": channel.get("name"),
        "is_channel": channel.get("is_channel"),
        "is_group": channel.get("is_group"),
        "is_im": channel.get("is_im"),
        "is_private": channel.get("is_private"),
        "is_archived": channel.get("is_archived"),
        "is_member": channel.get("is_member"),
        "num_members": channel.get("num_members"),
    }


def _normalize_search_match(match: dict[str, Any]) -> dict[str, Any]:
    channel = match.get("channel") if isinstance(match.get("channel"), dict) else {}
    return {
        "channel_id": channel.get("id"),
        "channel_name": channel.get("name"),
        "ts": match.get("ts"),
        "username": match.get("username"),
        "user": match.get("user"),
        "text": match.get("text"),
        "permalink": match.get("permalink"),
        "score": match.get("score"),
    }


def _normalize_reaction_item(item: dict[str, Any]) -> dict[str, Any]:
    message = item.get("message") if isinstance(item.get("message"), dict) else {}
    file_payload = item.get("file") if isinstance(item.get("file"), dict) else {}
    return {
        "type": item.get("type"),
        "channel": item.get("channel"),
        "reaction": item.get("reaction"),
        "count": item.get("count"),
        "message_ts": message.get("ts"),
        "message_text": message.get("text"),
        "file_id": file_payload.get("id"),
        "file_name": file_payload.get("name"),
    }


def _normalize_user_item(user: dict[str, Any]) -> dict[str, Any]:
    profile = user.get("profile") if isinstance(user.get("profile"), dict) else {}
    display_name = str(profile.get("display_name") or user.get("name") or "").strip()
    real_name = str(profile.get("real_name") or user.get("real_name") or "").strip()
    title = str(profile.get("title") or "").strip()
    name = str(user.get("name") or "").strip()
    user_id = str(user.get("id") or "").strip()
    label_name = display_name or real_name or name or user_id
    return {
        "id": user_id or None,
        "name": name or None,
        "display_name": display_name or None,
        "real_name": real_name or None,
        "title": title or None,
        "mention": f"<@{user_id}>" if user_id else None,
        "is_bot": user.get("is_bot"),
        "is_app_user": user.get("is_app_user"),
        "deleted": user.get("deleted"),
        "is_admin": user.get("is_admin"),
        "is_owner": user.get("is_owner"),
        "is_primary_owner": user.get("is_primary_owner"),
        "is_restricted": user.get("is_restricted"),
        "is_ultra_restricted": user.get("is_ultra_restricted"),
        "tz": user.get("tz"),
        "label_name": label_name,
    }


def _scope_metadata(
    *,
    kind: str,
    preview: str,
    label: str | None = None,
    scope_id: str | None = None,
    selection_surface: str | None = None,
    **extra: Any,
) -> dict[str, Any]:
    scope: dict[str, Any] = {
        "kind": kind,
        "preview": preview,
    }
    if label is not None:
        scope["label"] = label
    if scope_id is not None:
        scope["id"] = scope_id
    if selection_surface is not None:
        scope["selection_surface"] = selection_surface
    scope.update(extra)
    return scope


def _compact_preview(items: list[str], *, empty_text: str, limit: int = 3) -> str:
    labels = [item.strip() for item in items if isinstance(item, str) and item.strip()]
    if not labels:
        return empty_text
    visible = labels[:limit]
    preview = ", ".join(visible)
    remaining = len(labels) - len(visible)
    if remaining > 0:
        preview = f"{preview} +{remaining} more"
    return preview


def _workspace_context(identity: dict[str, Any], resolved: dict[str, Any]) -> dict[str, Any]:
    workspace_name = str(identity.get("team_name") or resolved.get("workspace_hint") or "Slack workspace").strip() or "Slack workspace"
    workspace_id = str(identity.get("team_id") or resolved.get("team_id_hint") or "").strip() or None
    bot_user_id = str(identity.get("user_id") or "").strip() or None
    bot_user_name = str(identity.get("user_name") or "").strip() or None
    bot_handle = f"@{bot_user_name}" if bot_user_name else (f"@{bot_user_id}" if bot_user_id else "@bot")
    return {
        "id": workspace_id,
        "name": workspace_name,
        "label": workspace_name,
        "bot_user_id": bot_user_id,
        "bot_user_name": bot_user_name,
        "bot_handle": bot_handle,
    }


def _channel_picker_item(channel: dict[str, Any], *, workspace_label: str) -> dict[str, Any]:
    channel_id = str(channel.get("id") or "").strip()
    channel_name = str(channel.get("name") or "").strip()
    label = f"#{channel_name}" if channel_name else (channel_id or "channel")
    item = {
        "kind": "channel",
        "id": channel_id or channel_name or label,
        "label": label,
        "channel_id": channel_id or None,
        "channel_name": channel_name or None,
        "scope_preview": f"{workspace_label} > {label}" if workspace_label else label,
        "surface": "channel.list",
        "is_private": channel.get("is_private"),
        "is_archived": channel.get("is_archived"),
        "is_member": channel.get("is_member"),
        "num_members": channel.get("num_members"),
    }
    return item


def _message_excerpt(text: str, *, limit: int = 80) -> str:
    collapsed = " ".join(text.split())
    if len(collapsed) <= limit:
        return collapsed
    return f"{collapsed[: max(limit - 3, 0)].rstrip()}..."


def _message_picker_item(
    match: dict[str, Any],
    *,
    workspace_label: str,
    scope_label: str,
    surface: str,
) -> dict[str, Any]:
    channel_id = str(match.get("channel_id") or "").strip()
    channel_name = str(match.get("channel_name") or "").strip()
    channel_label = f"#{channel_name}" if channel_name else (channel_id or "channel")
    text = str(match.get("text") or "").strip()
    excerpt = _message_excerpt(text)
    label = f"{channel_label} - {excerpt}" if excerpt else channel_label
    ts = str(match.get("ts") or "").strip()
    item_id = str(match.get("permalink") or "").strip()
    if not item_id:
        item_id = f"{channel_id}:{ts}".strip(":")
    if not item_id:
        item_id = label
    return {
        "kind": "message",
        "id": item_id,
        "label": label,
        "channel_id": channel_id or None,
        "channel_name": channel_name or None,
        "ts": ts or None,
        "user": match.get("user"),
        "username": match.get("username"),
        "text": text or None,
        "text_excerpt": excerpt or None,
        "permalink": match.get("permalink"),
        "score": match.get("score"),
        "surface": surface,
        "scope_preview": f"{workspace_label} > {scope_label} > {label}" if workspace_label else f"{scope_label} > {label}",
    }


def _reaction_picker_item(
    item: dict[str, Any],
    *,
    workspace_label: str,
    scope_label: str,
) -> dict[str, Any]:
    reaction = str(item.get("reaction") or "").strip()
    channel_id = str(item.get("channel") or "").strip()
    message_text = str(item.get("message_text") or "").strip()
    file_id = item.get("file_id")
    file_name = str(item.get("file_name") or "").strip()
    excerpt_source = message_text or file_name
    excerpt = _message_excerpt(excerpt_source) if excerpt_source else ""
    label_parts = [f":{reaction}:" if reaction else "reaction"]
    if channel_id:
        label_parts.append(f"#{channel_id}")
    if excerpt:
        label_parts.append(excerpt)
    label = " - ".join(label_parts)
    message_ts = str(item.get("message_ts") or "").strip()
    item_id = str(item.get("type") or "reaction")
    if channel_id:
        item_id = f"{item_id}:{channel_id}"
    if reaction:
        item_id = f"{item_id}:{reaction}"
    if message_ts:
        item_id = f"{item_id}:{message_ts}"
    return {
        "kind": "reaction",
        "id": item_id,
        "label": label,
        "channel_id": channel_id or None,
        "reaction": reaction or None,
        "count": item.get("count"),
        "message_ts": message_ts or None,
        "message_text": message_text or None,
        "file_id": file_id,
        "file_name": file_name or None,
        "surface": "reaction.list",
        "scope_preview": f"{workspace_label} > {scope_label} > {label}" if workspace_label else f"{scope_label} > {label}",
    }


def _person_picker_item(user: dict[str, Any], *, workspace_label: str, scope_label: str) -> dict[str, Any]:
    user_id = str(user.get("id") or "").strip()
    display_name = str(user.get("display_name") or "").strip()
    real_name = str(user.get("real_name") or "").strip()
    name = str(user.get("name") or "").strip()
    label_name = display_name or real_name or name or user_id
    label = f"@{label_name}" if label_name else user_id or "@unknown"
    subtitle = real_name if real_name and real_name != label_name else name if name and name != label_name else None
    return {
        "kind": "person",
        "id": user_id or label,
        "label": label,
        "subtitle": subtitle,
        "user_id": user_id or None,
        "name": name or None,
        "display_name": display_name or None,
        "real_name": real_name or None,
        "mention": user.get("mention"),
        "is_bot": user.get("is_bot"),
        "is_app_user": user.get("is_app_user"),
        "is_admin": user.get("is_admin"),
        "is_owner": user.get("is_owner"),
        "is_primary_owner": user.get("is_primary_owner"),
        "scope_preview": f"{workspace_label} > {scope_label} > {label}" if workspace_label else f"{scope_label} > {label}",
        "surface": "people.list",
    }


def _ok_result(operation: str, resource: str, data: dict[str, Any], *, context: dict[str, Any] | None = None) -> dict[str, Any]:
    payload = {
        "status": "ok",
        "backend": BACKEND,
        "resource": resource,
        "operation": operation,
        **data,
    }
    if context:
        payload["context"] = context
    return payload


def _probe_error(err: CliError) -> dict[str, Any]:
    return err.to_probe()


def auth_identity(config: dict[str, Any] | None = None) -> dict[str, Any]:
    resolved = config or runtime_config()
    token = _require_bot_token(resolved)
    payload = _request_json("auth.test", token)
    return _normalize_auth_payload(payload)


def probe_auth(config: dict[str, Any] | None = None) -> dict[str, Any]:
    resolved = config or runtime_config()
    if not resolved["bot_token_present"]:
        return {
            "ok": False,
            "code": "AUTH_REQUIRED",
            "message": "SLACK_BOT_TOKEN is not configured",
            "details": {
                "env": resolved.get("bot_token_source") or DEFAULT_BOT_TOKEN_ENV,
                "required_scope": None,
            },
        }
    try:
        identity = auth_identity(resolved)
    except CliError as err:
        return _probe_error(err)
    return {
        "ok": True,
        "code": "OK",
        "message": "Slack auth.test succeeded",
        "details": identity,
    }


def probe_channel_list(config: dict[str, Any] | None = None, *, limit: int = 1) -> dict[str, Any]:
    resolved = config or runtime_config()
    if not resolved["bot_token_present"]:
        return probe_auth(resolved)
    try:
        payload = _request_json(
            "conversations.list",
            _require_bot_token(resolved),
            params={"limit": limit, "types": "public_channel", "exclude_archived": True},
        )
    except CliError as err:
        return _probe_error(err)
    channels = [item for item in payload.get("channels", []) if isinstance(item, dict)]
    return {
        "ok": True,
        "code": "OK",
        "message": "Slack conversations.list succeeded",
        "details": {
            "count": len(channels),
            "next_cursor": (payload.get("response_metadata") or {}).get("next_cursor"),
        },
    }


def probe_message_search(config: dict[str, Any] | None = None, *, query: str = "slack", limit: int = 1) -> dict[str, Any]:
    resolved = config or runtime_config()
    if not resolved["bot_token_present"]:
        return probe_auth(resolved)
    try:
        payload = _request_json(
            "search.messages",
            _require_bot_token(resolved),
            params={"query": query, "count": limit},
        )
    except CliError as err:
        return _probe_error(err)
    matches = (payload.get("messages") or {}).get("matches", [])
    normalized = [_normalize_search_match(item) for item in matches if isinstance(item, dict)]
    return {
        "ok": True,
        "code": "OK",
        "message": "Slack search.messages succeeded",
        "details": {"count": len(normalized), "query": query},
    }


def probe_mention_scan(
    config: dict[str, Any] | None = None,
    *,
    limit: int = 1,
) -> dict[str, Any]:
    resolved = config or runtime_config()
    if not resolved["bot_token_present"]:
        return probe_auth(resolved)
    try:
        identity = auth_identity(resolved)
        user_id = identity.get("user_id")
        if not user_id:
            raise CliError(
                code="AUTH_ERROR",
                message="Slack auth.test did not return a bot user id",
                exit_code=4,
                details={"method": "auth.test"},
            )
        payload = _request_json(
            "search.messages",
            _require_bot_token(resolved),
            params={"query": f"<@{user_id}>", "count": limit},
        )
    except CliError as err:
        return _probe_error(err)
    matches = (payload.get("messages") or {}).get("matches", [])
    normalized = [_normalize_search_match(item) for item in matches if isinstance(item, dict)]
    return {
        "ok": True,
        "code": "OK",
        "message": "Slack mention probe succeeded",
        "details": {"count": len(normalized), "bot_user_id": user_id},
    }


def probe_reaction_list(config: dict[str, Any] | None = None, *, limit: int = 1) -> dict[str, Any]:
    resolved = config or runtime_config()
    if not resolved["bot_token_present"]:
        return probe_auth(resolved)
    try:
        payload = _request_json(
            "reactions.list",
            _require_bot_token(resolved),
            params={"limit": limit, "full": True},
        )
    except CliError as err:
        return _probe_error(err)
    items = [item for item in payload.get("items", []) if isinstance(item, dict)]
    return {
        "ok": True,
        "code": "OK",
        "message": "Slack reactions.list succeeded",
        "details": {"count": len(items)},
    }


def probe_people_list(config: dict[str, Any] | None = None, *, limit: int = 1) -> dict[str, Any]:
    resolved = config or runtime_config()
    if not resolved["bot_token_present"]:
        return probe_auth(resolved)
    try:
        payload = _request_json(
            "users.list",
            _require_bot_token(resolved),
            params={"limit": limit},
        )
    except CliError as err:
        return _probe_error(err)
    members = [item for item in payload.get("members", []) if isinstance(item, dict)]
    people = [
        _normalize_user_item(item)
        for item in members
        if not item.get("deleted") and not item.get("is_bot") and not item.get("is_app_user")
    ]
    return {
        "ok": True,
        "code": "OK",
        "message": "Slack users.list succeeded",
        "details": {
            "count": len(people),
            "next_cursor": (payload.get("response_metadata") or {}).get("next_cursor"),
        },
    }


def list_channels(
    *,
    config: dict[str, Any] | None = None,
    limit: int = 25,
    include_private: bool = False,
) -> dict[str, Any]:
    resolved = config or runtime_config()
    token = _require_bot_token(resolved)
    identity = auth_identity(resolved)
    workspace = _workspace_context(identity, resolved)
    types = ["public_channel"]
    if include_private:
        types.append("private_channel")
    payload = _request_json(
        "conversations.list",
        token,
        params={"limit": limit, "types": types, "exclude_archived": True},
    )
    channels = [
        _normalize_channel(item)
        for item in payload.get("channels", [])
        if isinstance(item, dict)
    ]
    picker_items = [_channel_picker_item(item, workspace_label=workspace["label"]) for item in channels]
    channel_labels = [item["label"] for item in picker_items]
    scope_label = "Workspace channels"
    scope_preview = f"{workspace['label']} > {scope_label}: {_compact_preview(channel_labels, empty_text='no channels returned')}"
    scope = _scope_metadata(
        kind="workspace",
        preview=scope_preview,
        label=workspace["label"],
        scope_id=workspace["id"],
        selection_surface="channel",
        workspace=workspace,
        item_count=len(picker_items),
        has_more=bool((payload.get("response_metadata") or {}).get("next_cursor")),
        next_cursor=(payload.get("response_metadata") or {}).get("next_cursor"),
    )
    return _ok_result(
        "list",
        "channel",
        {
            "count": len(channels),
            "channels": channels,
            "next_cursor": (payload.get("response_metadata") or {}).get("next_cursor"),
            "workspace": workspace,
            "scope_preview": scope_preview,
            "scope": scope,
            "picker": {
                "scope": scope,
                "items": picker_items,
            },
        },
    )


def list_people(
    *,
    config: dict[str, Any] | None = None,
    limit: int = 50,
) -> dict[str, Any]:
    resolved = config or runtime_config()
    token = _require_bot_token(resolved)
    identity = auth_identity(resolved)
    workspace = _workspace_context(identity, resolved)
    payload = _request_json("users.list", token, params={"limit": limit})
    members = [item for item in payload.get("members", []) if isinstance(item, dict)]
    people = [
        _normalize_user_item(item)
        for item in members
        if not item.get("deleted") and not item.get("is_bot") and not item.get("is_app_user")
    ]
    picker_items = [_person_picker_item(item, workspace_label=workspace["label"], scope_label="Mention targets") for item in people]
    item_labels = [item["label"] for item in picker_items]
    scope_preview = f"{workspace['label']} > Mention targets: {_compact_preview(item_labels, empty_text='no people returned')}"
    scope = _scope_metadata(
        kind="workspace",
        preview=scope_preview,
        label=workspace["label"],
        scope_id=workspace["id"],
        selection_surface="people",
        workspace=workspace,
        item_count=len(picker_items),
        has_more=bool((payload.get("response_metadata") or {}).get("next_cursor")),
        next_cursor=(payload.get("response_metadata") or {}).get("next_cursor"),
        filters={"exclude_deleted": True, "exclude_bots": True, "exclude_app_users": True},
    )
    return _ok_result(
        "list",
        "people",
        {
            "count": len(people),
            "people": people,
            "workspace": workspace,
            "scope_preview": scope_preview,
            "scope": scope,
            "picker": {
                "scope": scope,
                "items": picker_items,
            },
            "next_cursor": (payload.get("response_metadata") or {}).get("next_cursor"),
        },
    )


def search_messages(
    *,
    config: dict[str, Any] | None = None,
    query: str,
    limit: int = 10,
) -> dict[str, Any]:
    if not query.strip():
        raise CliError(
            code="INVALID_USAGE",
            message="message.search requires a non-empty query",
            exit_code=2,
            details={"required_scope": "search:read"},
    )
    resolved = config or runtime_config()
    token = _require_bot_token(resolved)
    identity = auth_identity(resolved)
    workspace = _workspace_context(identity, resolved)
    payload = _request_json("search.messages", token, params={"query": query, "count": limit})
    messages = [
        _normalize_search_match(item)
        for item in (payload.get("messages") or {}).get("matches", [])
        if isinstance(item, dict)
    ]
    scope_label = f"Message search for {query!r}"
    picker_items = [
        _message_picker_item(item, workspace_label=workspace["label"], scope_label=scope_label, surface="message.search")
        for item in messages
    ]
    item_labels = [item["label"] for item in picker_items]
    scope_preview = f"{workspace['label']} > {scope_label}: {_compact_preview(item_labels, empty_text='no results')}"
    scope = _scope_metadata(
        kind="workspace",
        preview=scope_preview,
        label=workspace["label"],
        scope_id=workspace["id"],
        selection_surface="message",
        workspace=workspace,
        query=query,
        item_count=len(picker_items),
        total=(payload.get("messages") or {}).get("total"),
    )
    return _ok_result(
        "search",
        "message",
        {
            "query": query,
            "count": len(messages),
            "messages": messages,
            "total": (payload.get("messages") or {}).get("total"),
            "workspace": workspace,
            "scope_preview": scope_preview,
            "scope": scope,
            "picker": {
                "scope": scope,
                "items": picker_items,
            },
        },
    )


def mention_scan(
    *,
    config: dict[str, Any] | None = None,
    query: str | None = None,
    limit: int = 10,
) -> dict[str, Any]:
    resolved = config or runtime_config()
    token = _require_bot_token(resolved)
    identity = auth_identity(resolved)
    workspace = _workspace_context(identity, resolved)
    bot_user_id = identity.get("user_id")
    if not bot_user_id:
        raise CliError(
            code="AUTH_ERROR",
            message="Slack auth.test did not return a bot user id",
            exit_code=4,
            details={"method": "auth.test"},
        )
    bot_handle = workspace["bot_handle"]
    final_query = query.strip() if query and query.strip() else f"<@{bot_user_id}>"
    payload = _request_json("search.messages", token, params={"query": final_query, "count": limit})
    messages = [
        _normalize_search_match(item)
        for item in (payload.get("messages") or {}).get("matches", [])
        if isinstance(item, dict)
    ]
    scope_label = f"Mentions for {bot_handle}"
    picker_items = [
        _message_picker_item(item, workspace_label=workspace["label"], scope_label=scope_label, surface="mention.scan")
        for item in messages
    ]
    item_labels = [item["label"] for item in picker_items]
    scope_preview = f"{workspace['label']} > {scope_label}: {_compact_preview(item_labels, empty_text='no mentions found')}"
    scope = _scope_metadata(
        kind="workspace",
        preview=scope_preview,
        label=workspace["label"],
        scope_id=workspace["id"],
        selection_surface="message",
        workspace=workspace,
        query=final_query,
        bot_user_id=bot_user_id,
        bot_handle=bot_handle,
        item_count=len(picker_items),
    )
    return _ok_result(
        "scan",
        "mention",
        {
            "query": final_query,
            "bot_user_id": bot_user_id,
            "count": len(messages),
            "messages": messages,
            "workspace": workspace,
            "scope_preview": scope_preview,
            "scope": scope,
            "picker": {
                "scope": scope,
                "items": picker_items,
            },
        },
    )


def list_reactions(
    *,
    config: dict[str, Any] | None = None,
    limit: int = 25,
) -> dict[str, Any]:
    resolved = config or runtime_config()
    token = _require_bot_token(resolved)
    identity = auth_identity(resolved)
    workspace = _workspace_context(identity, resolved)
    payload = _request_json("reactions.list", token, params={"limit": limit, "full": True})
    items = [
        _normalize_reaction_item(item)
        for item in payload.get("items", [])
        if isinstance(item, dict)
    ]
    bot_handle = workspace["bot_handle"]
    scope_label = f"Reactions by {bot_handle}"
    picker_items = [
        _reaction_picker_item(item, workspace_label=workspace["label"], scope_label=scope_label)
        for item in items
    ]
    item_labels = [item["label"] for item in picker_items]
    scope_preview = f"{workspace['label']} > {scope_label}: {_compact_preview(item_labels, empty_text='no reactions returned')}"
    scope = _scope_metadata(
        kind="workspace",
        preview=scope_preview,
        label=workspace["label"],
        scope_id=workspace["id"],
        selection_surface="reaction",
        workspace=workspace,
        bot_user_id=workspace["bot_user_id"],
        bot_handle=bot_handle,
        item_count=len(picker_items),
    )
    return _ok_result(
        "list",
        "reaction",
        {
            "count": len(items),
            "items": items,
            "paging": (payload.get("response_metadata") or {}).get("next_cursor"),
            "workspace": workspace,
            "scope_preview": scope_preview,
            "scope": scope,
            "picker": {
                "scope": scope,
                "items": picker_items,
            },
        },
    )


def reply_message(
    *,
    config: dict[str, Any] | None = None,
    channel: str,
    text: str,
    thread_ts: str | None = None,
    broadcast: bool = False,
) -> dict[str, Any]:
    if not channel.strip():
        raise CliError(
            code="INVALID_USAGE",
            message="message.reply requires a channel",
            exit_code=2,
            details={"required_scope": "chat:write"},
        )
    if not text.strip():
        raise CliError(
            code="INVALID_USAGE",
            message="message.reply requires reply text",
            exit_code=2,
            details={"required_scope": "chat:write"},
        )
    resolved = config or runtime_config()
    token = _require_bot_token(resolved)
    params: dict[str, Any] = {"channel": channel, "text": text, "reply_broadcast": broadcast}
    if thread_ts and thread_ts.strip():
        params["thread_ts"] = thread_ts.strip()
    payload = _request_json("chat.postMessage", token, params=params)
    message = payload.get("message") if isinstance(payload.get("message"), dict) else {}
    return _ok_result(
        "reply",
        "message",
        {
            "channel": payload.get("channel") or channel,
            "ts": payload.get("ts") or message.get("ts"),
            "thread_ts": message.get("thread_ts") or thread_ts,
            "message": {
                "text": message.get("text") or text,
                "user": message.get("user"),
                "channel": message.get("channel") or payload.get("channel") or channel,
            },
        },
    )


def _status_from_check(check: dict[str, Any]) -> str:
    code = str(check.get("code") or "").upper()
    if code in {"AUTH_REQUIRED"}:
        return "needs_setup"
    if code in {"AUTH_ERROR"}:
        return "auth_error"
    if code in {"BACKEND_UNAVAILABLE", "RATE_LIMITED"}:
        return "backend_unavailable"
    return "auth_error"


def _check_result(name: str, probe: dict[str, Any], *, details: dict[str, Any] | None = None) -> dict[str, Any]:
    return {
        "name": name,
        "ok": bool(probe.get("ok")),
        "code": probe.get("code"),
        "message": probe.get("message"),
        "details": details if details is not None else probe.get("details", {}),
    }


def _runtime_summary(config: dict[str, Any], checks: list[dict[str, Any]]) -> tuple[str, str, str]:
    if not config["bot_token_present"]:
        return (
            "needs_setup",
            "Slack live reads need SLACK_BOT_TOKEN before they can run.",
            "Set SLACK_BOT_TOKEN in API Keys and retry health.",
        )
    failing = next((check for check in checks if not check["ok"]), None)
    if failing:
        status = _status_from_check(failing)
        message = str(failing.get("message") or "Slack probe failed")
        if status == "needs_setup":
            summary = "Slack live reads need SLACK_BOT_TOKEN before they can run."
        elif status == "backend_unavailable":
            summary = f"Slack API is unreachable or rate limited: {message}"
        else:
            summary = f"Slack authentication or scopes need attention: {message}"
        next_step = failing.get("details", {})
        required_scope = next_step.get("required_scope")
        if required_scope:
            advice = f"Grant the Slack bot the {required_scope} scope."
        else:
            advice = "Revisit the Slack app token and workspace permissions."
        return status, summary, advice
    return (
        "ok",
        "Slack bot token and live read probes succeeded.",
        "No immediate action required.",
    )


def _health_checks(config: dict[str, Any]) -> list[dict[str, Any]]:
    checks = [
        {
            "name": "bot_token",
            "ok": config["bot_token_present"],
            "details": {
                "present": config["bot_token_present"],
                "source": config["bot_token_source"],
            },
        },
    ]
    if not config["bot_token_present"]:
        checks.extend(
            [
                {"name": "auth.test", "ok": False, "code": "AUTH_REQUIRED", "message": "SLACK_BOT_TOKEN is not configured", "details": {"skipped": True}},
                {"name": "channel.list", "ok": False, "code": "AUTH_REQUIRED", "message": "SLACK_BOT_TOKEN is not configured", "details": {"skipped": True}},
                {"name": "people.list", "ok": False, "code": "AUTH_REQUIRED", "message": "SLACK_BOT_TOKEN is not configured", "details": {"skipped": True}},
                {"name": "message.search", "ok": False, "code": "AUTH_REQUIRED", "message": "SLACK_BOT_TOKEN is not configured", "details": {"skipped": True}},
                {"name": "mention.scan", "ok": False, "code": "AUTH_REQUIRED", "message": "SLACK_BOT_TOKEN is not configured", "details": {"skipped": True}},
                {"name": "reaction.list", "ok": False, "code": "AUTH_REQUIRED", "message": "SLACK_BOT_TOKEN is not configured", "details": {"skipped": True}},
            ]
        )
        return checks

    auth_probe = probe_auth(config)
    checks.append(_check_result("auth.test", auth_probe))
    if not auth_probe["ok"]:
        return checks

    channel_probe = probe_channel_list(config)
    checks.append(_check_result("channel.list", channel_probe))
    people_probe = probe_people_list(config)
    checks.append(_check_result("people.list", people_probe))
    message_probe = probe_message_search(config)
    checks.append(_check_result("message.search", message_probe))
    mention_probe = probe_mention_scan(config)
    checks.append(_check_result("mention.scan", mention_probe))
    reaction_probe = probe_reaction_list(config)
    checks.append(_check_result("reaction.list", reaction_probe))
    return checks


def health_snapshot(ctx_obj: dict[str, Any] | None = None) -> dict[str, Any]:
    config = runtime_config()
    checks = _health_checks(config)
    status, summary, next_step = _runtime_summary(config, checks)
    next_steps = [next_step]
    if config["bot_token_present"]:
        for check in checks:
            if check["ok"]:
                continue
            details = check.get("details") or {}
            required_scope = details.get("required_scope")
            if required_scope:
                next_steps.append(f"Grant the Slack bot the {required_scope} scope.")
    else:
        next_steps = [
            "Add SLACK_BOT_TOKEN to API Keys.",
            "Grant the bot channels:read, search:read, users:read, and reactions:read before assigning it to live reads.",
        ]
    next_steps = list(dict.fromkeys(next_steps))
    return {
        "status": status,
        "summary": summary,
        "backend": BACKEND,
        "connector": {
            "label": CONNECTOR_LABEL,
            "category": CONNECTOR_CATEGORY,
            "categories": CONNECTOR_CATEGORIES,
            "resources": CONNECTOR_RESOURCES,
        },
        "auth": CONNECTOR_AUTH,
        "checks": checks,
        "next_steps": next_steps,
    }


def config_snapshot(ctx_obj: dict[str, Any] | None = None) -> dict[str, Any]:
    health = health_snapshot(ctx_obj)
    config = runtime_config()
    return {
        **health,
        "config": {
            "bot_token": {
                "present": config["bot_token_present"],
                "source": config["bot_token_source"],
                "required": True,
            },
            "app_token": {
                "present": config["app_token_present"],
                "source": config["app_token_source"],
                "required": False,
            },
            "workspace_hint": config["workspace_hint"],
            "workspace_hint_source": config["workspace_hint_source"],
            "team_id_hint": config["team_id_hint"],
            "team_id_hint_source": config["team_id_hint_source"],
            "runtime_ready": health["status"] == "ok",
            "required_read_scopes": READ_SCOPES,
            "required_write_scopes": WRITE_SCOPES,
            "supported_commands": [
                spec["id"]
                for spec in COMMAND_SPECS
                if spec["id"] not in {"capabilities", "health", "config.show", "doctor"}
            ],
        },
    }


def doctor_snapshot(ctx_obj: dict[str, Any] | None = None) -> dict[str, Any]:
    health = health_snapshot(ctx_obj)
    config = runtime_config()
    return {
        **health,
        "backend": BACKEND,
        "runtime": {
            "manifest_schema_version": "1.0.0",
            "supported_read_scopes": READ_SCOPES,
            "supported_write_scopes": WRITE_SCOPES,
            "channel_probe": probe_channel_list(config),
            "people_probe": probe_people_list(config),
            "message_search_probe": probe_message_search(config),
            "mention_probe": probe_mention_scan(config),
            "reaction_probe": probe_reaction_list(config),
        },
        "config": {
            "bot_token_present": config["bot_token_present"],
            "bot_token_source": config["bot_token_source"],
            "app_token_present": config["app_token_present"],
            "app_token_source": config["app_token_source"],
            "workspace_hint": config["workspace_hint"],
            "team_id_hint": config["team_id_hint"],
        },
    }
