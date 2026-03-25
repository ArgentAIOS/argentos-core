from __future__ import annotations

import json
from typing import Any

import click


def emit(payload: dict[str, Any], *, as_json: bool) -> None:
    if as_json:
        click.echo(json.dumps(payload, indent=2, sort_keys=True))
        return
    if payload.get("ok"):
        click.echo(payload.get("data", {}).get("summary") or "OK")
        return
    click.echo(f"ERROR: {payload.get('error', {}).get('message', 'Unknown error')}")


def success(*, tool: str, command: str, mode: str, started: float, version: str, data: dict[str, Any]) -> dict[str, Any]:
    return {
        "ok": True,
        "tool": tool,
        "command": command,
        "meta": {
            "mode": mode,
            "duration_ms": 0,
            "timestamp": None,
            "version": version,
        },
        "data": data,
    }


def failure(*, tool: str, command: str, mode: str, started: float, version: str, error: dict[str, Any]) -> dict[str, Any]:
    return {
        "ok": False,
        "tool": tool,
        "command": command,
        "meta": {
            "mode": mode,
            "duration_ms": 0,
            "timestamp": None,
            "version": version,
        },
        "error": error,
    }

