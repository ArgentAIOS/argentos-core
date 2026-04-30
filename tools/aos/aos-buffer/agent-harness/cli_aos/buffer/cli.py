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
    account_read_result,
    capabilities_snapshot,
    channel_list_result,
    channel_read_result,
    doctor_snapshot,
    health_snapshot,
    post_list_result,
    post_read_result,
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


def _emit_success(ctx: click.Context, command_id: str, data: dict[str, object]) -> None:
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


@cli.group("account")
def account_group() -> None:
    pass


@account_group.command("read")
@click.pass_context
def account_read(ctx: click.Context) -> None:
    _set_command(ctx, "account.read")
    require_mode(ctx, "account.read")
    _emit_success(ctx, "account.read", account_read_result(ctx.obj))


@cli.group("channel")
def channel_group() -> None:
    pass


@channel_group.command("list")
@click.option("--organization-id", default=None, help="Optional organization scope")
@click.option("--limit", type=int, default=10, show_default=True)
@click.pass_context
def channel_list(ctx: click.Context, organization_id: str | None, limit: int) -> None:
    _set_command(ctx, "channel.list")
    require_mode(ctx, "channel.list")
    _emit_success(ctx, "channel.list", channel_list_result(ctx.obj, organization_id=organization_id, limit=limit))


@channel_group.command("read")
@click.argument("channel_id", required=False)
@click.pass_context
def channel_read(ctx: click.Context, channel_id: str | None) -> None:
    _set_command(ctx, "channel.read")
    require_mode(ctx, "channel.read")
    _emit_success(ctx, "channel.read", channel_read_result(ctx.obj, channel_id=channel_id))


@cli.group("profile")
def profile_group() -> None:
    pass


@profile_group.command("list")
@click.option("--organization-id", default=None, help="Optional organization scope")
@click.option("--limit", type=int, default=10, show_default=True)
@click.pass_context
def profile_list(ctx: click.Context, organization_id: str | None, limit: int) -> None:
    _set_command(ctx, "profile.list")
    require_mode(ctx, "profile.list")
    _emit_success(
        ctx,
        "profile.list",
        channel_list_result(ctx.obj, organization_id=organization_id, limit=limit, profile_alias=True),
    )


@profile_group.command("read")
@click.argument("profile_id", required=False)
@click.pass_context
def profile_read(ctx: click.Context, profile_id: str | None) -> None:
    _set_command(ctx, "profile.read")
    require_mode(ctx, "profile.read")
    _emit_success(ctx, "profile.read", channel_read_result(ctx.obj, profile_id=profile_id, profile_alias=True))


@cli.group("post")
def post_group() -> None:
    pass


@post_group.command("list")
@click.option("--organization-id", default=None, help="Optional organization scope")
@click.option("--channel-id", default=None, help="Optional channel scope")
@click.option("--profile-id", default=None, help="Legacy channel alias scope")
@click.option("--status", default=None, help="Optional comma-separated Buffer post status filter")
@click.option("--limit", default=10, show_default=True, type=int)
@click.pass_context
def post_list(
    ctx: click.Context,
    organization_id: str | None,
    channel_id: str | None,
    profile_id: str | None,
    status: str | None,
    limit: int,
) -> None:
    _set_command(ctx, "post.list")
    require_mode(ctx, "post.list")
    _emit_success(
        ctx,
        "post.list",
        post_list_result(
            ctx.obj,
            organization_id=organization_id,
            channel_id=channel_id,
            profile_id=profile_id,
            status=status,
            limit=limit,
        ),
    )


@post_group.command("read")
@click.argument("post_id", required=False)
@click.pass_context
def post_read(ctx: click.Context, post_id: str | None) -> None:
    _set_command(ctx, "post.read")
    require_mode(ctx, "post.read")
    _emit_success(ctx, "post.read", post_read_result(ctx.obj, post_id=post_id))


if __name__ == "__main__":
    cli()
