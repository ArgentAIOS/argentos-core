from __future__ import annotations

import json
import sys
from typing import Any


def success(*, command: str, mode: str, started: float, data: dict[str, Any]) -> dict[str, Any]:
    return {
        "ok": True,
        "tool": "aos-hootsuite",
        "command": command,
        "mode": mode,
        "started": started,
        "data": data,
    }


def failure(*, command: str, mode: str, started: float, error: dict[str, Any]) -> dict[str, Any]:
    return {
        "ok": False,
        "tool": "aos-hootsuite",
        "command": command,
        "mode": mode,
        "started": started,
        "error": error,
    }


def emit(payload: dict[str, Any], *, as_json: bool) -> None:
    if as_json:
        json.dump(payload, sys.stdout, ensure_ascii=False)
        sys.stdout.write("\n")
        return
    if payload.get("ok"):
        sys.stdout.write(f"{payload.get('command')}: ok\n")
        return
    error = payload.get("error", {})
    sys.stdout.write(f"{payload.get('command')}: error: {error.get('message', 'unknown error')}\n")
