from __future__ import annotations

import json
import time

import click

from . import __version__
from .constants import MODE_ORDER, PERMISSIONS_PATH
from .errors import CliError
from .output import emit, failure, success
from .runtime import (
    canvas_create_result,
    canvas_update_result,
    capabilities_snapshot,
    channel_archive_result,
    channel_create_result,
    channel_list_result,
    config_show_result,
    doctor_snapshot,
    file_upload_result,
    health_snapshot,
    message_delete_result,
    message_post_result,
    message_update_result,
    reaction_add_result,
    reminder_create_result,
    thread_reply_result,
    user_list_result,
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


@cli.command("capabilities")
@click.pass_context
def capabilities(ctx: click.Context) -> None:
    _set_command(ctx, "capabilities")
    require_mode(ctx, "capabilities")
    _emit_success(ctx, "capabilities", capabilities_snapshot())


@cli.command("health")
@click.pass_context
def health(ctx: click.Context) -> None:
    _set_command(ctx, "health")
    require_mode(ctx, "health")
    _emit_success(ctx, "health", health_snapshot(ctx.obj))


@cli.group("config")
def config_group() -> None:
    pass


@config_group.command("show")
@click.pass_context
def config_show(ctx: click.Context) -> None:
    _set_command(ctx, "config.show")
    require_mode(ctx, "config.show")
    _emit_success(ctx, "config.show", config_show_result(ctx.obj))


@cli.command("doctor")
@click.pass_context
def doctor(ctx: click.Context) -> None:
    _set_command(ctx, "doctor")
    require_mode(ctx, "doctor")
    _emit_success(ctx, "doctor", doctor_snapshot(ctx.obj))


@cli.group("message")
def message_group() -> None:
    pass


@message_group.command("post")
@click.option("--channel-id", default=None)
@click.option("--text", default=None)
@click.option("--thread-ts", default=None)
@click.pass_context
def message_post(ctx: click.Context, channel_id: str | None, text: str | None, thread_ts: str | None) -> None:
    _set_command(ctx, "message.post")
    require_mode(ctx, "message.post")
    _emit_success(ctx, "message.post", message_post_result(ctx.obj, channel_id=channel_id, text=text, thread_ts=thread_ts))


@message_group.command("update")
@click.option("--channel-id", default=None)
@click.option("--thread-ts", default=None)
@click.option("--text", default=None)
@click.pass_context
def message_update(ctx: click.Context, channel_id: str | None, thread_ts: str | None, text: str | None) -> None:
    _set_command(ctx, "message.update")
    require_mode(ctx, "message.update")
    _emit_success(ctx, "message.update", message_update_result(ctx.obj, channel_id=channel_id, thread_ts=thread_ts, text=text))


@message_group.command("delete")
@click.option("--channel-id", default=None)
@click.option("--thread-ts", default=None)
@click.pass_context
def message_delete(ctx: click.Context, channel_id: str | None, thread_ts: str | None) -> None:
    _set_command(ctx, "message.delete")
    require_mode(ctx, "message.delete")
    _emit_success(ctx, "message.delete", message_delete_result(ctx.obj, channel_id=channel_id, thread_ts=thread_ts))


@cli.group("reaction")
def reaction_group() -> None:
    pass


@reaction_group.command("add")
@click.option("--channel-id", default=None)
@click.option("--thread-ts", default=None)
@click.option("--emoji", default=None)
@click.pass_context
def reaction_add(ctx: click.Context, channel_id: str | None, thread_ts: str | None, emoji: str | None) -> None:
    _set_command(ctx, "reaction.add")
    require_mode(ctx, "reaction.add")
    _emit_success(ctx, "reaction.add", reaction_add_result(ctx.obj, channel_id=channel_id, thread_ts=thread_ts, emoji=emoji))


@cli.group("channel")
def channel_group() -> None:
    pass


@channel_group.command("list")
@click.option("--limit", default=20, show_default=True, type=int)
@click.option("--cursor", default=None)
@click.pass_context
def channel_list(ctx: click.Context, limit: int, cursor: str | None) -> None:
    _set_command(ctx, "channel.list")
    require_mode(ctx, "channel.list")
    _emit_success(ctx, "channel.list", channel_list_result(ctx.obj, limit=limit, cursor=cursor))


@channel_group.command("create")
@click.option("--name", default=None)
@click.option("--private", is_flag=True, help="Create a private channel")
@click.pass_context
def channel_create(ctx: click.Context, name: str | None, private: bool) -> None:
    _set_command(ctx, "channel.create")
    require_mode(ctx, "channel.create")
    _emit_success(ctx, "channel.create", channel_create_result(ctx.obj, name=name, is_private=private))


@channel_group.command("archive")
@click.option("--channel-id", default=None)
@click.pass_context
def channel_archive(ctx: click.Context, channel_id: str | None) -> None:
    _set_command(ctx, "channel.archive")
    require_mode(ctx, "channel.archive")
    _emit_success(ctx, "channel.archive", channel_archive_result(ctx.obj, channel_id=channel_id))


@cli.group("thread")
def thread_group() -> None:
    pass


@thread_group.command("reply")
@click.option("--channel-id", default=None)
@click.option("--thread-ts", default=None)
@click.option("--text", default=None)
@click.pass_context
def thread_reply(ctx: click.Context, channel_id: str | None, thread_ts: str | None, text: str | None) -> None:
    _set_command(ctx, "thread.reply")
    require_mode(ctx, "thread.reply")
    _emit_success(ctx, "thread.reply", thread_reply_result(ctx.obj, channel_id=channel_id, thread_ts=thread_ts, text=text))


@cli.group("canvas")
def canvas_group() -> None:
    pass


@canvas_group.command("create")
@click.option("--title", default=None)
@click.option("--content", default=None)
@click.option("--channel-id", default=None)
@click.option("--owner-id", default=None)
@click.pass_context
def canvas_create(ctx: click.Context, title: str | None, content: str | None, channel_id: str | None, owner_id: str | None) -> None:
    _set_command(ctx, "canvas.create")
    require_mode(ctx, "canvas.create")
    _emit_success(ctx, "canvas.create", canvas_create_result(ctx.obj, title=title, content=content, channel_id=channel_id, owner_id=owner_id))


@canvas_group.command("update")
@click.option("--canvas-id", default=None)
@click.option("--content", default=None)
@click.option("--changes-json", default=None)
@click.pass_context
def canvas_update(ctx: click.Context, canvas_id: str | None, content: str | None, changes_json: str | None) -> None:
    _set_command(ctx, "canvas.update")
    require_mode(ctx, "canvas.update")
    _emit_success(ctx, "canvas.update", canvas_update_result(ctx.obj, canvas_id=canvas_id, content=content, changes_json=changes_json))


@cli.group("user")
def user_group() -> None:
    pass


@user_group.command("list")
@click.option("--limit", default=20, show_default=True, type=int)
@click.option("--cursor", default=None)
@click.pass_context
def user_list(ctx: click.Context, limit: int, cursor: str | None) -> None:
    _set_command(ctx, "user.list")
    require_mode(ctx, "user.list")
    _emit_success(ctx, "user.list", user_list_result(ctx.obj, limit=limit, cursor=cursor))


@cli.group("reminder")
def reminder_group() -> None:
    pass


@reminder_group.command("create")
@click.option("--text", default=None)
@click.option("--time", "time_value", default=None)
@click.option("--user-id", default=None)
@click.pass_context
def reminder_create(ctx: click.Context, text: str | None, time_value: str | None, user_id: str | None) -> None:
    _set_command(ctx, "reminder.create")
    require_mode(ctx, "reminder.create")
    _emit_success(ctx, "reminder.create", reminder_create_result(ctx.obj, text=text, time_value=time_value, user_id=user_id))


@cli.group("file")
def file_group() -> None:
    pass


@file_group.command("upload")
@click.option("--file-path", default=None)
@click.option("--filename", default=None)
@click.option("--channel-id", default=None)
@click.option("--thread-ts", default=None)
@click.option("--title", default=None)
@click.option("--initial-comment", default=None)
@click.pass_context
def file_upload(
    ctx: click.Context,
    file_path: str | None,
    filename: str | None,
    channel_id: str | None,
    thread_ts: str | None,
    title: str | None,
    initial_comment: str | None,
) -> None:
    _set_command(ctx, "file.upload")
    require_mode(ctx, "file.upload")
    _emit_success(
        ctx,
        "file.upload",
        file_upload_result(
            ctx.obj,
            file_path=file_path,
            filename=filename,
            channel_id=channel_id,
            thread_ts=thread_ts,
            title=title,
            initial_comment=initial_comment,
        ),
    )
