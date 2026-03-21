from __future__ import annotations

import json
import time
from datetime import datetime, timezone

import click


def _meta(*, mode: str, started: float, version: str) -> dict[str, object]:
    return {
        "mode": mode,
        "duration_ms": int((time.time() - started) * 1000),
        "timestamp": datetime.now(timezone.utc).isoformat(),
        "version": version,
    }


def success(*, tool: str, command: str, data: dict[str, object], started: float, mode: str, version: str) -> dict[str, object]:
    return {
        "ok": True,
        "tool": tool,
        "command": command,
        "data": data,
        "meta": _meta(mode=mode, started=started, version=version),
    }


def failure(
    *,
    tool: str,
    command: str,
    error: dict[str, object],
    started: float,
    mode: str,
    version: str,
) -> dict[str, object]:
    return {
        "ok": False,
        "tool": tool,
        "command": command,
        "error": error,
        "meta": _meta(mode=mode, started=started, version=version),
    }


def emit(payload: dict[str, object], *, as_json: bool) -> None:
    if as_json:
        click.echo(json.dumps(payload, indent=2, sort_keys=True))
        return

    if payload.get("ok"):
        click.echo("OK")
        return

    error = payload.get("error", {})
    message = error.get("message", "Unknown error") if isinstance(error, dict) else "Unknown error"
    click.echo(f"ERROR: {message}")
