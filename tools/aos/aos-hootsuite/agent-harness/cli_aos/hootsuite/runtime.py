from __future__ import annotations

import json
from pathlib import Path
from typing import Any

from . import __version__
from .client import HootsuiteApiError, HootsuiteClient
from .config import config_snapshot, resolve_runtime_values, redacted_config_snapshot
from .constants import BACKEND_NAME, CONNECTOR_CATEGORIES, CONNECTOR_CATEGORY, CONNECTOR_LABEL, CONNECTOR_RESOURCES, CONNECTOR_PATH, MODE_ORDER
from .errors import ConnectorError


def _connector_manifest() -> dict[str, Any]:
    return json.loads(CONNECTOR_PATH.read_text())


def _as_list(payload: dict[str, Any], *keys: str) -> list[Any]:
    for key in keys:
        value = payload.get(key)
        if isinstance(value, list):
            return value
    for value in payload.values():
        if isinstance(value, list):
            return value
    return []


def _as_record(value: Any) -> dict[str, Any]:
    return value if isinstance(value, dict) else {}


def _pick_text(record: dict[str, Any], *keys: str) -> str:
    for key in keys:
        value = record.get(key)
        if isinstance(value, str) and value.strip():
            return value.strip()
    return ""


def _scope_preview(*, command_id: str, selection_surface: str, **extra: Any) -> dict[str, Any]:
    return {
        "command_id": command_id,
        "selection_surface": selection_surface,
        **extra,
    }


def _picker_items(items: list[dict[str, Any]], *, kind: str, label_keys: tuple[str, ...], subtitle_keys: tuple[str, ...] = ()) -> list[dict[str, Any]]:
    picker: list[dict[str, Any]] = []
    for item in items:
        value = _pick_text(item, "id", "organizationId", "socialProfileId", "teamId", "messageId")
        if not value:
            continue
        label = _pick_text(item, *label_keys) or value
        subtitle = _pick_text(item, *subtitle_keys)
        option: dict[str, Any] = {"value": value, "label": label, "kind": kind}
        if subtitle:
            option["subtitle"] = subtitle
        picker.append(option)
    return picker


def create_client(ctx_obj: dict[str, Any] | None = None) -> HootsuiteClient:
    runtime = resolve_runtime_values(ctx_obj)
    if not runtime["access_token"]:
        raise ConnectorError(
            code="HOOTSUITE_ACCESS_TOKEN_REQUIRED",
            message="HOOTSUITE_ACCESS_TOKEN service key is required for Hootsuite live reads.",
            details={"env": runtime["access_token_env"]},
        )
    return HootsuiteClient(access_token=runtime["access_token"], base_url=runtime["base_url"])


def _resolve_org_id(runtime: dict[str, Any], org_id: str | None = None) -> str:
    resolved = (org_id or runtime["organization_id"]).strip()
    if resolved:
        return resolved
    raise ConnectorError(
        code="HOOTSUITE_ORGANIZATION_REQUIRED",
        message="An organization_id is required for this command.",
        details={"env": runtime["organization_id_env"]},
    )


def _resolve_social_profile_id(runtime: dict[str, Any], social_profile_id: str | None = None) -> str:
    resolved = (social_profile_id or runtime["social_profile_id"]).strip()
    if resolved:
        return resolved
    raise ConnectorError(
        code="HOOTSUITE_SOCIAL_PROFILE_REQUIRED",
        message="A social_profile_id is required for this command.",
        details={"env": runtime["social_profile_id_env"]},
    )


def _resolve_team_id(runtime: dict[str, Any], team_id: str | None = None) -> str:
    resolved = (team_id or runtime["team_id"]).strip()
    if resolved:
        return resolved
    raise ConnectorError(
        code="HOOTSUITE_TEAM_ID_REQUIRED",
        message="A team_id is required for this command.",
        details={"env": runtime["team_id_env"]},
    )


def _resolve_message_id(runtime: dict[str, Any], message_id: str | None = None) -> str:
    resolved = (message_id or runtime["message_id"]).strip()
    if resolved:
        return resolved
    raise ConnectorError(
        code="HOOTSUITE_MESSAGE_ID_REQUIRED",
        message="A message_id is required for this command.",
        details={"env": runtime["message_id_env"]},
    )


def capabilities_snapshot() -> dict[str, Any]:
    manifest = _connector_manifest()
    return {
        "tool": manifest["tool"],
        "version": __version__,
        "backend": manifest["backend"],
        "manifest_schema_version": manifest.get("manifest_schema_version", "1.0.0"),
        "modes": MODE_ORDER,
        "connector": manifest["connector"],
        "auth": manifest["auth"],
        "scope": manifest.get("scope", {}),
        "commands": manifest["commands"],
        "read_support": {
            "me.read": True,
            "organization.list": True,
            "organization.read": True,
            "social_profile.list": True,
            "social_profile.read": True,
            "team.list": True,
            "team.read": True,
            "message.list": True,
            "message.read": True,
        },
        "write_support": {
            "live_writes_enabled": False,
            "scaffold_only": True,
            "scaffolded_commands": ["message.schedule"],
        },
    }


def probe_live_read(runtime: dict[str, Any]) -> dict[str, Any]:
    if not runtime["access_token_present"]:
        return {
            "ok": False,
            "details": {
                "missing_keys": [runtime["access_token_env"]],
                "reason": "access token missing",
            },
        }
    try:
        client = HootsuiteClient(access_token=runtime["access_token"], base_url=runtime["base_url"])
        member = _as_record(client.me())
        organizations = _as_list(client.list_organizations(), "data", "organizations")
        social_profiles = _as_list(client.list_social_profiles(), "data", "socialProfiles", "social_profiles")
        return {
            "ok": True,
            "details": {
                "member_id": _pick_text(member, "id", "memberId"),
                "member_name": _pick_text(member, "fullName", "name", "displayName"),
                "organization_count": len(organizations),
                "social_profile_count": len(social_profiles),
            },
        }
    except (HootsuiteApiError, ConnectorError) as err:
        return {
            "ok": False,
            "details": {
                "error": err.as_dict() if hasattr(err, "as_dict") else {"message": str(err)},
            },
        }


def health_snapshot(ctx_obj: dict[str, Any]) -> dict[str, Any]:
    runtime = resolve_runtime_values(ctx_obj)
    probe = probe_live_read(runtime)
    auth_ready = runtime["access_token_present"]
    live_ready = bool(probe.get("ok"))
    if not auth_ready:
        status = "needs_setup"
        summary = "Configure HOOTSUITE_ACCESS_TOKEN in operator-controlled service keys before using live Hootsuite reads."
        next_steps = [
            f"Set {runtime['access_token_env']} in operator-controlled service keys to a valid Hootsuite OAuth access token.",
            f"Optional: set {runtime['base_url_env']} if you need a non-default Hootsuite API host.",
            "Use local HOOTSUITE_* environment variables only as harness fallback during development.",
        ]
    elif not live_ready:
        status = "degraded"
        summary = "Hootsuite credentials are present, but the live read probe failed."
        next_steps = [
            f"Verify {runtime['base_url_env']} points at the active Hootsuite API host.",
            "Verify the access token has member, organization, social profile, and team read access.",
        ]
    else:
        status = "ready"
        summary = "Hootsuite live reads are ready."
        next_steps = [
            "Use me.read, organization.list/read, social_profile.list/read, team.list/read, and message.list/read.",
            "Keep message.schedule scaffolded until publish approval and safety rules are finalized.",
        ]
    return {
        "status": status,
        "summary": summary,
        "connector": {
            "backend": BACKEND_NAME,
            "label": CONNECTOR_LABEL,
            "category": CONNECTOR_CATEGORY,
            "categories": list(CONNECTOR_CATEGORIES),
            "resources": list(CONNECTOR_RESOURCES),
            "live_backend_available": live_ready,
            "live_read_available": live_ready,
            "write_bridge_available": False,
            "scaffold_only": False,
        },
        "auth": {
            "base_url_env": runtime["base_url_env"],
            "base_url_present": runtime["base_url_present"],
            "base_url_source": runtime["base_url_source"],
            "access_token_env": runtime["access_token_env"],
            "access_token_present": runtime["access_token_present"],
            "access_token_source": runtime["access_token_source"],
            "organization_id_env": runtime["organization_id_env"],
            "organization_id_present": runtime["organization_id_present"],
            "social_profile_id_env": runtime["social_profile_id_env"],
            "social_profile_id_present": runtime["social_profile_id_present"],
            "team_id_env": runtime["team_id_env"],
            "team_id_present": runtime["team_id_present"],
            "message_id_env": runtime["message_id_env"],
            "message_id_present": runtime["message_id_present"],
        },
        "checks": [
            {
                "name": "access_token",
                "ok": auth_ready,
                "details": {
                    "present": auth_ready,
                    "env": runtime["access_token_env"],
                    "source": runtime["access_token_source"],
                },
            },
            {
                "name": "live_read",
                "ok": live_ready,
                "details": probe.get("details", {}),
            },
        ],
        "probe": probe,
        "runtime_ready": live_ready,
        "live_backend_available": live_ready,
        "live_read_available": live_ready,
        "write_bridge_available": False,
        "scaffold_only": False,
        "next_steps": next_steps,
    }


def doctor_snapshot(ctx_obj: dict[str, Any], *, health: dict[str, Any] | None = None) -> dict[str, Any]:
    health = health or health_snapshot(ctx_obj)
    if health["status"] == "needs_setup":
        recommendations = [
            "Configure HOOTSUITE_ACCESS_TOKEN in operator-controlled service keys before handing this connector to a worker.",
            "Use organization.list and social_profile.list to narrow scope after setup.",
        ]
    elif health["status"] == "degraded":
        recommendations = [
            "Verify the Hootsuite base URL and token permissions.",
            "Check member and organization reads before enabling worker scope.",
        ]
    else:
        recommendations = [
            "Use me.read, organization.list/read, social_profile.list/read, team.list/read, and message.list/read.",
            "Keep message.schedule scaffolded until publish approval is implemented.",
        ]
    return {
        **health,
        "recommendations": recommendations,
    }


def _organization_option(entry: dict[str, Any]) -> dict[str, Any] | None:
    org_id = _pick_text(entry, "id", "organizationId")
    if not org_id:
        return None
    label = _pick_text(entry, "name", "displayName") or org_id
    subtitle = _pick_text(entry, "accountName", "status")
    option: dict[str, Any] = {"value": org_id, "label": label, "kind": "organization"}
    if subtitle:
        option["subtitle"] = subtitle
    return option


def _social_profile_option(entry: dict[str, Any]) -> dict[str, Any] | None:
    profile_id = _pick_text(entry, "id", "socialProfileId")
    if not profile_id:
        return None
    label = _pick_text(entry, "socialNetworkUsername", "name", "title") or profile_id
    subtitle = _pick_text(entry, "type", "ownerId")
    option: dict[str, Any] = {"value": profile_id, "label": label, "kind": "social_profile"}
    if subtitle:
        option["subtitle"] = subtitle
    return option


def _team_option(entry: dict[str, Any]) -> dict[str, Any] | None:
    team_id = _pick_text(entry, "id", "teamId")
    if not team_id:
        return None
    label = _pick_text(entry, "name", "title") or team_id
    subtitle = _pick_text(entry, "status")
    option: dict[str, Any] = {"value": team_id, "label": label, "kind": "team"}
    if subtitle:
        option["subtitle"] = subtitle
    return option


def _message_option(entry: dict[str, Any]) -> dict[str, Any] | None:
    message_id = _pick_text(entry, "id", "messageId")
    if not message_id:
        return None
    label = _pick_text(entry, "text", "summary", "subject") or message_id
    subtitle = _pick_text(entry, "state", "scheduledSendTime")
    option: dict[str, Any] = {"value": message_id, "label": label, "kind": "message"}
    if subtitle:
        option["subtitle"] = subtitle
    return option


def me_read_result(ctx_obj: dict[str, Any]) -> dict[str, Any]:
    runtime = resolve_runtime_values(ctx_obj)
    client = create_client(ctx_obj)
    member = _as_record(client.me())
    organizations = _as_list(client.list_organizations(), "data", "organizations")
    social_profiles = _as_list(client.list_social_profiles(), "data", "socialProfiles", "social_profiles")
    organization_options = [opt for opt in (_organization_option(_as_record(entry)) for entry in organizations) if opt]
    social_profile_options = [opt for opt in (_social_profile_option(_as_record(entry)) for entry in social_profiles) if opt]
    member_id = _pick_text(member, "id", "memberId") or "authenticated member"
    return {
        "member": member,
        "organizations": organizations,
        "social_profiles": social_profiles,
        "organization_count": len(organizations),
        "social_profile_count": len(social_profiles),
        "picker": {"kind": "member", "items": [{"value": member_id, "label": _pick_text(member, "fullName", "name") or member_id, "kind": "member"}]},
        "picker_options": [{"value": member_id, "label": _pick_text(member, "fullName", "name") or member_id, "kind": "member"}],
        "organization_picker_options": organization_options,
        "social_profile_picker_options": social_profile_options,
        "scope_preview": _scope_preview(command_id="me.read", selection_surface="member", member_id=member_id),
        "summary": f"Loaded authenticated member and {len(organizations)} organizations.",
    }


def organization_list_result(ctx_obj: dict[str, Any]) -> dict[str, Any]:
    client = create_client(ctx_obj)
    payload = client.list_organizations()
    organizations = _as_list(payload, "data", "organizations")
    picker_options = [opt for opt in (_organization_option(_as_record(entry)) for entry in organizations) if opt]
    return {
        "organizations": organizations,
        "organization_count": len(organizations),
        "picker": {"kind": "organization", "items": picker_options},
        "picker_options": picker_options,
        "scope_preview": _scope_preview(command_id="organization.list", selection_surface="organization"),
        "summary": f"Loaded {len(organizations)} organizations.",
    }


def organization_read_result(ctx_obj: dict[str, Any], organization_id: str | None) -> dict[str, Any]:
    runtime = resolve_runtime_values(ctx_obj)
    client = create_client(ctx_obj)
    resolved = _resolve_org_id(runtime, organization_id)
    organization = _as_record(client.read_organization(resolved))
    return {
        "organization": organization,
        "organization_id": resolved,
        "scope_preview": _scope_preview(command_id="organization.read", selection_surface="organization", organization_id=resolved),
        "summary": _pick_text(organization, "name", "displayName") or f"Organization {resolved}",
    }


def social_profile_list_result(ctx_obj: dict[str, Any], organization_id: str | None = None) -> dict[str, Any]:
    runtime = resolve_runtime_values(ctx_obj)
    client = create_client(ctx_obj)
    resolved_org = organization_id or runtime["organization_id"] or None
    payload = client.list_social_profiles(resolved_org or None)
    social_profiles = _as_list(payload, "data", "socialProfiles", "social_profiles")
    picker_options = [opt for opt in (_social_profile_option(_as_record(entry)) for entry in social_profiles) if opt]
    return {
        "organization_id": resolved_org,
        "social_profiles": social_profiles,
        "social_profile_count": len(social_profiles),
        "picker": {"kind": "social_profile", "items": picker_options},
        "picker_options": picker_options,
        "scope_preview": _scope_preview(command_id="social_profile.list", selection_surface="social_profile", organization_id=resolved_org),
        "summary": f"Loaded {len(social_profiles)} social profiles.",
    }


def social_profile_read_result(ctx_obj: dict[str, Any], social_profile_id: str | None) -> dict[str, Any]:
    runtime = resolve_runtime_values(ctx_obj)
    client = create_client(ctx_obj)
    resolved = _resolve_social_profile_id(runtime, social_profile_id)
    social_profile = _as_record(client.read_social_profile(resolved))
    return {
        "social_profile": social_profile,
        "social_profile_id": resolved,
        "scope_preview": _scope_preview(command_id="social_profile.read", selection_surface="social_profile", social_profile_id=resolved),
        "summary": _pick_text(social_profile, "socialNetworkUsername", "name", "title") or f"Social profile {resolved}",
    }


def team_list_result(ctx_obj: dict[str, Any], organization_id: str | None = None) -> dict[str, Any]:
    runtime = resolve_runtime_values(ctx_obj)
    client = create_client(ctx_obj)
    resolved_org = _resolve_org_id(runtime, organization_id)
    payload = client.list_teams(resolved_org)
    teams = _as_list(payload, "data", "teams")
    picker_options = [opt for opt in (_team_option(_as_record(entry)) for entry in teams) if opt]
    return {
        "organization_id": resolved_org,
        "teams": teams,
        "team_count": len(teams),
        "picker": {"kind": "team", "items": picker_options},
        "picker_options": picker_options,
        "scope_preview": _scope_preview(command_id="team.list", selection_surface="team", organization_id=resolved_org),
        "summary": f"Loaded {len(teams)} teams for organization {resolved_org}.",
    }


def team_read_result(ctx_obj: dict[str, Any], team_id: str | None) -> dict[str, Any]:
    runtime = resolve_runtime_values(ctx_obj)
    client = create_client(ctx_obj)
    resolved = _resolve_team_id(runtime, team_id)
    team = _as_record(client.read_team(resolved))
    return {
        "team": team,
        "team_id": resolved,
        "scope_preview": _scope_preview(command_id="team.read", selection_surface="team", team_id=resolved),
        "summary": _pick_text(team, "name", "title") or f"Team {resolved}",
    }


def message_list_result(
    ctx_obj: dict[str, Any],
    *,
    limit: int = 25,
    social_profile_id: str | None = None,
    state: str | None = None,
    start_time: str | None = None,
    end_time: str | None = None,
) -> dict[str, Any]:
    runtime = resolve_runtime_values(ctx_obj)
    client = create_client(ctx_obj)
    resolved_profile = social_profile_id or runtime["social_profile_id"] or None
    payload = client.list_messages(
        social_profile_id=resolved_profile,
        state=state,
        start_time=start_time,
        end_time=end_time,
        limit=limit,
    )
    messages = _as_list(payload, "data", "messages")
    picker_options = [opt for opt in (_message_option(_as_record(entry)) for entry in messages) if opt]
    return {
        "social_profile_id": resolved_profile,
        "messages": messages,
        "message_count": len(messages),
        "picker": {"kind": "message", "items": picker_options},
        "picker_options": picker_options,
        "scope_preview": _scope_preview(command_id="message.list", selection_surface="message", social_profile_id=resolved_profile, state=state),
        "summary": f"Loaded {len(messages)} messages.",
    }


def message_read_result(ctx_obj: dict[str, Any], message_id: str | None) -> dict[str, Any]:
    runtime = resolve_runtime_values(ctx_obj)
    client = create_client(ctx_obj)
    resolved = _resolve_message_id(runtime, message_id)
    message = _as_record(client.read_message(resolved))
    return {
        "message": message,
        "message_id": resolved,
        "scope_preview": _scope_preview(command_id="message.read", selection_surface="message", message_id=resolved),
        "summary": _pick_text(message, "text", "summary", "subject") or f"Message {resolved}",
    }


def scaffold_write_result(ctx_obj: dict[str, Any], *, command_id: str, inputs: dict[str, Any]) -> dict[str, Any]:
    return {
        "status": "scaffold_write_only",
        "command": command_id,
        "tool": "aos-hootsuite",
        "scaffold_only": True,
        "inputs": inputs,
        "summary": "This connector keeps publish actions scaffolded until approval and publish-safety rules are implemented.",
    }
