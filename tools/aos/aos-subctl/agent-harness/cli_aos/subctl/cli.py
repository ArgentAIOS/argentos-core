from __future__ import annotations

import json
import os
import shutil
import subprocess
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Any
from urllib import error, parse, request

import click

from . import __version__

TOOL_NAME = "aos-subctl"
BACKEND = "subctl-http"
MODE_ORDER = ["readonly", "write", "full", "admin"]
HARNESS_DIR = Path(__file__).resolve().parents[2]
CONNECTOR_PATH = HARNESS_DIR.parent / "connector.json"
PERMISSIONS_PATH = HARNESS_DIR / "permissions.json"

# Defaults match subctl's localhost-only deployment model.
DEFAULT_API = "http://127.0.0.1:8787"
DEFAULT_BIN = str(Path.home() / ".subctl" / "bin" / "subctl")
API_ENV = "SUBCTL_API"
BIN_ENV = "SUBCTL_BIN"


class HarnessError(Exception):
    def __init__(
        self,
        code: str,
        message: str,
        exit_code: int = 4,
        details: dict[str, Any] | None = None,
    ) -> None:
        super().__init__(message)
        self.code = code
        self.message = message
        self.exit_code = exit_code
        self.details = details or {}


def _mode_allows(actual: str, required: str) -> bool:
    return MODE_ORDER.index(actual) >= MODE_ORDER.index(required)


def _permissions() -> dict[str, str]:
    return json.loads(PERMISSIONS_PATH.read_text()).get("permissions", {})


def _manifest() -> dict[str, Any]:
    return json.loads(CONNECTOR_PATH.read_text())


def _api_base() -> str:
    return (os.environ.get(API_ENV) or DEFAULT_API).rstrip("/")


def _bin_path() -> str:
    return os.environ.get(BIN_ENV) or DEFAULT_BIN


def _result(
    *,
    ok: bool,
    command: str,
    mode: str,
    started: float,
    data: dict[str, Any] | None = None,
    error_payload: dict[str, Any] | None = None,
) -> dict[str, Any]:
    payload: dict[str, Any] = {
        "ok": ok,
        "tool": TOOL_NAME,
        "command": command,
        "meta": {
            "mode": mode,
            "duration_ms": int((time.time() - started) * 1000),
            "timestamp": datetime.now(timezone.utc).isoformat(),
            "version": __version__,
        },
    }
    if ok:
        payload["data"] = data or {}
    else:
        payload["error"] = error_payload or {
            "code": "INTERNAL_ERROR",
            "message": "Unknown error",
        }
    return payload


def _emit(ctx: click.Context, payload: dict[str, Any]) -> None:
    if ctx.obj.get("json"):
        click.echo(json.dumps(payload, indent=2, sort_keys=True))
        return
    if payload.get("ok"):
        data = payload.get("data", {})
        if isinstance(data, dict):
            click.echo(str(data.get("summary") or "OK"))
        else:
            click.echo("OK")
        return
    err = payload.get("error", {})
    click.echo(f"ERROR: {err.get('message', 'Unknown error')}")


def _fail(ctx: click.Context, command_id: str, err: HarnessError) -> None:
    _emit(
        ctx,
        _result(
            ok=False,
            command=command_id,
            mode=ctx.obj["mode"],
            started=ctx.obj["started"],
            error_payload={
                "code": err.code,
                "message": err.message,
                "details": err.details,
            },
        ),
    )
    raise SystemExit(err.exit_code)


def _require_mode(ctx: click.Context, command_id: str) -> None:
    required = _permissions().get(command_id, "admin")
    if _mode_allows(ctx.obj["mode"], required):
        return
    raise HarnessError(
        "PERMISSION_DENIED",
        f"Command requires mode={required}",
        3,
        {"required_mode": required, "actual_mode": ctx.obj["mode"]},
    )


# ---- HTTP helpers --------------------------------------------------------

def _http_request(
    method: str,
    path: str,
    body: dict[str, Any] | None = None,
    timeout: int = 20,
) -> dict[str, Any]:
    url = f"{_api_base()}{path}"
    data = json.dumps(body).encode("utf-8") if body is not None else None
    headers = {"Accept": "application/json"}
    if data is not None:
        headers["Content-Type"] = "application/json"
    req = request.Request(url, data=data, method=method, headers=headers)
    try:
        with request.urlopen(req, timeout=timeout) as response:
            raw = response.read().decode("utf-8")
    except error.HTTPError as exc:
        raw = exc.read().decode("utf-8", "replace") if hasattr(exc, "read") else ""
        raise HarnessError(
            "SUBCTL_HTTP_ERROR",
            f"subctl returned HTTP {exc.code} for {method} {path}",
            4,
            {"status": exc.code, "body": raw[:2000]},
        ) from exc
    except error.URLError as exc:
        raise HarnessError(
            "SUBCTL_BACKEND_UNAVAILABLE",
            f"subctl dashboard unreachable at {_api_base()} (run `subctl service enable`)",
            5,
            {"reason": str(exc.reason), "api_base": _api_base()},
        ) from exc
    if not raw:
        return {}
    try:
        return json.loads(raw)
    except json.JSONDecodeError:
        return {"raw": raw}


def _bin_exec(args: list[str], timeout: int = 30) -> dict[str, Any]:
    """Shell out to bin/subctl for verbs with no HTTP equivalent (notify send)."""
    binary = _bin_path()
    if not Path(binary).exists() and not shutil.which(binary):
        raise HarnessError(
            "SUBCTL_BIN_MISSING",
            f"subctl binary not found at {binary}",
            5,
            {"bin_path": binary, "hint": "set SUBCTL_BIN or run `subctl install`"},
        )
    try:
        result = subprocess.run(
            [binary, *args],
            capture_output=True,
            text=True,
            timeout=timeout,
            check=False,
        )
    except subprocess.TimeoutExpired as exc:
        raise HarnessError(
            "SUBCTL_BIN_TIMEOUT",
            f"subctl {' '.join(args)} timed out after {timeout}s",
            5,
            {"timeout_s": timeout},
        ) from exc
    return {
        "exit_code": result.returncode,
        "stdout": result.stdout,
        "stderr": result.stderr,
    }


# ---- Health / config -----------------------------------------------------

def _health_snapshot() -> dict[str, Any]:
    try:
        state = _http_request("GET", "/api/state")
    except HarnessError as err:
        return {
            "status": "degraded" if err.code == "SUBCTL_BACKEND_UNAVAILABLE" else "auth_error",
            "runtime_ready": False,
            "summary": err.message,
            "checks": [{"name": "GET /api/state", "ok": False, "details": err.details}],
            "api_base": _api_base(),
        }
    verdict = (state.get("dispatch") or {}).get("verdict") or "unknown"
    accounts = state.get("accounts") or []
    sessions = state.get("sessions") or []
    return {
        "status": "healthy",
        "runtime_ready": True,
        "summary": (
            f"subctl reachable at {_api_base()} — verdict {verdict}, "
            f"{len(accounts)} accounts, {len(sessions)} tmux sessions."
        ),
        "checks": [{"name": "GET /api/state", "ok": True}],
        "api_base": _api_base(),
        "verdict": verdict,
        "accounts_count": len(accounts),
        "sessions_count": len(sessions),
    }


# ---- CLI -----------------------------------------------------------------

@click.group()
@click.option("--json", "as_json", is_flag=True, help="Emit JSON output")
@click.option(
    "--mode",
    type=click.Choice(MODE_ORDER),
    default="readonly",
    show_default=True,
)
@click.pass_context
def cli(ctx: click.Context, as_json: bool, mode: str) -> None:
    ctx.ensure_object(dict)
    ctx.obj.update({"json": as_json, "mode": mode, "started": time.time()})


@cli.command("capabilities")
@click.pass_context
def capabilities(ctx: click.Context) -> None:
    _require_mode(ctx, "capabilities")
    manifest = _manifest()
    _emit(
        ctx,
        {
            "ok": True,
            "tool": TOOL_NAME,
            "data": {**manifest, "version": __version__, "modes": MODE_ORDER},
        },
    )


def _emit_health(ctx: click.Context, command_id: str) -> None:
    _require_mode(ctx, command_id)
    _emit(
        ctx,
        _result(
            ok=True,
            command=command_id,
            mode=ctx.obj["mode"],
            started=ctx.obj["started"],
            data=_health_snapshot(),
        ),
    )


@cli.command("health")
@click.pass_context
def health(ctx: click.Context) -> None:
    _emit_health(ctx, "health")


@cli.command("health.check")
@click.pass_context
def health_check(ctx: click.Context) -> None:
    _emit_health(ctx, "health.check")


@cli.group("config")
def config_group() -> None:
    pass


@config_group.command("show")
@click.pass_context
def config_show(ctx: click.Context) -> None:
    _require_mode(ctx, "config.show")
    data = {
        "summary": "subctl connector configuration snapshot.",
        "api_base": _api_base(),
        "bin_path": _bin_path(),
        "auth": {
            "api_source": "env" if os.environ.get(API_ENV) else "default",
            "bin_source": "env" if os.environ.get(BIN_ENV) else "default",
        },
    }
    _emit(
        ctx,
        _result(
            ok=True,
            command="config.show",
            mode=ctx.obj["mode"],
            started=ctx.obj["started"],
            data=data,
        ),
    )


@cli.command("doctor")
@click.pass_context
def doctor(ctx: click.Context) -> None:
    _require_mode(ctx, "doctor")
    snap = _health_snapshot()
    _emit(
        ctx,
        _result(
            ok=True,
            command="doctor",
            mode=ctx.obj["mode"],
            started=ctx.obj["started"],
            data={**snap, "summary": "subctl connector diagnostics."},
        ),
    )


# ---- state ---------------------------------------------------------------

@cli.group("state")
def state_group() -> None:
    pass


@state_group.command("get")
@click.pass_context
def state_get(ctx: click.Context) -> None:
    command_id = "state.get"
    try:
        _require_mode(ctx, command_id)
        state = _http_request("GET", "/api/state")
    except HarnessError as err:
        _fail(ctx, command_id, err)
    summary = (
        f"verdict={(state.get('dispatch') or {}).get('verdict', '?')} "
        f"accounts={len(state.get('accounts') or [])} "
        f"sessions={len(state.get('sessions') or [])}"
    )
    _emit(
        ctx,
        _result(
            ok=True,
            command=command_id,
            mode=ctx.obj["mode"],
            started=ctx.obj["started"],
            data={"summary": summary, "state": state},
        ),
    )


# ---- orchestration -------------------------------------------------------

@cli.group("orchestration")
def orch_group() -> None:
    pass


@orch_group.command("list")
@click.pass_context
def orch_list(ctx: click.Context) -> None:
    command_id = "orchestration.list"
    try:
        _require_mode(ctx, command_id)
        body = _http_request("GET", "/api/orchestration")
    except HarnessError as err:
        _fail(ctx, command_id, err)
    sessions = body.get("orchestrations") or []
    _emit(
        ctx,
        _result(
            ok=True,
            command=command_id,
            mode=ctx.obj["mode"],
            started=ctx.obj["started"],
            data={
                "summary": f"{len(sessions)} orchestrator sessions",
                "sessions": sessions,
            },
        ),
    )


@orch_group.command("status")
@click.option("--name", required=True)
@click.pass_context
def orch_status(ctx: click.Context, name: str) -> None:
    command_id = "orchestration.status"
    try:
        _require_mode(ctx, command_id)
        body = _http_request("GET", f"/api/orchestration/{parse.quote(name)}")
    except HarnessError as err:
        _fail(ctx, command_id, err)
    if body.get("ok") is False:
        _fail(
            ctx,
            command_id,
            HarnessError(
                "SUBCTL_SESSION_NOT_FOUND",
                body.get("error") or f"session not found: {name}",
                4,
                {"name": name},
            ),
        )
    _emit(
        ctx,
        _result(
            ok=True,
            command=command_id,
            mode=ctx.obj["mode"],
            started=ctx.obj["started"],
            data={"summary": f"status for {name}", **body},
        ),
    )


@orch_group.command("spawn")
@click.option("--name", required=True)
@click.option("--account", required=True)
@click.option("--task", required=True)
@click.pass_context
def orch_spawn(
    ctx: click.Context, name: str, account: str, task: str
) -> None:
    command_id = "orchestration.spawn"
    try:
        _require_mode(ctx, command_id)
        body = _http_request(
            "POST",
            "/api/orchestration/spawn",
            {"name": name, "account": account, "task": task},
        )
    except HarnessError as err:
        _fail(ctx, command_id, err)
    if body.get("ok") is False:
        _fail(
            ctx,
            command_id,
            HarnessError(
                "SUBCTL_SPAWN_FAILED",
                body.get("error") or "spawn failed",
                4,
                {"name": name, "account": account},
            ),
        )
    _emit(
        ctx,
        _result(
            ok=True,
            command=command_id,
            mode=ctx.obj["mode"],
            started=ctx.obj["started"],
            data={
                "status": "live_write",
                "backend": BACKEND,
                "summary": f"spawned orchestrator {name} on {account}",
                **body,
            },
        ),
    )


@orch_group.command("msg")
@click.option("--name", required=True)
@click.option("--text", required=True)
@click.pass_context
def orch_msg(ctx: click.Context, name: str, text: str) -> None:
    command_id = "orchestration.msg"
    try:
        _require_mode(ctx, command_id)
        body = _http_request(
            "POST",
            f"/api/orchestration/{parse.quote(name)}/msg",
            {"text": text},
        )
    except HarnessError as err:
        _fail(ctx, command_id, err)
    if body.get("ok") is False:
        _fail(
            ctx,
            command_id,
            HarnessError(
                "SUBCTL_MSG_FAILED",
                body.get("error") or "msg failed",
                4,
                {"name": name},
            ),
        )
    _emit(
        ctx,
        _result(
            ok=True,
            command=command_id,
            mode=ctx.obj["mode"],
            started=ctx.obj["started"],
            data={
                "status": "live_write",
                "backend": BACKEND,
                "summary": f"sent message to {name}",
                **body,
            },
        ),
    )


@orch_group.command("kill")
@click.option("--name", required=True)
@click.pass_context
def orch_kill(ctx: click.Context, name: str) -> None:
    command_id = "orchestration.kill"
    try:
        _require_mode(ctx, command_id)
        body = _http_request(
            "POST",
            f"/api/orchestration/{parse.quote(name)}/kill",
        )
    except HarnessError as err:
        _fail(ctx, command_id, err)
    if body.get("ok") is False:
        _fail(
            ctx,
            command_id,
            HarnessError(
                "SUBCTL_KILL_FAILED",
                body.get("error") or "kill failed",
                4,
                {"name": name},
            ),
        )
    _emit(
        ctx,
        _result(
            ok=True,
            command=command_id,
            mode=ctx.obj["mode"],
            started=ctx.obj["started"],
            data={
                "status": "live_write",
                "backend": BACKEND,
                "summary": f"killed orchestrator {name}",
                **body,
            },
        ),
    )


# ---- notify --------------------------------------------------------------

@cli.group("notify")
def notify_group() -> None:
    pass


@notify_group.command("send")
@click.option("--text", required=True)
@click.pass_context
def notify_send(ctx: click.Context, text: str) -> None:
    """notify.send shells out to bin/subctl — no HTTP equivalent yet."""
    command_id = "notify.send"
    try:
        _require_mode(ctx, command_id)
        if not text.strip():
            raise HarnessError("INVALID_USAGE", "notify.send requires non-empty text.", 2)
        result = _bin_exec(["notify", text])
        if result["exit_code"] != 0:
            raise HarnessError(
                "SUBCTL_NOTIFY_FAILED",
                result["stderr"].strip()
                or result["stdout"].strip()
                or f"subctl notify exit {result['exit_code']}",
                4,
                {"exit_code": result["exit_code"]},
            )
    except HarnessError as err:
        _fail(ctx, command_id, err)
    _emit(
        ctx,
        _result(
            ok=True,
            command=command_id,
            mode=ctx.obj["mode"],
            started=ctx.obj["started"],
            data={
                "status": "live_write",
                "backend": BACKEND,
                "summary": "Telegram message sent via subctl notify",
                "stdout": result["stdout"][:2000],
            },
        ),
    )


@notify_group.command("inbox")
@click.pass_context
def notify_inbox(ctx: click.Context) -> None:
    command_id = "notify.inbox"
    try:
        _require_mode(ctx, command_id)
        body = _http_request("GET", "/api/notify/inbox")
    except HarnessError as err:
        _fail(ctx, command_id, err)
    entries = body.get("entries") or []
    _emit(
        ctx,
        _result(
            ok=True,
            command=command_id,
            mode=ctx.obj["mode"],
            started=ctx.obj["started"],
            data={
                "summary": f"{len(entries)} inbox entries",
                "entries": entries,
                "listener": body.get("listener"),
            },
        ),
    )


@notify_group.command("inbox_ack")
@click.option("--id", "entry_id", required=True)
@click.pass_context
def notify_inbox_ack(ctx: click.Context, entry_id: str) -> None:
    command_id = "notify.inbox_ack"
    try:
        _require_mode(ctx, command_id)
        body = _http_request(
            "POST",
            f"/api/notify/inbox/{parse.quote(entry_id)}/ack",
        )
    except HarnessError as err:
        _fail(ctx, command_id, err)
    if body.get("ok") is False:
        _fail(
            ctx,
            command_id,
            HarnessError(
                "SUBCTL_INBOX_ACK_FAILED",
                body.get("error") or "ack failed",
                4,
                {"id": entry_id},
            ),
        )
    _emit(
        ctx,
        _result(
            ok=True,
            command=command_id,
            mode=ctx.obj["mode"],
            started=ctx.obj["started"],
            data={
                "status": "live_write",
                "backend": BACKEND,
                "summary": f"ack'd inbox entry {entry_id}",
                **body,
            },
        ),
    )


if __name__ == "__main__":
    cli()
