from __future__ import annotations

import json
import shutil
from pathlib import Path
from typing import Any

from .client import BufferClient
from .config import BufferConnectorContext, redact_config, resolve_config
from .constants import BACKEND_NAME, TOOL_NAME


def resolve_runtime_binary() -> str | None:
    return shutil.which("aos-buffer")


def create_client(context: BufferConnectorContext | None = None) -> BufferClient:
    config = context.config if context else resolve_config()
    if not config.api_key:
        raise RuntimeError("BUFFER_API_KEY or BUFFER_ACCESS_TOKEN is required")
    return BufferClient(
        api_key=config.api_key,
        base_url=config.base_url,
        graphql_url=config.graphql_url,
    )


def build_scope_preview(command_id: str, selection_surface: str, **extra: Any) -> dict[str, Any]:
    payload = {"selection_surface": selection_surface, "command_id": command_id}
    payload.update({key: value for key, value in extra.items() if value is not None})
    return payload


def build_manifest_payload() -> dict[str, Any]:
    connector_path = Path(__file__).resolve().parents[3] / "connector.json"
    return {
        "tool": TOOL_NAME,
        "backend": BACKEND_NAME,
        "connector": json.loads(connector_path.read_text()),
    }


def build_capabilities_payload() -> dict[str, Any]:
    manifest = build_manifest_payload()
    return {
        "tool": TOOL_NAME,
        "backend": BACKEND_NAME,
        "manifest_version": manifest["connector"].get("manifest_schema_version"),
        "data": manifest["connector"],
    }


def build_config_show_payload() -> dict[str, Any]:
    config = resolve_config()
    return {
        "tool": TOOL_NAME,
        "backend": BACKEND_NAME,
        "data": {
            "config": redact_config(config),
            "scope": {
                "account_id": config.account_id,
                "channel_id": config.channel_id,
                "profile_id": config.profile_id,
                "post_id": config.post_id,
            },
            "runtime": {
                "binary_path": resolve_runtime_binary(),
                "implementation_mode": "live_read_with_scaffolded_writes",
                "live_read_surfaces": ["account", "channel", "profile"],
                "scaffolded_surfaces": ["post"],
            },
        },
    }


def build_health_payload(*, client_factory=None) -> dict[str, Any]:
    client_factory = client_factory or create_client
    config = resolve_config()
    checks: list[dict[str, Any]] = [
        {
            "name": "connector_runtime",
            "label": "Connector runtime installed",
            "ok": bool(resolve_runtime_binary()),
            "optional": False,
            "summary": "aos-buffer is on PATH" if resolve_runtime_binary() else "Install the harness to expose an aos-buffer binary.",
        },
        {
            "name": "api_key",
            "label": "Buffer API key configured",
            "ok": bool(config.api_key),
            "optional": False,
            "summary": "BUFFER_API_KEY or BUFFER_ACCESS_TOKEN is set" if config.api_key else "Add BUFFER_API_KEY or BUFFER_ACCESS_TOKEN in API Keys.",
        },
        {
            "name": "base_url",
            "label": "Buffer base URL configured",
            "ok": bool(config.base_url),
            "optional": True,
            "summary": config.base_url,
        },
        {
            "name": "channel_scope",
            "label": "Channel scope pinned",
            "ok": bool(config.channel_id),
            "optional": True,
            "summary": config.channel_id or "Optional: set BUFFER_CHANNEL_ID for worker defaults.",
        },
        {
            "name": "profile_scope",
            "label": "Profile scope pinned",
            "ok": bool(config.profile_id),
            "optional": True,
            "summary": config.profile_id or "Optional: set BUFFER_PROFILE_ID for worker defaults.",
        },
    ]
    probe = None
    if config.api_key:
        try:
            client = client_factory(BufferConnectorContext(config=config))
            probe = {
                "ok": True,
                "account": client.read_account(),
                "channels": client.list_channels(),
                "profiles": client.list_profiles(),
            }
        except Exception as exc:  # noqa: BLE001
            probe = {"ok": False, "error": str(exc)}
            checks.append({
                "name": "connector_health",
                "label": "Connector health check",
                "ok": False,
                "optional": False,
                "summary": str(exc),
            })
        else:
            checks.append({
                "name": "connector_health",
                "label": "Connector health check",
                "ok": True,
                "optional": False,
                "summary": "Buffer REST reads succeeded.",
            })
    ok = bool(config.api_key) and bool(resolve_runtime_binary()) and (probe is None or probe.get("ok") is True)
    next_steps = []
    if not resolve_runtime_binary():
        next_steps.append("Install the Buffer harness so the aos-buffer binary is available on PATH.")
    if not config.api_key:
        next_steps.append("Create or choose a Buffer API token and add BUFFER_API_KEY or BUFFER_ACCESS_TOKEN.")
    if not config.channel_id:
        next_steps.append("Optional: pin BUFFER_CHANNEL_ID to default a worker to one Buffer channel.")
    if not config.profile_id:
        next_steps.append("Optional: pin BUFFER_PROFILE_ID to default a worker to one Buffer profile.")
    next_steps.append("Keep post.create_draft and post.schedule scaffolded until the current Buffer post contract is confirmed.")
    return {
        "tool": TOOL_NAME,
        "backend": BACKEND_NAME,
        "data": {
            "status": "ready" if ok else "needs_setup",
            "checks": checks,
            "probe": probe,
            "next_steps": next_steps,
        },
    }


def build_doctor_payload() -> dict[str, Any]:
    health = build_health_payload()
    return {
        "tool": TOOL_NAME,
        "backend": BACKEND_NAME,
        "data": {
            "status": health["data"]["status"],
            "checks": health["data"]["checks"],
            "probe": health["data"]["probe"],
            "summary": "Buffer connector diagnostics complete.",
        },
    }


def build_account_read_payload(*, client_factory=None) -> dict[str, Any]:
    client_factory = client_factory or create_client
    config = resolve_config()
    client = client_factory(BufferConnectorContext(config=config))
    account = client.read_account()
    return {
        "tool": TOOL_NAME,
        "backend": BACKEND_NAME,
        "data": {
            "account": account,
            "scope_preview": build_scope_preview("account.read", "account"),
        },
    }


def build_channel_list_payload(*, client_factory=None, limit: int = 10) -> dict[str, Any]:
    client_factory = client_factory or create_client
    config = resolve_config()
    client = client_factory(BufferConnectorContext(config=config))
    channels = client.list_channels()["channels"][:limit]
    return {
        "tool": TOOL_NAME,
        "backend": BACKEND_NAME,
        "data": {
            "channel_count": len(channels),
            "channels": channels,
            "picker": {"kind": "channel", "items": channels},
            "scope_preview": build_scope_preview("channel.list", "channel"),
        },
    }


def build_channel_read_payload(*, client_factory=None, channel_id: str | None = None) -> dict[str, Any]:
    client_factory = client_factory or create_client
    config = resolve_config()
    channel_id = channel_id or config.channel_id
    if not channel_id:
        return {
            "tool": TOOL_NAME,
            "backend": BACKEND_NAME,
            "error": {"code": "BUFFER_CHANNEL_REQUIRED", "message": "Set BUFFER_CHANNEL_ID or pass a channel id."},
        }
    client = client_factory(BufferConnectorContext(config=config))
    channel = client.read_channel(channel_id)
    return {
        "tool": TOOL_NAME,
        "backend": BACKEND_NAME,
        "data": {
            "channel": channel,
            "scope_preview": build_scope_preview("channel.read", "channel", channel_id=channel_id),
        },
    }


def build_profile_list_payload(*, client_factory=None, limit: int = 10) -> dict[str, Any]:
    client_factory = client_factory or create_client
    config = resolve_config()
    client = client_factory(BufferConnectorContext(config=config))
    profiles = client.list_profiles()["profiles"][:limit]
    return {
        "tool": TOOL_NAME,
        "backend": BACKEND_NAME,
        "data": {
            "profile_count": len(profiles),
            "profiles": profiles,
            "picker": {"kind": "profile", "items": profiles},
            "scope_preview": build_scope_preview("profile.list", "profile"),
        },
    }


def build_profile_read_payload(*, client_factory=None, profile_id: str | None = None) -> dict[str, Any]:
    client_factory = client_factory or create_client
    config = resolve_config()
    profile_id = profile_id or config.profile_id or config.channel_id
    if not profile_id:
        return {
            "tool": TOOL_NAME,
            "backend": BACKEND_NAME,
            "error": {"code": "BUFFER_PROFILE_REQUIRED", "message": "Set BUFFER_PROFILE_ID or pass a profile id."},
        }
    client = client_factory(BufferConnectorContext(config=config))
    profile = client.read_profile(profile_id)
    schedules = client.list_profile_schedules(profile_id)
    return {
        "tool": TOOL_NAME,
        "backend": BACKEND_NAME,
        "data": {
            "profile": profile,
            "schedules": schedules["schedules"],
            "scope_preview": build_scope_preview("profile.read", "profile", profile_id=profile_id),
        },
    }


def build_post_list_payload(*, client_factory=None, profile_id: str | None = None, status: str | None = None, limit: int = 10) -> dict[str, Any]:
    client_factory = client_factory or create_client
    config = resolve_config()
    profile_id = profile_id or config.profile_id
    if not profile_id:
        return {
            "tool": TOOL_NAME,
            "backend": BACKEND_NAME,
            "error": {"code": "BUFFER_PROFILE_REQUIRED", "message": "Set BUFFER_PROFILE_ID or pass a profile id."},
        }
    return {
        "tool": TOOL_NAME,
        "backend": BACKEND_NAME,
        "data": {
            "supported": False,
            "status": "scaffold_read_only",
            "reason": (
                "Buffer's current public docs confirm account/profile reads, but do not yet expose a stable post list surface "
                "in this connector scaffold."
            ),
            "profile_id": profile_id,
            "post_count": 0,
            "posts": [],
            "status_filter": status,
            "limit": limit,
            "scope_preview": build_scope_preview("post.list", "post", profile_id=profile_id),
        },
    }


def build_post_read_payload(*, client_factory=None, post_id: str | None = None) -> dict[str, Any]:
    client_factory = client_factory or create_client
    config = resolve_config()
    post_id = post_id or config.post_id
    if not post_id:
        return {
            "tool": TOOL_NAME,
            "backend": BACKEND_NAME,
            "error": {"code": "BUFFER_POST_REQUIRED", "message": "Set BUFFER_POST_ID or pass a post id."},
        }
    return {
        "tool": TOOL_NAME,
        "backend": BACKEND_NAME,
        "data": {
            "supported": False,
            "status": "scaffold_read_only",
            "reason": "Buffer post read is scaffolded until the current API post schema is confirmed.",
            "post": {"id": post_id},
            "scope_preview": build_scope_preview("post.read", "post", post_id=post_id),
        },
    }


def build_post_create_draft_payload(*, client_factory=None, channel_id: str | None = None, text: str | None = None, due_at: str | None = None) -> dict[str, Any]:
    client_factory = client_factory or create_client
    config = resolve_config()
    channel_id = channel_id or config.channel_id
    text = text or config.post_text
    if not channel_id:
        return {
            "tool": TOOL_NAME,
            "backend": BACKEND_NAME,
            "error": {"code": "BUFFER_CHANNEL_REQUIRED", "message": "Set BUFFER_CHANNEL_ID or pass a channel id."},
        }
    if not text:
        return {
            "tool": TOOL_NAME,
            "backend": BACKEND_NAME,
            "error": {"code": "BUFFER_POST_TEXT_REQUIRED", "message": "Set BUFFER_POST_TEXT or pass post text."},
        }
    return {
        "tool": TOOL_NAME,
        "backend": BACKEND_NAME,
        "data": {
            "supported": False,
            "status": "scaffold_write_only",
            "reason": "Buffer post creation is scaffolded until the current public post contract is confirmed.",
            "post": {"channel_id": channel_id, "text": text, "due_at": due_at},
            "scope_preview": build_scope_preview("post.create_draft", "post", channel_id=channel_id, post_text=text),
        },
    }


def build_post_schedule_payload(*, client_factory=None, channel_id: str | None = None, text: str | None = None, due_at: str | None = None) -> dict[str, Any]:
    client_factory = client_factory or create_client
    config = resolve_config()
    channel_id = channel_id or config.channel_id
    text = text or config.post_text
    if not channel_id:
        return {
            "tool": TOOL_NAME,
            "backend": BACKEND_NAME,
            "error": {"code": "BUFFER_CHANNEL_REQUIRED", "message": "Set BUFFER_CHANNEL_ID or pass a channel id."},
        }
    if not text:
        return {
            "tool": TOOL_NAME,
            "backend": BACKEND_NAME,
            "error": {"code": "BUFFER_POST_TEXT_REQUIRED", "message": "Set BUFFER_POST_TEXT or pass post text."},
        }
    return {
        "tool": TOOL_NAME,
        "backend": BACKEND_NAME,
        "data": {
            "supported": False,
            "status": "scaffold_write_only",
            "reason": "Buffer post scheduling is scaffolded until the current public post contract is confirmed.",
            "post": {"channel_id": channel_id, "text": text, "due_at": due_at},
            "scope_preview": build_scope_preview("post.schedule", "post", channel_id=channel_id, post_text=text),
        },
    }
