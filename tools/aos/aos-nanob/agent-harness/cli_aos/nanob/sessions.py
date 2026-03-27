from __future__ import annotations

import json
from datetime import datetime, timezone
from pathlib import Path

from .constants import SESSIONS_DIR
from .errors import CliError


def _ensure_dir() -> None:
    SESSIONS_DIR.mkdir(parents=True, exist_ok=True)


def _session_path(name: str) -> Path:
    return SESSIONS_DIR / f"{name}.json"


def create(name: str) -> dict:
    """Create a new session with the given name."""
    _ensure_dir()
    path = _session_path(name)
    if path.exists():
        raise CliError(
            code="SESSION_EXISTS",
            message=f"Session already exists: {name}",
            exit_code=1,
            details={"name": name, "path": str(path)},
        )

    session = {
        "name": name,
        "created_at": datetime.now(timezone.utc).isoformat(),
        "updated_at": datetime.now(timezone.utc).isoformat(),
        "images": [],
        "references": [],
    }
    path.write_text(json.dumps(session, indent=2))
    return session


def list_sessions() -> list[dict]:
    """List all session files."""
    _ensure_dir()
    sessions = []
    for path in sorted(SESSIONS_DIR.glob("*.json")):
        try:
            data = json.loads(path.read_text())
            sessions.append({
                "name": data.get("name", path.stem),
                "created_at": data.get("created_at", ""),
                "image_count": len(data.get("images", [])),
                "reference_count": len(data.get("references", [])),
                "path": str(path),
            })
        except (json.JSONDecodeError, KeyError):
            sessions.append({
                "name": path.stem,
                "created_at": "",
                "image_count": 0,
                "reference_count": 0,
                "path": str(path),
                "error": "corrupt session file",
            })
    return sessions


def get(name: str) -> dict:
    """Load a session by name."""
    path = _session_path(name)
    if not path.exists():
        raise CliError(
            code="SESSION_NOT_FOUND",
            message=f"Session not found: {name}",
            exit_code=1,
            details={"name": name},
        )
    return json.loads(path.read_text())


def add_image(name: str, image_path: str, prompt: str) -> dict:
    """Track a generated image in a session."""
    session = get(name)
    session["images"].append({
        "path": image_path,
        "prompt": prompt,
        "generated_at": datetime.now(timezone.utc).isoformat(),
    })
    session["updated_at"] = datetime.now(timezone.utc).isoformat()
    _session_path(name).write_text(json.dumps(session, indent=2))
    return session


def add_reference(name: str, ref_path: str) -> dict:
    """Track a reference image in a session."""
    session = get(name)
    session["references"].append({
        "path": ref_path,
        "added_at": datetime.now(timezone.utc).isoformat(),
    })
    session["updated_at"] = datetime.now(timezone.utc).isoformat()
    _session_path(name).write_text(json.dumps(session, indent=2))
    return session
