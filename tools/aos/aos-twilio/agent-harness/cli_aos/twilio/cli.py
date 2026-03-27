from __future__ import annotations

import json
import time

import click

from . import __version__
from .config import config_snapshot
from .constants import MODE_ORDER, PERMISSIONS_PATH
from .errors import CliError
from .output import emit, failure, success
from .runtime import (
    call_create_result,
    call_list_result,
    call_status_result,
    capabilities_snapshot,
    doctor_snapshot,
    health_snapshot,
    lookup_phone_result,
    sms_list_result,
    sms_read_result,
    sms_send_result,
    whatsapp_list_result,
    whatsapp_send_result,
)


def _mode_allows(actual: str, required: str) -> bool:
    return MODE_ORDER.index(actual) >= MODE_ORDER.index(required)


def _load_permissions() -> dict[str, str]:
    payload = json.loads(PERMISSIONS_PATH.read_text())
    return payload.get("permissions", {})


def require_mode(ctx: click.Context, command_id: str) -> None:
    required = _load_permissions().get(command_id, "admin")
    mode = ctx.obj["mode"]
    if _mode_allows(mode, required):
        return
    raise CliError(
        code="PERMISSION_DENIED",
        message=f"Command requires mode={required}",
        exit_code=3,
        details={"required_mode": required, "actual_mode": mode},
    )


class AosGroup(click.Group):
    def invoke(self, ctx: click.Context):
        try:
            return super().invoke(ctx)
        except CliError as err:
            emit(
                failure(
                    command=ctx.obj.get("_command_id", "unknown") if ctx.obj else "unknown",
                    mode=ctx.obj.get("mode", "unknown") if ctx.obj else "unknown",
                    started=ctx.obj.get("started", time.time()) if ctx.obj else time.time(),
                    error={"code": err.code, "message": err.message, "details": err.details},
                ),
                as_json=ctx.obj.get("json", True) if ctx.obj else True,
            )
            ctx.exit(err.exit_code)
        except click.ClickException as err:
            emit(
                failure(
                    command=ctx.obj.get("_command_id", "unknown") if ctx.obj else "unknown",
                    mode=ctx.obj.get("mode", "unknown") if ctx.obj else "unknown",
                    started=ctx.obj.get("started", time.time()) if ctx.obj else time.time(),
                    error={"code": "INVALID_USAGE", "message": str(err), "details": {}},
                ),
                as_json=ctx.obj.get("json", True) if ctx.obj else True,
            )
            ctx.exit(2)


def _set_command(ctx: click.Context, command_id: str) -> None:
    ctx.obj["_command_id"] = command_id


def _emit_success(ctx: click.Context, command_id: str, data: dict) -> None:
    emit(
        success(command=command_id, mode=ctx.obj["mode"], started=ctx.obj["started"], data=data),
        as_json=ctx.obj["json"],
    )


@click.group(cls=AosGroup)
@click.option("--json", "as_json", is_flag=True, help="Emit JSON output")
@click.option("--mode", type=click.Choice(MODE_ORDER), default="readonly", show_default=True)
@click.option("--verbose", is_flag=True, help="Verbose diagnostics")
@click.version_option(__version__)
@click.pass_context
def cli(ctx: click.Context, as_json: bool, mode: str, verbose: bool) -> None:
    ctx.ensure_object(dict)
    ctx.obj.update(
        {
            "json": as_json,
            "mode": mode,
            "verbose": verbose,
            "started": time.time(),
            "version": __version__,
            "_command_id": "unknown",
        }
    )


# ── Meta commands ────────────────────────────────────────────────────

@cli.command("capabilities")
@click.pass_context
def capabilities(ctx: click.Context) -> None:
    _set_command(ctx, "capabilities")
    require_mode(ctx, "capabilities")
    _emit_success(ctx, "capabilities", capabilities_snapshot())


@cli.group("config")
def config_group() -> None:
    pass


@config_group.command("show")
@click.pass_context
def config_show(ctx: click.Context) -> None:
    _set_command(ctx, "config.show")
    require_mode(ctx, "config.show")
    _emit_success(ctx, "config.show", config_snapshot(ctx.obj))


@cli.command("health")
@click.pass_context
def health(ctx: click.Context) -> None:
    _set_command(ctx, "health")
    require_mode(ctx, "health")
    _emit_success(ctx, "health", health_snapshot(ctx.obj))


@cli.command("doctor")
@click.pass_context
def doctor(ctx: click.Context) -> None:
    _set_command(ctx, "doctor")
    require_mode(ctx, "doctor")
    _emit_success(ctx, "doctor", doctor_snapshot(ctx.obj))


# ── SMS ──────────────────────────────────────────────────────────────

@cli.group("sms")
def sms_group() -> None:
    pass


@sms_group.command("send")
@click.option("--from", "from_number", default=None, help="Twilio phone number (E.164)")
@click.option("--to", "to_number", default=None, help="Destination phone number (E.164)")
@click.option("--body", default=None, help="Message body text")
@click.option("--status-callback", default=None, help="Webhook URL for delivery status")
@click.pass_context
def sms_send(ctx: click.Context, from_number: str | None, to_number: str | None, body: str | None, status_callback: str | None) -> None:
    _set_command(ctx, "sms.send")
    require_mode(ctx, "sms.send")
    _emit_success(
        ctx,
        "sms.send",
        sms_send_result(ctx.obj, from_number=from_number, to_number=to_number, body=body, status_callback=status_callback),
    )


@sms_group.command("list")
@click.option("--limit", default=20, show_default=True, type=int)
@click.pass_context
def sms_list(ctx: click.Context, limit: int) -> None:
    _set_command(ctx, "sms.list")
    require_mode(ctx, "sms.list")
    _emit_success(ctx, "sms.list", sms_list_result(ctx.obj, limit=limit))


@sms_group.command("read")
@click.argument("message_sid", required=False)
@click.pass_context
def sms_read(ctx: click.Context, message_sid: str | None) -> None:
    _set_command(ctx, "sms.read")
    require_mode(ctx, "sms.read")
    _emit_success(ctx, "sms.read", sms_read_result(ctx.obj, message_sid))


# ── Voice Calls ──────────────────────────────────────────────────────

@cli.group("call")
def call_group() -> None:
    pass


@call_group.command("create")
@click.option("--from", "from_number", default=None, help="Twilio phone number (E.164)")
@click.option("--to", "to_number", default=None, help="Destination phone number (E.164)")
@click.option("--url", "voice_url", default=None, help="TwiML URL or text to say")
@click.option("--status-callback", default=None, help="Webhook URL for call status")
@click.pass_context
def call_create(ctx: click.Context, from_number: str | None, to_number: str | None, voice_url: str | None, status_callback: str | None) -> None:
    _set_command(ctx, "call.create")
    require_mode(ctx, "call.create")
    _emit_success(
        ctx,
        "call.create",
        call_create_result(ctx.obj, from_number=from_number, to_number=to_number, voice_url=voice_url, status_callback=status_callback),
    )


@call_group.command("list")
@click.option("--limit", default=20, show_default=True, type=int)
@click.pass_context
def call_list(ctx: click.Context, limit: int) -> None:
    _set_command(ctx, "call.list")
    require_mode(ctx, "call.list")
    _emit_success(ctx, "call.list", call_list_result(ctx.obj, limit=limit))


@call_group.command("status")
@click.argument("call_sid", required=False)
@click.pass_context
def call_status(ctx: click.Context, call_sid: str | None) -> None:
    _set_command(ctx, "call.status")
    require_mode(ctx, "call.status")
    _emit_success(ctx, "call.status", call_status_result(ctx.obj, call_sid))


# ── WhatsApp ─────────────────────────────────────────────────────────

@cli.group("whatsapp")
def whatsapp_group() -> None:
    pass


@whatsapp_group.command("send")
@click.option("--from", "from_number", default=None, help="WhatsApp-enabled Twilio number (E.164)")
@click.option("--to", "to_number", default=None, help="Destination WhatsApp number (E.164)")
@click.option("--body", default=None, help="Message body text")
@click.option("--status-callback", default=None, help="Webhook URL for delivery status")
@click.pass_context
def whatsapp_send(ctx: click.Context, from_number: str | None, to_number: str | None, body: str | None, status_callback: str | None) -> None:
    _set_command(ctx, "whatsapp.send")
    require_mode(ctx, "whatsapp.send")
    _emit_success(
        ctx,
        "whatsapp.send",
        whatsapp_send_result(ctx.obj, from_number=from_number, to_number=to_number, body=body, status_callback=status_callback),
    )


@whatsapp_group.command("list")
@click.option("--limit", default=20, show_default=True, type=int)
@click.pass_context
def whatsapp_list(ctx: click.Context, limit: int) -> None:
    _set_command(ctx, "whatsapp.list")
    require_mode(ctx, "whatsapp.list")
    _emit_success(ctx, "whatsapp.list", whatsapp_list_result(ctx.obj, limit=limit))


# ── Lookup ───────────────────────────────────────────────────────────

@cli.group("lookup")
def lookup_group() -> None:
    pass


@lookup_group.command("phone")
@click.argument("phone_number", required=False)
@click.pass_context
def lookup_phone(ctx: click.Context, phone_number: str | None) -> None:
    _set_command(ctx, "lookup.phone")
    require_mode(ctx, "lookup.phone")
    _emit_success(ctx, "lookup.phone", lookup_phone_result(ctx.obj, phone_number))
