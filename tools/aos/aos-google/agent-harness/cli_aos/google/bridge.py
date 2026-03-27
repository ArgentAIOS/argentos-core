from __future__ import annotations

import json
import shutil
import subprocess

from .errors import CliError


def ensure_gws_exists(gws_bin: str) -> None:
    if shutil.which(gws_bin):
        return
    raise CliError(
        code="BACKEND_UNAVAILABLE",
        message=f"gws binary not found on PATH: {gws_bin}",
        exit_code=5,
    )


def run_gws(gws_bin: str, args: list[str], env: dict[str, str] | None = None) -> dict:
    ensure_gws_exists(gws_bin)
    cmd = [gws_bin, "--json", *args]

    try:
        proc = subprocess.run(
            cmd,
            capture_output=True,
            text=True,
            check=False,
            env=env,
        )
    except OSError as exc:
        raise CliError(
            code="BACKEND_UNAVAILABLE",
            message=str(exc),
            exit_code=5,
        ) from exc

    stdout = (proc.stdout or "").strip()
    stderr = (proc.stderr or "").strip()

    if proc.returncode != 0:
        raise CliError(
            code="BACKEND_ERROR",
            message="gws command failed",
            exit_code=5,
            details={"returncode": proc.returncode, "stderr": stderr, "stdout": stdout},
        )

    if not stdout:
        return {"raw": ""}

    try:
        return json.loads(stdout)
    except json.JSONDecodeError:
        return {"raw": stdout}


def probe_gws(gws_bin: str, args: list[str], env: dict[str, str] | None = None) -> dict:
    ensure_gws_exists(gws_bin)
    cmd = [gws_bin, *args]
    try:
        proc = subprocess.run(
            cmd,
            capture_output=True,
            text=True,
            check=False,
            env=env,
        )
    except OSError as exc:
        return {"ok": False, "returncode": 127, "stdout": "", "stderr": str(exc)}

    return {
        "ok": proc.returncode == 0,
        "returncode": proc.returncode,
        "stdout": (proc.stdout or "").strip(),
        "stderr": (proc.stderr or "").strip(),
    }
