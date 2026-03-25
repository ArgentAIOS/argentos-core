from __future__ import annotations

import json
import time
from datetime import datetime, timezone


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def meta(started: float, mode: str, version: str) -> dict:
    return {
        "mode": mode,
        "duration_ms": int((time.time() - started) * 1000),
        "timestamp": now_iso(),
        "version": version,
    }


def success(tool: str, command: str, data: dict, started: float, mode: str, version: str) -> dict:
    return {
        "ok": True,
        "tool": tool,
        "command": command,
        "data": data,
        "meta": meta(started, mode, version),
    }


def failure(tool: str, command: str, error: dict, started: float, mode: str, version: str) -> dict:
    return {
        "ok": False,
        "tool": tool,
        "command": command,
        "error": error,
        "meta": meta(started, mode, version),
    }


def emit(payload: dict, as_json: bool) -> None:
    if as_json:
        print(json.dumps(payload, indent=2, sort_keys=True))
        return
    if payload.get("ok"):
        data = payload.get("data", {})
        preview = data.get("scope_preview")
        if isinstance(preview, dict):
            preview_text = data.get("summary") or preview.get("command_id") or preview.get("resource") or "OK"
        else:
            preview_text = preview
        print(preview_text or data.get("summary") or "OK")
    else:
        print(f"ERROR [{payload['error']['code']}]: {payload['error']['message']}")
