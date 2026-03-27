from __future__ import annotations

import json
import os
from typing import Any

from .client import GraphApiError, TeamsClient
from .config import config_snapshot, runtime_config
from .constants import BACKEND_NAME, CONNECTOR_AUTH, CONNECTOR_CATEGORY, CONNECTOR_CATEGORIES, CONNECTOR_LABEL, CONNECTOR_PATH, CONNECTOR_RESOURCES, MANIFEST_SCHEMA_VERSION, PERMISSIONS_PATH, TOOL_NAME
from .errors import CliError


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


def capabilities_snapshot() -> dict[str, Any]:
    manifest = _load_manifest()
    read_support: dict[str, bool] = {}
    write_support: dict[str, bool] = {}
    for command in manifest["commands"]:
        target = read_support if command["required_mode"] == "readonly" else write_support
        target[command["id"]] = True
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
        tenant_id=os.getenv("TEAMS_TENANT_ID", ""),
        client_id=os.getenv("TEAMS_CLIENT_ID", ""),
        client_secret=os.getenv("TEAMS_CLIENT_SECRET", ""),
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
            "write_bridge_available": False,
            "scaffold_only": True,
        },
        "auth": config["auth"],
        "runtime": runtime,
        "checks": checks,
        "runtime_ready": bool(probe.get("ok")),
        "probe": probe,
        "next_steps": next_steps,
    }


def doctor_snapshot(ctx_obj: dict[str, Any] | None = None) -> dict[str, Any]:
    snapshot = health_snapshot(ctx_obj)
    recommendations = [
        "Keep write commands scaffolded until a real Graph mutation bridge exists.",
        "Use readonly mode for live Teams reads.",
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
        "supported_read_commands": ["team.list", "channel.list", "meeting.list"],
        "supported_write_commands": [
            "message.send",
            "message.reply",
            "channel.create",
            "chat.send",
            "meeting.create",
            "file.upload",
            "adaptive_card.send",
        ],
        "command_readiness": {
            "team.list": snapshot["runtime"]["team_ready"],
            "channel.list": snapshot["runtime"]["channel_ready"],
            "meeting.list": snapshot["runtime"]["meeting_ready"],
            "message.send": False,
            "message.reply": False,
            "channel.create": False,
            "chat.send": False,
            "meeting.create": False,
            "file.upload": False,
            "adaptive_card.send": False,
        },
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


def scaffold_write_command(command_id: str, items: tuple[str, ...]) -> dict[str, Any]:
    return {
        "command_id": command_id,
        "arguments": list(items),
        "scaffold_only": True,
        "backend": BACKEND_NAME,
        "available": False,
    }
