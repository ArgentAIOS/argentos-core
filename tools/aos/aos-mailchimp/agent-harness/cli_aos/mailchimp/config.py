from __future__ import annotations

import re
from typing import Any

from .constants import (
    BACKEND_NAME,
    MAILCHIMP_API_KEY_ENV,
    MAILCHIMP_AUDIENCE_ID_ENV,
    MAILCHIMP_CAMPAIGN_ID_ENV,
    MAILCHIMP_MEMBER_EMAIL_ENV,
    MAILCHIMP_SERVER_PREFIX_ENV,
)
from .service_keys import SERVICE_KEY_VARIABLES, service_key_env, service_key_source


def _mask(value: str | None) -> str | None:
    if not value:
        return None
    if len(value) <= 8:
        return "*" * len(value)
    return f"{value[:4]}***{value[-4:]}"


def _infer_server_prefix(api_key: str) -> str:
    if "-" not in api_key:
        return ""
    suffix = api_key.rsplit("-", 1)[-1].strip()
    return suffix.lower() if re.fullmatch(r"[a-z]{2,}[0-9]+", suffix.lower()) else ""


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


def resolve_runtime_values(ctx_obj: dict[str, Any]) -> dict[str, Any]:
    api_key_env = ctx_obj.get("api_key_env") or MAILCHIMP_API_KEY_ENV
    server_prefix_env = ctx_obj.get("server_prefix_env") or MAILCHIMP_SERVER_PREFIX_ENV
    audience_env = ctx_obj.get("audience_env") or MAILCHIMP_AUDIENCE_ID_ENV
    campaign_env = ctx_obj.get("campaign_env") or MAILCHIMP_CAMPAIGN_ID_ENV
    member_email_env = ctx_obj.get("member_email_env") or MAILCHIMP_MEMBER_EMAIL_ENV

    api_key = (service_key_env(api_key_env, "") or "").strip()
    configured_server_prefix = (service_key_env(server_prefix_env, "") or "").strip()
    server_prefix = configured_server_prefix or _infer_server_prefix(api_key)
    audience_id = (service_key_env(audience_env, "") or "").strip()
    campaign_id = (service_key_env(campaign_env, "") or "").strip()
    member_email = (service_key_env(member_email_env, "") or "").strip()

    return {
        "backend": BACKEND_NAME,
        "api_key_env": api_key_env,
        "server_prefix_env": server_prefix_env,
        "configured_server_prefix": configured_server_prefix,
        "audience_env": audience_env,
        "campaign_env": campaign_env,
        "member_email_env": member_email_env,
        "api_key": api_key,
        "server_prefix": server_prefix,
        "audience_id": audience_id,
        "campaign_id": campaign_id,
        "member_email": member_email,
        "api_key_present": bool(api_key),
        "server_prefix_present": bool(server_prefix),
        "audience_id_present": bool(audience_id),
        "campaign_id_present": bool(campaign_id),
        "member_email_present": bool(member_email),
        "service_keys": sorted(SERVICE_KEY_VARIABLES),
        "sources": {key: service_key_source(key) for key in sorted(SERVICE_KEY_VARIABLES)},
    }


def config_snapshot(ctx_obj: dict[str, Any]) -> dict[str, Any]:
    runtime = resolve_runtime_values(ctx_obj)
    live_ready = runtime["api_key_present"] and runtime["server_prefix_present"]
    command_defaults = {
        "account.read": {
            "selection_surface": "account",
        },
        "audience.list": {
            "selection_surface": "audience",
            "limit": 10,
        },
        "audience.read": {
            "selection_surface": "audience",
            "args": [runtime["audience_id"] or runtime["audience_env"]],
        },
        "member.list": {
            "selection_surface": "member",
            "limit": 10,
            "args": [runtime["audience_id"] or runtime["audience_env"]],
        },
        "member.read": {
            "selection_surface": "member",
            "args": [
                runtime["audience_id"] or runtime["audience_env"],
                runtime["member_email"] or runtime["member_email_env"],
            ],
        },
        "campaign.list": {
            "selection_surface": "campaign",
            "limit": 10,
        },
        "campaign.read": {
            "selection_surface": "campaign",
            "args": [runtime["campaign_id"] or runtime["campaign_env"]],
        },
        "report.list": {
            "selection_surface": "campaign",
            "limit": 10,
        },
        "report.read": {
            "selection_surface": "campaign",
            "args": [runtime["campaign_id"] or runtime["campaign_env"]],
        },
    }
    picker_scopes = {
        "account": _scope_picker_preview(
            surface="account",
            kind="account_scope",
            ready=live_ready,
            requirements=[runtime["api_key_env"], runtime["server_prefix_env"]],
            pickers={
                "account": _picker_source(
                    command="account.read",
                    resource="connector",
                    available=live_ready,
                    kind="account",
                    selected={
                        "server_prefix": runtime["server_prefix"] or None,
                    },
                ),
            },
            candidates=[
                _picker_candidate(
                    value=runtime["server_prefix"] or None,
                    label=runtime["server_prefix"] or "(unset server prefix)",
                    subtitle="Mailchimp server prefix",
                    selected=bool(runtime["server_prefix"]),
                    kind="account",
                ),
            ],
            selected={
                "server_prefix": runtime["server_prefix"] or None,
            },
        ),
        "audience": _scope_picker_preview(
            surface="audience",
            kind="audience_scope",
            ready=live_ready,
            requirements=[runtime["api_key_env"], runtime["server_prefix_env"]],
            pickers={
                "audience": _picker_source(
                    command="audience.list",
                    resource="audience",
                    available=live_ready,
                    kind="audience",
                    selected={
                        "audience_id": runtime["audience_id"] or None,
                    },
                ),
            },
            candidates=[
                _picker_candidate(
                    value=runtime["audience_id"] or None,
                    label=runtime["audience_id"] or "(unset audience)",
                    subtitle="Audience ID",
                    selected=bool(runtime["audience_id"]),
                    kind="audience",
                ),
            ],
            selected={
                "audience_id": runtime["audience_id"] or None,
            },
        ),
        "campaign": _scope_picker_preview(
            surface="campaign",
            kind="campaign_scope",
            ready=live_ready,
            requirements=[runtime["api_key_env"], runtime["server_prefix_env"]],
            pickers={
                "campaign": _picker_source(
                    command="campaign.list",
                    resource="campaign",
                    available=live_ready,
                    kind="campaign",
                    selected={
                        "campaign_id": runtime["campaign_id"] or None,
                    },
                ),
            },
            candidates=[
                _picker_candidate(
                    value=runtime["campaign_id"] or None,
                    label=runtime["campaign_id"] or "(unset campaign)",
                    subtitle="Campaign ID",
                    selected=bool(runtime["campaign_id"]),
                    kind="campaign",
                ),
            ],
            selected={
                "campaign_id": runtime["campaign_id"] or None,
            },
        ),
        "member": _scope_picker_preview(
            surface="member",
            kind="member_scope",
            ready=live_ready and bool(runtime["audience_id"]),
            requirements=[runtime["api_key_env"], runtime["server_prefix_env"], runtime["audience_env"]],
            pickers={
                "member": _picker_source(
                    command="member.list",
                    resource="member",
                    available=live_ready and bool(runtime["audience_id"]),
                    kind="member",
                    selected={
                        "audience_id": runtime["audience_id"] or None,
                        "member_email": runtime["member_email"] or None,
                    },
                    parent={
                        "audience_id": runtime["audience_id"] or None,
                    },
                ),
            },
            candidates=[
                _picker_candidate(
                    value=runtime["member_email"] or None,
                    label=runtime["member_email"] or "(unset member)",
                    subtitle=runtime["audience_id"] or "Audience ID",
                    selected=bool(runtime["member_email"]),
                    kind="member",
                ),
            ],
            selected={
                "audience_id": runtime["audience_id"] or None,
                "member_email": runtime["member_email"] or None,
            },
        ),
    }
    return {
        "summary": "Mailchimp connector configuration snapshot.",
        "backend": BACKEND_NAME,
        "runtime": {
            "implementation_mode": "live_read_only",
            "live_read_available": runtime["api_key_present"] and runtime["server_prefix_present"],
            "write_bridge_available": False,
            "command_defaults": command_defaults,
            "picker_scopes": picker_scopes,
        },
        "auth": {
            "api_key_env": runtime["api_key_env"],
            "api_key_present": runtime["api_key_present"],
            "api_key_preview": _mask(runtime["api_key"]),
            "server_prefix_env": runtime["server_prefix_env"],
            "server_prefix": runtime["server_prefix"] or None,
            "server_prefix_source": service_key_source(runtime["server_prefix_env"])
            or ("api_key_suffix" if runtime["server_prefix"] else None),
            "server_prefix_present": runtime["server_prefix_present"],
            "service_keys": sorted(SERVICE_KEY_VARIABLES),
            "operator_service_keys": sorted(SERVICE_KEY_VARIABLES),
            "sources": {key: service_key_source(key) for key in sorted(SERVICE_KEY_VARIABLES)},
            "development_fallback": sorted(SERVICE_KEY_VARIABLES),
        },
        "scope": {
            "workerFields": ["account", "audience_id", "campaign_id", "member_email"],
            "audience_id": runtime["audience_id"] or None,
            "campaign_id": runtime["campaign_id"] or None,
            "member_email": runtime["member_email"] or None,
            "commandDefaults": {
                "account.read": {"selection_surface": "account"},
                "audience.list": {"selection_surface": "audience", "limit": 10},
                "audience.read": {
                    "selection_surface": "audience",
                    "args": [runtime["audience_id"] or runtime["audience_env"]],
                },
                "member.list": {
                    "selection_surface": "member",
                    "limit": 10,
                    "args": [runtime["audience_id"] or runtime["audience_env"]],
                },
                "member.read": {
                    "selection_surface": "member",
                    "args": [
                        runtime["audience_id"] or runtime["audience_env"],
                        runtime["member_email"] or runtime["member_email_env"],
                    ],
                },
                "campaign.list": {"selection_surface": "campaign", "limit": 10},
                "campaign.read": {
                    "selection_surface": "campaign",
                    "args": [runtime["campaign_id"] or runtime["campaign_env"]],
                },
                "report.list": {"selection_surface": "campaign", "limit": 10},
                "report.read": {
                    "selection_surface": "campaign",
                    "args": [runtime["campaign_id"] or runtime["campaign_env"]],
                },
            },
        },
        "read_support": {
            "account.read": True,
            "audience.list": True,
            "audience.read": True,
            "member.list": True,
            "member.read": True,
            "campaign.list": True,
            "campaign.read": True,
            "report.list": True,
            "report.read": True,
        },
        "write_support": {},
    }
