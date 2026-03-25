from __future__ import annotations

import json
import time
from typing import Any

import click

from . import __version__
from .constants import CONNECTOR_PATH, MANIFEST_SCHEMA_VERSION, MODE_ORDER, PERMISSIONS_PATH, TOOL_NAME
from .errors import CliError
from . import runtime as runtime_module
from .output import emit, failure, success


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
                command=ctx.obj.get("_command_id", "unknown") if ctx.obj else "unknown",
                mode=ctx.obj.get("mode", "unknown") if ctx.obj else "unknown",
                started=ctx.obj.get("started", time.time()) if ctx.obj else time.time(),
                error={"code": err.code, "message": err.message, "details": err.details},
            )
            emit(payload, as_json=ctx.obj.get("json", True) if ctx.obj else True)
            ctx.exit(err.exit_code)
        except click.ClickException as err:
            payload = failure(
                command=ctx.obj.get("_command_id", "unknown") if ctx.obj else "unknown",
                mode=ctx.obj.get("mode", "unknown") if ctx.obj else "unknown",
                started=ctx.obj.get("started", time.time()) if ctx.obj else time.time(),
                error={"code": "INVALID_USAGE", "message": str(err), "details": {}},
            )
            emit(payload, as_json=ctx.obj.get("json", True) if ctx.obj else True)
            ctx.exit(2)


def _set_command(ctx: click.Context, command_id: str) -> None:
    ctx.obj["_command_id"] = command_id


def _success(ctx: click.Context, command: str, data: dict[str, Any]) -> dict[str, Any]:
    return success(command=command, mode=ctx.obj["mode"], started=ctx.obj["started"], data=data)


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
    manifest = json.loads(CONNECTOR_PATH.read_text())
    emit(
        _success(
            ctx,
            "capabilities",
            {
                "summary": "Monday.com connector manifest.",
                "tool": TOOL_NAME,
                "version": __version__,
                "manifest_schema_version": MANIFEST_SCHEMA_VERSION,
                "backend": manifest["backend"],
                "modes": MODE_ORDER,
                "connector": manifest["connector"],
                "auth": manifest["auth"],
                "commands": manifest["commands"],
            },
        ),
        as_json=ctx.obj["json"],
    )


@cli.group("config")
def config_group() -> None:
    pass


@config_group.command("show")
@click.pass_context
def config_show(ctx: click.Context) -> None:
    _set_command(ctx, "config.show")
    require_mode(ctx, "config.show")
    emit(_success(ctx, "config.show", runtime_module.config_snapshot(ctx.obj)), as_json=ctx.obj["json"])


@cli.command("health")
@click.pass_context
def health(ctx: click.Context) -> None:
    _set_command(ctx, "health")
    require_mode(ctx, "health")
    emit(_success(ctx, "health", runtime_module.health_snapshot(ctx.obj)), as_json=ctx.obj["json"])


@cli.command("doctor")
@click.pass_context
def doctor(ctx: click.Context) -> None:
    _set_command(ctx, "doctor")
    require_mode(ctx, "doctor")
    emit(_success(ctx, "doctor", runtime_module.doctor_snapshot(ctx.obj)), as_json=ctx.obj["json"])


@cli.group("account")
def account_group() -> None:
    pass


@account_group.command("read")
@click.pass_context
def account_read(ctx: click.Context) -> None:
    _set_command(ctx, "account.read")
    require_mode(ctx, "account.read")
    emit(_success(ctx, "account.read", runtime_module.read_account(ctx.obj)), as_json=ctx.obj["json"])


@cli.group("workspace")
def workspace_group() -> None:
    pass


@workspace_group.command("list")
@click.option("--limit", default=10, show_default=True, type=int)
@click.pass_context
def workspace_list(ctx: click.Context, limit: int) -> None:
    _set_command(ctx, "workspace.list")
    require_mode(ctx, "workspace.list")
    emit(_success(ctx, "workspace.list", runtime_module.list_workspaces(ctx.obj, limit=limit)), as_json=ctx.obj["json"])


@cli.group("board")
def board_group() -> None:
    pass


@board_group.command("list")
@click.option("--limit", default=10, show_default=True, type=int)
@click.pass_context
def board_list(ctx: click.Context, limit: int) -> None:
    _set_command(ctx, "board.list")
    require_mode(ctx, "board.list")
    emit(_success(ctx, "board.list", runtime_module.list_boards(ctx.obj, limit=limit)), as_json=ctx.obj["json"])


@board_group.command("read")
@click.argument("board_id")
@click.option("--limit", default=5, show_default=True, type=int)
@click.pass_context
def board_read(ctx: click.Context, board_id: str, limit: int) -> None:
    _set_command(ctx, "board.read")
    require_mode(ctx, "board.read")
    emit(
        _success(ctx, "board.read", runtime_module.read_board(ctx.obj, board_id=board_id, limit=limit)),
        as_json=ctx.obj["json"],
    )


@cli.group("item")
def item_group() -> None:
    pass


@item_group.command("read")
@click.argument("item_id")
@click.pass_context
def item_read(ctx: click.Context, item_id: str) -> None:
    _set_command(ctx, "item.read")
    require_mode(ctx, "item.read")
    emit(_success(ctx, "item.read", runtime_module.read_item(ctx.obj, item_id=item_id)), as_json=ctx.obj["json"])


@item_group.command("create")
@click.option("--board-id", required=True)
@click.option("--name", "item_name", required=True)
@click.pass_context
def item_create(ctx: click.Context, board_id: str, item_name: str) -> None:
    _set_command(ctx, "item.create")
    require_mode(ctx, "item.create")
    raise CliError(
        code="NOT_IMPLEMENTED",
        message="item.create is scaffolded but not implemented yet",
        exit_code=10,
        details=runtime_module.scaffold_write_command(
            ctx.obj,
            command_id="item.create",
            resource="item",
            operation="create",
            inputs={"board_id": board_id, "name": item_name},
            consequential=True,
        ),
    )


@item_group.command("update")
@click.argument("item_id")
@click.option("--name", default="", show_default=False)
@click.pass_context
def item_update(ctx: click.Context, item_id: str, name: str) -> None:
    _set_command(ctx, "item.update")
    require_mode(ctx, "item.update")
    raise CliError(
        code="NOT_IMPLEMENTED",
        message="item.update is scaffolded but not implemented yet",
        exit_code=10,
        details=runtime_module.scaffold_write_command(
            ctx.obj,
            command_id="item.update",
            resource="item",
            operation="update",
            inputs={"item_id": item_id, "name": name or None},
            consequential=True,
        ),
    )


@cli.group("update")
def update_group() -> None:
    pass


@update_group.command("list")
@click.option("--limit", default=10, show_default=True, type=int)
@click.option("--from-date", default="", show_default=False)
@click.option("--to-date", default="", show_default=False)
@click.pass_context
def update_list(ctx: click.Context, limit: int, from_date: str, to_date: str) -> None:
    _set_command(ctx, "update.list")
    require_mode(ctx, "update.list")
    emit(
        _success(
            ctx,
            "update.list",
            runtime_module.list_updates(
                ctx.obj,
                limit=limit,
                from_date=from_date or None,
                to_date=to_date or None,
            ),
        ),
        as_json=ctx.obj["json"],
    )


@update_group.command("create")
@click.argument("item_id")
@click.option("--body", required=True)
@click.pass_context
def update_create(ctx: click.Context, item_id: str, body: str) -> None:
    _set_command(ctx, "update.create")
    require_mode(ctx, "update.create")
    raise CliError(
        code="NOT_IMPLEMENTED",
        message="update.create is scaffolded but not implemented yet",
        exit_code=10,
        details=runtime_module.scaffold_write_command(
            ctx.obj,
            command_id="update.create",
            resource="update",
            operation="create",
            inputs={"item_id": item_id, "body": body},
            consequential=True,
        ),
    )
