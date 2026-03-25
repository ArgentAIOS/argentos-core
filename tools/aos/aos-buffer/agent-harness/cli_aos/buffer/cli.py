from __future__ import annotations

from typing import Any

import click

from .output import dumps
from . import runtime


@click.group(context_settings={"help_option_names": ["-h", "--help"]})
@click.option("--json/--no-json", "json_output", default=True, show_default=True)
@click.option("--mode", type=click.Choice(["readonly", "write"]), default="readonly", show_default=True)
@click.pass_context
def cli(ctx: click.Context, json_output: bool, mode: str) -> None:
    ctx.ensure_object(dict)
    ctx.obj["json_output"] = json_output
    ctx.obj["mode"] = mode


def emit(ctx: click.Context, payload: dict[str, Any], *, exit_code: int = 0) -> None:
    if ctx.obj.get("json_output", True):
        click.echo(dumps(payload))
    else:
        click.echo(payload)
    raise SystemExit(exit_code)


@cli.command()
@click.pass_context
def capabilities(ctx: click.Context) -> None:
    emit(ctx, runtime.build_capabilities_payload())


@cli.group()
@click.pass_context
def config(ctx: click.Context) -> None:
    del ctx


@config.command(name="show")
@click.pass_context
def config_show(ctx: click.Context) -> None:
    emit(ctx, runtime.build_config_show_payload())


@cli.command()
@click.pass_context
def health(ctx: click.Context) -> None:
    emit(ctx, runtime.build_health_payload())


@cli.command()
@click.pass_context
def doctor(ctx: click.Context) -> None:
    emit(ctx, runtime.build_doctor_payload())


@cli.group()
@click.pass_context
def account(ctx: click.Context) -> None:
    del ctx


@account.command(name="read")
@click.pass_context
def account_read(ctx: click.Context) -> None:
    emit(ctx, runtime.build_account_read_payload())


@cli.group()
@click.pass_context
def channel(ctx: click.Context) -> None:
    del ctx


@channel.command(name="list")
@click.option("--limit", type=int, default=10, show_default=True)
@click.pass_context
def channel_list(ctx: click.Context, limit: int) -> None:
    emit(ctx, runtime.build_channel_list_payload(limit=limit))


@channel.command(name="read")
@click.option("--channel-id", type=str, default=None)
@click.pass_context
def channel_read(ctx: click.Context, channel_id: str | None) -> None:
    emit(ctx, runtime.build_channel_read_payload(channel_id=channel_id))


@cli.group()
@click.pass_context
def profile(ctx: click.Context) -> None:
    del ctx


@profile.command(name="list")
@click.option("--limit", type=int, default=10, show_default=True)
@click.pass_context
def profile_list(ctx: click.Context, limit: int) -> None:
    emit(ctx, runtime.build_profile_list_payload(limit=limit))


@profile.command(name="read")
@click.option("--profile-id", type=str, default=None)
@click.pass_context
def profile_read(ctx: click.Context, profile_id: str | None) -> None:
    emit(ctx, runtime.build_profile_read_payload(profile_id=profile_id))


@cli.group()
@click.pass_context
def post(ctx: click.Context) -> None:
    del ctx


@post.command(name="list")
@click.option("--profile-id", type=str, default=None)
@click.option("--status", type=str, default=None)
@click.option("--limit", type=int, default=10, show_default=True)
@click.pass_context
def post_list(ctx: click.Context, profile_id: str | None, status: str | None, limit: int) -> None:
    emit(ctx, runtime.build_post_list_payload(profile_id=profile_id, status=status, limit=limit))


@post.command(name="read")
@click.option("--post-id", type=str, default=None)
@click.pass_context
def post_read(ctx: click.Context, post_id: str | None) -> None:
    emit(ctx, runtime.build_post_read_payload(post_id=post_id))


@post.command(name="create-draft")
@click.argument("text", required=False)
@click.option("--channel-id", type=str, default=None)
@click.option("--due-at", type=str, default=None)
@click.pass_context
def post_create_draft(ctx: click.Context, text: str | None, channel_id: str | None, due_at: str | None) -> None:
    if ctx.obj.get("mode") == "write":
        emit(ctx, {
            "tool": "aos-buffer",
            "backend": "buffer-rest-api",
            "data": {
                "status": "scaffold_write_only",
                "command": "post.create_draft",
                "reason": "Buffer post creation remains scaffolded until the current public post contract is confirmed.",
                "scope_preview": {"selection_surface": "post", "command_id": "post.create_draft", "channel_id": channel_id, "post_text": text},
            },
        })
    emit(ctx, runtime.build_post_create_draft_payload(channel_id=channel_id, text=text, due_at=due_at))


@post.command(name="schedule")
@click.argument("text", required=False)
@click.option("--channel-id", type=str, default=None)
@click.option("--due-at", type=str, default=None)
@click.pass_context
def post_schedule(ctx: click.Context, text: str | None, channel_id: str | None, due_at: str | None) -> None:
    if ctx.obj.get("mode") == "write":
        emit(ctx, {
            "tool": "aos-buffer",
            "backend": "buffer-rest-api",
            "data": {
                "status": "scaffold_write_only",
                "command": "post.schedule",
                "reason": "Buffer post scheduling remains scaffolded until the current public post contract is confirmed.",
                "scope_preview": {"selection_surface": "post", "command_id": "post.schedule", "channel_id": channel_id, "post_text": text},
            },
        })
    emit(ctx, runtime.build_post_schedule_payload(channel_id=channel_id, text=text, due_at=due_at))


if __name__ == "__main__":
    cli()
