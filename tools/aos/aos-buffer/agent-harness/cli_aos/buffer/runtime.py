from __future__ import annotations

import json
from typing import Any

from . import __version__
from .client import BufferAPIError, BufferClient
from .config import config_snapshot, resolve_runtime_values
from .constants import BACKEND_NAME, CONNECTOR_PATH, MODE_ORDER, TOOL_NAME
from .errors import CliError

POST_READ_PAGE_LIMIT = 50
POST_READ_MAX_PAGES = 5


def _load_manifest() -> dict[str, Any]:
    return json.loads(CONNECTOR_PATH.read_text())


def _scope_preview(*, command_id: str, selection_surface: str, **extra: Any) -> dict[str, Any]:
    return {"command_id": command_id, "selection_surface": selection_surface, **extra}


def _picker_items(items: list[dict[str, Any]], *, kind: str, label_keys: tuple[str, ...], subtitle_keys: tuple[str, ...]) -> list[dict[str, Any]]:
    picker: list[dict[str, Any]] = []
    for item in items:
        value = str(item.get("id") or "").strip()
        if not value:
            continue
        label = next((str(item.get(key) or "").strip() for key in label_keys if str(item.get(key) or "").strip()), value)
        subtitle = next((str(item.get(key) or "").strip() for key in subtitle_keys if str(item.get(key) or "").strip()), "")
        option: dict[str, Any] = {"value": value, "label": label, "kind": kind}
        if subtitle:
            option["subtitle"] = subtitle
        picker.append(option)
    return picker


def _status_list(status: str | None) -> list[str] | None:
    if not status:
        return None
    parts = [segment.strip() for segment in status.split(",")]
    values = [segment for segment in parts if segment]
    return values or None


def _api_error(err: BufferAPIError) -> CliError:
    return CliError(code=err.code, message=err.message, exit_code=err.exit_code, details=err.details)


def create_client(ctx_obj: dict[str, Any] | None = None) -> BufferClient:
    runtime = resolve_runtime_values(ctx_obj)
    if not runtime["access_token_present"]:
        raise CliError(
            code="BUFFER_SETUP_REQUIRED",
            message="BUFFER_API_KEY or BUFFER_ACCESS_TOKEN is required for Buffer live reads.",
            exit_code=4,
            details={"missing_keys": ["BUFFER_API_KEY", "BUFFER_ACCESS_TOKEN"]},
        )
    return BufferClient(api_key=runtime["access_token"], base_url=runtime["base_url"])


def _account(ctx_obj: dict[str, Any] | None = None) -> dict[str, Any]:
    try:
        return create_client(ctx_obj).read_account()
    except BufferAPIError as err:
        raise _api_error(err) from err


def _organization_scope(ctx_obj: dict[str, Any] | None = None, explicit_organization_id: str | None = None) -> tuple[list[str], dict[str, Any]]:
    runtime = resolve_runtime_values(ctx_obj)
    account = _account(ctx_obj)
    if explicit_organization_id:
        return [explicit_organization_id.strip()], account
    if runtime["organization_id"]:
        return [runtime["organization_id"]], account
    organizations = account.get("organizations")
    if isinstance(organizations, list):
        organization_ids = [str(item.get("id") or "").strip() for item in organizations if isinstance(item, dict) and str(item.get("id") or "").strip()]
        if organization_ids:
            return organization_ids, account
    raise CliError(
        code="BUFFER_ORGANIZATION_REQUIRED",
        message="No Buffer organization is available for this command.",
        exit_code=4,
        details={"env": runtime["organization_id_env"]},
    )


def _resolve_channel_id(ctx_obj: dict[str, Any] | None = None, channel_id: str | None = None, profile_id: str | None = None) -> str:
    runtime = resolve_runtime_values(ctx_obj)
    resolved = (channel_id or profile_id or runtime["resolved_channel_id"]).strip()
    if resolved:
        return resolved
    raise CliError(
        code="BUFFER_CHANNEL_REQUIRED",
        message="A Buffer channel ID is required for this command.",
        exit_code=4,
        details={"env": runtime["channel_id_env"], "legacy_env": runtime["profile_id_env"]},
    )


def _resolve_post_id(ctx_obj: dict[str, Any] | None = None, post_id: str | None = None) -> str:
    runtime = resolve_runtime_values(ctx_obj)
    resolved = (post_id or runtime["post_id"]).strip()
    if resolved:
        return resolved
    raise CliError(
        code="BUFFER_POST_REQUIRED",
        message="A Buffer post ID is required for this command.",
        exit_code=4,
        details={"env": runtime["post_id_env"]},
    )


def capabilities_snapshot() -> dict[str, Any]:
    manifest = _load_manifest()
    return {
        "tool": TOOL_NAME,
        "version": __version__,
        "manifest_schema_version": manifest.get("manifest_schema_version", "1.0.0"),
        "backend": manifest["backend"],
        "modes": MODE_ORDER,
        "connector": manifest["connector"],
        "auth": manifest["auth"],
        "scope": manifest["scope"],
        "commands": manifest["commands"],
        "read_support": {
            "account.read": "live",
            "channel.list": "live",
            "channel.read": "live",
            "profile.list": "live_alias",
            "profile.read": "live_alias",
            "post.list": "live",
            "post.read": "live_lookup",
        },
        "write_support": {
            "scaffold_only": False,
            "scaffolded_commands": [],
            "live_writes_enabled": False,
            "live_write_smoke_tested": False,
        },
    }


def probe_runtime(ctx_obj: dict[str, Any] | None = None) -> dict[str, Any]:
    runtime = resolve_runtime_values(ctx_obj)
    if not runtime["access_token_present"]:
        return {
            "ok": False,
            "code": "BUFFER_SETUP_REQUIRED",
            "message": "Configure BUFFER_API_KEY or BUFFER_ACCESS_TOKEN before using live Buffer reads.",
            "details": {"missing_keys": ["BUFFER_API_KEY", "BUFFER_ACCESS_TOKEN"], "live_backend_available": False},
        }
    try:
        client = create_client(ctx_obj)
        account = client.read_account()
        organizations = account.get("organizations") if isinstance(account.get("organizations"), list) else []
        first_org = next((item for item in organizations if isinstance(item, dict) and str(item.get("id") or "").strip()), None)
        channel_count = 0
        if isinstance(first_org, dict):
            channel_count = len(client.list_channels(organization_id=str(first_org["id"])))
    except BufferAPIError as err:
        return {"ok": False, "code": err.code, "message": err.message, "details": err.details}
    except CliError as err:
        return {"ok": False, "code": err.code, "message": err.message, "details": err.details}

    return {
        "ok": True,
        "code": "OK",
        "message": "Buffer live reads are ready.",
        "details": {
            "account": account,
            "organization_count": len(organizations),
            "channel_probe_count": channel_count,
        },
    }


def health_snapshot(ctx_obj: dict[str, Any] | None = None) -> dict[str, Any]:
    runtime = resolve_runtime_values(ctx_obj)
    probe = probe_runtime(ctx_obj)
    status = "ready" if probe["ok"] else ("needs_setup" if probe["code"] == "BUFFER_SETUP_REQUIRED" else "degraded")
    return {
        "status": status,
        "summary": probe["message"],
        "connector": {
            "backend": BACKEND_NAME,
            "live_backend_available": bool(probe.get("ok")),
            "live_read_available": bool(probe.get("ok")),
            "write_bridge_available": False,
            "live_write_smoke_tested": False,
            "scaffold_only": False,
        },
        "auth": {
            "access_token_envs": ["BUFFER_API_KEY", "BUFFER_ACCESS_TOKEN"],
            "access_token_source": runtime["access_token_source"],
            "base_url_env": runtime["base_url_env"],
            "base_url_source": runtime["base_url_source"],
            "organization_id_env": runtime["organization_id_env"],
            "organization_id_source": runtime["organization_id_source"],
            "channel_id_env": runtime["channel_id_env"],
            "channel_id_source": runtime["channel_id_source"],
            "profile_id_env": runtime["profile_id_env"],
            "profile_id_source": runtime["profile_id_source"],
            "post_id_env": runtime["post_id_env"],
            "post_id_source": runtime["post_id_source"],
        },
        "scope": {
            "organization_id": runtime["organization_id"] or None,
            "channel_id": runtime["channel_id"] or None,
            "profile_id": runtime["profile_id"] or None,
            "post_id": runtime["post_id"] or None,
        },
        "checks": [
            {
                "name": "access_token",
                "ok": runtime["access_token_present"],
                "details": {"source": runtime["access_token_source"], "missing_keys": [] if runtime["access_token_present"] else ["BUFFER_API_KEY", "BUFFER_ACCESS_TOKEN"]},
            },
            {
                "name": "live_backend",
                "ok": bool(probe.get("ok")),
                "details": probe.get("details", {}),
            },
        ],
        "probe": probe,
        "runtime_ready": bool(probe.get("ok")),
        "write_bridge_available": False,
        "live_write_smoke_tested": False,
        "next_steps": [
            "Set BUFFER_API_KEY or BUFFER_ACCESS_TOKEN in operator-controlled service keys first; only rely on local env for harness fallback.",
            "Optionally pin BUFFER_ORGANIZATION_ID and BUFFER_CHANNEL_ID to stabilize worker scope.",
            "Use account.read and channel.list to discover live scope before relying on post.read lookups.",
            "Do not advertise Buffer draft/schedule writes until a live write bridge and approval policy are implemented.",
        ],
    }


def doctor_snapshot(ctx_obj: dict[str, Any] | None = None) -> dict[str, Any]:
    health = health_snapshot(ctx_obj)
    return {
        **health,
        "runtime": {
            "implementation_mode": "live_graphql_read_only",
            "service_key_precedence": resolve_runtime_values(ctx_obj)["service_key_precedence"],
            "command_readiness": {
                "account.read": health["runtime_ready"],
                "channel.list": health["runtime_ready"],
                "channel.read": health["runtime_ready"],
                "profile.list": health["runtime_ready"],
                "profile.read": health["runtime_ready"],
                "post.list": health["runtime_ready"],
                "post.read": health["runtime_ready"],
            },
        },
        "supported_write_commands": [],
        "scaffolded_write_commands": [],
    }


def account_read_result(ctx_obj: dict[str, Any] | None = None) -> dict[str, Any]:
    account = _account(ctx_obj)
    organizations = account.get("organizations") if isinstance(account.get("organizations"), list) else []
    return {
        "summary": "Read the authenticated Buffer account.",
        "account": account,
        "organization_count": len(organizations),
        "picker": {
            "kind": "account",
            "items": [
                {
                    "value": str(account.get("id") or "authenticated-account"),
                    "label": str(account.get("name") or account.get("email") or "Authenticated Buffer account"),
                    "kind": "account",
                }
            ],
        },
        "scope_preview": _scope_preview(command_id="account.read", selection_surface="account"),
    }


def channel_list_result(ctx_obj: dict[str, Any] | None = None, *, organization_id: str | None = None, limit: int = 10, profile_alias: bool = False) -> dict[str, Any]:
    client = create_client(ctx_obj)
    organization_ids, _ = _organization_scope(ctx_obj, organization_id)
    channels: list[dict[str, Any]] = []
    for org_id in organization_ids:
        try:
            org_channels = client.list_channels(organization_id=org_id)
        except BufferAPIError as err:
            raise _api_error(err) from err
        for channel in org_channels:
            if not isinstance(channel, dict):
                continue
            record = dict(channel)
            record.setdefault("organization_id", org_id)
            channels.append(record)
            if len(channels) >= limit:
                break
        if len(channels) >= limit:
            break

    selection_surface = "profile" if profile_alias else "channel"
    command_id = "profile.list" if profile_alias else "channel.list"
    kind = "profile" if profile_alias else "channel"
    return {
        "summary": f"Returned {len(channels)} Buffer {kind}{'s' if len(channels) != 1 else ''}.",
        kind + "_count": len(channels),
        kind + "s": channels,
        "picker": {"kind": kind, "items": _picker_items(channels, kind=kind, label_keys=("name", "id"), subtitle_keys=("service", "organization_id"))},
        "scope_preview": _scope_preview(
            command_id=command_id,
            selection_surface=selection_surface,
            organization_ids=organization_ids,
            organization_id=organization_id or resolve_runtime_values(ctx_obj)["organization_id"] or None,
        ),
        "legacy_alias": "profile -> channel" if profile_alias else None,
    }


def channel_read_result(ctx_obj: dict[str, Any] | None = None, *, channel_id: str | None = None, profile_id: str | None = None, profile_alias: bool = False) -> dict[str, Any]:
    client = create_client(ctx_obj)
    resolved_channel_id = _resolve_channel_id(ctx_obj, channel_id=channel_id, profile_id=profile_id)
    try:
        channel = client.read_channel(channel_id=resolved_channel_id)
    except BufferAPIError as err:
        raise _api_error(err) from err
    selection_surface = "profile" if profile_alias else "channel"
    command_id = "profile.read" if profile_alias else "channel.read"
    payload_key = "profile" if profile_alias else "channel"
    return {
        "summary": f"Read Buffer {selection_surface} {resolved_channel_id}.",
        payload_key: channel,
        "scope_preview": _scope_preview(command_id=command_id, selection_surface=selection_surface, channel_id=resolved_channel_id, profile_id=resolved_channel_id if profile_alias else None),
        "legacy_alias": "profile -> channel" if profile_alias else None,
    }


def post_list_result(
    ctx_obj: dict[str, Any] | None = None,
    *,
    organization_id: str | None = None,
    channel_id: str | None = None,
    profile_id: str | None = None,
    status: str | None = None,
    limit: int = 10,
) -> dict[str, Any]:
    client = create_client(ctx_obj)
    organization_ids, _ = _organization_scope(ctx_obj, organization_id)
    statuses = _status_list(status)
    resolved_channel_id = (channel_id or profile_id or resolve_runtime_values(ctx_obj)["resolved_channel_id"]).strip() or None
    posts: list[dict[str, Any]] = []
    for org_id in organization_ids:
        try:
            payload = client.list_posts(
                organization_id=org_id,
                channel_ids=[resolved_channel_id] if resolved_channel_id else None,
                statuses=statuses,
                limit=max(1, limit - len(posts)),
            )
        except BufferAPIError as err:
            raise _api_error(err) from err
        edges = payload.get("edges") if isinstance(payload.get("edges"), list) else []
        for edge in edges:
            if not isinstance(edge, dict):
                continue
            node = edge.get("node")
            if not isinstance(node, dict):
                continue
            record = dict(node)
            record.setdefault("organization_id", org_id)
            posts.append(record)
            if len(posts) >= limit:
                break
        if len(posts) >= limit:
            break

    return {
        "summary": f"Returned {len(posts)} Buffer post{'s' if len(posts) != 1 else ''}.",
        "post_count": len(posts),
        "posts": posts,
        "picker": {"kind": "post", "items": _picker_items(posts, kind="post", label_keys=("text", "id"), subtitle_keys=("status", "channelId"))},
        "scope_preview": _scope_preview(
            command_id="post.list",
            selection_surface="post",
            organization_ids=organization_ids,
            organization_id=organization_id or resolve_runtime_values(ctx_obj)["organization_id"] or None,
            channel_id=resolved_channel_id,
            status=statuses,
        ),
    }


def post_read_result(
    ctx_obj: dict[str, Any] | None = None,
    *,
    post_id: str | None = None,
) -> dict[str, Any]:
    client = create_client(ctx_obj)
    resolved_post_id = _resolve_post_id(ctx_obj, post_id=post_id)
    runtime = resolve_runtime_values(ctx_obj)
    organization_ids, _ = _organization_scope(ctx_obj, None)
    channel_id = runtime["resolved_channel_id"] or None
    scanned_pages: dict[str, int] = {}

    for org_id in organization_ids:
        after: str | None = None
        scanned_pages[org_id] = 0
        while scanned_pages[org_id] < POST_READ_MAX_PAGES:
            try:
                payload = client.list_posts(
                    organization_id=org_id,
                    channel_ids=[channel_id] if channel_id else None,
                    limit=POST_READ_PAGE_LIMIT,
                    after=after,
                )
            except BufferAPIError as err:
                raise _api_error(err) from err
            scanned_pages[org_id] += 1
            edges = payload.get("edges") if isinstance(payload.get("edges"), list) else []
            for edge in edges:
                if not isinstance(edge, dict):
                    continue
                node = edge.get("node")
                if isinstance(node, dict) and str(node.get("id") or "").strip() == resolved_post_id:
                    post = dict(node)
                    post.setdefault("organization_id", org_id)
                    return {
                        "summary": f"Read Buffer post {resolved_post_id}.",
                        "post": post,
                        "scope_preview": _scope_preview(
                            command_id="post.read",
                            selection_surface="post",
                            post_id=resolved_post_id,
                            organization_ids=organization_ids,
                            channel_id=channel_id,
                        ),
                    }
            page_info = payload.get("pageInfo") if isinstance(payload.get("pageInfo"), dict) else {}
            if not page_info.get("hasNextPage"):
                break
            after = str(page_info.get("endCursor") or "").strip() or None
            if not after:
                break

    raise CliError(
        code="BUFFER_POST_NOT_FOUND",
        message="Could not find the requested Buffer post in the accessible organization scope.",
        exit_code=6,
        details={
            "post_id": resolved_post_id,
            "organization_ids": organization_ids,
            "channel_id": channel_id,
            "pages_scanned": scanned_pages,
        },
    )
