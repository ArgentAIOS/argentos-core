from __future__ import annotations

import json
import time

import click

from . import __version__
from .config import config_snapshot
from .constants import MODE_ORDER, PERMISSIONS_PATH
from .errors import ConnectorError
from .output import emit, failure, success
from .runtime import (
    capabilities_snapshot,
    doctor_snapshot,
    health_snapshot,
    message_list_result,
    message_read_result,
    organization_list_result,
    organization_read_result,
    me_read_result,
    scaffold_write_result,
    social_profile_list_result,
    social_profile_read_result,
    team_list_result,
    team_read_result,
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
    raise ConnectorError(
        code="PERMISSION_DENIED",
        message=f"Command requires mode={required}",
        exit_code=3,
        details={"required_mode": required, "actual_mode": mode},
    )


class AosGroup(click.Group):
    def invoke(self, ctx: click.Context):
        try:
            return super().invoke(ctx)
        except ConnectorError as err:
            emit(
                failure(
                    command=ctx.obj.get("_command_id", "unknown") if ctx.obj else "unknown",
                    mode=ctx.obj.get("mode", "unknown") if ctx.obj else "unknown",
                    started=ctx.obj.get("started", time.time()) if ctx.obj else time.time(),
                    error={"code": err.code, "message": err.message, "details": err.details or {}},
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


@cli.command("doctor")
@click.pass_context
def doctor(ctx: click.Context) -> None:
    _set_command(ctx, "doctor")
    require_mode(ctx, "doctor")
    _emit_success(ctx, "doctor", doctor_snapshot(ctx.obj))


@cli.group("config")
def config_group() -> None:
    pass


@config_group.command("show")
@click.pass_context
def config_show(ctx: click.Context) -> None:
    _set_command(ctx, "config.show")
    require_mode(ctx, "config.show")
    _emit_success(ctx, "config.show", config_snapshot(ctx.obj))


@cli.group("me")
def me_group() -> None:
    pass


@me_group.command("read")
@click.pass_context
def me_read(ctx: click.Context) -> None:
    _set_command(ctx, "me.read")
    require_mode(ctx, "me.read")
    _emit_success(ctx, "me.read", me_read_result(ctx.obj))


@cli.group("organization")
def organization_group() -> None:
    pass


@organization_group.command("list")
@click.pass_context
def organization_list(ctx: click.Context) -> None:
    _set_command(ctx, "organization.list")
    require_mode(ctx, "organization.list")
    _emit_success(ctx, "organization.list", organization_list_result(ctx.obj))


@organization_group.command("read")
@click.argument("organization_id", required=False)
@click.pass_context
def organization_read(ctx: click.Context, organization_id: str | None) -> None:
    _set_command(ctx, "organization.read")
    require_mode(ctx, "organization.read")
    _emit_success(ctx, "organization.read", organization_read_result(ctx.obj, organization_id))


@cli.group("social-profile")
def social_profile_group() -> None:
    pass


@social_profile_group.command("list")
@click.option("--organization-id", default=None, help="Optional organization filter")
@click.pass_context
def social_profile_list(ctx: click.Context, organization_id: str | None) -> None:
    _set_command(ctx, "social_profile.list")
    require_mode(ctx, "social_profile.list")
    _emit_success(ctx, "social_profile.list", social_profile_list_result(ctx.obj, organization_id=organization_id))


@social_profile_group.command("read")
@click.argument("social_profile_id", required=False)
@click.pass_context
def social_profile_read(ctx: click.Context, social_profile_id: str | None) -> None:
    _set_command(ctx, "social_profile.read")
    require_mode(ctx, "social_profile.read")
    _emit_success(ctx, "social_profile.read", social_profile_read_result(ctx.obj, social_profile_id))


@cli.group("team")
def team_group() -> None:
    pass


@team_group.command("list")
@click.option("--organization-id", default=None, help="Organization ID used to scope the teams list")
@click.pass_context
def team_list(ctx: click.Context, organization_id: str | None) -> None:
    _set_command(ctx, "team.list")
    require_mode(ctx, "team.list")
    _emit_success(ctx, "team.list", team_list_result(ctx.obj, organization_id=organization_id))


@team_group.command("read")
@click.argument("team_id", required=False)
@click.pass_context
def team_read(ctx: click.Context, team_id: str | None) -> None:
    _set_command(ctx, "team.read")
    require_mode(ctx, "team.read")
    _emit_success(ctx, "team.read", team_read_result(ctx.obj, team_id))


@cli.group("message")
def message_group() -> None:
    pass


@message_group.command("list")
@click.option("--social-profile-id", default=None, help="Optional social profile scope")
@click.option("--state", default=None, help="Optional message state filter")
@click.option("--start-time", default=None, help="Optional ISO-8601 start time filter")
@click.option("--end-time", default=None, help="Optional ISO-8601 end time filter")
@click.option("--limit", default=25, show_default=True, type=int)
@click.pass_context
def message_list(
    ctx: click.Context,
    social_profile_id: str | None,
    state: str | None,
    start_time: str | None,
    end_time: str | None,
    limit: int,
) -> None:
    _set_command(ctx, "message.list")
    require_mode(ctx, "message.list")
    _emit_success(
        ctx,
        "message.list",
        message_list_result(
            ctx.obj,
            social_profile_id=social_profile_id,
            state=state,
            start_time=start_time,
            end_time=end_time,
            limit=limit,
        ),
    )


@message_group.command("read")
@click.argument("message_id", required=False)
@click.pass_context
def message_read(ctx: click.Context, message_id: str | None) -> None:
    _set_command(ctx, "message.read")
    require_mode(ctx, "message.read")
    _emit_success(ctx, "message.read", message_read_result(ctx.obj, message_id))


@message_group.command("schedule")
@click.argument("text", required=False)
@click.option("--social-profile-id", default=None, help="Social profile ID for the scheduled message")
@click.option("--scheduled-send-time", default=None, help="Optional ISO-8601 send time")
@click.pass_context
def message_schedule(
    ctx: click.Context,
    text: str | None,
    social_profile_id: str | None,
    scheduled_send_time: str | None,
) -> None:
    _set_command(ctx, "message.schedule")
    require_mode(ctx, "message.schedule")
    _emit_success(
        ctx,
        "message.schedule",
        scaffold_write_result(
            ctx.obj,
            command_id="message.schedule",
            inputs={
                "text": text,
                "social_profile_id": social_profile_id,
                "scheduled_send_time": scheduled_send_time,
            },
        ),
    )


if __name__ == "__main__":
    cli()
