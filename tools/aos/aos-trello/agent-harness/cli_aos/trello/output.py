from __future__ import annotations

import json
from typing import Any

import click


def emit(payload: dict[str, Any], as_json: bool) -> None:
    if as_json:
        click.echo(json.dumps(payload, indent=2, sort_keys=True))
        return
    if payload.get("ok"):
        summary = payload.get("data", {}).get("summary")
        click.echo(summary or "OK")
    else:
        error = payload.get("error", {})
        click.echo(f"ERROR: {error.get('message', 'Unknown error')}")


def success(*, tool: str, command: str, data: dict[str, Any], started: float, mode: str, version: str) -> dict[str, Any]:
    from datetime import datetime, timezone
    from time import time

    return {
        "ok": True,
        "tool": tool,
        "command": command,
        "data": data,
        "meta": {
            "mode": mode,
            "duration_ms": int((time() - started) * 1000),
            "timestamp": datetime.now(timezone.utc).isoformat(),
            "version": version,
        },
    }


def failure(*, tool: str, command: str, error: dict[str, Any], started: float, mode: str, version: str) -> dict[str, Any]:
    from datetime import datetime, timezone
    from time import time

    return {
        "ok": False,
        "tool": tool,
        "command": command,
        "error": error,
        "meta": {
            "mode": mode,
            "duration_ms": int((time() - started) * 1000),
            "timestamp": datetime.now(timezone.utc).isoformat(),
            "version": version,
        },
    }
