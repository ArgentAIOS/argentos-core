from __future__ import annotations

import json
from typing import Any

import click

from .bridge import ensure_gws_exists, probe_gws, run_gws
from .errors import CliError
from .metadata import (
    capabilities_payload,
    connector_backend,
    connector_tool,
)
from .permissions import require_mode

TOOL_NAME = connector_tool()
BACKEND_NAME = connector_backend()


def _sanitize_opts(ctx: click.Context, command_id: str) -> list[str]:
    # Only Gmail read/search operations should be sanitized automatically.
    if not command_id.startswith("gmail."):
        return []
    sanitize_template = ctx.obj.get("sanitize_template")
    sanitize_mode = ctx.obj.get("sanitize_mode")
    opts: list[str] = []
    if sanitize_template:
        opts.extend(["--sanitize", sanitize_template])
    if sanitize_mode:
        opts.extend(["--sanitize-mode", sanitize_mode])
    return opts


def _account_opts(ctx: click.Context) -> list[str]:
    account = ctx.obj.get("account")
    if not account:
        return []
    return ["--account", account]


def _account_value(ctx: click.Context) -> str:
    account = ctx.obj.get("account")
    return str(account) if account else "me"


def _picker_option(
    value: str,
    label: str,
    resource: str,
    *,
    subtitle: str | None = None,
    selected: bool = False,
    **extra: Any,
) -> dict[str, Any]:
    option: dict[str, Any] = {
        "value": value,
        "label": label,
        "resource": resource,
    }
    if subtitle:
        option["subtitle"] = subtitle
    if selected:
        option["selected"] = True
    if extra:
        option.update(extra)
    return option


def _collection_items(result: dict[str, Any], *keys: str) -> list[dict[str, Any]]:
    for key in keys:
        raw = result.get(key)
        if isinstance(raw, list):
            return [item for item in raw if isinstance(item, dict)]
    return []


def _merge_picker_options(*option_groups: list[dict[str, Any]]) -> list[dict[str, Any]]:
    merged: list[dict[str, Any]] = []
    index: dict[tuple[str, str], dict[str, Any]] = {}
    for options in option_groups:
        for option in options:
            value = str(option.get("value") or "").strip()
            resource = str(option.get("resource") or "").strip()
            if not value and not resource:
                continue
            key = (resource, value)
            existing = index.get(key)
            if existing is None:
                copied = dict(option)
                merged.append(copied)
                index[key] = copied
                continue
            if option.get("selected"):
                existing["selected"] = True
            for field in ("subtitle", "source_kind", "source_command"):
                if field in option and field not in existing:
                    existing[field] = option[field]
    return merged


def _enrich_live_payload(
    result: dict[str, Any],
    *,
    command_id: str,
    resource: str,
    operation: str,
    inputs: dict[str, Any],
    scope: dict[str, Any],
    picker_options: list[dict[str, Any]] | None = None,
    live_status: str = "live_read",
    consequential: bool = False,
    preview_summary: str | None = None,
    **extra: Any,
) -> dict[str, Any]:
    payload = dict(result)
    payload.update(
        {
            "live_status": live_status,
            "command_id": command_id,
            "resource": resource,
            "operation": operation,
            "implemented": True,
            "executed": True,
            "consequential": consequential,
            "inputs": inputs,
            "scope": scope,
        }
    )
    if picker_options is not None:
        payload["picker_options"] = picker_options
    if preview_summary:
        payload["preview_summary"] = preview_summary
    if extra:
        payload.update(extra)
    return payload


def _scope_preview(
    *,
    kind: str,
    selection_surface: str,
    account: str,
    resource: str,
    **extra: Any,
) -> dict[str, Any]:
    preview: dict[str, Any] = {
        "kind": kind,
        "selection_surface": selection_surface,
        "account": account,
        "resource": resource,
    }
    preview.update(extra)
    return preview


def _headers_from_message(message: dict[str, Any]) -> dict[str, str]:
    payload = message.get("payload")
    if not isinstance(payload, dict):
        return {}
    headers = payload.get("headers")
    if not isinstance(headers, list):
        return {}
    normalized: dict[str, str] = {}
    for header in headers:
        if not isinstance(header, dict):
            continue
        name = str(header.get("name") or "").strip().lower()
        value = str(header.get("value") or "").strip()
        if name and value:
            normalized[name] = value
    return normalized


def _message_label(message: dict[str, Any]) -> str:
    headers = _headers_from_message(message)
    return (
        headers.get("subject")
        or str(message.get("subject") or "").strip()
        or str(message.get("snippet") or "").strip()
        or str(message.get("id") or "gmail message")
    )


def _message_subtitle(message: dict[str, Any]) -> str | None:
    headers = _headers_from_message(message)
    parts = [
        headers.get("from"),
        headers.get("date"),
    ]
    parts = [str(part).strip() for part in parts if part]
    return " | ".join(parts) if parts else None


def _message_label_ids(message: dict[str, Any]) -> list[str]:
    label_ids: list[str] = []
    for key in ("labelIds", "label_ids"):
        raw_labels = message.get(key)
        if not isinstance(raw_labels, list):
            continue
        for raw_label in raw_labels:
            if isinstance(raw_label, str):
                label_id = raw_label.strip()
            elif isinstance(raw_label, (int, float)):
                label_id = str(raw_label).strip()
            else:
                continue
            if label_id:
                label_ids.append(label_id)
    raw_labels = message.get("labels")
    if isinstance(raw_labels, list):
        for raw_label in raw_labels:
            if isinstance(raw_label, str):
                label_id = raw_label.strip()
            elif isinstance(raw_label, dict):
                label_id = str(raw_label.get("id") or raw_label.get("name") or "").strip()
            else:
                label_id = ""
            if label_id:
                label_ids.append(label_id)
    payload = message.get("payload")
    if isinstance(payload, dict):
        raw_labels = payload.get("labelIds")
        if isinstance(raw_labels, list):
            for raw_label in raw_labels:
                if isinstance(raw_label, str):
                    label_id = raw_label.strip()
                elif isinstance(raw_label, (int, float)):
                    label_id = str(raw_label).strip()
                else:
                    continue
                if label_id:
                    label_ids.append(label_id)
    seen: set[str] = set()
    normalized: list[str] = []
    for label_id in label_ids:
        if label_id in seen:
            continue
        seen.add(label_id)
        normalized.append(label_id)
    return normalized


_GMAIL_LABEL_NAMES = {
    "INBOX": "Inbox",
    "SENT": "Sent",
    "DRAFT": "Draft",
    "STARRED": "Starred",
    "IMPORTANT": "Important",
    "TRASH": "Trash",
    "SPAM": "Spam",
    "UNREAD": "Unread",
    "CHAT": "Chat",
    "CATEGORY_PERSONAL": "Category Personal",
    "CATEGORY_SOCIAL": "Category Social",
    "CATEGORY_PROMOTIONS": "Category Promotions",
    "CATEGORY_UPDATES": "Category Updates",
    "CATEGORY_FORUMS": "Category Forums",
}


def _label_name(label_id: str) -> str:
    normalized = label_id.strip()
    upper = normalized.upper()
    if upper in _GMAIL_LABEL_NAMES:
        return _GMAIL_LABEL_NAMES[upper]
    if upper.startswith("CATEGORY_"):
        suffix = upper.removeprefix("CATEGORY_").replace("_", " ").strip()
        return f"Category {suffix.title()}" if suffix else "Category"
    readable = normalized.replace("_", " ").replace("-", " ").strip()
    return readable or label_id


def _live_gmail_label_picker_options(ctx: click.Context) -> list[dict[str, Any]]:
    try:
        result = run_gws(
            ctx.obj["gws_bin"],
            ["gmail", "users", "labels", "list", "--params", json.dumps({"userId": "me"}), *_account_opts(ctx)],
        )
    except CliError:
        return []

    labels = _collection_items(result, "labels", "items")
    options: list[dict[str, Any]] = []
    for label in labels:
        label_id = str(label.get("id") or label.get("name") or "").strip()
        if not label_id:
            continue
        label_name = _label_name(str(label.get("name") or label_id))
        subtitle_parts: list[str] = []
        messages_total = label.get("messagesTotal")
        messages_unread = label.get("messagesUnread")
        if isinstance(messages_total, (int, float)) or isinstance(messages_unread, (int, float)):
            count_bits: list[str] = []
            if isinstance(messages_total, (int, float)):
                count_bits.append(f"{int(messages_total)} messages")
            if isinstance(messages_unread, (int, float)):
                count_bits.append(f"{int(messages_unread)} unread")
            subtitle_parts.append(" | ".join(count_bits))
        label_type = str(label.get("type") or "").strip()
        visibility = str(label.get("labelListVisibility") or "").strip()
        if label_type or visibility:
            subtitle_parts.append(" / ".join(part for part in [label_type, visibility] if part))
        options.append(
            _picker_option(
                label_id,
                label_name,
                "gmail.label",
                subtitle=" | ".join(part for part in subtitle_parts if part) or "Live label list",
                kind="label",
                selection_surface="label",
                scope_preview=f"Gmail labels > {label_name}",
                source_kind="live_list",
                source_command="gmail.users.labels.list",
            )
        )
    return options


def _gmail_label_picker_options(result: dict[str, Any], *, source_command: str) -> list[dict[str, Any]]:
    messages = result.get("messages")
    sources: list[dict[str, Any]] = []
    if isinstance(messages, list):
        sources.extend(message for message in messages if isinstance(message, dict))
    elif result:
        sources.append(result)

    label_counts: dict[str, int] = {}
    for message in sources:
        for label_id in _message_label_ids(message):
            label_counts[label_id] = label_counts.get(label_id, 0) + 1

    options: list[dict[str, Any]] = []
    for label_id, count in label_counts.items():
        label_name = _label_name(label_id)
        subtitle = f"Seen in {count} message{'s' if count != 1 else ''}"
        options.append(
            _picker_option(
                label_id,
                label_name,
                "gmail.label",
                subtitle=subtitle,
                kind="label",
                selection_surface="label",
                scope_preview=f"Gmail labels > {label_name}",
                message_count=count,
                source_kind="observed_response",
                source_command=source_command,
            )
        )
    return options


def _gmail_picker_options(result: dict[str, Any]) -> list[dict[str, Any]]:
    options: list[dict[str, Any]] = []
    messages = result.get("messages")
    if not isinstance(messages, list):
        return options
    for message in messages:
        if not isinstance(message, dict):
            continue
        message_id = str(message.get("id") or message.get("message_id") or "").strip()
        label = _message_label(message)
        options.append(
            _picker_option(
                message_id or label,
                label,
                "gmail.message",
                subtitle=_message_subtitle(message),
                selected=False,
                source_kind="observed_response",
                source_command="gmail.users.messages.list",
            )
        )
    return options


def _gmail_read_picker_options(result: dict[str, Any], message_id: str) -> list[dict[str, Any]]:
    if not result:
        return []
    label = _message_label(result)
    option = _picker_option(
        str(result.get("id") or message_id),
        label,
        "gmail.message",
        subtitle=_message_subtitle(result),
        selected=True,
        source_kind="observed_response",
        source_command="gmail.users.messages.get",
    )
    return [option]


def _file_label(file_entry: dict[str, Any]) -> str:
    return (
        str(file_entry.get("name") or "").strip()
        or str(file_entry.get("title") or "").strip()
        or str(file_entry.get("id") or "drive file")
    )


def _file_subtitle(file_entry: dict[str, Any]) -> str | None:
    parts = [
        file_entry.get("mimeType"),
        file_entry.get("modifiedTime"),
    ]
    parts = [str(part).strip() for part in parts if part]
    return " | ".join(parts) if parts else None


def _drive_picker_options(result: dict[str, Any]) -> list[dict[str, Any]]:
    options: list[dict[str, Any]] = []
    files = result.get("files")
    if not isinstance(files, list):
        return options
    for file_entry in files:
        if not isinstance(file_entry, dict):
            continue
        file_id = str(file_entry.get("id") or file_entry.get("fileId") or "").strip()
        label = _file_label(file_entry)
        options.append(
            _picker_option(
                file_id or label,
                label,
                "drive.file",
                subtitle=_file_subtitle(file_entry),
            )
        )
    return options


def _calendar_label(event: dict[str, Any]) -> str:
    return (
        str(event.get("summary") or "").strip()
        or str(event.get("title") or "").strip()
        or str(event.get("id") or "calendar event")
    )


def _calendar_subtitle(event: dict[str, Any]) -> str | None:
    start = event.get("start")
    end = event.get("end")
    start_value = ""
    end_value = ""
    if isinstance(start, dict):
        start_value = str(start.get("dateTime") or start.get("date") or "").strip()
    if isinstance(end, dict):
        end_value = str(end.get("dateTime") or end.get("date") or "").strip()
    parts = [part for part in [start_value, end_value] if part]
    return " -> ".join(parts) if parts else None


def _calendar_picker_options(result: dict[str, Any], *, selected: bool = False) -> list[dict[str, Any]]:
    options: list[dict[str, Any]] = []
    events = result.get("items")
    if not isinstance(events, list):
        events = result.get("events")
    if not isinstance(events, list):
        if selected and result:
            event_id = str(result.get("id") or "").strip()
            label = _calendar_label(result)
            return [
                _picker_option(
                    event_id or label,
                    label,
                    "calendar.event",
                    subtitle=_calendar_subtitle(result),
                    selected=True,
                    source_kind="observed_response",
                    source_command="calendar.events.insert" if selected else "calendar.events.list",
                )
            ]
        return options
    for event in events:
        if not isinstance(event, dict):
            continue
        event_id = str(event.get("id") or event.get("eventId") or "").strip()
        label = _calendar_label(event)
        options.append(
            _picker_option(
                event_id or label,
                label,
                "calendar.event",
                subtitle=_calendar_subtitle(event),
                selected=selected,
                source_kind="observed_response",
                source_command="calendar.events.list" if not selected else "calendar.events.insert",
            )
        )
    return options


def _live_calendar_picker_options(ctx: click.Context) -> list[dict[str, Any]]:
    try:
        result = run_gws(
            ctx.obj["gws_bin"],
            ["calendar", "calendarList", "list", "--params", json.dumps({"maxResults": 250}), *_account_opts(ctx)],
        )
    except CliError:
        return []

    calendars = _collection_items(result, "items", "calendars", "calendarList")
    options: list[dict[str, Any]] = []
    for calendar in calendars:
        calendar_id = str(calendar.get("id") or calendar.get("calendarId") or "").strip()
        if not calendar_id:
            continue
        calendar_name = _calendar_target_label(str(calendar.get("summary") or calendar_id))
        subtitle_parts: list[str] = []
        if calendar.get("primary"):
            subtitle_parts.append("Primary calendar")
        access_role = str(calendar.get("accessRole") or "").strip()
        if access_role:
            subtitle_parts.append(f"Access role: {access_role}")
        options.append(
            _picker_option(
                calendar_id,
                calendar_name,
                "calendar.calendar",
                subtitle=" | ".join(subtitle_parts) if subtitle_parts else "Live calendar list",
                kind="calendar",
                selection_surface="calendar",
                scope_preview=f"Calendar scope > {calendar_name}",
                selected=bool(calendar.get("selected")) or calendar_id == "primary",
                source_kind="live_list",
                source_command="calendar.calendarList.list",
            )
        )
    return options


def _calendar_target_label(calendar_id: str) -> str:
    normalized = calendar_id.strip()
    if not normalized:
        return "Calendar"
    if normalized == "primary":
        return "Primary calendar"
    if "@" in normalized:
        return normalized
    readable = normalized.replace("_", " ").replace("-", " ").strip()
    return readable or normalized


def _calendar_candidate_options(
    calendar_id: str,
    *,
    result: dict[str, Any] | None = None,
    live_options: list[dict[str, Any]] | None = None,
) -> list[dict[str, Any]]:
    candidates: dict[str, dict[str, Any]] = {}

    def add_candidate(
        candidate_id: str,
        *,
        label: str | None = None,
        subtitle: str | None = None,
        selected: bool = False,
        source_kind: str | None = None,
        source_command: str | None = None,
    ) -> None:
        normalized_id = candidate_id.strip()
        if not normalized_id:
            return
        if normalized_id in candidates:
            if selected:
                candidates[normalized_id]["selected"] = True
            return
        candidates[normalized_id] = _picker_option(
            normalized_id,
            label or _calendar_target_label(normalized_id),
            "calendar.calendar",
            subtitle=subtitle,
            selected=selected,
            kind="calendar",
            selection_surface="calendar",
            scope_preview=f"Calendar scope > {label or _calendar_target_label(normalized_id)}",
            source_kind=source_kind or ("observed_response" if result is not None else "input_scope"),
            source_command=source_command
            or ("calendar.events.list" if result is not None else "calendar.events.insert"),
        )

    add_candidate(calendar_id, subtitle="Requested calendar scope", selected=True, source_kind="input_scope")

    if live_options:
        for option in live_options:
            if not isinstance(option, dict):
                continue
            live_id = str(option.get("value") or "").strip()
            if not live_id:
                continue
            add_candidate(
                live_id,
                label=str(option.get("label") or _calendar_target_label(live_id)),
                subtitle=str(option.get("subtitle") or "Live calendar list").strip(),
                selected=bool(option.get("selected")),
                source_kind=str(option.get("source_kind") or "live_list"),
                source_command=str(option.get("source_command") or "calendar.calendarList.list"),
            )

    if isinstance(result, dict):
        if isinstance(result.get("calendarId"), str):
            add_candidate(
                str(result["calendarId"]),
                subtitle="Observed in live response",
                source_kind="observed_response",
                source_command="calendar.events.list",
            )
        events = result.get("items")
        if not isinstance(events, list):
            events = result.get("events")
        if isinstance(events, list):
            for event in events:
                if not isinstance(event, dict):
                    continue
                event_calendar_id = str(event.get("calendarId") or "").strip()
                if event_calendar_id:
                    add_candidate(
                        event_calendar_id,
                        source_kind="observed_response",
                        source_command="calendar.events.list",
                    )

    return list(candidates.values())


@click.group("gmail")
def gmail_group() -> None:
    pass


@gmail_group.command("search")
@click.argument("query")
@click.option("--max-results", type=int, default=10, show_default=True)
@click.pass_context
def gmail_search(ctx: click.Context, query: str, max_results: int) -> None:
    require_mode(ctx.obj["mode"], "gmail.search")
    params = {"userId": "me", "q": query, "maxResults": max_results}
    args = [
        "gmail",
        "users",
        "messages",
        "list",
        "--params",
        json.dumps(params),
        *_sanitize_opts(ctx, "gmail.search"),
        *_account_opts(ctx),
    ]
    result = run_gws(ctx.obj["gws_bin"], args)
    account = _account_value(ctx)
    live_label_picker_options = _live_gmail_label_picker_options(ctx)
    observed_label_picker_options = _gmail_label_picker_options(result, source_command="gmail.users.messages.list")
    label_picker_options = _merge_picker_options(live_label_picker_options, observed_label_picker_options)
    ctx.obj["_result"] = _enrich_live_payload(
        result,
        command_id="gmail.search",
        resource="gmail",
        operation="search",
        inputs={"query": query, "max_results": max_results, "account": account},
        scope=_scope_preview(
            kind="mailbox",
            selection_surface="message",
            account=account,
            resource="gmail",
            query=query,
            max_results=max_results,
            label_picker_options=label_picker_options,
        ),
        picker_options=_gmail_picker_options(result),
        label_picker_options=label_picker_options,
        preview_summary=f"Search Gmail messages for {query!r}",
    )
    ctx.obj["_command_id"] = "gmail.search"


@gmail_group.command("read")
@click.argument("message_id")
@click.option("--format", "fmt", type=click.Choice(["minimal", "full", "raw", "metadata"]), default="full", show_default=True)
@click.pass_context
def gmail_read(ctx: click.Context, message_id: str, fmt: str) -> None:
    require_mode(ctx.obj["mode"], "gmail.read")
    params = {"userId": "me", "id": message_id, "format": fmt}
    args = [
        "gmail",
        "users",
        "messages",
        "get",
        "--params",
        json.dumps(params),
        *_sanitize_opts(ctx, "gmail.read"),
        *_account_opts(ctx),
    ]
    result = run_gws(ctx.obj["gws_bin"], args)
    account = _account_value(ctx)
    live_label_picker_options = _live_gmail_label_picker_options(ctx)
    observed_label_picker_options = _gmail_label_picker_options(result, source_command="gmail.users.messages.get")
    label_picker_options = _merge_picker_options(live_label_picker_options, observed_label_picker_options)
    ctx.obj["_result"] = _enrich_live_payload(
        result,
        command_id="gmail.read",
        resource="gmail",
        operation="read",
        inputs={"message_id": message_id, "format": fmt, "account": account},
        scope=_scope_preview(
            kind="mailbox",
            selection_surface="message",
            account=account,
            resource="gmail",
            message_id=message_id,
            format=fmt,
            label_picker_options=label_picker_options,
        ),
        picker_options=_gmail_read_picker_options(result, message_id),
        label_picker_options=label_picker_options,
        preview_summary=f"Read Gmail message {message_id}",
    )
    ctx.obj["_command_id"] = "gmail.read"


@click.group("drive")
def drive_group() -> None:
    pass


@drive_group.command("list")
@click.option("--page-size", type=int, default=10, show_default=True)
@click.option("--query", default="", help="Drive API q filter")
@click.pass_context
def drive_list(ctx: click.Context, page_size: int, query: str) -> None:
    require_mode(ctx.obj["mode"], "drive.list")
    params = {"pageSize": page_size}
    if query:
        params["q"] = query
    args = ["drive", "files", "list", "--params", json.dumps(params), *_account_opts(ctx)]
    result = run_gws(ctx.obj["gws_bin"], args)
    account = _account_value(ctx)
    ctx.obj["_result"] = _enrich_live_payload(
        result,
        command_id="drive.list",
        resource="drive",
        operation="list",
        inputs={"page_size": page_size, "query": query or None, "account": account},
        scope=_scope_preview(
            kind="drive",
            selection_surface="file",
            account=account,
            resource="drive",
            page_size=page_size,
            query=query or None,
        ),
        picker_options=_drive_picker_options(result),
        preview_summary="List Drive files",
    )
    ctx.obj["_command_id"] = "drive.list"


@click.group("calendar")
def calendar_group() -> None:
    pass


@calendar_group.command("list")
@click.option("--calendar-id", default="primary", show_default=True)
@click.option("--max-results", type=int, default=10, show_default=True)
@click.pass_context
def calendar_list(ctx: click.Context, calendar_id: str, max_results: int) -> None:
    require_mode(ctx.obj["mode"], "calendar.list")
    params = {"calendarId": calendar_id, "maxResults": max_results, "singleEvents": True, "orderBy": "startTime"}
    args = ["calendar", "events", "list", "--params", json.dumps(params), *_account_opts(ctx)]
    result = run_gws(ctx.obj["gws_bin"], args)
    account = _account_value(ctx)
    live_calendar_picker_options = _live_calendar_picker_options(ctx)
    calendar_picker_options = _merge_picker_options(
        live_calendar_picker_options,
        _calendar_candidate_options(calendar_id, result=result, live_options=live_calendar_picker_options),
    )
    ctx.obj["_result"] = _enrich_live_payload(
        result,
        command_id="calendar.list",
        resource="calendar",
        operation="list",
        inputs={"calendar_id": calendar_id, "max_results": max_results, "account": account},
        scope=_scope_preview(
            kind="calendar",
            selection_surface="event",
            account=account,
            resource="calendar",
            calendar_id=calendar_id,
            max_results=max_results,
            calendar_picker_options=calendar_picker_options,
        ),
        picker_options=_calendar_picker_options(result),
        calendar_picker_options=calendar_picker_options,
        preview_summary=f"List calendar events from {calendar_id}",
    )
    ctx.obj["_command_id"] = "calendar.list"


@calendar_group.command("create")
@click.option("--calendar-id", default="primary", show_default=True)
@click.option("--summary", required=True)
@click.option("--start", "start_time", required=True, help="RFC3339 time")
@click.option("--end", "end_time", required=True, help="RFC3339 time")
@click.pass_context
def calendar_create(ctx: click.Context, calendar_id: str, summary: str, start_time: str, end_time: str) -> None:
    require_mode(ctx.obj["mode"], "calendar.create")
    params = {
        "calendarId": calendar_id,
        "requestBody": {
            "summary": summary,
            "start": {"dateTime": start_time},
            "end": {"dateTime": end_time},
        },
    }
    args = ["calendar", "events", "insert", "--params", json.dumps(params), *_account_opts(ctx)]
    result = run_gws(ctx.obj["gws_bin"], args)
    account = _account_value(ctx)
    live_calendar_picker_options = _live_calendar_picker_options(ctx)
    calendar_picker_options = _merge_picker_options(
        live_calendar_picker_options,
        _calendar_candidate_options(calendar_id, result=result, live_options=live_calendar_picker_options),
    )
    ctx.obj["_result"] = _enrich_live_payload(
        result,
        command_id="calendar.create",
        resource="calendar",
        operation="create",
        inputs={
            "calendar_id": calendar_id,
            "summary": summary,
            "start_time": start_time,
            "end_time": end_time,
            "account": account,
        },
        scope=_scope_preview(
            kind="calendar",
            selection_surface="calendar",
            account=account,
            resource="calendar",
            calendar_id=calendar_id,
            summary=summary,
            start_time=start_time,
            end_time=end_time,
            calendar_picker_options=calendar_picker_options,
        ),
        picker_options=_calendar_picker_options(result, selected=True),
        calendar_picker_options=calendar_picker_options,
        live_status="live_write",
        consequential=True,
        preview_summary=f"Create calendar event {summary!r}",
    )
    ctx.obj["_command_id"] = "calendar.create"


@click.command("health")
@click.pass_context
def health(ctx: click.Context) -> None:
    ensure_gws_exists(ctx.obj["gws_bin"])
    version_probe = probe_gws(ctx.obj["gws_bin"], ["--version"])
    if not version_probe["ok"]:
        raise CliError(
            code="BACKEND_ERROR",
            message="gws version check failed",
            exit_code=5,
            details=version_probe,
        )
    ctx.obj["_result"] = {"status": "healthy", "backend": BACKEND_NAME, "backend_info": version_probe}
    ctx.obj["_command_id"] = "health"


@click.command("doctor")
@click.pass_context
def doctor(ctx: click.Context) -> None:
    require_mode(ctx.obj["mode"], "doctor")

    try:
        ensure_gws_exists(ctx.obj["gws_bin"])
    except CliError as err:
        err.details = {
            **err.details,
            "install_hint": "Install upstream with: npm install -g @googleworkspace/cli",
            "upstream_repo": "https://github.com/googleworkspace/cli",
        }
        raise

    version_probe = probe_gws(ctx.obj["gws_bin"], ["--version"])
    auth_probe = probe_gws(ctx.obj["gws_bin"], ["auth", "status", "--json"])
    authenticated = False
    auth_details = dict(auth_probe)
    auth_raw = auth_probe.get("stdout", "")
    if auth_raw:
        try:
            auth_status = json.loads(auth_raw)
            auth_details["status"] = auth_status
            auth_method = str(auth_status.get("auth_method") or "").strip().lower()
            credential_source = str(auth_status.get("credential_source") or "").strip().lower()
            authenticated = auth_method not in {"", "none"} and credential_source not in {"", "none"}
            auth_details["authenticated"] = authenticated
        except json.JSONDecodeError:
            auth_details["raw"] = auth_raw

    checks = [
        {
            "name": "gws_binary",
            "ok": True,
            "details": {"bin": ctx.obj["gws_bin"]},
        },
        {
            "name": "gws_version",
            "ok": version_probe["ok"],
            "details": version_probe,
        },
        {
            "name": "gws_auth_status",
            "ok": auth_probe["ok"] and authenticated,
            "details": auth_details,
        },
        {
            "name": "sanitize_template",
            "ok": bool(ctx.obj.get("sanitize_template")),
            "details": {
                "configured": bool(ctx.obj.get("sanitize_template")),
                "mode": ctx.obj.get("sanitize_mode"),
            },
        },
    ]

    overall_ok = all(check["ok"] for check in checks[:3])
    status = "healthy" if overall_ok else "degraded"
    ctx.obj["_result"] = {
        "status": status,
        "backend": BACKEND_NAME,
        "required_backend": "@googleworkspace/cli",
        "upstream_repo": "https://github.com/googleworkspace/cli",
        "checks": checks,
        "recommendations": [
            "Install/update upstream gws: npm install -g @googleworkspace/cli",
            "Run auth if needed: gws auth login -s drive,gmail,calendar,sheets,docs",
        ],
    }
    ctx.obj["_command_id"] = "doctor"


@click.group("config")
def config_group() -> None:
    pass


@config_group.command("show")
@click.pass_context
def config_show(ctx: click.Context) -> None:
    require_mode(ctx.obj["mode"], "config.show")
    # Keep output safe: expose only non-secret config values.
    account = _account_value(ctx)
    live_label_picker_options = _live_gmail_label_picker_options(ctx)
    live_calendar_picker_options = _live_calendar_picker_options(ctx)
    ctx.obj["_result"] = {
        "tool": TOOL_NAME,
        "backend": BACKEND_NAME,
        "gws_bin": ctx.obj["gws_bin"],
        "account": ctx.obj.get("account"),
        "sanitize_enabled": bool(ctx.obj.get("sanitize_template")),
        "sanitize_mode": ctx.obj.get("sanitize_mode"),
        "scope": _scope_preview(
            kind="account",
            selection_surface="account",
            account=account,
            resource="gmail",
            mailbox=account,
            label_picker_options=live_label_picker_options,
            calendar_picker_options=live_calendar_picker_options,
        ),
        "picker_options": [
            _picker_option(
                account,
                "Current Google account" if account == "me" else account,
                "gmail.mailbox",
                subtitle="Mailbox scope",
                selected=True,
            )
        ],
        "label_picker_options": live_label_picker_options,
        "calendar_picker_options": live_calendar_picker_options,
    }
    ctx.obj["_command_id"] = "config.show"


@click.command("capabilities")
@click.pass_context
def capabilities(ctx: click.Context) -> None:
    ctx.obj["_result"] = capabilities_payload(ctx.obj["version"])
    ctx.obj["_command_id"] = "capabilities"


def register(cli: click.Group) -> None:
    cli.add_command(capabilities)
    cli.add_command(health)
    cli.add_command(doctor)
    cli.add_command(config_group)
    cli.add_command(gmail_group)
    cli.add_command(drive_group)
    cli.add_command(calendar_group)
