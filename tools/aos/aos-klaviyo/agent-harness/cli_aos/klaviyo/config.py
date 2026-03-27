from __future__ import annotations

import os
from typing import Any

from .constants import (
    BACKEND_NAME,
    DEFAULT_REVISION,
    KLAVIYO_API_KEY_ENV,
    KLAVIYO_CAMPAIGN_ID_ENV,
    KLAVIYO_LIST_ID_ENV,
    KLAVIYO_PROFILE_EMAIL_ENV,
    KLAVIYO_PROFILE_ID_ENV,
    KLAVIYO_REVISION_ENV,
)


def _mask(value: str | None) -> str | None:
    if not value:
        return None
    if len(value) <= 8:
        return "*" * len(value)
    return f"{value[:4]}***{value[-4:]}"


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
    api_key_env = ctx_obj.get("api_key_env") or KLAVIYO_API_KEY_ENV
    revision_env = ctx_obj.get("revision_env") or KLAVIYO_REVISION_ENV
    list_id_env = ctx_obj.get("list_id_env") or KLAVIYO_LIST_ID_ENV
    profile_id_env = ctx_obj.get("profile_id_env") or KLAVIYO_PROFILE_ID_ENV
    profile_email_env = ctx_obj.get("profile_email_env") or KLAVIYO_PROFILE_EMAIL_ENV
    campaign_id_env = ctx_obj.get("campaign_id_env") or KLAVIYO_CAMPAIGN_ID_ENV

    api_key = (os.getenv(api_key_env) or "").strip()
    revision = (os.getenv(revision_env) or DEFAULT_REVISION).strip() or DEFAULT_REVISION
    list_id = (os.getenv(list_id_env) or "").strip()
    profile_id = (os.getenv(profile_id_env) or "").strip()
    profile_email = (os.getenv(profile_email_env) or "").strip()
    campaign_id = (os.getenv(campaign_id_env) or "").strip()

    return {
        "backend": BACKEND_NAME,
        "api_key_env": api_key_env,
        "revision_env": revision_env,
        "list_id_env": list_id_env,
        "profile_id_env": profile_id_env,
        "profile_email_env": profile_email_env,
        "campaign_id_env": campaign_id_env,
        "api_key": api_key,
        "revision": revision,
        "list_id": list_id,
        "profile_id": profile_id,
        "profile_email": profile_email,
        "campaign_id": campaign_id,
        "api_key_present": bool(api_key),
        "revision_present": bool(revision),
        "list_id_present": bool(list_id),
        "profile_id_present": bool(profile_id),
        "profile_email_present": bool(profile_email),
        "campaign_id_present": bool(campaign_id),
        "revision_source": "env" if os.getenv(revision_env) else "default",
    }


def config_snapshot(ctx_obj: dict[str, Any]) -> dict[str, Any]:
    runtime = resolve_runtime_values(ctx_obj)
    live_ready = runtime["api_key_present"]
    command_defaults = {
        "account.read": {
            "selection_surface": "account",
        },
        "list.list": {
            "selection_surface": "list",
            "limit": 10,
        },
        "list.read": {
            "selection_surface": "list",
            "args": [runtime["list_id"] or runtime["list_id_env"]],
        },
        "profile.list": {
            "selection_surface": "profile",
            "args": [runtime["list_id"] or runtime["list_id_env"]],
            "limit": 10,
            "email": runtime["profile_email"] or runtime["profile_email_env"],
        },
        "profile.read": {
            "selection_surface": "profile",
            "args": [runtime["profile_id"] or runtime["profile_email"] or runtime["profile_id_env"]],
            "email": runtime["profile_email"] or runtime["profile_email_env"],
        },
        "campaign.list": {
            "selection_surface": "campaign",
            "limit": 10,
            "channel": "email",
        },
        "campaign.read": {
            "selection_surface": "campaign",
            "args": [runtime["campaign_id"] or runtime["campaign_id_env"]],
        },
    }
    picker_scopes = {
        "account": _scope_picker_preview(
            surface="account",
            kind="account_scope",
            ready=live_ready,
            requirements=[runtime["api_key_env"]],
            pickers={
                "account": _picker_source(
                    command="account.read",
                    resource="account",
                    available=live_ready,
                    kind="account",
                    selected={
                        "api_key_present": runtime["api_key_present"],
                        "revision": runtime["revision"],
                    },
                ),
            },
            candidates=[
                _picker_candidate(
                    value="current",
                    label="Connected Klaviyo account",
                    subtitle=runtime["revision"],
                    selected=runtime["api_key_present"],
                    kind="account",
                ),
            ],
            selected={
                "api_key_present": runtime["api_key_present"],
                "revision": runtime["revision"],
            },
        ),
        "list": _scope_picker_preview(
            surface="list",
            kind="list_scope",
            ready=live_ready,
            requirements=[runtime["api_key_env"]],
            pickers={
                "list": _picker_source(
                    command="list.list",
                    resource="list",
                    available=live_ready,
                    kind="list",
                    selected={
                        "list_id": runtime["list_id"] or None,
                    },
                ),
            },
            candidates=[
                _picker_candidate(
                    value=runtime["list_id"] or None,
                    label=runtime["list_id"] or "(unset list)",
                    subtitle="List ID",
                    selected=bool(runtime["list_id"]),
                    kind="list",
                ),
            ],
            selected={
                "list_id": runtime["list_id"] or None,
            },
        ),
        "profile": _scope_picker_preview(
            surface="profile",
            kind="profile_scope",
            ready=live_ready,
            requirements=[runtime["api_key_env"]],
            pickers={
                "profile": _picker_source(
                    command="profile.list",
                    resource="profile",
                    available=live_ready,
                    kind="profile",
                    selected={
                        "list_id": runtime["list_id"] or None,
                        "profile_id": runtime["profile_id"] or None,
                        "profile_email": runtime["profile_email"] or None,
                    },
                    parent={
                        "list_id": runtime["list_id"] or None,
                    },
                ),
            },
            candidates=[
                _picker_candidate(
                    value=runtime["profile_id"] or runtime["profile_email"] or None,
                    label=runtime["profile_email"] or runtime["profile_id"] or "(unset profile)",
                    subtitle=runtime["list_id"] or "Account profiles",
                    selected=bool(runtime["profile_id"] or runtime["profile_email"]),
                    kind="profile",
                ),
            ],
            selected={
                "list_id": runtime["list_id"] or None,
                "profile_id": runtime["profile_id"] or None,
                "profile_email": runtime["profile_email"] or None,
            },
        ),
        "campaign": _scope_picker_preview(
            surface="campaign",
            kind="campaign_scope",
            ready=live_ready,
            requirements=[runtime["api_key_env"]],
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
    }
    from .runtime import probe_runtime

    probe = probe_runtime(ctx_obj) if runtime["api_key_present"] else {"ok": False, "code": "SKIPPED", "message": "Klaviyo probe skipped until KLAVIYO_API_KEY is configured", "details": {"skipped": True}}
    return {
        "summary": "Klaviyo connector configuration snapshot.",
        "backend": BACKEND_NAME,
        "runtime": {
            "implementation_mode": "live_read_with_scaffolded_writes",
            "live_read_available": runtime["api_key_present"],
            "write_bridge_available": False,
            "command_defaults": command_defaults,
            "picker_scopes": picker_scopes,
            "probe": probe,
        },
        "auth": {
            "api_key_env": runtime["api_key_env"],
            "api_key_present": runtime["api_key_present"],
            "api_key_preview": _mask(runtime["api_key"]),
            "revision_env": runtime["revision_env"],
            "revision": runtime["revision"],
            "revision_source": runtime["revision_source"],
        },
        "scope": {
            "workerFields": ["account", "list_id", "profile_id", "profile_email", "campaign_id"],
            "list_id": runtime["list_id"] or None,
            "profile_id": runtime["profile_id"] or None,
            "profile_email": runtime["profile_email"] or None,
            "campaign_id": runtime["campaign_id"] or None,
            "commandDefaults": command_defaults,
            "pickerHints": {
                "account": {
                    "kind": "account",
                    "selection_surface": "account",
                    "resource": "klaviyo.account",
                    "source_command": "account.read",
                    "source_fields": ["id", "name", "timezone", "currency", "public_api_key"],
                },
                "list": {
                    "kind": "list",
                    "selection_surface": "list",
                    "resource": "klaviyo.list",
                    "source_command": "list.list",
                    "source_fields": ["id", "name", "created", "updated", "subscriptions"],
                },
                "profile": {
                    "kind": "profile",
                    "selection_surface": "profile",
                    "resource": "klaviyo.profile",
                    "source_command": "profile.list",
                    "source_fields": ["id", "email", "first_name", "last_name", "created", "updated"],
                },
                "campaign": {
                    "kind": "campaign",
                    "selection_surface": "campaign",
                    "resource": "klaviyo.campaign",
                    "source_command": "campaign.list",
                    "source_fields": ["id", "name", "status", "archived", "created", "updated"],
                },
            },
        },
        "read_support": {
            "account.read": True,
            "list.list": True,
            "list.read": True,
            "profile.list": True,
            "profile.read": True,
            "campaign.list": True,
            "campaign.read": True,
        },
        "write_support": {
            "campaign.create": "scaffold_only",
            "profile.upsert": "scaffold_only",
            "scaffold_only": True,
        },
    }
