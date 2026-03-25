from __future__ import annotations

import json
import time
from datetime import datetime, timezone
from typing import Any

import click

from . import __version__
from .constants import TOOL_NAME


def _timestamp() -> str:
    return datetime.now(timezone.utc).isoformat()


def success(*, command: str, mode: str, started: float, data: dict[str, Any]) -> dict[str, Any]:
    return {
        "ok": True,
        "tool": TOOL_NAME,
        "command": command,
        "data": data,
        "meta": {
            "mode": mode,
            "duration_ms": int((time.time() - started) * 1000),
            "timestamp": _timestamp(),
            "version": __version__,
        },
    }


def failure(*, command: str, mode: str, started: float, error: dict[str, Any]) -> dict[str, Any]:
    return {
        "ok": False,
        "tool": TOOL_NAME,
        "command": command,
        "error": error,
        "meta": {
            "mode": mode,
            "duration_ms": int((time.time() - started) * 1000),
            "timestamp": _timestamp(),
            "version": __version__,
        },
    }


def emit(payload: dict[str, Any], *, as_json: bool) -> None:
    if as_json:
        click.echo(json.dumps(payload, indent=2, sort_keys=True))
        return
    if payload.get("ok"):
        data = payload.get("data", {})
        summary = data.get("summary") or payload.get("command") or "OK"
        click.echo(summary)
        return
    click.echo(f"ERROR: {payload.get('error', {}).get('message', 'Unknown error')}")

