from __future__ import annotations

import json
import time

import click

from . import __version__
from .constants import MODE_ORDER, PERMISSIONS_PATH
from .errors import CliError
from .output import emit, failure, success
from .runtime import (
    capabilities_snapshot,
    channel_create_result,
    channel_list_result,
    config_show_result,
    doctor_snapshot,
    embed_send_result,
    health_snapshot,
    member_list_result,
    message_delete_result,
    message_edit_result,
    message_send_result,
    reaction_add_result,
    role_assign_result,
    role_list_result,
    thread_create_result,
    webhook_send_result,
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


@cli.group("config")
def config_group() -> None:
    pass


@config_group.command("show")
@click.pass_context
def config_show(ctx: click.Context) -> None:
    _set_command(ctx, "config.show")
    require_mode(ctx, "config.show")
    _emit_success(ctx, "config.show", config_show_result(ctx.obj))


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


@cli.group("message")
def message_group() -> None:
    pass


@message_group.command("send")
@click.option("--channel-id", default=None)
@click.option("--content", default=None)
@click.pass_context
def message_send(ctx: click.Context, channel_id: str | None, content: str | None) -> None:
    _set_command(ctx, "message.send")
    require_mode(ctx, "message.send")
    _emit_success(ctx, "message.send", message_send_result(ctx.obj, channel_id=channel_id, content=content))


@message_group.command("edit")
@click.option("--channel-id", default=None)
@click.option("--message-id", default=None)
@click.option("--content", default=None)
@click.pass_context
def message_edit(ctx: click.Context, channel_id: str | None, message_id: str | None, content: str | None) -> None:
    _set_command(ctx, "message.edit")
    require_mode(ctx, "message.edit")
    _emit_success(ctx, "message.edit", message_edit_result(ctx.obj, channel_id=channel_id, message_id=message_id, content=content))


@message_group.command("delete")
@click.option("--channel-id", default=None)
@click.option("--message-id", default=None)
@click.pass_context
def message_delete(ctx: click.Context, channel_id: str | None, message_id: str | None) -> None:
    _set_command(ctx, "message.delete")
    require_mode(ctx, "message.delete")
    _emit_success(ctx, "message.delete", message_delete_result(ctx.obj, channel_id=channel_id, message_id=message_id))


@cli.group("reaction")
def reaction_group() -> None:
    pass


@reaction_group.command("add")
@click.option("--channel-id", default=None)
@click.option("--message-id", default=None)
@click.option("--emoji", default=None)
@click.pass_context
def reaction_add(ctx: click.Context, channel_id: str | None, message_id: str | None, emoji: str | None) -> None:
    _set_command(ctx, "reaction.add")
    require_mode(ctx, "reaction.add")
    _emit_success(ctx, "reaction.add", reaction_add_result(ctx.obj, channel_id=channel_id, message_id=message_id, emoji=emoji))


@cli.group("channel")
def channel_group() -> None:
    pass


@channel_group.command("list")
@click.option("--guild-id", default=None)
@click.option("--limit", default=20, show_default=True, type=int)
@click.pass_context
def channel_list(ctx: click.Context, guild_id: str | None, limit: int) -> None:
    _set_command(ctx, "channel.list")
    require_mode(ctx, "channel.list")
    _emit_success(ctx, "channel.list", channel_list_result(ctx.obj, guild_id=guild_id, limit=limit))


@channel_group.command("create")
@click.option("--guild-id", default=None)
@click.option("--name", default=None)
@click.option("--type", "channel_type", default=None)
@click.option("--topic", default=None)
@click.pass_context
def channel_create(ctx: click.Context, guild_id: str | None, name: str | None, channel_type: str | None, topic: str | None) -> None:
    _set_command(ctx, "channel.create")
    require_mode(ctx, "channel.create")
    _emit_success(ctx, "channel.create", channel_create_result(ctx.obj, guild_id=guild_id, name=name, channel_type=channel_type, topic=topic))


@cli.group("thread")
def thread_group() -> None:
    pass


@thread_group.command("create")
@click.option("--channel-id", default=None)
@click.option("--message-id", default=None)
@click.option("--name", default=None)
@click.option("--content", default=None)
@click.pass_context
def thread_create(ctx: click.Context, channel_id: str | None, message_id: str | None, name: str | None, content: str | None) -> None:
    _set_command(ctx, "thread.create")
    require_mode(ctx, "thread.create")
    _emit_success(ctx, "thread.create", thread_create_result(ctx.obj, channel_id=channel_id, message_id=message_id, name=name, content=content))


@cli.group("embed")
def embed_group() -> None:
    pass


@embed_group.command("send")
@click.option("--channel-id", default=None)
@click.option("--embed-json", default=None)
@click.option("--content", default=None)
@click.pass_context
def embed_send(ctx: click.Context, channel_id: str | None, embed_json: str | None, content: str | None) -> None:
    _set_command(ctx, "embed.send")
    require_mode(ctx, "embed.send")
    _emit_success(ctx, "embed.send", embed_send_result(ctx.obj, channel_id=channel_id, embed_json=embed_json, content=content))


@cli.group("role")
def role_group() -> None:
    pass


@role_group.command("list")
@click.option("--guild-id", default=None)
@click.option("--limit", default=20, show_default=True, type=int)
@click.pass_context
def role_list(ctx: click.Context, guild_id: str | None, limit: int) -> None:
    _set_command(ctx, "role.list")
    require_mode(ctx, "role.list")
    _emit_success(ctx, "role.list", role_list_result(ctx.obj, guild_id=guild_id, limit=limit))


@role_group.command("assign")
@click.option("--guild-id", default=None)
@click.option("--member-id", default=None)
@click.option("--role-id", default=None)
@click.pass_context
def role_assign(ctx: click.Context, guild_id: str | None, member_id: str | None, role_id: str | None) -> None:
    _set_command(ctx, "role.assign")
    require_mode(ctx, "role.assign")
    _emit_success(ctx, "role.assign", role_assign_result(ctx.obj, guild_id=guild_id, member_id=member_id, role_id=role_id))


@cli.group("member")
def member_group() -> None:
    pass


@member_group.command("list")
@click.option("--guild-id", default=None)
@click.option("--limit", default=20, show_default=True, type=int)
@click.pass_context
def member_list(ctx: click.Context, guild_id: str | None, limit: int) -> None:
    _set_command(ctx, "member.list")
    require_mode(ctx, "member.list")
    _emit_success(ctx, "member.list", member_list_result(ctx.obj, guild_id=guild_id, limit=limit))


@cli.group("webhook")
def webhook_group() -> None:
    pass


@webhook_group.command("send")
@click.option("--webhook-url", default=None)
@click.option("--content", default=None)
@click.option("--embed-json", default=None)
@click.option("--username", default=None)
@click.option("--avatar-url", default=None)
@click.pass_context
def webhook_send(
    ctx: click.Context,
    webhook_url: str | None,
    content: str | None,
    embed_json: str | None,
    username: str | None,
    avatar_url: str | None,
) -> None:
    _set_command(ctx, "webhook.send")
    require_mode(ctx, "webhook.send")
    _emit_success(
        ctx,
        "webhook.send",
        webhook_send_result(
            ctx.obj,
            webhook_url=webhook_url,
            content=content,
            embed_json=embed_json,
            username=username,
            avatar_url=avatar_url,
        ),
    )
