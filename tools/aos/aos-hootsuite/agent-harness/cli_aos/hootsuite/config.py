from __future__ import annotations

import os
from typing import Any

from .constants import BACKEND_NAME, CONNECTOR_CATEGORIES, CONNECTOR_CATEGORY, CONNECTOR_LABEL, CONNECTOR_RESOURCES, DEFAULT_BASE_URL
from .service_keys import service_key_details


def _plain_env(*names: str) -> str:
    for name in names:
        value = os.getenv(name, "").strip()
        if value:
            return value
    return ""


def _env_source(*names: str, default_source: str = "missing") -> str:
    for name in names:
        if os.getenv(name, "").strip():
            return "env"
    return default_source


def resolve_runtime_values(ctx_obj: dict[str, Any] | None = None) -> dict[str, Any]:
    ctx_obj = ctx_obj or {}
    access_token_details = service_key_details("HOOTSUITE_ACCESS_TOKEN", ctx_obj)
    base_url = _plain_env("HOOTSUITE_BASE_URL") or DEFAULT_BASE_URL
    organization_id = _plain_env("HOOTSUITE_ORGANIZATION_ID")
    social_profile_id = _plain_env("HOOTSUITE_SOCIAL_PROFILE_ID")
    team_id = _plain_env("HOOTSUITE_TEAM_ID")
    message_id = _plain_env("HOOTSUITE_MESSAGE_ID")
    return {
        "backend": BACKEND_NAME,
        "base_url": base_url,
        "access_token": access_token_details["value"],
        "organization_id": organization_id,
        "social_profile_id": social_profile_id,
        "team_id": team_id,
        "message_id": message_id,
        "service_keys": ["HOOTSUITE_ACCESS_TOKEN"],
        "base_url_env": "HOOTSUITE_BASE_URL",
        "access_token_env": "HOOTSUITE_ACCESS_TOKEN",
        "organization_id_env": "HOOTSUITE_ORGANIZATION_ID",
        "social_profile_id_env": "HOOTSUITE_SOCIAL_PROFILE_ID",
        "team_id_env": "HOOTSUITE_TEAM_ID",
        "message_id_env": "HOOTSUITE_MESSAGE_ID",
        "base_url_source": _env_source("HOOTSUITE_BASE_URL", default_source="default"),
        "access_token_source": access_token_details["source"],
        "organization_id_source": _env_source("HOOTSUITE_ORGANIZATION_ID"),
        "social_profile_id_source": _env_source("HOOTSUITE_SOCIAL_PROFILE_ID"),
        "team_id_source": _env_source("HOOTSUITE_TEAM_ID"),
        "message_id_source": _env_source("HOOTSUITE_MESSAGE_ID"),
        "base_url_present": bool(base_url),
        "access_token_present": access_token_details["present"],
        "organization_id_present": bool(organization_id),
        "social_profile_id_present": bool(social_profile_id),
        "team_id_present": bool(team_id),
        "message_id_present": bool(message_id),
    }


def _redact(value: str) -> str:
    return "<redacted>" if value else ""


def redacted_config_snapshot(ctx_obj: dict[str, Any] | None = None) -> dict[str, Any]:
    runtime = resolve_runtime_values(ctx_obj)
    return {
        "backend": runtime["backend"],
        "base_url": runtime["base_url"],
        "base_url_source": runtime["base_url_source"],
        "access_token": _redact(runtime["access_token"]),
        "access_token_source": runtime["access_token_source"],
        "organization_id": runtime["organization_id"],
        "organization_id_source": runtime["organization_id_source"],
        "social_profile_id": runtime["social_profile_id"],
        "social_profile_id_source": runtime["social_profile_id_source"],
        "team_id": runtime["team_id"],
        "team_id_source": runtime["team_id_source"],
        "message_id": runtime["message_id"],
        "message_id_source": runtime["message_id_source"],
    }


def config_snapshot(ctx_obj: dict[str, Any] | None = None) -> dict[str, Any]:
    runtime = resolve_runtime_values(ctx_obj)
    command_defaults = {
        "me.read": {"selection_surface": "member"},
        "organization.list": {"selection_surface": "organization"},
        "organization.read": {"selection_surface": "organization", "args": [runtime["organization_id_env"]]},
        "social_profile.list": {
            "selection_surface": "social_profile",
            "args": [runtime["organization_id_env"]],
        },
        "social_profile.read": {
            "selection_surface": "social_profile",
            "args": [runtime["social_profile_id_env"]],
        },
        "team.list": {"selection_surface": "team", "args": [runtime["organization_id_env"]]},
        "team.read": {"selection_surface": "team", "args": [runtime["team_id_env"]]},
        "message.list": {
            "selection_surface": "message",
            "args": [runtime["social_profile_id_env"]],
            "limit": 25,
            "default_window": "now-7d..now+7d",
        },
        "message.read": {"selection_surface": "message", "args": [runtime["message_id_env"]]},
        "message.schedule": {"selection_surface": "message", "args": [runtime["social_profile_id_env"]]},
    }
    picker_scopes = {
        "member": {
            "selected": {
                "member_id": "authenticated member",
                "member_name": "authenticated member",
                "member_email": None,
            },
            "pickers": {"member": {"command": "me.read", "selection_surface": "member"}},
        },
        "organization": {
            "selected": {"organization_id": runtime["organization_id"]},
            "pickers": {
                "organization": {"command": "organization.list", "selection_surface": "organization"}
            },
        },
        "social_profile": {
            "selected": {"social_profile_id": runtime["social_profile_id"]},
            "pickers": {
                "social_profile": {"command": "social_profile.list", "selection_surface": "social_profile"}
            },
        },
        "team": {
            "selected": {"team_id": runtime["team_id"]},
            "pickers": {"team": {"command": "team.list", "selection_surface": "team"}},
        },
        "message": {
            "selected": {"message_id": runtime["message_id"]},
            "pickers": {"message": {"command": "message.list", "selection_surface": "message"}},
        },
    }
    return {
        "tool": "aos-hootsuite",
        "backend": BACKEND_NAME,
        "auth": {
            "kind": "oauth-service-key",
            "service_keys": list(runtime["service_keys"]),
            "access_token_env": runtime["access_token_env"],
            "access_token_present": runtime["access_token_present"],
            "access_token_source": runtime["access_token_source"],
            "local_env_fallback": True,
        },
        "runtime": {
            "implementation_mode": "live_read_with_scaffolded_writes",
            "command_defaults": command_defaults,
            "picker_scopes": picker_scopes,
        },
        "scope": redacted_config_snapshot(ctx_obj),
        "connector": {
            "label": CONNECTOR_LABEL,
            "category": CONNECTOR_CATEGORY,
            "categories": list(CONNECTOR_CATEGORIES),
            "resources": list(CONNECTOR_RESOURCES),
        },
    }
