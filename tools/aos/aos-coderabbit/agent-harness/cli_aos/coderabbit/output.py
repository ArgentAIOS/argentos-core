from __future__ import annotations

import json
import sys
import time
from typing import Any

from .constants import TOOL_NAME


def _stamp(started: float) -> dict[str, Any]:
    return {
        "duration_ms": int((time.time() - started) * 1000),
        "timestamp": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
    }


def success(*, command: str, mode: str, started: float, data: dict[str, Any]) -> dict[str, Any]:
    return {
        "ok": True,
        "tool": TOOL_NAME,
        "command": command,
        "meta": {"mode": mode, **_stamp(started)},
        "data": data,
    }


def failure(*, command: str, mode: str, started: float, error: dict[str, Any]) -> dict[str, Any]:
    return {
        "ok": False,
        "tool": TOOL_NAME,
        "command": command,
        "meta": {"mode": mode, **_stamp(started)},
        "error": error,
    }


def emit(payload: dict[str, Any], *, as_json: bool) -> None:
    if as_json:
        sys.stdout.write(json.dumps(payload, indent=2, sort_keys=True) + "\n")
        return
    if payload.get("ok"):
        sys.stdout.write(f"{payload['command']}: {payload.get('data', {}).get('summary', 'OK')}\n")
        return
    error = payload.get("error", {})
    sys.stdout.write(f"{payload['command']}: {error.get('code', 'ERROR')} {error.get('message', '')}\n")
