from __future__ import annotations

from datetime import datetime, timezone
from typing import Any

import click
import json

from . import __version__

TOOL_NAME = "aos-teams"


def _timestamp() -> str:
    return datetime.now(timezone.utc).isoformat()


def success(*, command: str, mode: str, started: float, data: dict[str, Any]) -> dict[str, Any]:
    return {
        "ok": True,
        "tool": TOOL_NAME,
        "command": command,
        "meta": {
            "mode": mode,
            "duration_ms": int((datetime.now(timezone.utc).timestamp() - started) * 1000),
            "timestamp": _timestamp(),
            "version": __version__,
        },
        "data": data,
    }


def failure(
    *,
    command: str,
    mode: str,
    started: float,
    error: dict[str, Any],
) -> dict[str, Any]:
    return {
        "ok": False,
        "tool": TOOL_NAME,
        "command": command,
        "meta": {
            "mode": mode,
            "duration_ms": int((datetime.now(timezone.utc).timestamp() - started) * 1000),
            "timestamp": _timestamp(),
            "version": __version__,
        },
        "error": error,
    }


def emit(payload: dict[str, Any], *, as_json: bool) -> None:
    if as_json:
        click.echo(json.dumps(payload, indent=2, sort_keys=True))
        return
    if payload.get("ok"):
        click.echo(payload.get("data", {}).get("summary") or "OK")
    else:
        error = payload.get("error", {})
        click.echo(f"ERROR: {error.get('message', 'Unknown error')}")
