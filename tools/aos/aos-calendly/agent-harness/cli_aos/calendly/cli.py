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
    availability_get_result,
    capabilities_snapshot,
    doctor_snapshot,
    event_types_get_result,
    event_types_list_result,
    events_get_result,
    events_list_result,
    health_snapshot,
    invitees_list_result,
    scaffold_write_result,
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


@cli.group("events")
def events_group() -> None:
    pass


@events_group.command("list")
@click.option("--limit", default=20, show_default=True, type=int)
@click.option("--start-time", default=None, help="Min start time (ISO 8601)")
@click.option("--end-time", default=None, help="Max start time (ISO 8601)")
@click.option("--status", default=None, type=click.Choice(["active", "canceled"]), help="Event status filter")
@click.pass_context
def events_list(ctx: click.Context, limit: int, start_time: str | None, end_time: str | None, status: str | None) -> None:
    _set_command(ctx, "events.list")
    require_mode(ctx, "events.list")
    _emit_success(ctx, "events.list", events_list_result(ctx.obj, limit=limit, start_time=start_time, end_time=end_time, status=status))


@events_group.command("get")
@click.argument("uuid", required=False)
@click.pass_context
def events_get(ctx: click.Context, uuid: str | None) -> None:
    _set_command(ctx, "events.get")
    require_mode(ctx, "events.get")
    _emit_success(ctx, "events.get", events_get_result(ctx.obj, uuid))


@events_group.command("cancel")
@click.argument("uuid")
@click.option("--reason", default=None, help="Cancellation reason")
@click.pass_context
def events_cancel(ctx: click.Context, uuid: str, reason: str | None) -> None:
    _set_command(ctx, "events.cancel")
    require_mode(ctx, "events.cancel")
    _emit_success(
        ctx,
        "events.cancel",
        scaffold_write_result(ctx.obj, command_id="events.cancel", inputs={"uuid": uuid, "reason": reason}),
    )


@cli.group("event-types")
def event_types_group() -> None:
    pass


@event_types_group.command("list")
@click.option("--limit", default=20, show_default=True, type=int)
@click.pass_context
def event_types_list(ctx: click.Context, limit: int) -> None:
    _set_command(ctx, "event_types.list")
    require_mode(ctx, "event_types.list")
    _emit_success(ctx, "event_types.list", event_types_list_result(ctx.obj, limit=limit))


@event_types_group.command("get")
@click.argument("uuid", required=False)
@click.pass_context
def event_types_get(ctx: click.Context, uuid: str | None) -> None:
    _set_command(ctx, "event_types.get")
    require_mode(ctx, "event_types.get")
    _emit_success(ctx, "event_types.get", event_types_get_result(ctx.obj, uuid))


@cli.group("invitees")
def invitees_group() -> None:
    pass


@invitees_group.command("list")
@click.argument("event_uuid", required=False)
@click.option("--limit", default=20, show_default=True, type=int)
@click.option("--email", default=None, help="Filter by invitee email")
@click.pass_context
def invitees_list(ctx: click.Context, event_uuid: str | None, limit: int, email: str | None) -> None:
    _set_command(ctx, "invitees.list")
    require_mode(ctx, "invitees.list")
    _emit_success(ctx, "invitees.list", invitees_list_result(ctx.obj, event_uuid, limit=limit, email=email))


@cli.group("availability")
def availability_group() -> None:
    pass


@availability_group.command("get")
@click.argument("event_type_uuid", required=False)
@click.option("--start-time", default=None, help="Start time (ISO 8601)")
@click.option("--end-time", default=None, help="End time (ISO 8601)")
@click.pass_context
def availability_get(ctx: click.Context, event_type_uuid: str | None, start_time: str | None, end_time: str | None) -> None:
    _set_command(ctx, "availability.get")
    require_mode(ctx, "availability.get")
    _emit_success(ctx, "availability.get", availability_get_result(ctx.obj, event_type_uuid, start_time=start_time, end_time=end_time))


@cli.group("scheduling-links")
def scheduling_links_group() -> None:
    pass


@scheduling_links_group.command("create")
@click.argument("event_type_uuid")
@click.option("--max-event-count", default=1, show_default=True, type=int)
@click.pass_context
def scheduling_links_create(ctx: click.Context, event_type_uuid: str, max_event_count: int) -> None:
    _set_command(ctx, "scheduling_links.create")
    require_mode(ctx, "scheduling_links.create")
    _emit_success(
        ctx,
        "scheduling_links.create",
        scaffold_write_result(
            ctx.obj,
            command_id="scheduling_links.create",
            inputs={"event_type_uuid": event_type_uuid, "max_event_count": max_event_count},
        ),
    )
