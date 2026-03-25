from __future__ import annotations

import json
from datetime import datetime, timedelta, timezone
from typing import Any
from urllib import error, parse, request

from . import __version__
from .config import redacted_config_snapshot, runtime_config
from .constants import CONNECTOR_CATEGORY, CONNECTOR_CATEGORIES, CONNECTOR_LABEL, CONNECTOR_RESOURCES, TOOL_NAME, WRITE_COMMAND_IDS
from .errors import ConnectorError

GRAPH_SCOPE = "https://graph.microsoft.com/.default"


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
    import os

    return os.getenv(name, "").strip()


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
        "writes": False,
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
        "Keep write actions disabled until the connector implements actual Graph mutation paths.",
        "Use readonly mode for live reads; write commands remain scaffolded.",
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


def _scaffold_write(command_id: str, items: tuple[str, ...]) -> dict[str, Any]:
    return {
        "command": command_id,
        "implemented": False,
        "mode": "scaffold",
        "items": list(items),
    }


def scaffold_write_command(command_id: str, items: tuple[str, ...]) -> dict[str, Any]:
    if command_id not in WRITE_COMMAND_IDS:
        raise ConnectorError("UNKNOWN_COMMAND", f"Unknown write command: {command_id}", 2, {})
    return _scaffold_write(command_id, items)


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
