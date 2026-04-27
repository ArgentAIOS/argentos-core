from __future__ import annotations

import json
from typing import Any

from .client import MailchimpApiError, MailchimpClient
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
            command["id"]: True
            for command in manifest["commands"]
            if command["required_mode"] == "readonly"
        },
        "write_support": {},
    }


def create_client(ctx_obj: dict[str, Any]) -> MailchimpClient:
    runtime = resolve_runtime_values(ctx_obj)
    missing = []
    if not runtime["api_key_present"]:
        missing.append(runtime["api_key_env"])
    if not runtime["server_prefix_present"]:
        missing.append(runtime["server_prefix_env"])
    if missing:
        raise CliError(
            code="MAILCHIMP_SETUP_REQUIRED",
            message="Mailchimp connector is missing required credentials",
            exit_code=4,
            details={"missing_keys": missing},
        )
    return MailchimpClient(api_key=runtime["api_key"], server_prefix=runtime["server_prefix"])


def probe_runtime(ctx_obj: dict[str, Any]) -> dict[str, Any]:
    runtime = resolve_runtime_values(ctx_obj)
    missing = []
    if not runtime["api_key_present"]:
        missing.append(runtime["api_key_env"])
    if not runtime["server_prefix_present"]:
        missing.append(runtime["server_prefix_env"])
    if missing:
        return {
            "ok": False,
            "code": "MAILCHIMP_SETUP_REQUIRED",
            "message": "Mailchimp connector is missing required credentials",
            "details": {"missing_keys": missing, "live_backend_available": False},
        }
    try:
        client = create_client(ctx_obj)
        ping = client.ping()
    except CliError as err:
        return {"ok": False, "code": err.code, "message": err.message, "details": err.details}
    except MailchimpApiError as err:
        code = "MAILCHIMP_AUTH_FAILED" if err.status_code in {401, 403} else "MAILCHIMP_API_ERROR"
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
        "message": "Mailchimp live read runtime is ready",
        "details": {
            "live_backend_available": True,
            "ping": ping,
            "server_prefix": runtime["server_prefix"],
        },
    }


def health_snapshot(ctx_obj: dict[str, Any]) -> dict[str, Any]:
    runtime = resolve_runtime_values(ctx_obj)
    probe = probe_runtime(ctx_obj)
    status = "ready" if probe["ok"] else ("needs_setup" if probe["code"] == "MAILCHIMP_SETUP_REQUIRED" else "degraded")
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
            "server_prefix_env": runtime["server_prefix_env"],
            "server_prefix_present": runtime["server_prefix_present"],
            "server_prefix_source": "service_key_or_env"
            if runtime["configured_server_prefix"]
            else ("api_key_suffix" if runtime["server_prefix"] else None),
            "service_keys": runtime["service_keys"],
            "operator_service_keys": runtime["service_keys"],
            "sources": runtime["sources"],
        },
        "scope": {
            "audience_id": runtime["audience_id"] or None,
            "campaign_id": runtime["campaign_id"] or None,
            "member_email": runtime["member_email"] or None,
        },
        "checks": [
            {
                "name": "required_env",
                "ok": runtime["api_key_present"] and runtime["server_prefix_present"],
                "details": {
                    "missing_keys": [
                        key
                        for key, present in [
                            (runtime["api_key_env"], runtime["api_key_present"]),
                            (runtime["server_prefix_env"], runtime["server_prefix_present"]),
                        ]
                        if not present
                    ]
                },
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
            f"Optional: set {runtime['server_prefix_env']} in API Keys only if you need to override the API key suffix.",
            "Optional: pin MAILCHIMP_AUDIENCE_ID, MAILCHIMP_CAMPAIGN_ID, and MAILCHIMP_MEMBER_EMAIL for worker scope defaults.",
            "Do not advertise Mailchimp write actions until approval, compliance, and campaign safety rules are verified.",
        ],
    }


def doctor_snapshot(ctx_obj: dict[str, Any]) -> dict[str, Any]:
    runtime = resolve_runtime_values(ctx_obj)
    probe = probe_runtime(ctx_obj)
    return {
        "status": "ready" if probe.get("ok") else ("needs_setup" if probe.get("code") == "MAILCHIMP_SETUP_REQUIRED" else "degraded"),
        "summary": "Mailchimp connector diagnostics.",
        "runtime": {
            "implementation_mode": "live_read_only",
            "command_readiness": {
                "account.read": bool(probe.get("ok")),
                "audience.list": bool(probe.get("ok")),
                "audience.read": bool(probe.get("ok")),
                "member.list": bool(probe.get("ok")),
                "member.read": bool(probe.get("ok")),
                "campaign.list": bool(probe.get("ok")),
                "campaign.read": bool(probe.get("ok")),
                "report.list": bool(probe.get("ok")),
                "report.read": bool(probe.get("ok")),
            },
            "server_prefix_present": runtime["server_prefix_present"],
            "audience_id_present": runtime["audience_id_present"],
            "campaign_id_present": runtime["campaign_id_present"],
            "member_email_present": runtime["member_email_present"],
        },
        "checks": [
            {"name": "required_env", "ok": runtime["api_key_present"] and runtime["server_prefix_present"]},
            {"name": "live_backend", "ok": bool(probe.get("ok")), "details": probe.get("details", {})},
            {"name": "write_commands", "ok": True, "details": {"supported_write_commands": []}},
        ],
        "next_steps": [
            f"Set {runtime['api_key_env']} in API Keys.",
            f"Optional: set {runtime['server_prefix_env']} in API Keys only if you need to override the API key suffix.",
            "Use account.read to confirm the connected Mailchimp account before choosing audience, campaign, and member scope pickers.",
            "Do not advertise Mailchimp write actions until approval, compliance, and campaign safety rules are verified.",
        ],
        "supported_write_commands": [],
    }


def _picker(items: list[dict[str, Any]], *, kind: str, label_key: str = "label") -> dict[str, Any]:
    return {"kind": kind, "items": items, "count": len(items), "label_key": label_key}


def _require_arg(value: str | None, *, code: str, message: str, detail_key: str, detail_value: str) -> str:
    resolved = (value or "").strip()
    if resolved:
        return resolved
    raise CliError(code=code, message=message, exit_code=4, details={detail_key: detail_value})


def audience_list_result(ctx_obj: dict[str, Any], *, limit: int) -> dict[str, Any]:
    client = create_client(ctx_obj)
    payload = client.list_audiences(limit=limit)
    lists = payload.get("lists", []) if isinstance(payload.get("lists"), list) else []
    items = [
        {
            "id": str(item.get("id") or ""),
            "label": f"{item.get('name', 'Audience')} ({item.get('id', '')})",
            "member_count": item.get("stats", {}).get("member_count"),
        }
        for item in lists
        if isinstance(item, dict)
    ]
    return {
        "status": "live_read",
        "backend": BACKEND_NAME,
        "summary": f"Returned {len(lists)} Mailchimp audience{'' if len(lists) == 1 else 's' }.",
        "audiences": lists,
        "audience_count": len(lists),
        "picker": _picker(items, kind="audience"),
        "scope_preview": {
            "selection_surface": "audience",
            "command_id": "audience.list",
            "audience_id": resolve_runtime_values(ctx_obj)["audience_id"] or None,
        },
    }


def account_read_result(ctx_obj: dict[str, Any]) -> dict[str, Any]:
    runtime = resolve_runtime_values(ctx_obj)
    client = create_client(ctx_obj)
    account = client.read_account()
    account_label = str(account.get("account_name") or account.get("username") or runtime["server_prefix"] or "Mailchimp account")
    return {
        "status": "live_read",
        "backend": BACKEND_NAME,
        "summary": f"Read Mailchimp account {account_label}.",
        "account": account,
        "scope_preview": {
            "selection_surface": "account",
            "command_id": "account.read",
            "server_prefix": runtime["server_prefix"] or None,
            "account_label": account_label,
        },
    }


def audience_read_result(ctx_obj: dict[str, Any], audience_id: str | None) -> dict[str, Any]:
    runtime = resolve_runtime_values(ctx_obj)
    resolved = _require_arg(audience_id or runtime["audience_id"], code="MAILCHIMP_AUDIENCE_REQUIRED", message="Audience ID is required", detail_key="env", detail_value=runtime["audience_env"])
    client = create_client(ctx_obj)
    audience = client.read_audience(resolved)
    return {
        "status": "live_read",
        "backend": BACKEND_NAME,
        "summary": f"Read Mailchimp audience {resolved}.",
        "audience": audience,
        "scope_preview": {
            "selection_surface": "audience",
            "command_id": "audience.read",
            "audience_id": resolved,
        },
    }


def member_list_result(ctx_obj: dict[str, Any], audience_id: str | None, *, limit: int) -> dict[str, Any]:
    runtime = resolve_runtime_values(ctx_obj)
    resolved = _require_arg(audience_id or runtime["audience_id"], code="MAILCHIMP_AUDIENCE_REQUIRED", message="Audience ID is required", detail_key="env", detail_value=runtime["audience_env"])
    client = create_client(ctx_obj)
    payload = client.list_members(resolved, limit=limit)
    members = payload.get("members", []) if isinstance(payload.get("members"), list) else []
    items = [
        {
            "id": str(item.get("id") or item.get("email_address") or ""),
            "label": f"{item.get('email_address', 'member')} ({item.get('status', 'unknown')})",
            "email": item.get("email_address"),
        }
        for item in members
        if isinstance(item, dict)
    ]
    return {
        "status": "live_read",
        "backend": BACKEND_NAME,
        "summary": f"Returned {len(members)} Mailchimp member{'' if len(members) == 1 else 's'} from audience {resolved}.",
        "audience_id": resolved,
        "members": members,
        "member_count": len(members),
        "picker": _picker(items, kind="member"),
        "scope_preview": {
            "selection_surface": "member",
            "command_id": "member.list",
            "audience_id": resolved,
        },
    }


def member_read_result(ctx_obj: dict[str, Any], audience_id: str | None, email: str | None) -> dict[str, Any]:
    runtime = resolve_runtime_values(ctx_obj)
    resolved_audience = _require_arg(audience_id or runtime["audience_id"], code="MAILCHIMP_AUDIENCE_REQUIRED", message="Audience ID is required", detail_key="env", detail_value=runtime["audience_env"])
    resolved_email = _require_arg(email or runtime["member_email"], code="MAILCHIMP_MEMBER_REQUIRED", message="Member email is required", detail_key="env", detail_value=runtime["member_email_env"])
    client = create_client(ctx_obj)
    member = client.read_member(resolved_audience, resolved_email)
    return {
        "status": "live_read",
        "backend": BACKEND_NAME,
        "summary": f"Read Mailchimp member {resolved_email} from audience {resolved_audience}.",
        "audience_id": resolved_audience,
        "member": member,
        "scope_preview": {
            "selection_surface": "member",
            "command_id": "member.read",
            "audience_id": resolved_audience,
            "member_email": resolved_email,
        },
    }


def campaign_list_result(ctx_obj: dict[str, Any], *, limit: int, status: str | None) -> dict[str, Any]:
    client = create_client(ctx_obj)
    payload = client.list_campaigns(limit=limit, status=status)
    campaigns = payload.get("campaigns", []) if isinstance(payload.get("campaigns"), list) else []
    items = [
        {
            "id": str(item.get("id") or ""),
            "label": f"{item.get('settings', {}).get('title') or item.get('id', 'Campaign')} ({item.get('status', 'unknown')})",
            "status": item.get("status"),
        }
        for item in campaigns
        if isinstance(item, dict)
    ]
    return {
        "status": "live_read",
        "backend": BACKEND_NAME,
        "summary": f"Returned {len(campaigns)} Mailchimp campaign{'' if len(campaigns) == 1 else 's'}.",
        "campaigns": campaigns,
        "campaign_count": len(campaigns),
        "picker": _picker(items, kind="campaign"),
        "scope_preview": {
            "selection_surface": "campaign",
            "command_id": "campaign.list",
            "campaign_id": resolve_runtime_values(ctx_obj)["campaign_id"] or None,
        },
    }


def campaign_read_result(ctx_obj: dict[str, Any], campaign_id: str | None) -> dict[str, Any]:
    runtime = resolve_runtime_values(ctx_obj)
    resolved = _require_arg(campaign_id or runtime["campaign_id"], code="MAILCHIMP_CAMPAIGN_REQUIRED", message="Campaign ID is required", detail_key="env", detail_value=runtime["campaign_env"])
    client = create_client(ctx_obj)
    campaign = client.read_campaign(resolved)
    return {
        "status": "live_read",
        "backend": BACKEND_NAME,
        "summary": f"Read Mailchimp campaign {resolved}.",
        "campaign": campaign,
        "scope_preview": {
            "selection_surface": "campaign",
            "command_id": "campaign.read",
            "campaign_id": resolved,
        },
    }


def report_list_result(ctx_obj: dict[str, Any], *, limit: int) -> dict[str, Any]:
    client = create_client(ctx_obj)
    payload = client.list_reports(limit=limit)
    reports = payload.get("reports", []) if isinstance(payload.get("reports"), list) else []
    items = [
        {
            "id": str(item.get("campaign_id") or item.get("id") or ""),
            "label": f"{item.get('campaign_title') or item.get('campaign_id', 'Report')}",
            "emails_sent": item.get("emails_sent"),
        }
        for item in reports
        if isinstance(item, dict)
    ]
    return {
        "status": "live_read",
        "backend": BACKEND_NAME,
        "summary": f"Returned {len(reports)} Mailchimp report{'' if len(reports) == 1 else 's'}.",
        "reports": reports,
        "report_count": len(reports),
        "picker": _picker(items, kind="report"),
        "scope_preview": {
            "selection_surface": "campaign",
            "command_id": "report.list",
            "campaign_id": resolve_runtime_values(ctx_obj)["campaign_id"] or None,
        },
    }


def report_read_result(ctx_obj: dict[str, Any], campaign_id: str | None) -> dict[str, Any]:
    runtime = resolve_runtime_values(ctx_obj)
    resolved = _require_arg(campaign_id or runtime["campaign_id"], code="MAILCHIMP_CAMPAIGN_REQUIRED", message="Campaign ID is required", detail_key="env", detail_value=runtime["campaign_env"])
    client = create_client(ctx_obj)
    report = client.read_report(resolved)
    return {
        "status": "live_read",
        "backend": BACKEND_NAME,
        "summary": f"Read Mailchimp report for campaign {resolved}.",
        "report": report,
        "scope_preview": {
            "selection_surface": "campaign",
            "command_id": "report.read",
            "campaign_id": resolved,
        },
    }
