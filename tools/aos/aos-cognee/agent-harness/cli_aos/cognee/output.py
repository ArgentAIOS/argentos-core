from __future__ import annotations

import json
import time
from datetime import datetime, timezone

from . import __version__

TOOL_NAME = "aos-cognee"


def _meta(started: float, mode: str) -> dict:
    return {
        "mode": mode,
        "duration_ms": int((time.time() - started) * 1000),
        "timestamp": datetime.now(timezone.utc).isoformat(),
        "version": __version__,
    }


def success(*, command: str, mode: str, started: float, data: dict) -> dict:
    return {
        "ok": True,
        "tool": TOOL_NAME,
        "command": command,
        "data": data,
        "meta": _meta(started, mode),
    }


def failure(*, command: str, mode: str, started: float, error: dict) -> dict:
    return {
        "ok": False,
        "tool": TOOL_NAME,
        "command": command,
        "error": error,
        "meta": _meta(started, mode),
    }


def emit(payload: dict, as_json: bool) -> None:
    if as_json:
        print(json.dumps(payload, indent=2, sort_keys=True))
        return
    if payload.get("ok"):
        print("OK")
        return
    error = payload.get("error") or {}
    print(f"ERROR [{error.get('code', 'ERROR')}]: {error.get('message', 'Unknown error')}")
