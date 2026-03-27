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
    branch_create_result,
    branch_delete_result,
    branch_list_result,
    capabilities_snapshot,
    doctor_snapshot,
    health_snapshot,
    project_info_result,
    sql_execute_result,
    sql_query_result,
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


@cli.group("project")
def project_group() -> None:
    pass


@project_group.command("info")
@click.pass_context
def project_info(ctx: click.Context) -> None:
    _set_command(ctx, "project.info")
    require_mode(ctx, "project.info")
    _emit_success(ctx, "project.info", project_info_result(ctx.obj))


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


@cli.group("sql")
def sql_group() -> None:
    pass


@sql_group.command("query")
@click.argument("query")
@click.pass_context
def sql_query(ctx: click.Context, query: str) -> None:
    _set_command(ctx, "sql.query")
    require_mode(ctx, "sql.query")
    _emit_success(ctx, "sql.query", sql_query_result(ctx.obj, query=query))


@sql_group.command("execute")
@click.argument("statement")
@click.pass_context
def sql_execute(ctx: click.Context, statement: str) -> None:
    _set_command(ctx, "sql.execute")
    require_mode(ctx, "sql.execute")
    _emit_success(ctx, "sql.execute", sql_execute_result(ctx.obj, statement=statement))


@cli.group("branch")
def branch_group() -> None:
    pass


@branch_group.command("list")
@click.pass_context
def branch_list(ctx: click.Context) -> None:
    _set_command(ctx, "branch.list")
    require_mode(ctx, "branch.list")
    _emit_success(ctx, "branch.list", branch_list_result(ctx.obj))


@branch_group.command("create")
@click.option("--name", default=None, help="Branch name")
@click.option("--parent", "parent_id", default=None, help="Parent branch ID")
@click.pass_context
def branch_create(ctx: click.Context, name: str | None, parent_id: str | None) -> None:
    _set_command(ctx, "branch.create")
    require_mode(ctx, "branch.create")
    _emit_success(ctx, "branch.create", branch_create_result(ctx.obj, name=name, parent_id=parent_id))


@branch_group.command("delete")
@click.argument("branch_id")
@click.pass_context
def branch_delete(ctx: click.Context, branch_id: str) -> None:
    _set_command(ctx, "branch.delete")
    require_mode(ctx, "branch.delete")
    _emit_success(ctx, "branch.delete", branch_delete_result(ctx.obj, branch_id=branch_id))
