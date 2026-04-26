from __future__ import annotations

from datetime import datetime, timedelta, timezone
import json
from typing import Any

from .client import GraphApiError, TeamsClient
from .config import config_snapshot, runtime_config
from .constants import BACKEND_NAME, CONNECTOR_AUTH, CONNECTOR_CATEGORY, CONNECTOR_CATEGORIES, CONNECTOR_LABEL, CONNECTOR_PATH, CONNECTOR_RESOURCES, MANIFEST_SCHEMA_VERSION, PERMISSIONS_PATH, TOOL_NAME
from .errors import CliError
from .service_keys import service_key_env

SUPPORTED_READ_COMMANDS = ("team.list", "channel.list", "meeting.list")
SUPPORTED_WRITE_COMMANDS = ("channel.create", "meeting.create")


def _load_manifest() -> dict[str, Any]:
    return json.loads(CONNECTOR_PATH.read_text())


def _scope_preview(command_id: str, resource: str, extra: dict[str, Any] | None = None) -> dict[str, Any]:
    payload = {"selection_surface": resource, "command_id": command_id, "backend": BACKEND_NAME}
    if extra:
        payload.update(extra)
    return payload


def _picker(items: list[dict[str, Any]], *, kind: str) -> dict[str, Any]:
    return {"kind": kind, "items": items, "count": len(items)}


def _require_arg(value: str | None, *, code: str, message: str, detail_key: str, detail_value: str) -> str:
    resolved = (value or "").strip()
    if resolved:
        return resolved
    raise CliError(code=code, message=message, exit_code=4, details={detail_key: detail_value})


def _parse_json_argument(raw: str, *, code: str, message: str) -> Any:
    try:
        return json.loads(raw)
    except json.JSONDecodeError as exc:
        raise CliError(code=code, message=message, exit_code=4, details={"raw": raw[:500]}) from exc


def _parse_datetime_input(value: str, *, field_name: str) -> datetime:
    normalized = value.strip()
    if not normalized:
        raise CliError(code="INVALID_ARGUMENT", message=f"{field_name} is required", exit_code=4, details={})
    if normalized.endswith("Z"):
        normalized = f"{normalized[:-1]}+00:00"
    try:
        parsed = datetime.fromisoformat(normalized)
    except ValueError as exc:
        raise CliError(
            code="INVALID_ARGUMENT",
            message=f"{field_name} must be a valid ISO 8601 datetime",
            exit_code=4,
            details={"field": field_name, "value": value},
        ) from exc
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=timezone.utc)
    return parsed.astimezone(timezone.utc)


def _normalize_meeting_times(start_time: str, end_time: str | None) -> tuple[str, str]:
    start_dt = _parse_datetime_input(start_time, field_name="start_time")
    end_dt = _parse_datetime_input(end_time, field_name="end_time") if end_time else start_dt + timedelta(minutes=30)
    if end_dt <= start_dt:
        raise CliError(code="INVALID_ARGUMENT", message="end_time must be later than start_time", exit_code=4, details={})
    return (
        start_dt.isoformat(timespec="seconds").replace("+00:00", "Z"),
        end_dt.isoformat(timespec="seconds").replace("+00:00", "Z"),
    )


def capabilities_snapshot() -> dict[str, Any]:
    manifest = _load_manifest()
    config = runtime_config()
    return {
        "tool": manifest["tool"],
        "backend": manifest["backend"],
        "manifest_schema_version": manifest.get("manifest_schema_version", "1.0.0"),
        "connector": manifest["connector"],
        "auth": manifest["auth"],
        "scope": manifest.get("scope", {}),
        "commands": manifest["commands"],
        "read_support": config["read_support"],
        "write_support": config["write_support"],
    }


def create_client(ctx_obj: dict[str, Any] | None = None) -> TeamsClient:
    config = runtime_config()
    auth = config["auth"]
    runtime = config["runtime"]
    if auth["missing_keys"]:
        raise CliError(
            code="TEAMS_SETUP_REQUIRED",
            message="Microsoft Teams connector is missing required credentials",
            exit_code=4,
            details={"missing_keys": auth["missing_keys"]},
        )
    return TeamsClient(
        tenant_id=service_key_env("TEAMS_TENANT_ID", "") or "",
        client_id=service_key_env("TEAMS_CLIENT_ID", "") or "",
        client_secret=service_key_env("TEAMS_CLIENT_SECRET", "") or "",
        graph_base_url=runtime["graph_base_url"],
        token_url=runtime["token_url"] or None,
        timeout_seconds=runtime["timeout_seconds"],
    )


def probe_runtime(ctx_obj: dict[str, Any] | None = None) -> dict[str, Any]:
    config = runtime_config()
    auth = config["auth"]
    if auth["missing_keys"]:
        return {
            "ok": False,
            "code": "TEAMS_SETUP_REQUIRED",
            "message": "Microsoft Teams connector is missing required credentials",
            "details": {"missing_keys": auth["missing_keys"], "live_backend_available": False},
        }
    try:
        client = create_client(ctx_obj)
        teams = client.list_teams(limit=1)
    except CliError as err:
        return {"ok": False, "code": err.code, "message": err.message, "details": err.details}
    except GraphApiError as err:
        code = "TEAMS_AUTH_ERROR" if err.status_code in {401, 403} else "TEAMS_API_ERROR"
        return {
            "ok": False,
            "code": code,
            "message": err.message,
            "details": {**(err.details or {}), "status_code": err.status_code, "live_backend_available": False},
        }
    return {
        "ok": True,
        "code": "OK",
        "message": "Microsoft Teams live runtime is ready",
        "details": {"live_backend_available": True, "team_count": teams["count"], "sample_team": teams["items"][:1]},
    }


def health_snapshot(ctx_obj: dict[str, Any] | None = None) -> dict[str, Any]:
    config = runtime_config()
    probe = probe_runtime(ctx_obj)
    status = "ready" if probe["ok"] else ("needs_setup" if probe["code"] == "TEAMS_SETUP_REQUIRED" else "degraded")
    runtime = config["runtime"]
    checks = [
        {"name": "service_keys", "ok": not config["auth"]["missing_keys"], "details": {"missing_keys": config["auth"]["missing_keys"]}},
        {"name": "live_backend", "ok": bool(probe.get("ok")), "details": probe.get("details", {})},
        {"name": "team_surface", "ok": runtime["team_ready"], "details": {"ready": runtime["team_ready"]}},
        {"name": "channel_surface", "ok": runtime["channel_ready"], "details": {"ready": runtime["channel_ready"]}},
        {"name": "meeting_surface", "ok": runtime["meeting_ready"], "details": {"ready": runtime["meeting_ready"]}},
    ]
    next_steps = [
        f"Set {key} in API Keys." for key in config["auth"]["missing_keys"]
    ]
    if not runtime["channel_ready"]:
        next_steps.append("Set TEAMS_TEAM_ID before using channel.list.")
    if not runtime["meeting_ready"]:
        next_steps.append("Set TEAMS_USER_ID before using meeting.list.")
    return {
        "status": status,
        "summary": probe["message"],
        "connector": {
            "label": CONNECTOR_LABEL,
            "category": CONNECTOR_CATEGORY,
            "categories": CONNECTOR_CATEGORIES,
            "resources": CONNECTOR_RESOURCES,
            "backend": BACKEND_NAME,
            "live_backend_available": bool(probe.get("ok")),
            "live_read_available": bool(probe.get("ok")),
            "write_bridge_available": True,
            "scaffold_only": False,
        },
        "auth": config["auth"],
        "scope": config["scope"],
        "runtime": runtime,
        "read_support": config["read_support"],
        "write_support": config["write_support"],
        "checks": checks,
        "runtime_ready": bool(probe.get("ok")),
        "probe": probe,
        "next_steps": next_steps,
    }


def doctor_snapshot(ctx_obj: dict[str, Any] | None = None) -> dict[str, Any]:
    snapshot = health_snapshot(ctx_obj)
    recommendations = [
        "Use readonly mode for live team/channel/meeting discovery and write mode only for channel.create or meeting.create.",
        "meeting.create requires OnlineMeetings.ReadWrite.All plus an application access policy granted to the scoped TEAMS_USER_ID user.",
    ]
    if snapshot["status"] == "needs_setup":
        recommendations.insert(0, "Set the Teams auth service keys before assigning this connector.")
    if not snapshot["runtime"]["channel_ready"]:
        recommendations.append("Set TEAMS_TEAM_ID before using the channel surface.")
    if not snapshot["runtime"]["meeting_ready"]:
        recommendations.append("Set TEAMS_USER_ID before using the meeting surface.")
    return {
        **snapshot,
        "backend": BACKEND_NAME,
        "runtime_ready": snapshot["status"] == "ready",
        "recommendations": recommendations,
        "config": config_snapshot(),
        "supported_read_commands": list(SUPPORTED_READ_COMMANDS),
        "supported_write_commands": list(SUPPORTED_WRITE_COMMANDS),
        "command_readiness": dict(snapshot["runtime"]["command_readiness"]),
    }


def team_list_result(ctx_obj: dict[str, Any], *, limit: int) -> dict[str, Any]:
    client = create_client(ctx_obj)
    listing = client.list_teams(limit=limit)
    teams = listing["items"]
    picker_items = [{"value": item["id"], "label": item["label"], "subtitle": item.get("subtitle"), "selected": False} for item in teams]
    return {
        "status": "live_read",
        "backend": BACKEND_NAME,
        "summary": f"Listed {len(teams)} team(s).",
        "teams": teams,
        "picker_options": picker_items,
        "scope_preview": _scope_preview("team.list", "team", {"candidate_count": len(teams), "picker": _picker(picker_items, kind="team")}),
    }


def channel_list_result(ctx_obj: dict[str, Any], *, team_id: str | None, limit: int) -> dict[str, Any]:
    runtime = runtime_config()
    resolved_team_id = team_id or runtime["runtime"]["team_id"]
    resolved_team_id = _require_arg(
        resolved_team_id,
        code="TEAMS_TEAM_ID_REQUIRED",
        message="team_id is required",
        detail_key="env",
        detail_value="TEAMS_TEAM_ID",
    )
    client = create_client(ctx_obj)
    listing = client.list_channels(team_id=resolved_team_id, limit=limit)
    channels = listing["items"]
    picker_items = [{"value": item["id"], "label": item["label"], "subtitle": item.get("subtitle"), "selected": False} for item in channels]
    return {
        "status": "live_read",
        "backend": BACKEND_NAME,
        "summary": f"Listed {len(channels)} channel(s).",
        "channels": channels,
        "picker_options": picker_items,
        "scope_preview": _scope_preview("channel.list", "channel", {"team_id": resolved_team_id, "candidate_count": len(channels), "picker": _picker(picker_items, kind="channel")}),
    }


def meeting_list_result(ctx_obj: dict[str, Any], *, user_id: str | None, limit: int) -> dict[str, Any]:
    runtime = runtime_config()
    resolved_user_id = user_id or runtime["runtime"]["user_id"]
    resolved_user_id = _require_arg(
        resolved_user_id,
        code="TEAMS_USER_ID_REQUIRED",
        message="user_id is required",
        detail_key="env",
        detail_value="TEAMS_USER_ID",
    )
    client = create_client(ctx_obj)
    listing = client.list_meetings(user_id=resolved_user_id, limit=limit)
    meetings = listing["items"]
    picker_items = [{"value": item["id"], "label": item["label"], "subtitle": item.get("subtitle"), "selected": False} for item in meetings]
    return {
        "status": "live_read",
        "backend": BACKEND_NAME,
        "summary": f"Listed {len(meetings)} meeting(s).",
        "meetings": meetings,
        "picker_options": picker_items,
        "scope_preview": _scope_preview("meeting.list", "meeting", {"user_id": resolved_user_id, "candidate_count": len(meetings), "picker": _picker(picker_items, kind="meeting")}),
    }


def _parse_channel_create_items(items: tuple[str, ...], runtime: dict[str, Any]) -> dict[str, str]:
    if len(items) == 1 and items[0].lstrip().startswith("{"):
        payload = _parse_json_argument(
            items[0],
            code="INVALID_ARGUMENT",
            message="channel.create expected a JSON object.",
        )
        if not isinstance(payload, dict):
            raise CliError(code="INVALID_ARGUMENT", message="channel.create JSON input must be an object", exit_code=4, details={})
        team_id = str(payload.get("team_id") or runtime["runtime"]["team_id"] or "").strip()
        display_name = str(payload.get("display_name") or payload.get("channel_name") or "").strip()
        description = str(payload.get("description") or payload.get("channel_description") or "").strip()
    else:
        default_team_id = str(runtime["runtime"]["team_id"] or "").strip()
        if len(items) == 1 and default_team_id:
            team_id = default_team_id
            display_name = items[0].strip()
            description = ""
        elif len(items) >= 2:
            team_id = items[0].strip()
            display_name = items[1].strip()
            description = " ".join(items[2:]).strip()
        else:
            raise CliError(
                code="ARGUMENT_REQUIRED",
                message="channel.create requires <team_id> <display_name> [description] or a single JSON object argument",
                exit_code=4,
                details={},
            )
    if not team_id or not display_name:
        raise CliError(code="ARGUMENT_REQUIRED", message="channel.create requires team_id and display_name", exit_code=4, details={})
    return {"team_id": team_id, "display_name": display_name, "description": description}


def _parse_meeting_create_items(items: tuple[str, ...], runtime: dict[str, Any]) -> dict[str, str]:
    if len(items) == 1 and items[0].lstrip().startswith("{"):
        payload = _parse_json_argument(
            items[0],
            code="INVALID_ARGUMENT",
            message="meeting.create expected a JSON object.",
        )
        if not isinstance(payload, dict):
            raise CliError(code="INVALID_ARGUMENT", message="meeting.create JSON input must be an object", exit_code=4, details={})
        user_id = str(payload.get("user_id") or runtime["runtime"]["user_id"] or "").strip()
        subject = str(payload.get("subject") or payload.get("meeting_subject") or "").strip()
        start_time = str(payload.get("start_time") or runtime["runtime"]["start_time"] or "").strip()
        end_time = str(payload.get("end_time") or runtime["runtime"]["end_time"] or "").strip()
    else:
        user_id = (runtime["runtime"]["user_id"] or "").strip()
        if len(items) < 2:
            raise CliError(
                code="ARGUMENT_REQUIRED",
                message="meeting.create requires <subject> <start_time> [end_time] or a single JSON object argument",
                exit_code=4,
                details={},
            )
        subject = items[0].strip()
        start_time = items[1].strip()
        end_time = items[2].strip() if len(items) >= 3 else ""
    if not user_id:
        raise CliError(code="TEAMS_USER_ID_REQUIRED", message="user_id is required", exit_code=4, details={"env": "TEAMS_USER_ID"})
    if not subject or not start_time:
        raise CliError(code="ARGUMENT_REQUIRED", message="meeting.create requires subject and start_time", exit_code=4, details={})
    normalized_start, normalized_end = _normalize_meeting_times(start_time, end_time or None)
    return {"user_id": user_id, "subject": subject, "start_time": normalized_start, "end_time": normalized_end}


def channel_create_result(ctx_obj: dict[str, Any], *, items: tuple[str, ...]) -> dict[str, Any]:
    runtime = runtime_config()
    parsed = _parse_channel_create_items(items, runtime)
    client = create_client(ctx_obj)
    channel = client.create_channel(
        team_id=parsed["team_id"],
        display_name=parsed["display_name"],
        description=parsed["description"] or None,
    )
    return {
        "status": "live_write",
        "backend": BACKEND_NAME,
        "summary": f"Created channel {channel.get('displayName') or parsed['display_name']}.",
        "channel": channel,
        "scope_preview": _scope_preview(
            "channel.create",
            "channel",
            {"team_id": parsed["team_id"], "display_name": parsed["display_name"]},
        ),
    }


def meeting_create_result(ctx_obj: dict[str, Any], *, items: tuple[str, ...]) -> dict[str, Any]:
    runtime = runtime_config()
    parsed = _parse_meeting_create_items(items, runtime)
    client = create_client(ctx_obj)
    meeting = client.create_online_meeting(
        user_id=parsed["user_id"],
        subject=parsed["subject"],
        start_iso=parsed["start_time"],
        end_iso=parsed["end_time"],
    )
    return {
        "status": "live_write",
        "backend": BACKEND_NAME,
        "summary": f"Created online meeting {meeting.get('id') or parsed['subject']}.",
        "meeting": meeting,
        "scope_preview": _scope_preview(
            "meeting.create",
            "meeting",
            {
                "user_id": parsed["user_id"],
                "subject": parsed["subject"],
                "start_time": parsed["start_time"],
                "end_time": parsed["end_time"],
            },
        ),
    }


def run_write_command(ctx_obj: dict[str, Any], command_id: str, items: tuple[str, ...]) -> dict[str, Any]:
    if command_id == "channel.create":
        return channel_create_result(ctx_obj, items=items)
    if command_id == "meeting.create":
        return meeting_create_result(ctx_obj, items=items)
    raise CliError(code="UNKNOWN_COMMAND", message=f"Unknown command: {command_id}", exit_code=2, details={})
