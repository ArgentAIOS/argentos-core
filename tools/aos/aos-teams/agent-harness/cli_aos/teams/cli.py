from __future__ import annotations

import json
import time
from typing import Any

import click

from . import __version__
from .constants import MODE_ORDER, PERMISSIONS_PATH
from .errors import CliError
from .output import emit, failure, success
from .runtime import (
    capabilities_snapshot,
    channel_list_result,
    channel_create_result,
    config_snapshot,
    doctor_snapshot,
    health_snapshot,
    run_write_command,
    meeting_list_result,
    team_list_result,
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
    raise CliError(code="PERMISSION_DENIED", message=f"Command requires mode={required}", exit_code=3, details={"required_mode": required, "actual_mode": mode})


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
    emit(success(command=command_id, mode=ctx.obj["mode"], started=ctx.obj["started"], data=data), as_json=ctx.obj["json"])


def _emit_write(ctx: click.Context, command_id: str, items: tuple[str, ...]) -> None:
    _emit_success(ctx, command_id, run_write_command(ctx.obj, command_id, items))


@click.group(cls=AosGroup)
@click.option("--json", "as_json", is_flag=True, help="Emit JSON output")
@click.option("--mode", type=click.Choice(MODE_ORDER), default="readonly", show_default=True)
@click.option("--verbose", is_flag=True, help="Verbose diagnostics")
@click.version_option(__version__)
@click.pass_context
def cli(ctx: click.Context, as_json: bool, mode: str, verbose: bool) -> None:
    ctx.ensure_object(dict)
    ctx.obj.update({"json": as_json, "mode": mode, "verbose": verbose, "started": time.time(), "version": __version__, "_command_id": "unknown"})


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
    _emit_success(ctx, "config.show", config_snapshot())


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


@cli.group("team")
def team_group() -> None:
    pass


@team_group.command("list")
@click.option("--limit", default=20, show_default=True, type=int)
@click.pass_context
def team_list(ctx: click.Context, limit: int) -> None:
    _set_command(ctx, "team.list")
    require_mode(ctx, "team.list")
    _emit_success(ctx, "team.list", team_list_result(ctx.obj, limit=limit))


@cli.group("channel")
def channel_group() -> None:
    pass


@channel_group.command("list")
@click.option("--team-id", default=None)
@click.option("--limit", default=20, show_default=True, type=int)
@click.pass_context
def channel_list(ctx: click.Context, team_id: str | None, limit: int) -> None:
    _set_command(ctx, "channel.list")
    require_mode(ctx, "channel.list")
    _emit_success(ctx, "channel.list", channel_list_result(ctx.obj, team_id=team_id, limit=limit))


@channel_group.command("create")
@click.argument("items", nargs=-1)
@click.pass_context
def channel_create(ctx: click.Context, items: tuple[str, ...]) -> None:
    _set_command(ctx, "channel.create")
    require_mode(ctx, "channel.create")
    _emit_write(ctx, "channel.create", items)


@cli.group("meeting")
def meeting_group() -> None:
    pass


@meeting_group.command("list")
@click.option("--user-id", default=None)
@click.option("--limit", default=10, show_default=True, type=int)
@click.pass_context
def meeting_list(ctx: click.Context, user_id: str | None, limit: int) -> None:
    _set_command(ctx, "meeting.list")
    require_mode(ctx, "meeting.list")
    _emit_success(ctx, "meeting.list", meeting_list_result(ctx.obj, user_id=user_id, limit=limit))


@meeting_group.command("create")
@click.argument("items", nargs=-1)
@click.pass_context
def meeting_create(ctx: click.Context, items: tuple[str, ...]) -> None:
    _set_command(ctx, "meeting.create")
    require_mode(ctx, "meeting.create")
    _emit_write(ctx, "meeting.create", items)


@cli.group("message")
def message_group() -> None:
    pass


@message_group.command("send")
@click.argument("items", nargs=-1)
@click.pass_context
def message_send(ctx: click.Context, items: tuple[str, ...]) -> None:
    _set_command(ctx, "message.send")
    require_mode(ctx, "message.send")
    _emit_write(ctx, "message.send", items)


@message_group.command("reply")
@click.argument("items", nargs=-1)
@click.pass_context
def message_reply(ctx: click.Context, items: tuple[str, ...]) -> None:
    _set_command(ctx, "message.reply")
    require_mode(ctx, "message.reply")
    _emit_write(ctx, "message.reply", items)


@cli.group("chat")
def chat_group() -> None:
    pass


@chat_group.command("send")
@click.argument("items", nargs=-1)
@click.pass_context
def chat_send(ctx: click.Context, items: tuple[str, ...]) -> None:
    _set_command(ctx, "chat.send")
    require_mode(ctx, "chat.send")
    _emit_write(ctx, "chat.send", items)


@cli.group("file")
def file_group() -> None:
    pass


@file_group.command("upload")
@click.argument("items", nargs=-1)
@click.pass_context
def file_upload(ctx: click.Context, items: tuple[str, ...]) -> None:
    _set_command(ctx, "file.upload")
    require_mode(ctx, "file.upload")
    _emit_write(ctx, "file.upload", items)


@cli.group("adaptive-card")
def adaptive_card_group() -> None:
    pass


@adaptive_card_group.command("send")
@click.argument("items", nargs=-1)
@click.pass_context
def adaptive_card_send(ctx: click.Context, items: tuple[str, ...]) -> None:
    _set_command(ctx, "adaptive_card.send")
    require_mode(ctx, "adaptive_card.send")
    _emit_write(ctx, "adaptive_card.send", items)
