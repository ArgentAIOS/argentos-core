from __future__ import annotations

import json
import sys
import time
from typing import Any


def _duration(started: float) -> float:
    return max(time.time() - started, 0.0)


def success(*, tool: str, backend: str, command: str, data: Any, started: float, mode: str, version: str) -> dict[str, Any]:
    ended = time.time()
    return {
        "status": "ok",
        "tool": tool,
        "backend": backend,
        "command": command,
        "mode": mode,
        "version": version,
        "started": started,
        "ended": ended,
        "duration_seconds": round(ended - started, 3),
        "data": data,
    }


def failure(*, tool: str, command: str, error: dict[str, Any], started: float, mode: str, version: str, backend: str) -> dict[str, Any]:
    ended = time.time()
    return {
        "status": "error",
        "tool": tool,
        "backend": backend,
        "command": command,
        "mode": mode,
        "version": version,
        "started": started,
        "ended": ended,
        "duration_seconds": round(ended - started, 3),
        "error": error,
    }


def emit(payload: Any, *, as_json: bool) -> None:
    text = json.dumps(payload, indent=2, sort_keys=True, ensure_ascii=False) if as_json else json.dumps(payload, sort_keys=True, ensure_ascii=False)
    sys.stdout.write(text)
    sys.stdout.write("\n")
