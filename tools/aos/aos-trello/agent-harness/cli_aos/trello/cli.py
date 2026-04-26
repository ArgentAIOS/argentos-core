from __future__ import annotations

import json
import time
from typing import Any

import click

from . import __version__
from .constants import MODE_ORDER, PERMISSIONS_PATH, TOOL_NAME
from .errors import CliError
from .output import emit, failure, success
from .runtime import (
    account_read_result,
    board_list_result,
    board_read_result,
    capabilities_snapshot,
    create_card_result,
    card_list_result,
    card_read_result,
    config_snapshot,
    doctor_snapshot,
    health_snapshot,
    list_list_result,
    list_read_result,
    member_list_result,
    member_read_result,
    update_card_result,
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
            payload = failure(
                tool=TOOL_NAME,
                command=ctx.obj.get("_command_id", "unknown") if ctx.obj else "unknown",
                error={"code": err.code, "message": err.message, "details": err.details},
                started=ctx.obj.get("started", time.time()) if ctx.obj else time.time(),
                mode=ctx.obj.get("mode", "unknown") if ctx.obj else "unknown",
                version=ctx.obj.get("version", __version__) if ctx.obj else __version__,
            )
            emit(payload, as_json=ctx.obj.get("json", True) if ctx.obj else True)
            ctx.exit(err.exit_code)
        except click.ClickException as err:
            payload = failure(
                tool=TOOL_NAME,
                command=ctx.obj.get("_command_id", "unknown") if ctx.obj else "unknown",
                error={"code": "INVALID_USAGE", "message": str(err), "details": {}},
                started=ctx.obj.get("started", time.time()) if ctx.obj else time.time(),
                mode=ctx.obj.get("mode", "unknown") if ctx.obj else "unknown",
                version=ctx.obj.get("version", __version__) if ctx.obj else __version__,
            )
            emit(payload, as_json=ctx.obj.get("json", True) if ctx.obj else True)
            ctx.exit(2)


def _set_command(ctx: click.Context, command_id: str) -> None:
    ctx.obj["_command_id"] = command_id


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
    payload = success(
        tool=TOOL_NAME,
        command="capabilities",
        data=capabilities_snapshot(),
        started=ctx.obj["started"],
        mode=ctx.obj["mode"],
        version=ctx.obj["version"],
    )
    emit(payload, as_json=ctx.obj["json"])


@cli.group("config")
def config_group() -> None:
    pass


@config_group.command("show")
@click.pass_context
def config_show(ctx: click.Context) -> None:
    _set_command(ctx, "config.show")
    require_mode(ctx, "config.show")
    payload = success(
        tool=TOOL_NAME,
        command="config.show",
        data=config_snapshot(ctx.obj),
        started=ctx.obj["started"],
        mode=ctx.obj["mode"],
        version=ctx.obj["version"],
    )
    emit(payload, as_json=ctx.obj["json"])


@cli.command("health")
@click.pass_context
def health(ctx: click.Context) -> None:
    _set_command(ctx, "health")
    require_mode(ctx, "health")
    payload = success(
        tool=TOOL_NAME,
        command="health",
        data=health_snapshot(ctx.obj),
        started=ctx.obj["started"],
        mode=ctx.obj["mode"],
        version=ctx.obj["version"],
    )
    emit(payload, as_json=ctx.obj["json"])


@cli.command("doctor")
@click.pass_context
def doctor(ctx: click.Context) -> None:
    _set_command(ctx, "doctor")
    require_mode(ctx, "doctor")
    payload = success(
        tool=TOOL_NAME,
        command="doctor",
        data=doctor_snapshot(ctx.obj),
        started=ctx.obj["started"],
        mode=ctx.obj["mode"],
        version=ctx.obj["version"],
    )
    emit(payload, as_json=ctx.obj["json"])


def _read_command(
    ctx: click.Context,
    *,
    command_id: str,
    resource: str,
    operation: str,
    inputs: dict[str, Any],
    reader,
) -> None:
    _set_command(ctx, command_id)
    require_mode(ctx, command_id)
    payload = success(
        tool=TOOL_NAME,
        command=command_id,
        data=reader(ctx.obj, **inputs),
        started=ctx.obj["started"],
        mode=ctx.obj["mode"],
        version=ctx.obj["version"],
    )
    emit(payload, as_json=ctx.obj["json"])


def _write_command(
    ctx: click.Context,
    *,
    command_id: str,
    runner,
) -> None:
    _set_command(ctx, command_id)
    require_mode(ctx, command_id)
    payload = success(
        tool=TOOL_NAME,
        command=command_id,
        data=runner(ctx.obj),
        started=ctx.obj["started"],
        mode=ctx.obj["mode"],
        version=ctx.obj["version"],
    )
    emit(payload, as_json=ctx.obj["json"])


@cli.group("account")
def account_group() -> None:
    pass


@account_group.command("read")
@click.pass_context
def account_read(ctx: click.Context) -> None:
    _read_command(
        ctx,
        command_id="account.read",
        resource="account",
        operation="read",
        inputs={},
        reader=lambda ctx_obj: account_read_result(ctx_obj),
    )


@cli.group("member")
def member_group() -> None:
    pass


@member_group.command("list")
@click.option("--board-id", default=None, help="Trello board id")
@click.option("--limit", default=10, show_default=True, type=int)
@click.pass_context
def member_list(ctx: click.Context, board_id: str | None, limit: int) -> None:
    _read_command(
        ctx,
        command_id="member.list",
        resource="member",
        operation="list",
        inputs={"board_id": board_id, "limit": limit},
        reader=lambda ctx_obj, board_id, limit: member_list_result(ctx_obj, board_id=board_id, limit=limit),
    )


@member_group.command("read")
@click.option("--member-id", default=None, help="Trello member id")
@click.pass_context
def member_read(ctx: click.Context, member_id: str | None) -> None:
    _read_command(
        ctx,
        command_id="member.read",
        resource="member",
        operation="read",
        inputs={"member_id": member_id},
        reader=lambda ctx_obj, member_id: member_read_result(ctx_obj, member_id=member_id),
    )


@cli.group("board")
def board_group() -> None:
    pass


@board_group.command("list")
@click.option("--limit", default=10, show_default=True, type=int)
@click.pass_context
def board_list(ctx: click.Context, limit: int) -> None:
    _read_command(
        ctx,
        command_id="board.list",
        resource="board",
        operation="list",
        inputs={"limit": limit},
        reader=lambda ctx_obj, limit: board_list_result(ctx_obj, limit=limit),
    )


@board_group.command("read")
@click.option("--board-id", default=None, help="Trello board id")
@click.pass_context
def board_read(ctx: click.Context, board_id: str | None) -> None:
    _read_command(
        ctx,
        command_id="board.read",
        resource="board",
        operation="read",
        inputs={"board_id": board_id},
        reader=lambda ctx_obj, board_id: board_read_result(ctx_obj, board_id=board_id),
    )


@cli.group("list")
def list_group() -> None:
    pass


@list_group.command("list")
@click.option("--board-id", default=None, help="Trello board id")
@click.pass_context
def list_list(ctx: click.Context, board_id: str | None) -> None:
    _read_command(
        ctx,
        command_id="list.list",
        resource="list",
        operation="list",
        inputs={"board_id": board_id},
        reader=lambda ctx_obj, board_id: list_list_result(ctx_obj, board_id=board_id),
    )


@list_group.command("read")
@click.option("--list-id", default=None, help="Trello list id")
@click.pass_context
def list_read(ctx: click.Context, list_id: str | None) -> None:
    _read_command(
        ctx,
        command_id="list.read",
        resource="list",
        operation="read",
        inputs={"list_id": list_id},
        reader=lambda ctx_obj, list_id: list_read_result(ctx_obj, list_id=list_id),
    )


@cli.group("card")
def card_group() -> None:
    pass


@card_group.command("list")
@click.option("--list-id", default=None, help="Trello list id")
@click.pass_context
def card_list(ctx: click.Context, list_id: str | None) -> None:
    _read_command(
        ctx,
        command_id="card.list",
        resource="card",
        operation="list",
        inputs={"list_id": list_id},
        reader=lambda ctx_obj, list_id: card_list_result(ctx_obj, list_id=list_id),
    )


@card_group.command("read")
@click.option("--card-id", default=None, help="Trello card id")
@click.pass_context
def card_read(ctx: click.Context, card_id: str | None) -> None:
    _read_command(
        ctx,
        command_id="card.read",
        resource="card",
        operation="read",
        inputs={"card_id": card_id},
        reader=lambda ctx_obj, card_id: card_read_result(ctx_obj, card_id=card_id),
    )


@card_group.command("create_draft")
@click.option("--list-id", default=None, help="Trello list id")
@click.option("--name", required=True, help="Draft card name")
@click.option("--desc", default="", help="Draft card description")
@click.pass_context
def card_create_draft(ctx: click.Context, list_id: str | None, name: str, desc: str) -> None:
    _write_command(
        ctx,
        command_id="card.create_draft",
        runner=lambda ctx_obj: create_card_result(ctx_obj, list_id=list_id, name=name, desc=desc),
    )


@card_group.command("update_draft")
@click.option("--card-id", default=None, help="Trello card id")
@click.option("--name", default=None, help="Draft card name")
@click.option("--desc", default=None, help="Draft card description")
@click.pass_context
def card_update_draft(ctx: click.Context, card_id: str | None, name: str | None, desc: str | None) -> None:
    _write_command(
        ctx,
        command_id="card.update_draft",
        runner=lambda ctx_obj: update_card_result(ctx_obj, card_id=card_id, name=name, desc=desc),
    )
