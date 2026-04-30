from __future__ import annotations

import json
from datetime import datetime, timedelta, timezone
from typing import Any
from urllib import error, parse, request

from . import __version__
from .config import redacted_config_snapshot, runtime_config
from .constants import CONNECTOR_CATEGORY, CONNECTOR_CATEGORIES, CONNECTOR_LABEL, CONNECTOR_RESOURCES, TOOL_NAME, WRITE_COMMAND_IDS
from .errors import ConnectorError
from .service_keys import service_key_env

GRAPH_SCOPE = "https://graph.microsoft.com/.default"
SUPPORTED_WRITE_COMMAND_IDS = {"mail.reply", "mail.send", "calendar.create"}
LIMITED_WRITE_COMMANDS = {
    "excel.append_rows": (
        "Microsoft Graph workbook range updates do not support application permissions, "
        "so excel.append_rows stays disabled for this client-credentials connector."
    ),
    "teams.reply_message": (
        "Microsoft Graph channel message replies only support application permissions for migration scenarios, "
        "so teams.reply_message stays disabled for operator-driven app-only auth."
    ),
}


def _utc_now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _format_result(
    *,
    ok: bool,
    command: str,
    mode: str,
    started: float,
    data: dict[str, Any] | None = None,
    error_payload: dict[str, Any] | None = None,
) -> dict[str, Any]:
    payload: dict[str, Any] = {
        "ok": ok,
        "tool": TOOL_NAME,
        "command": command,
        "meta": {
            "mode": mode,
            "duration_ms": int((datetime.now(timezone.utc).timestamp() - started) * 1000),
            "timestamp": _utc_now(),
            "version": __version__,
        },
    }
    if ok:
        payload["data"] = data or {}
    else:
        payload["error"] = error_payload or {"code": "INTERNAL_ERROR", "message": "Unknown error"}
    return payload


def _json_request(
    method: str,
    url: str,
    *,
    headers: dict[str, str] | None = None,
    payload: dict[str, Any] | None = None,
    query: dict[str, Any] | None = None,
    timeout_seconds: float = 20.0,
    form_encoded: bool = False,
) -> dict[str, Any]:
    if query:
        separator = "&" if "?" in url else "?"
        url = f"{url}{separator}{parse.urlencode(query, doseq=True)}"
    request_headers = {"Accept": "application/json"}
    if headers:
        request_headers.update(headers)
    body = None
    if payload is not None:
        if form_encoded:
            body = parse.urlencode(payload).encode("utf-8")
            request_headers["Content-Type"] = "application/x-www-form-urlencoded"
        else:
            body = json.dumps(payload).encode("utf-8")
            request_headers["Content-Type"] = "application/json"
    req = request.Request(url, data=body, headers=request_headers, method=method)
    try:
        with request.urlopen(req, timeout=timeout_seconds) as resp:
            raw = resp.read().decode("utf-8")
    except error.HTTPError as exc:
        raw = exc.read().decode("utf-8", "replace") if hasattr(exc, "read") else ""
        details: dict[str, Any] = {"url": url, "status": exc.code}
        if raw:
            details["body"] = raw[:2000]
            try:
                details["response"] = json.loads(raw)
            except json.JSONDecodeError:
                pass
        code = "GRAPH_HTTP_ERROR"
        message = f"Graph request failed with HTTP {exc.code}"
        if exc.code in {401, 403}:
            code = "M365_AUTH_ERROR"
            message = "Microsoft Graph authentication or authorization failed."
        raise ConnectorError(code, message, 12, details) from exc
    except error.URLError as exc:
        raise ConnectorError(
            "GRAPH_UNREACHABLE",
            f"Unable to reach Microsoft Graph: {exc.reason}",
            12,
            {"url": url},
        ) from exc
    if not raw:
        return {}
    try:
        return json.loads(raw)
    except json.JSONDecodeError as exc:
        raise ConnectorError(
            "GRAPH_BAD_JSON",
            "Microsoft Graph returned invalid JSON.",
            12,
            {"url": url, "body": raw[:2000]},
        ) from exc


def _fetch_access_token(config: dict[str, Any]) -> dict[str, Any]:
    auth = config["auth"]
    runtime = config["runtime"]
    if auth["missing_keys"]:
        raise ConnectorError(
            "M365_AUTH_MISSING",
            "Microsoft 365 service keys are missing.",
            2,
            {"missing_keys": auth["missing_keys"]},
        )
    if not runtime["token_url"]:
        raise ConnectorError(
            "M365_AUTH_MISSING",
            "Microsoft 365 token URL could not be derived from the configured tenant.",
            2,
            {"missing_keys": auth["missing_keys"]},
        )
    payload = {
        "client_id": _raw_env("M365_CLIENT_ID"),
        "client_secret": _raw_env("M365_CLIENT_SECRET"),
        "grant_type": "client_credentials",
        "scope": GRAPH_SCOPE,
    }
    token_payload = _json_request(
        "POST",
        runtime["token_url"],
        payload=payload,
        timeout_seconds=runtime["timeout_seconds"],
        form_encoded=True,
    )
    access_token = token_payload.get("access_token")
    if not access_token:
        raise ConnectorError(
            "M365_TOKEN_MISSING",
            "Microsoft 365 token response did not include an access token.",
            12,
            {"token_url": runtime["token_url"], "response": token_payload},
        )
    return {
        "access_token": access_token,
        "token_type": token_payload.get("token_type", "Bearer"),
        "expires_in": token_payload.get("expires_in"),
        "scope": token_payload.get("scope"),
    }


def _raw_env(name: str) -> str:
    return (service_key_env(name, "") or "").strip()


def _split_csv(value: str | None) -> list[str]:
    return [part.strip() for part in str(value or "").split(",") if part.strip()]


def _parse_json_argument(raw: str, *, code: str, message: str) -> Any:
    try:
        return json.loads(raw)
    except json.JSONDecodeError as exc:
        raise ConnectorError(code, message, 2, {"raw": raw[:500]}) from exc


def _normalize_html_body(content: str) -> dict[str, str]:
    return {"contentType": "html", "content": content}


def _require_target_user(config: dict[str, Any], *, surface: str) -> str:
    target_user = (config["context"]["target_user"] or "").strip()
    if target_user:
        return target_user
    raise ConnectorError(
        "M365_TARGET_USER_MISSING",
        f"Set M365_TARGET_USER before using {surface}.",
        2,
        {},
    )


def _parse_datetime_input(value: str, *, field_name: str) -> datetime:
    normalized = value.strip()
    if not normalized:
        raise ConnectorError("ARGUMENT_REQUIRED", f"{field_name} is required.", 2, {})
    if normalized.endswith("Z"):
        normalized = f"{normalized[:-1]}+00:00"
    try:
        parsed = datetime.fromisoformat(normalized)
    except ValueError as exc:
        raise ConnectorError(
            "INVALID_ARGUMENT",
            f"{field_name} must be a valid ISO 8601 datetime.",
            2,
            {"field": field_name, "value": value},
        ) from exc
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=timezone.utc)
    return parsed.astimezone(timezone.utc)


def _graph_datetime(value: str, *, field_name: str) -> dict[str, str]:
    parsed = _parse_datetime_input(value, field_name=field_name)
    return {
        "dateTime": parsed.replace(tzinfo=None).isoformat(timespec="seconds"),
        "timeZone": "UTC",
    }


def _mail_recipient(address: str) -> dict[str, Any]:
    return {"emailAddress": {"address": address}}


def _parse_mail_send_items(
    config: dict[str, Any],
    items: tuple[str, ...],
) -> dict[str, Any]:
    sender = _require_target_user(config, surface="mail.send")
    if len(items) == 1 and items[0].lstrip().startswith("{"):
        payload = _parse_json_argument(
            items[0],
            code="INVALID_ARGUMENT",
            message="mail.send expected a JSON object.",
        )
        if not isinstance(payload, dict):
            raise ConnectorError("INVALID_ARGUMENT", "mail.send JSON input must be an object.", 2, {})
        recipients = payload.get("to") or payload.get("to_recipients") or []
        if isinstance(recipients, str):
            recipients = _split_csv(recipients)
        if not isinstance(recipients, list) or not recipients:
            raise ConnectorError("ARGUMENT_REQUIRED", "mail.send requires at least one recipient.", 2, {})
        subject = str(payload.get("subject") or "").strip()
        body = str(payload.get("body") or payload.get("content") or "").strip()
        if not subject or not body:
            raise ConnectorError("ARGUMENT_REQUIRED", "mail.send requires subject and body.", 2, {})
        mailbox_id = str(payload.get("mailbox_id") or sender).strip()
        return {
            "mailbox_id": mailbox_id,
            "recipients": [str(recipient).strip() for recipient in recipients if str(recipient).strip()],
            "subject": subject,
            "body": body,
        }
    if len(items) < 3:
        raise ConnectorError(
            "ARGUMENT_REQUIRED",
            "mail.send requires <to_csv> <subject> <body> or a single JSON object argument.",
            2,
            {},
        )
    recipients = _split_csv(items[0])
    subject = items[1].strip()
    body = " ".join(items[2:]).strip()
    if not recipients or not subject or not body:
        raise ConnectorError("ARGUMENT_REQUIRED", "mail.send requires recipients, subject, and body.", 2, {})
    return {
        "mailbox_id": sender,
        "recipients": recipients,
        "subject": subject,
        "body": body,
    }


def _parse_mail_reply_items(
    config: dict[str, Any],
    items: tuple[str, ...],
) -> dict[str, str]:
    mailbox_id = _require_target_user(config, surface="mail.reply")
    if len(items) == 1 and items[0].lstrip().startswith("{"):
        payload = _parse_json_argument(
            items[0],
            code="INVALID_ARGUMENT",
            message="mail.reply expected a JSON object.",
        )
        if not isinstance(payload, dict):
            raise ConnectorError("INVALID_ARGUMENT", "mail.reply JSON input must be an object.", 2, {})
        message_id = str(payload.get("message_id") or "").strip()
        comment = str(payload.get("comment") or payload.get("body") or "").strip()
        mailbox_id = str(payload.get("mailbox_id") or mailbox_id).strip()
    else:
        if len(items) < 2:
            raise ConnectorError(
                "ARGUMENT_REQUIRED",
                "mail.reply requires <message_id> <comment> or a single JSON object argument.",
                2,
                {},
            )
        message_id = items[0].strip()
        comment = " ".join(items[1:]).strip()
    if not message_id or not comment:
        raise ConnectorError("ARGUMENT_REQUIRED", "mail.reply requires message_id and comment.", 2, {})
    return {"mailbox_id": mailbox_id, "message_id": message_id, "comment": comment}


def _parse_calendar_create_items(
    config: dict[str, Any],
    items: tuple[str, ...],
) -> dict[str, Any]:
    target_user = _require_target_user(config, surface="calendar.create")
    if len(items) == 1 and items[0].lstrip().startswith("{"):
        payload = _parse_json_argument(
            items[0],
            code="INVALID_ARGUMENT",
            message="calendar.create expected a JSON object.",
        )
        if not isinstance(payload, dict):
            raise ConnectorError("INVALID_ARGUMENT", "calendar.create JSON input must be an object.", 2, {})
        title = str(payload.get("title") or payload.get("subject") or "").strip()
        start = str(payload.get("start") or payload.get("event_start") or "").strip()
        end = str(payload.get("end") or payload.get("event_end") or "").strip()
        body = str(payload.get("body") or payload.get("event_body") or "").strip()
        location = str(payload.get("location") or payload.get("event_location") or "").strip()
        calendar_id = str(payload.get("calendar_id") or "").strip()
    else:
        if len(items) < 2:
            raise ConnectorError(
                "ARGUMENT_REQUIRED",
                "calendar.create requires <title> <start_iso> [end_iso] or a single JSON object argument.",
                2,
                {},
            )
        title = items[0].strip()
        start = items[1].strip()
        end = items[2].strip() if len(items) >= 3 else ""
        body = ""
        location = ""
        calendar_id = ""
    if not title or not start:
        raise ConnectorError("ARGUMENT_REQUIRED", "calendar.create requires title and start.", 2, {})
    start_dt = _parse_datetime_input(start, field_name="event_start")
    end_dt = _parse_datetime_input(end, field_name="event_end") if end else start_dt + timedelta(minutes=30)
    if end_dt <= start_dt:
        raise ConnectorError(
            "INVALID_ARGUMENT",
            "calendar.create requires event_end to be later than event_start.",
            2,
            {},
        )
    return {
        "target_user": target_user,
        "calendar_id": calendar_id,
        "title": title,
        "start": {
            "dateTime": start_dt.replace(tzinfo=None).isoformat(timespec="seconds"),
            "timeZone": "UTC",
        },
        "end": {
            "dateTime": end_dt.replace(tzinfo=None).isoformat(timespec="seconds"),
            "timeZone": "UTC",
        },
        "body": body,
        "location": location,
    }


def _graph_request(
    config: dict[str, Any],
    method: str,
    path: str,
    *,
    query: dict[str, Any] | None = None,
    payload: dict[str, Any] | None = None,
    headers: dict[str, str] | None = None,
) -> dict[str, Any]:
    token = _fetch_access_token(config)["access_token"]
    return _graph_request_with_token(
        config,
        token,
        method,
        path,
        query=query,
        payload=payload,
        headers=headers,
    )


def _graph_request_with_token(
    config: dict[str, Any],
    token: str,
    method: str,
    path: str,
    *,
    query: dict[str, Any] | None = None,
    payload: dict[str, Any] | None = None,
    headers: dict[str, str] | None = None,
) -> dict[str, Any]:
    request_headers = {"Authorization": f"Bearer {token}"}
    if headers:
        request_headers.update(headers)
    return _json_request(
        method,
        f"{config['runtime']['graph_base_url'].rstrip('/')}/{path.lstrip('/')}",
        headers=request_headers,
        payload=payload,
        query=query,
        timeout_seconds=config["runtime"]["timeout_seconds"],
    )


def probe_runtime(config: dict[str, Any] | None = None) -> dict[str, Any]:
    config = config or runtime_config()
    runtime = config["runtime"]
    if config["auth"]["missing_keys"]:
        return {
            "ok": False,
            "code": "M365_AUTH_MISSING",
            "message": "Microsoft 365 service keys are missing.",
            "details": {"missing_keys": config["auth"]["missing_keys"]},
        }
    if not runtime["target_user_present"]:
        return {
            "ok": False,
            "code": "M365_TARGET_USER_MISSING",
            "message": "Set M365_TARGET_USER to enable live mailbox, calendar, and file reads.",
            "details": {
                "mail_ready": runtime["mail_ready"],
                "calendar_ready": runtime["calendar_ready"],
                "file_ready": runtime["file_ready"],
            },
    }
    try:
        token_info = _fetch_access_token(config)
        user = _graph_request_with_token(
            config,
            token_info["access_token"],
            "GET",
            f"/users/{parse.quote(config['context']['target_user'])}",
            query={"$select": "id,displayName,mail,userPrincipalName"},
        )
    except ConnectorError as exc:
        return {
            "ok": False,
            "code": exc.code,
            "message": exc.message,
            "details": exc.details or {},
        }
    return {
        "ok": True,
        "code": "OK",
        "message": "Microsoft Graph live read probe succeeded.",
        "details": {
            "user": {
                "id": user.get("id"),
                "displayName": user.get("displayName"),
                "mail": user.get("mail"),
                "userPrincipalName": user.get("userPrincipalName"),
            },
            "token_type": token_info.get("token_type"),
            "expires_in": token_info.get("expires_in"),
        },
    }


def config_snapshot() -> dict[str, Any]:
    config = runtime_config()
    probe = probe_runtime(config)
    return {
        **config,
        "api_probe": probe,
        "runtime_ready": bool(probe.get("ok")),
    }


def _resource_readiness(config: dict[str, Any]) -> dict[str, bool]:
    runtime = config["runtime"]
    return {
        "mail": runtime["mail_ready"],
        "calendar": runtime["calendar_ready"],
        "file": runtime["file_ready"],
        "teams": runtime["teams_ready"],
        "excel": runtime["excel_ready"],
        "writes": True,
    }


def health_snapshot() -> dict[str, Any]:
    config = runtime_config()
    probe = probe_runtime(config)
    readiness = _resource_readiness(config)
    status = "healthy"
    summary = "Microsoft 365 live read access is available."
    next_steps: list[str] = []

    if config["auth"]["missing_keys"]:
        status = "needs_setup"
        summary = "Microsoft 365 service keys are missing."
        next_steps.append("Set M365_TENANT_ID, M365_CLIENT_ID, and M365_CLIENT_SECRET.")
    elif not config["runtime"]["target_user_present"]:
        status = "needs_setup"
        summary = "Set M365_TARGET_USER to enable live mailbox, calendar, and file reads."
        next_steps.append("Set M365_TARGET_USER to a mailbox, user principal name, or user id.")
    elif not probe["ok"]:
        status = "auth_error" if probe["code"] == "M365_AUTH_ERROR" else "backend_unavailable"
        summary = probe["message"]
        next_steps.append(f"Fix the Microsoft Graph probe failure: {probe['message']}")

    if not readiness["teams"]:
        next_steps.append("Use teams.list_teams, then teams.list_channels, or set M365_TEAM_ID and M365_CHANNEL_ID before using the Teams read surface.")
    if not readiness["excel"]:
        next_steps.append("Use excel.list_workbooks, excel.list_worksheets, and excel.used_range, or set M365_EXCEL_ITEM_ID, M365_EXCEL_WORKSHEET_NAME, and M365_EXCEL_RANGE before using Excel reads.")

    checks = [
        {
            "name": "service_keys",
            "ok": not config["auth"]["missing_keys"],
            "details": {
                "configured": config["auth"]["configured"],
                "missing_keys": config["auth"]["missing_keys"],
            },
        },
        {
            "name": "target_user",
            "ok": config["runtime"]["target_user_present"],
            "details": {
                "present": config["runtime"]["target_user_present"],
                "value": config["context"]["target_user"] or None,
            },
        },
        {
            "name": "graph_probe",
            "ok": bool(probe["ok"]),
            "details": probe,
        },
        {
            "name": "mail_surface",
            "ok": readiness["mail"],
            "details": {"ready": readiness["mail"]},
        },
        {
            "name": "calendar_surface",
            "ok": readiness["calendar"],
            "details": {"ready": readiness["calendar"]},
        },
        {
            "name": "file_surface",
            "ok": readiness["file"],
            "details": {"ready": readiness["file"]},
        },
        {
            "name": "teams_surface",
            "ok": readiness["teams"],
            "details": {"ready": readiness["teams"]},
        },
        {
            "name": "excel_surface",
            "ok": readiness["excel"],
            "details": {"ready": readiness["excel"]},
        },
    ]
    return {
        "status": status,
        "summary": summary,
        "connector": {
            "label": CONNECTOR_LABEL,
            "category": CONNECTOR_CATEGORY,
            "categories": CONNECTOR_CATEGORIES,
            "resources": CONNECTOR_RESOURCES,
        },
        "auth": config["auth"],
        "runtime": config["runtime"],
        "checks": checks,
        "next_steps": next_steps,
        "surface_readiness": readiness,
    }


def doctor_snapshot() -> dict[str, Any]:
    snapshot = health_snapshot()
    recommendations = [
        "Use readonly mode for live reads and write mode only for supported Graph mutations.",
        "excel.append_rows and teams.reply_message remain disabled because Microsoft Graph limits those paths for app-only auth.",
    ]
    if snapshot["status"] == "needs_setup":
        recommendations.insert(0, "Set the Microsoft 365 auth and target-user environment before assigning this connector.")
    elif snapshot["status"] != "healthy":
        recommendations.insert(0, "Resolve the live Microsoft Graph probe failure before promoting this connector.")
    if not snapshot["surface_readiness"]["teams"]:
        recommendations.append("Use the live Teams pickers to choose a team and channel before assigning the Teams read surface.")
    if not snapshot["surface_readiness"]["excel"]:
        recommendations.append("Use the live Excel pickers to choose a workbook, worksheet, and range before assigning the Excel read surface.")
    return {
        **snapshot,
        "backend": "microsoft-graph",
        "runtime_ready": snapshot["status"] == "healthy",
        "recommendations": recommendations,
        "config": redacted_config_snapshot(),
        "supported_write_commands": sorted(SUPPORTED_WRITE_COMMAND_IDS),
        "limited_write_commands": LIMITED_WRITE_COMMANDS,
    }


def _normalize_rows(values: list[list[Any]]) -> list[dict[str, Any]]:
    if not values:
        return []
    headers = [str(item) for item in values[0]]
    rows: list[dict[str, Any]] = []
    for index, row in enumerate(values[1:], start=1):
        rows.append({headers[i]: row[i] if i < len(row) else None for i in range(len(headers))} | {"_row_index": index})
    return rows


def _compact(value: Any) -> str | None:
    text = str(value or "").strip()
    return text or None


def _message_preview(message: dict[str, Any]) -> dict[str, Any]:
    sender = None
    from_value = message.get("from")
    if isinstance(from_value, dict):
        email_address = from_value.get("emailAddress")
        if isinstance(email_address, dict):
            sender = _compact(email_address.get("address")) or _compact(email_address.get("name"))
    return {
        "id": message.get("id"),
        "label": _compact(message.get("subject")) or _compact(message.get("id")) or "(no subject)",
        "subtitle": sender,
        "preview": _compact(message.get("bodyPreview")),
        "url": _compact(message.get("webLink")),
        "is_read": message.get("isRead"),
        "importance": _compact(message.get("importance")),
        "received_at": _compact(message.get("receivedDateTime")),
    }


def _calendar_preview(event: dict[str, Any]) -> dict[str, Any]:
    start = event.get("start") if isinstance(event.get("start"), dict) else {}
    end = event.get("end") if isinstance(event.get("end"), dict) else {}
    organizer = event.get("organizer") if isinstance(event.get("organizer"), dict) else {}
    organizer_name = None
    if isinstance(organizer, dict):
        organizer_email = organizer.get("emailAddress")
        if isinstance(organizer_email, dict):
            organizer_name = _compact(organizer_email.get("name")) or _compact(organizer_email.get("address"))
    return {
        "id": event.get("id"),
        "label": _compact(event.get("subject")) or _compact(event.get("id")) or "(no subject)",
        "subtitle": organizer_name,
        "start": start,
        "end": end,
        "location": event.get("location") or {},
        "url": _compact(event.get("webLink")),
        "is_all_day": event.get("isAllDay"),
    }


def _drive_preview(item: dict[str, Any]) -> dict[str, Any]:
    return {
        "id": item.get("id"),
        "label": _compact(item.get("name")) or _compact(item.get("id")) or "(unnamed item)",
        "subtitle": "folder" if isinstance(item.get("folder"), dict) else "file" if isinstance(item.get("file"), dict) else None,
        "size": item.get("size"),
        "modified_at": _compact(item.get("lastModifiedDateTime")),
        "url": _compact(item.get("webUrl")),
    }


def _team_preview(team: dict[str, Any]) -> dict[str, Any]:
    return {
        "id": team.get("id"),
        "label": _compact(team.get("displayName")) or _compact(team.get("id")) or "(unnamed team)",
        "subtitle": _compact(team.get("description")) or _compact(team.get("mailNickname")),
        "url": _compact(team.get("webUrl")),
    }


def _channel_preview(channel: dict[str, Any]) -> dict[str, Any]:
    return {
        "id": channel.get("id"),
        "label": _compact(channel.get("displayName")) or _compact(channel.get("id")) or "(unnamed channel)",
        "subtitle": "private" if channel.get("membershipType") == "private" else "standard" if channel.get("membershipType") else None,
        "url": _compact(channel.get("webUrl")),
    }


def _worksheet_preview(worksheet: dict[str, Any]) -> dict[str, Any]:
    return {
        "id": worksheet.get("id"),
        "label": _compact(worksheet.get("name")) or _compact(worksheet.get("id")) or "(unnamed worksheet)",
        "subtitle": "worksheet",
    }


def _team_message_preview(message: dict[str, Any]) -> dict[str, Any]:
    sender = None
    from_value = message.get("from")
    if isinstance(from_value, dict):
        user_value = from_value.get("user")
        if isinstance(user_value, dict):
            sender = _compact(user_value.get("displayName")) or _compact(user_value.get("id"))
    return {
        "id": message.get("id"),
        "label": _compact(message.get("subject")) or _compact(message.get("bodyPreview")) or _compact(message.get("id")) or "(no subject)",
        "subtitle": sender,
        "preview": _compact(message.get("bodyPreview")),
        "url": _compact(message.get("webUrl")),
        "created_at": _compact(message.get("createdDateTime")),
    }


def _workbook_preview(
    *,
    item_id: str,
    worksheet: str,
    cell_range: str,
    rows: list[dict[str, Any]],
    raw_values: list[list[Any]],
) -> dict[str, Any]:
    headers = [str(item) for item in raw_values[0]] if raw_values else []
    return {
        "surface": "excel",
        "kind": "workbook",
        "mode": "read_rows",
        "item_id": item_id,
        "worksheet": worksheet,
        "range": cell_range,
        "columns": headers,
        "row_count": len(rows),
        "rows": rows[:10],
    }


def _used_range_preview(
    *,
    item_id: str,
    worksheet: str,
    payload: dict[str, Any],
) -> dict[str, Any]:
    return {
        "surface": "excel",
        "kind": "range",
        "mode": "used_range",
        "item_id": item_id,
        "worksheet": worksheet,
        "address": _compact(payload.get("address")),
        "row_count": payload.get("rowCount"),
        "column_count": payload.get("columnCount"),
        "values": payload.get("values")[:10] if isinstance(payload.get("values"), list) else [],
    }


def search_mail(config: dict[str, Any], *, query: str | None, limit: int = 25) -> dict[str, Any]:
    if not config["runtime"]["target_user_present"]:
        raise ConnectorError(
            "M365_TARGET_USER_MISSING",
            "Set M365_TARGET_USER before reading mail.",
            2,
            {},
        )
    params: dict[str, Any] = {
        "$top": max(1, min(limit, 50)),
        "$select": "id,subject,from,receivedDateTime,bodyPreview,isRead,webLink,importance",
    }
    headers = {"ConsistencyLevel": "eventual"}
    if query:
        params["$search"] = f'"{query}"'
    payload = _graph_request(config, "GET", f"/users/{parse.quote(config['context']['target_user'])}/messages", query=params, headers=headers)
    messages = payload.get("value", [])
    previews = [_message_preview(message) for message in messages if isinstance(message, dict)]
    return {
        "summary": f"Found {len(messages)} message(s).",
        "query": query,
        "count": len(messages),
        "messages": messages,
        "scope_preview": {
            "surface": "mail",
            "kind": "mailbox",
            "mode": "search",
            "target_user": config["context"]["target_user"],
            "query": query,
            "candidates": previews,
        },
    }


def list_joined_teams(config: dict[str, Any], *, limit: int = 25) -> dict[str, Any]:
    if not config["runtime"]["target_user_present"]:
        raise ConnectorError(
            "M365_TARGET_USER_MISSING",
            "Set M365_TARGET_USER before listing Teams.",
            2,
            {},
        )
    payload = _graph_request(
        config,
        "GET",
        f"/users/{parse.quote(config['context']['target_user'])}/joinedTeams",
        query={"$top": max(1, min(limit, 50)), "$select": "id,displayName,description,mailNickname,webUrl"},
    )
    teams = payload.get("value", [])
    previews = [_team_preview(team) for team in teams if isinstance(team, dict)]
    return {
        "summary": f"Found {len(teams)} team(s).",
        "count": len(teams),
        "teams": teams,
        "scope_preview": {
            "surface": "teams",
            "kind": "team",
            "mode": "list_teams",
            "target_user": config["context"]["target_user"],
            "candidates": previews,
        },
    }


def list_team_channels(config: dict[str, Any], *, team_id: str | None = None, limit: int = 25) -> dict[str, Any]:
    team_id = (team_id or config["context"]["team_id"]).strip()
    if not team_id:
        raise ConnectorError(
            "M365_TEAM_MISSING",
            "Set M365_TEAM_ID before listing Teams channels.",
            2,
            {"team_id_present": False},
        )
    payload = _graph_request(
        config,
        "GET",
        f"/teams/{parse.quote(team_id)}/channels",
        query={"$top": max(1, min(limit, 50)), "$select": "id,displayName,description,membershipType,webUrl"},
    )
    channels = payload.get("value", [])
    previews = [_channel_preview(channel) for channel in channels if isinstance(channel, dict)]
    return {
        "summary": f"Found {len(channels)} channel(s).",
        "team_id": team_id,
        "count": len(channels),
        "channels": channels,
        "scope_preview": {
            "surface": "teams",
            "kind": "channel",
            "mode": "list_channels",
            "team_id": team_id,
            "candidates": previews,
        },
    }


def read_mail_message(config: dict[str, Any], message_id: str) -> dict[str, Any]:
    if not message_id:
        raise ConnectorError("ARGUMENT_REQUIRED", "mail.read requires a message id.", 2, {})
    if not config["runtime"]["target_user_present"]:
        raise ConnectorError("M365_TARGET_USER_MISSING", "Set M365_TARGET_USER before reading mail.", 2, {})
    payload = _graph_request(
        config,
        "GET",
        f"/users/{parse.quote(config['context']['target_user'])}/messages/{parse.quote(message_id)}",
        query={"$select": "id,subject,from,toRecipients,ccRecipients,receivedDateTime,bodyPreview,body,isRead,webLink"},
    )
    return {
        "summary": f"Loaded message {payload.get('id')}.",
        "message": payload,
        "scope_preview": {
            "surface": "mail",
            "kind": "mailbox",
            "mode": "read",
            "target_user": config["context"]["target_user"],
            "preview": _message_preview(payload),
        },
    }


def list_calendar_events(config: dict[str, Any], *, start: str | None = None, end: str | None = None, limit: int = 25) -> dict[str, Any]:
    if not config["runtime"]["target_user_present"]:
        raise ConnectorError("M365_TARGET_USER_MISSING", "Set M365_TARGET_USER before reading calendar events.", 2, {})
    start_dt = start or datetime.now(timezone.utc).isoformat()
    end_dt = end or (datetime.now(timezone.utc) + timedelta(days=7)).isoformat()
    payload = _graph_request(
        config,
        "GET",
        f"/users/{parse.quote(config['context']['target_user'])}/calendarView",
        query={
            "startDateTime": start_dt,
            "endDateTime": end_dt,
            "$top": max(1, min(limit, 50)),
            "$select": "id,subject,start,end,organizer,location,isAllDay,webLink",
        },
    )
    events = payload.get("value", [])
    previews = [_calendar_preview(event) for event in events if isinstance(event, dict)]
    return {
        "summary": f"Found {len(events)} event(s).",
        "start": start_dt,
        "end": end_dt,
        "count": len(events),
        "events": events,
        "scope_preview": {
            "surface": "calendar",
            "kind": "calendar",
            "mode": "list",
            "target_user": config["context"]["target_user"],
            "window": {"start": start_dt, "end": end_dt},
            "candidates": previews,
        },
    }


def list_drive_children(config: dict[str, Any], *, path: str | None = None, limit: int = 50) -> dict[str, Any]:
    if not config["runtime"]["target_user_present"]:
        raise ConnectorError("M365_TARGET_USER_MISSING", "Set M365_TARGET_USER before reading files.", 2, {})
    normalized_path = (path or "").strip().strip("/")
    if normalized_path:
        resource = f"/users/{parse.quote(config['context']['target_user'])}/drive/root:/{parse.quote(normalized_path)}:/children"
    else:
        resource = f"/users/{parse.quote(config['context']['target_user'])}/drive/root/children"
    payload = _graph_request(
        config,
        "GET",
        resource,
        query={"$top": max(1, min(limit, 100)), "$select": "id,name,size,lastModifiedDateTime,webUrl,folder,file"},
    )
    items = payload.get("value", [])
    previews = [_drive_preview(item) for item in items if isinstance(item, dict)]
    return {
        "summary": f"Found {len(items)} item(s).",
        "path": normalized_path or "/",
        "count": len(items),
        "items": items,
        "scope_preview": {
            "surface": "file",
            "kind": "drive",
            "mode": "list",
            "target_user": config["context"]["target_user"],
            "path": normalized_path or "/",
            "candidates": previews,
        },
    }


def list_excel_workbooks(config: dict[str, Any], *, path: str | None = None, limit: int = 50) -> dict[str, Any]:
    payload = list_drive_children(config, path=path, limit=limit)
    candidates = []
    for item in payload.get("items", []):
        if not isinstance(item, dict):
            continue
        name = str(item.get("name") or "").lower()
        if name.endswith((".xlsx", ".xlsm", ".xlsb", ".xls")):
            preview = _drive_preview(item)
            preview["kind"] = "workbook"
            candidates.append(preview)
    if not candidates:
        candidates = [_drive_preview(item) | {"kind": "workbook"} for item in payload.get("items", []) if isinstance(item, dict)]
    return {
        "summary": f"Found {len(candidates)} workbook candidate(s).",
        "path": payload.get("path", "/"),
        "count": len(candidates),
        "workbooks": candidates,
        "scope_preview": {
            "surface": "excel",
            "kind": "workbook",
            "mode": "list_workbooks",
            "target_user": config["context"]["target_user"],
            "path": payload.get("path", "/"),
            "candidates": candidates,
        },
    }


def list_excel_worksheets(config: dict[str, Any], *, item_id: str | None = None) -> dict[str, Any]:
    if not config["runtime"]["target_user_present"]:
        raise ConnectorError("M365_TARGET_USER_MISSING", "Set M365_TARGET_USER before listing worksheets.", 2, {})
    item_id = (item_id or config["context"]["excel_item_id"]).strip()
    if not item_id:
        raise ConnectorError(
            "M365_EXCEL_ITEM_MISSING",
            "Set M365_EXCEL_ITEM_ID before listing worksheets.",
            2,
            {"item_id_present": False},
        )
    payload = _graph_request(
        config,
        "GET",
        f"/users/{parse.quote(config['context']['target_user'])}/drive/items/{parse.quote(item_id)}/workbook/worksheets",
        query={"$select": "id,name"},
    )
    worksheets = payload.get("value", [])
    previews = [_worksheet_preview(worksheet) for worksheet in worksheets if isinstance(worksheet, dict)]
    return {
        "summary": f"Found {len(worksheets)} worksheet(s).",
        "item_id": item_id,
        "count": len(worksheets),
        "worksheets": worksheets,
        "scope_preview": {
            "surface": "excel",
            "kind": "worksheet",
            "mode": "list_worksheets",
            "item_id": item_id,
            "candidates": previews,
        },
    }


def read_excel_used_range(config: dict[str, Any], *, item_id: str | None = None, worksheet: str | None = None) -> dict[str, Any]:
    if not config["runtime"]["target_user_present"]:
        raise ConnectorError("M365_TARGET_USER_MISSING", "Set M365_TARGET_USER before reading workbook ranges.", 2, {})
    item_id = (item_id or config["context"]["excel_item_id"]).strip()
    worksheet = (worksheet or config["context"]["excel_worksheet_name"]).strip()
    if not (item_id and worksheet):
        raise ConnectorError(
            "M365_EXCEL_CONTEXT_MISSING",
            "Set M365_EXCEL_ITEM_ID and M365_EXCEL_WORKSHEET_NAME before reading workbook ranges.",
            2,
            {"item_id_present": bool(item_id), "worksheet_present": bool(worksheet)},
        )
    payload = _graph_request(
        config,
        "GET",
        f"/users/{parse.quote(config['context']['target_user'])}/drive/items/{parse.quote(item_id)}/workbook/worksheets/{parse.quote(worksheet)}/usedRange(valuesOnly=true)",
        query={"$select": "address,columnCount,rowCount,values"},
    )
    values = payload.get("values", [])
    rows = _normalize_rows(values) if isinstance(values, list) else []
    return {
        "summary": f"Loaded used range for {worksheet}.",
        "item_id": item_id,
        "worksheet": worksheet,
        "rows": rows,
        "raw": payload,
        "scope_preview": _used_range_preview(
            item_id=item_id,
            worksheet=worksheet,
            payload=payload,
        ),
    }


def read_excel_rows(
    config: dict[str, Any],
    *,
    item_id: str | None = None,
    worksheet: str | None = None,
    cell_range: str | None = None,
) -> dict[str, Any]:
    item_id = (item_id or config["context"]["excel_item_id"]).strip()
    worksheet = (worksheet or config["context"]["excel_worksheet_name"]).strip()
    cell_range = (cell_range or config["context"]["excel_range"]).strip()
    if not (config["runtime"]["target_user_present"] and item_id and worksheet and cell_range):
        raise ConnectorError(
            "M365_EXCEL_CONTEXT_MISSING",
            "Set M365_TARGET_USER, M365_EXCEL_ITEM_ID, M365_EXCEL_WORKSHEET_NAME, and M365_EXCEL_RANGE before reading Excel rows.",
            2,
            {
                "target_user_present": config["runtime"]["target_user_present"],
                "item_id_present": bool(item_id),
                "worksheet_present": bool(worksheet),
                "range_present": bool(cell_range),
            },
        )
    payload = _graph_request(
        config,
        "GET",
        f"/users/{parse.quote(config['context']['target_user'])}/drive/items/{parse.quote(item_id)}/workbook/worksheets/{parse.quote(worksheet)}/range(address='{parse.quote(cell_range, safe=':')}')",
    )
    values = payload.get("values", [])
    rows = _normalize_rows(values) if isinstance(values, list) else []
    return {
        "summary": f"Loaded Excel range {worksheet}!{cell_range}.",
        "item_id": item_id,
        "worksheet": worksheet,
        "range": cell_range,
        "rows": rows,
        "raw": payload,
        "scope_preview": _workbook_preview(
            item_id=item_id,
            worksheet=worksheet,
            cell_range=cell_range,
            rows=rows,
            raw_values=values if isinstance(values, list) else [],
        ),
    }


def list_team_messages(
    config: dict[str, Any],
    *,
    team_id: str | None = None,
    channel_id: str | None = None,
    limit: int = 25,
) -> dict[str, Any]:
    team_id = (team_id or config["context"]["team_id"]).strip()
    channel_id = (channel_id or config["context"]["channel_id"]).strip()
    if not (team_id and channel_id):
        raise ConnectorError(
            "M365_TEAMS_CONTEXT_MISSING",
            "Set M365_TEAM_ID and M365_CHANNEL_ID before reading Teams messages.",
            2,
            {"team_id_present": bool(team_id), "channel_id_present": bool(channel_id)},
        )
    payload = _graph_request(
        config,
        "GET",
        f"/teams/{parse.quote(team_id)}/channels/{parse.quote(channel_id)}/messages",
        query={"$top": max(1, min(limit, 50)), "$select": "id,subject,bodyPreview,from,createdDateTime,webUrl"},
    )
    messages = payload.get("value", [])
    previews = [_team_message_preview(message) for message in messages if isinstance(message, dict)]
    return {
        "summary": f"Found {len(messages)} message(s).",
        "team_id": team_id,
        "channel_id": channel_id,
        "count": len(messages),
        "messages": messages,
        "scope_preview": {
            "surface": "teams",
            "kind": "channel",
            "mode": "list_messages",
            "team_id": team_id,
            "channel_id": channel_id,
            "candidates": previews,
        },
    }


def send_mail_message(config: dict[str, Any], items: tuple[str, ...]) -> dict[str, Any]:
    parsed = _parse_mail_send_items(config, items)
    response = _graph_request(
        config,
        "POST",
        f"/users/{parse.quote(parsed['mailbox_id'])}/sendMail",
        payload={
            "message": {
                "subject": parsed["subject"],
                "body": _normalize_html_body(parsed["body"]),
                "toRecipients": [_mail_recipient(address) for address in parsed["recipients"]],
            },
            "saveToSentItems": True,
        },
    )
    return {
        "summary": f"Sent mail to {', '.join(parsed['recipients'])}.",
        "mailbox_id": parsed["mailbox_id"],
        "to": parsed["recipients"],
        "subject": parsed["subject"],
        "response": response,
        "scope_preview": {
            "surface": "mail",
            "kind": "mailbox",
            "mode": "send",
            "target_user": parsed["mailbox_id"],
            "recipients": parsed["recipients"],
            "subject": parsed["subject"],
        },
    }


def reply_mail_message(config: dict[str, Any], items: tuple[str, ...]) -> dict[str, Any]:
    parsed = _parse_mail_reply_items(config, items)
    response = _graph_request(
        config,
        "POST",
        f"/users/{parse.quote(parsed['mailbox_id'])}/messages/{parse.quote(parsed['message_id'])}/reply",
        payload={"comment": parsed["comment"]},
    )
    return {
        "summary": f"Queued reply for message {parsed['message_id']}.",
        "mailbox_id": parsed["mailbox_id"],
        "message_id": parsed["message_id"],
        "response": response,
        "scope_preview": {
            "surface": "mail",
            "kind": "mailbox",
            "mode": "reply",
            "target_user": parsed["mailbox_id"],
            "message_id": parsed["message_id"],
        },
    }


def create_calendar_event(config: dict[str, Any], items: tuple[str, ...]) -> dict[str, Any]:
    parsed = _parse_calendar_create_items(config, items)
    path = (
        f"/users/{parse.quote(parsed['target_user'])}/calendars/{parse.quote(parsed['calendar_id'])}/events"
        if parsed["calendar_id"]
        else f"/users/{parse.quote(parsed['target_user'])}/calendar/events"
    )
    payload: dict[str, Any] = {
        "subject": parsed["title"],
        "start": parsed["start"],
        "end": parsed["end"],
    }
    if parsed["body"]:
        payload["body"] = _normalize_html_body(parsed["body"])
    if parsed["location"]:
        payload["location"] = {"displayName": parsed["location"]}
    event = _graph_request(config, "POST", path, payload=payload)
    return {
        "summary": f"Created calendar event {event.get('id') or parsed['title']}.",
        "event": event,
        "scope_preview": {
            "surface": "calendar",
            "kind": "calendar",
            "mode": "create",
            "target_user": parsed["target_user"],
            "calendar_id": parsed["calendar_id"] or None,
            "title": parsed["title"],
            "start": parsed["start"],
            "end": parsed["end"],
        },
    }


def _scaffold_write(command_id: str, items: tuple[str, ...]) -> dict[str, Any]:
    return {
        "command": command_id,
        "implemented": False,
        "mode": "scaffold",
        "items": list(items),
        "limitation": LIMITED_WRITE_COMMANDS.get(command_id),
    }


def scaffold_write_command(command_id: str, items: tuple[str, ...]) -> dict[str, Any]:
    if command_id not in WRITE_COMMAND_IDS:
        raise ConnectorError("UNKNOWN_COMMAND", f"Unknown write command: {command_id}", 2, {})
    if command_id in SUPPORTED_WRITE_COMMAND_IDS:
        raise ConnectorError("INTERNAL_ERROR", f"{command_id} is implemented and should not use the scaffold path.", 2, {})
    return _scaffold_write(command_id, items)


def run_write_command(command_id: str, items: tuple[str, ...]) -> dict[str, Any]:
    config = runtime_config()
    if command_id == "mail.send":
        return send_mail_message(config, items)
    if command_id == "mail.reply":
        return reply_mail_message(config, items)
    if command_id == "calendar.create":
        return create_calendar_event(config, items)
    if command_id in WRITE_COMMAND_IDS:
        raise ConnectorError(
            "NOT_IMPLEMENTED",
            LIMITED_WRITE_COMMANDS.get(command_id) or f"{command_id} is not implemented yet.",
            10,
            _scaffold_write(command_id, items),
        )
    raise ConnectorError("UNKNOWN_COMMAND", f"Unknown write command: {command_id}", 2, {})


def run_read_command(command_id: str, items: tuple[str, ...]) -> dict[str, Any]:
    config = runtime_config()
    if command_id == "teams.list_teams":
        return list_joined_teams(config)
    if command_id == "teams.list_channels":
        return list_team_channels(config, team_id=items[0] if items else None)
    if command_id == "mail.search":
        query = " ".join(items).strip() or None
        return search_mail(config, query=query)
    if command_id == "mail.read":
        if not items:
            raise ConnectorError("ARGUMENT_REQUIRED", "mail.read requires a message id.", 2, {})
        return read_mail_message(config, items[0])
    if command_id == "calendar.list":
        start = items[0] if len(items) >= 1 else None
        end = items[1] if len(items) >= 2 else None
        return list_calendar_events(config, start=start, end=end)
    if command_id == "file.list":
        return list_drive_children(config, path=items[0] if items else None)
    if command_id == "excel.list_workbooks":
        return list_excel_workbooks(config, path=items[0] if items else None)
    if command_id == "excel.list_worksheets":
        return list_excel_worksheets(config, item_id=items[0] if items else None)
    if command_id == "excel.used_range":
        return read_excel_used_range(
            config,
            item_id=items[0] if len(items) >= 1 else None,
            worksheet=items[1] if len(items) >= 2 else None,
        )
    if command_id == "excel.read_rows":
        return read_excel_rows(
            config,
            item_id=items[0] if len(items) >= 1 else None,
            worksheet=items[1] if len(items) >= 2 else None,
            cell_range=items[2] if len(items) >= 3 else None,
        )
    if command_id == "teams.list_messages":
        return list_team_messages(
            config,
            team_id=items[0] if len(items) >= 1 else None,
            channel_id=items[1] if len(items) >= 2 else None,
        )
    raise ConnectorError("UNKNOWN_COMMAND", f"Unknown read command: {command_id}", 2, {})
