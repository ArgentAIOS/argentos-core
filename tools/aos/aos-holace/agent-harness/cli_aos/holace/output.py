from __future__ import annotations

from datetime import datetime, timezone
import json
import sys
import time
from typing import Any


def _meta(*, mode: str, started: float, version: str) -> dict[str, Any]:
    return {
        "mode": mode,
        "duration_ms": max(0, int((time.time() - started) * 1000)),
        "timestamp": datetime.now(timezone.utc).isoformat().replace("+00:00", "Z"),
        "version": version,
    }


def success(*, command: str, mode: str, started: float, version: str, data: dict[str, Any]) -> dict[str, Any]:
    return {"ok": True, "tool": "aos-holace", "command": command, "data": data, "meta": _meta(mode=mode, started=started, version=version)}


def failure(*, command: str, mode: str, started: float, version: str, error: dict[str, Any]) -> dict[str, Any]:
    return {"ok": False, "tool": "aos-holace", "command": command, "error": error, "meta": _meta(mode=mode, started=started, version=version)}


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
