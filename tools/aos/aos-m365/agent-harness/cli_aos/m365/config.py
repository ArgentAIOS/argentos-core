from __future__ import annotations

import os
from typing import Any

from . import __version__
from .constants import CONNECTOR_AUTH, CONNECTOR_CATEGORY, CONNECTOR_CATEGORIES, CONNECTOR_LABEL, CONNECTOR_RESOURCES, TOOL_NAME
from .service_keys import resolve_service_key, service_key_env

REQUIRED_AUTH_KEYS = ["M365_TENANT_ID", "M365_CLIENT_ID", "M365_CLIENT_SECRET"]


def _env(name: str) -> str:
    return os.getenv(name, "").strip()


def _redact(value: str | None, *, keep: int = 4) -> str:
    if not value:
        return ""
    if len(value) <= keep:
        return "*" * len(value)
    return f"{value[:2]}...{value[-keep:]}"


def _parse_float(value: str | None, default: float) -> float:
    if not value:
        return default
    try:
        parsed = float(value)
    except ValueError:
        return default
    return parsed if parsed > 0 else default


def _picker_candidate(
    *,
    value: str | None,
    label: str,
    subtitle: str | None = None,
    selected: bool = False,
    kind: str | None = None,
) -> dict[str, Any]:
    candidate: dict[str, Any] = {
        "value": value,
        "label": label,
        "selected": selected,
    }
    if subtitle:
        candidate["subtitle"] = subtitle
    if kind:
        candidate["kind"] = kind
    return candidate


def _picker_source(
    *,
    command: str,
    resource: str,
    available: bool,
    kind: str,
    selected: dict[str, Any] | None = None,
    parent: dict[str, Any] | None = None,
) -> dict[str, Any]:
    picker: dict[str, Any] = {
        "mode": "live_read",
        "command": command,
        "resource": resource,
        "available": available,
        "kind": kind,
    }
    if selected is not None:
        picker["selected"] = selected
    if parent is not None:
        picker["parent"] = parent
    return picker


def _scope_picker_preview(
    *,
    surface: str,
    kind: str,
    ready: bool,
    requirements: list[str],
    candidates: list[dict[str, Any]],
    selected: dict[str, Any],
    pickers: dict[str, dict[str, Any]],
) -> dict[str, Any]:
    return {
        "surface": surface,
        "kind": kind,
        "ready": ready,
        "requirements": requirements,
        "mode": "live_read",
        "pickers": pickers,
        "candidates": candidates,
        "selected": selected,
    }


def runtime_config() -> dict[str, Any]:
    env_values = {key: (service_key_env(key, "") or "").strip() for key in REQUIRED_AUTH_KEYS}
    configured = {key: bool(value) for key, value in env_values.items()}
    missing_keys = [key for key, present in configured.items() if not present]
    auth_sources = {
        key: (
            "service-keys"
            if resolve_service_key(key)
            else "process.env"
            if _env(key)
            else None
        )
        for key in REQUIRED_AUTH_KEYS
    }

    tenant_id = env_values["M365_TENANT_ID"]
    target_user = _env("M365_TARGET_USER")
    team_id = _env("M365_TEAM_ID")
    channel_id = _env("M365_CHANNEL_ID")
    excel_item_id = _env("M365_EXCEL_ITEM_ID")
    excel_worksheet = _env("M365_EXCEL_WORKSHEET_NAME")
    excel_range = _env("M365_EXCEL_RANGE")
    graph_base_url = _env("M365_GRAPH_BASE_URL") or "https://graph.microsoft.com/v1.0"
    token_url = _env("M365_TOKEN_URL") or (
        f"https://login.microsoftonline.com/{tenant_id}/oauth2/v2.0/token" if tenant_id else ""
    )
    timeout_seconds = _parse_float(_env("M365_HTTP_TIMEOUT_SECONDS"), 20.0)

    auth_ready = not missing_keys
    mailbox_ready = auth_ready and bool(target_user)
    teams_ready = auth_ready and bool(team_id and channel_id)
    excel_ready = auth_ready and bool(target_user and excel_item_id and excel_worksheet and excel_range)

    scope_pickers = {
        "teams": _scope_picker_preview(
            surface="teams",
            kind="channel_scope",
            ready=teams_ready,
            requirements=["M365_TENANT_ID", "M365_CLIENT_ID", "M365_CLIENT_SECRET", "M365_TARGET_USER", "M365_TEAM_ID", "M365_CHANNEL_ID"],
            pickers={
                "team": _picker_source(
                    command="teams.list_teams",
                    resource="teams",
                    available=auth_ready and bool(target_user),
                    kind="team",
                    selected={"team_id": team_id or None},
                ),
                "channel": _picker_source(
                    command="teams.list_channels",
                    resource="teams",
                    available=auth_ready and bool(team_id),
                    kind="channel",
                    selected={"team_id": team_id or None, "channel_id": channel_id or None},
                    parent={"team_id": team_id or None},
                ),
            },
            candidates=[
                _picker_candidate(
                    value=team_id or None,
                    label=team_id or "(unset team)",
                    subtitle="team id",
                    selected=bool(team_id),
                    kind="team",
                ),
                _picker_candidate(
                    value=channel_id or None,
                    label=channel_id or "(unset channel)",
                    subtitle="channel id",
                    selected=bool(channel_id),
                    kind="channel",
                ),
            ],
            selected={"team_id": team_id or None, "channel_id": channel_id or None},
        ),
        "workbook": _scope_picker_preview(
            surface="excel",
            kind="workbook_scope",
            ready=excel_ready,
            requirements=[
                "M365_TENANT_ID",
                "M365_CLIENT_ID",
                "M365_CLIENT_SECRET",
                "M365_TARGET_USER",
                "M365_EXCEL_ITEM_ID",
                "M365_EXCEL_WORKSHEET_NAME",
                "M365_EXCEL_RANGE",
            ],
            pickers={
                "workbook": _picker_source(
                    command="excel.list_workbooks",
                    resource="file",
                    available=auth_ready and bool(target_user),
                    kind="workbook",
                    selected={"item_id": excel_item_id or None},
                ),
                "worksheet": _picker_source(
                    command="excel.list_worksheets",
                    resource="excel",
                    available=auth_ready and bool(excel_item_id),
                    kind="worksheet",
                    selected={"item_id": excel_item_id or None, "worksheet": excel_worksheet or None},
                    parent={"item_id": excel_item_id or None},
                ),
                "range": _picker_source(
                    command="excel.used_range",
                    resource="excel",
                    available=auth_ready and bool(excel_item_id and excel_worksheet),
                    kind="range",
                    selected={
                        "item_id": excel_item_id or None,
                        "worksheet": excel_worksheet or None,
                        "range": excel_range or None,
                    },
                    parent={"item_id": excel_item_id or None, "worksheet": excel_worksheet or None},
                ),
            },
            candidates=[
                _picker_candidate(
                    value=excel_item_id or None,
                    label=excel_item_id or "(unset workbook item)",
                    subtitle="workbook item id",
                    selected=bool(excel_item_id),
                    kind="workbook",
                ),
                _picker_candidate(
                    value=excel_worksheet or None,
                    label=excel_worksheet or "(unset worksheet)",
                    subtitle="worksheet name",
                    selected=bool(excel_worksheet),
                    kind="worksheet",
                ),
                _picker_candidate(
                    value=excel_range or None,
                    label=excel_range or "(unset range)",
                    subtitle="cell range",
                    selected=bool(excel_range),
                    kind="range",
                ),
            ],
            selected={
                "target_user": target_user or None,
                "item_id": excel_item_id or None,
                "worksheet": excel_worksheet or None,
                "range": excel_range or None,
            },
        ),
    }

    return {
        "tool": TOOL_NAME,
        "version": __version__,
        "backend": "microsoft-graph",
        "label": CONNECTOR_LABEL,
        "category": CONNECTOR_CATEGORY,
        "categories": CONNECTOR_CATEGORIES,
        "resources": CONNECTOR_RESOURCES,
        "auth": {
            "kind": CONNECTOR_AUTH["kind"],
            "required": CONNECTOR_AUTH["required"],
            "service_keys": list(CONNECTOR_AUTH["service_keys"]),
            "operator_service_keys": list(CONNECTOR_AUTH["service_keys"]),
            "configured": configured,
            "missing_keys": missing_keys,
            "sources": auth_sources,
            "redacted": {
                "M365_TENANT_ID": _redact(tenant_id),
                "M365_CLIENT_ID": _redact(env_values["M365_CLIENT_ID"]),
                "M365_CLIENT_SECRET": _redact(env_values["M365_CLIENT_SECRET"]),
            },
            "interactive_setup": list(CONNECTOR_AUTH["interactive_setup"]),
        },
        "runtime": {
            "graph_base_url": graph_base_url.rstrip("/"),
            "token_url": token_url,
            "timeout_seconds": timeout_seconds,
            "target_user": target_user,
            "target_user_present": bool(target_user),
            "team_id_present": bool(team_id),
            "channel_id_present": bool(channel_id),
            "excel_item_id_present": bool(excel_item_id),
            "excel_worksheet_present": bool(excel_worksheet),
            "excel_range_present": bool(excel_range),
            "mail_ready": mailbox_ready,
            "calendar_ready": mailbox_ready,
            "file_ready": mailbox_ready,
            "teams_ready": teams_ready,
            "excel_ready": excel_ready,
            "picker_scopes": scope_pickers,
        },
        "context": {
            "target_user": target_user,
            "team_id": team_id,
            "channel_id": channel_id,
            "excel_item_id": excel_item_id,
            "excel_worksheet_name": excel_worksheet,
            "excel_range": excel_range,
        },
    }


def redacted_config_snapshot() -> dict[str, Any]:
    config = runtime_config()
    return {
        "tool": config["tool"],
        "version": config["version"],
        "backend": config["backend"],
        "label": config["label"],
        "category": config["category"],
        "categories": config["categories"],
        "resources": config["resources"],
        "auth": config["auth"],
        "runtime": config["runtime"],
        "context": {
            "target_user_present": bool(config["context"]["target_user"]),
            "team_id_present": bool(config["context"]["team_id"]),
            "channel_id_present": bool(config["context"]["channel_id"]),
            "excel_item_id_present": bool(config["context"]["excel_item_id"]),
            "excel_worksheet_present": bool(config["context"]["excel_worksheet_name"]),
            "excel_range_present": bool(config["context"]["excel_range"]),
            "picker_scopes": config["runtime"]["picker_scopes"],
        },
    }
