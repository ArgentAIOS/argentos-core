from __future__ import annotations

import json
from typing import Any

from .client import KlaviyoApiError, KlaviyoClient
from .config import config_snapshot, resolve_runtime_values
from .constants import BACKEND_NAME, CONNECTOR_PATH
from .errors import CliError


def _load_manifest() -> dict[str, Any]:
    return json.loads(CONNECTOR_PATH.read_text())


def capabilities_snapshot() -> dict[str, Any]:
    manifest = _load_manifest()
    return {
        "tool": manifest["tool"],
        "backend": manifest["backend"],
        "manifest_schema_version": manifest.get("manifest_schema_version", "1.0.0"),
        "connector": manifest["connector"],
        "auth": manifest["auth"],
        "scope": manifest.get("scope", {}),
        "commands": manifest["commands"],
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
            "live_writes_enabled": False,
            "scaffold_only": False,
        },
    }

def create_client(ctx_obj: dict[str, Any]) -> KlaviyoClient:
    runtime = resolve_runtime_values(ctx_obj)
    if not runtime["api_key_present"]:
        raise CliError(
            code="KLAVIYO_SETUP_REQUIRED",
            message="Klaviyo connector is missing the required API key",
            exit_code=4,
            details={"missing_keys": [runtime["api_key_env"]]},
        )
    return KlaviyoClient(api_key=runtime["api_key"], revision=runtime["revision"])


def probe_runtime(ctx_obj: dict[str, Any]) -> dict[str, Any]:
    runtime = resolve_runtime_values(ctx_obj)
    if not runtime["api_key_present"]:
        return {
            "ok": False,
            "code": "KLAVIYO_SETUP_REQUIRED",
            "message": "Klaviyo connector is missing the required API key",
            "details": {"missing_keys": [runtime["api_key_env"]], "live_backend_available": False},
        }
    try:
        client = create_client(ctx_obj)
        account = client.read_account()
    except CliError as err:
        return {"ok": False, "code": err.code, "message": err.message, "details": err.details}
    except KlaviyoApiError as err:
        code = "KLAVIYO_AUTH_FAILED" if err.status_code in {401, 403} else "KLAVIYO_API_ERROR"
        return {
            "ok": False,
            "code": code,
            "message": err.message,
            "details": {
                **(err.details or {}),
                "status_code": err.status_code,
                "live_backend_available": False,
            },
        }
    return {
        "ok": True,
        "code": "OK",
        "message": "Klaviyo live read runtime is ready",
        "details": {
            "live_backend_available": True,
            "account": account,
            "revision": runtime["revision"],
        },
    }


def health_snapshot(ctx_obj: dict[str, Any]) -> dict[str, Any]:
    runtime = resolve_runtime_values(ctx_obj)
    probe = probe_runtime(ctx_obj)
    status = "ready" if probe["ok"] else ("needs_setup" if probe["code"] == "KLAVIYO_SETUP_REQUIRED" else "degraded")
    return {
        "status": status,
        "summary": probe["message"],
        "connector": {
            "backend": BACKEND_NAME,
            "live_backend_available": bool(probe.get("ok")),
            "live_read_available": bool(probe.get("ok")),
            "write_bridge_available": False,
            "scaffold_only": False,
        },
        "auth": {
            "api_key_env": runtime["api_key_env"],
            "api_key_present": runtime["api_key_present"],
            "revision_env": runtime["revision_env"],
            "revision_present": runtime["revision_present"],
            "revision_source": runtime["revision_source"],
        },
        "scope": {
            "list_id": runtime["list_id"] or None,
            "profile_id": runtime["profile_id"] or None,
            "profile_email": runtime["profile_email"] or None,
            "campaign_id": runtime["campaign_id"] or None,
        },
        "checks": [
            {
                "name": "required_env",
                "ok": runtime["api_key_present"],
                "details": {"missing_keys": [] if runtime["api_key_present"] else [runtime["api_key_env"]]},
            },
            {"name": "live_backend", "ok": bool(probe.get("ok")), "details": probe.get("details", {})},
        ],
        "runtime_ready": bool(probe.get("ok")),
        "live_backend_available": bool(probe.get("ok")),
        "live_read_available": bool(probe.get("ok")),
        "write_bridge_available": False,
        "scaffold_only": False,
        "probe": probe,
        "next_steps": [
            f"Set {runtime['api_key_env']} in API Keys.",
            "Optionally pin KLAVIYO_LIST_ID, KLAVIYO_PROFILE_ID, KLAVIYO_PROFILE_EMAIL, and KLAVIYO_CAMPAIGN_ID to stabilize worker-flow scope pickers.",
            "Klaviyo mutation commands are not exposed until approval and compliance safeguards are defined.",
        ],
    }


def doctor_snapshot(ctx_obj: dict[str, Any]) -> dict[str, Any]:
    runtime = resolve_runtime_values(ctx_obj)
    probe = probe_runtime(ctx_obj)
    return {
        "status": "ready" if probe.get("ok") else ("needs_setup" if probe.get("code") == "KLAVIYO_SETUP_REQUIRED" else "degraded"),
        "summary": "Klaviyo connector diagnostics.",
        "runtime": {
            "implementation_mode": "live_read_only",
            "command_readiness": {
                "account.read": bool(probe.get("ok")),
                "list.list": bool(probe.get("ok")),
                "list.read": bool(probe.get("ok")),
                "profile.list": bool(probe.get("ok")),
                "profile.read": bool(probe.get("ok")),
                "campaign.list": bool(probe.get("ok")),
                "campaign.read": bool(probe.get("ok")),
            },
            "list_id_present": runtime["list_id_present"],
            "profile_id_present": runtime["profile_id_present"],
            "profile_email_present": runtime["profile_email_present"],
            "campaign_id_present": runtime["campaign_id_present"],
            "revision": runtime["revision"],
            "revision_source": runtime["revision_source"],
        },
        "checks": [
            {"name": "required_env", "ok": runtime["api_key_present"]},
            {"name": "live_backend", "ok": bool(probe.get("ok")), "details": probe.get("details", {})},
            {"name": "write_commands", "ok": True, "details": {"mode": "not_exposed"}},
        ],
        "supported_read_commands": [
            "account.read",
            "list.list",
            "list.read",
            "profile.list",
            "profile.read",
            "campaign.list",
            "campaign.read",
        ],
        "scaffolded_commands": [],
        "next_steps": [
            f"Set {runtime['api_key_env']} in API Keys.",
            "Use account.read to confirm the connected Klaviyo account before choosing list, profile, and campaign scope pickers.",
            "Add mutation commands only after approval and compliance safeguards are defined.",
        ],
    }


def _picker(items: list[dict[str, Any]], *, kind: str, label_key: str = "label") -> dict[str, Any]:
    return {"kind": kind, "items": items, "count": len(items), "label_key": label_key}


def _require_arg(value: str | None, *, code: str, message: str, detail_key: str, detail_value: str) -> str:
    resolved = (value or "").strip()
    if resolved:
        return resolved
    raise CliError(code=code, message=message, exit_code=4, details={detail_key: detail_value})


def account_read_result(ctx_obj: dict[str, Any]) -> dict[str, Any]:
    runtime = resolve_runtime_values(ctx_obj)
    client = create_client(ctx_obj)
    account = client.read_account()
    return {
        "status": "live_read",
        "backend": BACKEND_NAME,
        "summary": f"Read Klaviyo account {account.get('name') or account.get('id') or 'connected account'}.",
        "account": account,
        "scope_preview": {
            "selection_surface": "account",
            "command_id": "account.read",
            "revision": runtime["revision"],
        },
    }


def list_list_result(ctx_obj: dict[str, Any], *, limit: int) -> dict[str, Any]:
    runtime = resolve_runtime_values(ctx_obj)
    client = create_client(ctx_obj)
    payload = client.list_lists(limit=limit)
    lists = payload.get("lists", []) if isinstance(payload.get("lists"), list) else []
    items = [
        {
            "id": str(item.get("id") or ""),
            "label": str(item.get("name") or item.get("id") or "List"),
            "subtitle": f"profiles={item.get('profile_count') or 'unknown'}" if item.get("profile_count") is not None else None,
            "kind": "list",
        }
        for item in lists
        if isinstance(item, dict)
    ]
    return {
        "status": "live_read",
        "backend": BACKEND_NAME,
        "summary": f"Returned {len(lists)} Klaviyo list{'s' if len(lists) != 1 else ''}.",
        "lists": lists,
        "list_count": len(lists),
        "picker": _picker(items, kind="list"),
        "scope_preview": {
            "selection_surface": "list",
            "command_id": "list.list",
            "list_id": runtime["list_id"] or None,
        },
    }


def list_read_result(ctx_obj: dict[str, Any], list_id: str | None) -> dict[str, Any]:
    runtime = resolve_runtime_values(ctx_obj)
    resolved = _require_arg(list_id or runtime["list_id"], code="KLAVIYO_LIST_REQUIRED", message="List ID is required", detail_key="env", detail_value=runtime["list_id_env"])
    client = create_client(ctx_obj)
    list_record = client.read_list(resolved)
    return {
        "status": "live_read",
        "backend": BACKEND_NAME,
        "summary": f"Read Klaviyo list {resolved}.",
        "list": list_record,
        "scope_preview": {
            "selection_surface": "list",
            "command_id": "list.read",
            "list_id": resolved,
        },
    }


def profile_list_result(ctx_obj: dict[str, Any], list_id: str | None, *, limit: int, email: str | None) -> dict[str, Any]:
    runtime = resolve_runtime_values(ctx_obj)
    resolved_list = (list_id or runtime["list_id"] or "").strip() or None
    client = create_client(ctx_obj)
    payload = client.list_profiles(list_id=resolved_list, limit=limit, email=email or runtime["profile_email"] or None)
    profiles = payload.get("profiles", []) if isinstance(payload.get("profiles"), list) else []
    items = [
        {
            "id": str(item.get("id") or ""),
            "label": str(item.get("display_name") or item.get("email") or item.get("id") or "Profile"),
            "subtitle": item.get("email") or resolved_list or None,
            "kind": "profile",
        }
        for item in profiles
        if isinstance(item, dict)
    ]
    return {
        "status": "live_read",
        "backend": BACKEND_NAME,
        "summary": f"Returned {len(profiles)} Klaviyo profile{'s' if len(profiles) != 1 else ''}.",
        "list_id": resolved_list,
        "profiles": profiles,
        "profile_count": len(profiles),
        "picker": _picker(items, kind="profile"),
        "scope_preview": {
            "selection_surface": "profile",
            "command_id": "profile.list",
            "list_id": resolved_list,
            "profile_email": email or runtime["profile_email"] or None,
        },
    }


def profile_read_result(ctx_obj: dict[str, Any], profile_id: str | None, email: str | None) -> dict[str, Any]:
    runtime = resolve_runtime_values(ctx_obj)
    client = create_client(ctx_obj)
    resolved_email = (email or runtime["profile_email"] or "").strip() or None
    resolved_profile_id = (profile_id or runtime["profile_id"] or "").strip() or None
    if resolved_profile_id:
        profile = client.read_profile(resolved_profile_id)
    elif resolved_email:
        profile = client.find_profile_by_email(resolved_email)
    else:
        raise CliError(
            code="KLAVIYO_PROFILE_REQUIRED",
            message="Profile ID or email is required",
            exit_code=4,
            details={"env": runtime["profile_id_env"], "email_env": runtime["profile_email_env"]},
        )
    return {
        "status": "live_read",
        "backend": BACKEND_NAME,
        "summary": f"Read Klaviyo profile {profile.get('email') or profile.get('id') or 'profile'}.",
        "profile": profile,
        "scope_preview": {
            "selection_surface": "profile",
            "command_id": "profile.read",
            "profile_id": profile.get("id") or resolved_profile_id,
            "profile_email": profile.get("email") or resolved_email,
        },
    }


def campaign_list_result(ctx_obj: dict[str, Any], *, limit: int) -> dict[str, Any]:
    runtime = resolve_runtime_values(ctx_obj)
    client = create_client(ctx_obj)
    payload = client.list_campaigns(limit=limit)
    campaigns = payload.get("campaigns", []) if isinstance(payload.get("campaigns"), list) else []
    items = [
        {
            "id": str(item.get("id") or ""),
            "label": str(item.get("name") or item.get("id") or "Campaign"),
            "subtitle": item.get("status") or item.get("channel") or None,
            "kind": "campaign",
        }
        for item in campaigns
        if isinstance(item, dict)
    ]
    return {
        "status": "live_read",
        "backend": BACKEND_NAME,
        "summary": f"Returned {len(campaigns)} Klaviyo campaign{'s' if len(campaigns) != 1 else ''}.",
        "campaigns": campaigns,
        "campaign_count": len(campaigns),
        "picker": _picker(items, kind="campaign"),
        "scope_preview": {
            "selection_surface": "campaign",
            "command_id": "campaign.list",
            "campaign_id": runtime["campaign_id"] or None,
        },
    }


def campaign_read_result(ctx_obj: dict[str, Any], campaign_id: str | None) -> dict[str, Any]:
    runtime = resolve_runtime_values(ctx_obj)
    resolved = _require_arg(campaign_id or runtime["campaign_id"], code="KLAVIYO_CAMPAIGN_REQUIRED", message="Campaign ID is required", detail_key="env", detail_value=runtime["campaign_id_env"])
    client = create_client(ctx_obj)
    campaign = client.read_campaign(resolved)
    return {
        "status": "live_read",
        "backend": BACKEND_NAME,
        "summary": f"Read Klaviyo campaign {resolved}.",
        "campaign": campaign,
        "scope_preview": {
            "selection_surface": "campaign",
            "command_id": "campaign.read",
            "campaign_id": resolved,
        },
    }
