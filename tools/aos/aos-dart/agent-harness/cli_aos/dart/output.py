from __future__ import annotations

import json
import time
from datetime import datetime, timezone
from typing import Any

import click


def _timestamp() -> str:
    return datetime.now(timezone.utc).isoformat()


def success(*, tool: str, command: str, data: Any, started: float, mode: str, version: str) -> dict[str, Any]:
    return {
        "ok": True,
        "tool": tool,
        "command": command,
        "data": data,
        "meta": {
            "mode": mode,
            "duration_ms": int((time.time() - started) * 1000),
            "timestamp": _timestamp(),
            "version": version,
        },
    }


def failure(*, tool: str, command: str, error: dict[str, Any], started: float, mode: str, version: str) -> dict[str, Any]:
    return {
        "ok": False,
        "tool": tool,
        "command": command,
        "error": error,
        "meta": {
            "mode": mode,
            "duration_ms": int((time.time() - started) * 1000),
            "timestamp": _timestamp(),
            "version": version,
        },
    }


def emit(payload: Any, *, as_json: bool) -> None:
    if as_json:
        click.echo(json.dumps(payload, indent=2, sort_keys=True))
        return
    if payload.get("ok"):
        data = payload.get("data", {})
        summary = data.get("summary") or payload.get("command") or "OK"
        click.echo(summary)
        return
    click.echo(f"ERROR: {payload.get('error', {}).get('message', 'Unknown error')}")
