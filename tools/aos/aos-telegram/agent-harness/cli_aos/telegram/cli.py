from __future__ import annotations

import json
import os
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Any
from urllib import error, parse, request

import click

from . import __version__

TOOL_NAME = "aos-telegram"
BACKEND = "telegram-bot-api"
MODE_ORDER = ["readonly", "write", "full", "admin"]
HARNESS_DIR = Path(__file__).resolve().parents[2]
CONNECTOR_PATH = HARNESS_DIR.parent / "connector.json"
PERMISSIONS_PATH = HARNESS_DIR / "permissions.json"
TOKEN_ENV = "TELEGRAM_BOT_TOKEN"
CHAT_ID_ENV = "TELEGRAM_CHAT_ID"


class HarnessError(Exception):
    def __init__(self, code: str, message: str, exit_code: int = 4, details: dict[str, Any] | None = None) -> None:
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


def _token() -> str | None:
    return (os.environ.get(TOKEN_ENV) or "").strip() or None


def _result(*, ok: bool, command: str, mode: str, started: float, data: dict[str, Any] | None = None, error_payload: dict[str, Any] | None = None) -> dict[str, Any]:
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
        payload["error"] = error_payload or {"code": "INTERNAL_ERROR", "message": "Unknown error"}
    return payload


def _emit(ctx: click.Context, payload: dict[str, Any]) -> None:
    if ctx.obj.get("json"):
        click.echo(json.dumps(payload, indent=2, sort_keys=True))
        return
    if payload.get("ok"):
        data = payload.get("data", {})
        click.echo(str(data.get("summary") or "OK") if isinstance(data, dict) else "OK")
        return
    error_payload = payload.get("error", {})
    click.echo(f"ERROR: {error_payload.get('message', 'Unknown error')}")


def _fail(ctx: click.Context, command_id: str, err: HarnessError) -> None:
    _emit(
        ctx,
        _result(
            ok=False,
            command=command_id,
            mode=ctx.obj["mode"],
            started=ctx.obj["started"],
            error_payload={"code": err.code, "message": err.message, "details": err.details},
        ),
    )
    raise SystemExit(err.exit_code)


def _require_mode(ctx: click.Context, command_id: str) -> None:
    required = _permissions().get(command_id, "admin")
    if _mode_allows(ctx.obj["mode"], required):
        return
    raise HarnessError("PERMISSION_DENIED", f"Command requires mode={required}", 3, {"required_mode": required, "actual_mode": ctx.obj["mode"]})


def _api_request(method: str, token: str, params: dict[str, Any] | None = None) -> dict[str, Any]:
    encoded = parse.urlencode(params or {}).encode("utf-8")
    req = request.Request(f"https://api.telegram.org/bot{token}/{method}", data=encoded if encoded else None, method="POST" if encoded else "GET")
    try:
        with request.urlopen(req, timeout=20) as response:
            payload = json.loads(response.read().decode("utf-8"))
    except error.HTTPError as exc:
        raw = exc.read().decode("utf-8", "replace") if hasattr(exc, "read") else ""
        raise HarnessError("TELEGRAM_API_ERROR", "Telegram API returned an error.", 4, {"status": exc.code, "body": raw[:2000]}) from exc
    except error.URLError as exc:
        raise HarnessError("TELEGRAM_BACKEND_UNAVAILABLE", "Telegram API is unreachable.", 5, {"reason": str(exc.reason)}) from exc
    if not payload.get("ok"):
        raise HarnessError("TELEGRAM_API_ERROR", "Telegram API rejected the request.", 4, {"body": payload})
    return payload


def _health_snapshot() -> dict[str, Any]:
    token = _token()
    if not token:
        return {
            "status": "needs_setup",
            "runtime_ready": False,
            "summary": "Set TELEGRAM_BOT_TOKEN before using live Telegram commands.",
            "checks": [{"name": "bot_token", "ok": False, "details": {"missing_keys": [TOKEN_ENV]}}],
        }
    try:
        payload = _api_request("getMe", token)
    except HarnessError as err:
        return {
            "status": "auth_error" if err.code == "TELEGRAM_API_ERROR" else "degraded",
            "runtime_ready": False,
            "summary": err.message,
            "checks": [{"name": "getMe", "ok": False, "details": err.details}],
        }
    return {
        "status": "healthy",
        "runtime_ready": True,
        "summary": "Telegram bot API probe succeeded.",
        "checks": [{"name": "getMe", "ok": True}],
        "bot": payload.get("result"),
    }


def _send_message(chat_id: str | None, text: str) -> dict[str, Any]:
    token = _token()
    if not token:
        raise HarnessError("TELEGRAM_CONFIG_MISSING", "Set TELEGRAM_BOT_TOKEN before sending messages.", 4, {"missing_keys": [TOKEN_ENV]})
    resolved_chat_id = (chat_id or os.environ.get(CHAT_ID_ENV) or "").strip()
    if not resolved_chat_id:
        raise HarnessError("TELEGRAM_CHAT_REQUIRED", "message.send requires a chat_id or TELEGRAM_CHAT_ID.", 2, {"missing_keys": [CHAT_ID_ENV]})
    if not text.strip():
        raise HarnessError("INVALID_USAGE", "message.send requires non-empty text.", 2)
    payload = _api_request("sendMessage", token, {"chat_id": resolved_chat_id, "text": text})
    return {
        "status": "live_write",
        "backend": BACKEND,
        "summary": f"Telegram message sent to {resolved_chat_id}.",
        "result": payload.get("result"),
    }


@click.group()
@click.option("--json", "as_json", is_flag=True, help="Emit JSON output")
@click.option("--mode", type=click.Choice(MODE_ORDER), default="readonly", show_default=True)
@click.pass_context
def cli(ctx: click.Context, as_json: bool, mode: str) -> None:
    ctx.ensure_object(dict)
    ctx.obj.update({"json": as_json, "mode": mode, "started": time.time()})


@cli.command("capabilities")
@click.pass_context
def capabilities(ctx: click.Context) -> None:
    _require_mode(ctx, "capabilities")
    manifest = _manifest()
    _emit(ctx, {"ok": True, "tool": TOOL_NAME, "data": {**manifest, "version": __version__, "modes": MODE_ORDER}})


def _emit_health(ctx: click.Context, command_id: str) -> None:
    _require_mode(ctx, command_id)
    _emit(ctx, _result(ok=True, command=command_id, mode=ctx.obj["mode"], started=ctx.obj["started"], data=_health_snapshot()))


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
        "summary": "Telegram connector configuration snapshot.",
        "auth": {"bot_token_source": "env" if _token() else "missing", "chat_id_source": "env" if os.environ.get(CHAT_ID_ENV) else "missing"},
    }
    _emit(ctx, _result(ok=True, command="config.show", mode=ctx.obj["mode"], started=ctx.obj["started"], data=data))


@cli.command("doctor")
@click.pass_context
def doctor(ctx: click.Context) -> None:
    _require_mode(ctx, "doctor")
    health = _health_snapshot()
    _emit(ctx, _result(ok=True, command="doctor", mode=ctx.obj["mode"], started=ctx.obj["started"], data={**health, "summary": "Telegram connector diagnostics."}))


@cli.group("message")
def message_group() -> None:
    pass


@message_group.command("send")
@click.option("--chat-id", default=None)
@click.option("--text", required=True)
@click.pass_context
def message_send(ctx: click.Context, chat_id: str | None, text: str) -> None:
    command_id = "message.send"
    try:
        _require_mode(ctx, command_id)
        data = _send_message(chat_id, text)
    except HarnessError as err:
        _fail(ctx, command_id, err)
    _emit(ctx, _result(ok=True, command=command_id, mode=ctx.obj["mode"], started=ctx.obj["started"], data=data))


if __name__ == "__main__":
    cli()
