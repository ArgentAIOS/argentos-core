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
    capabilities_snapshot,
    doctor_snapshot,
    health_snapshot,
    project_info_result,
    rpc_call_result,
    storage_download_result,
    storage_list_result,
    table_delete_result,
    table_insert_result,
    table_select_result,
    table_update_result,
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


@cli.group("table")
def table_group() -> None:
    pass


@table_group.command("select")
@click.argument("table", required=False)
@click.option("--select", "select_cols", default="*", show_default=True, help="Columns to select")
@click.option("--filter", "filter_str", default=None, help="PostgREST filter string")
@click.option("--limit", default=100, show_default=True, type=int)
@click.pass_context
def table_select(ctx: click.Context, table: str | None, select_cols: str, filter_str: str | None, limit: int) -> None:
    _set_command(ctx, "table.select")
    require_mode(ctx, "table.select")
    _emit_success(ctx, "table.select", table_select_result(ctx.obj, table, select=select_cols, filter_str=filter_str, limit=limit))


@table_group.command("insert")
@click.argument("table", required=False)
@click.option("--row", "row_json", required=True, help="JSON object to insert")
@click.pass_context
def table_insert(ctx: click.Context, table: str | None, row_json: str) -> None:
    _set_command(ctx, "table.insert")
    require_mode(ctx, "table.insert")
    _emit_success(ctx, "table.insert", table_insert_result(ctx.obj, table, row_json=row_json))


@table_group.command("update")
@click.argument("table", required=False)
@click.option("--filter", "filter_str", required=True, help="PostgREST filter (e.g. id=eq.1)")
@click.option("--set", "updates_json", required=True, help="JSON object with updates")
@click.pass_context
def table_update(ctx: click.Context, table: str | None, filter_str: str, updates_json: str) -> None:
    _set_command(ctx, "table.update")
    require_mode(ctx, "table.update")
    _emit_success(ctx, "table.update", table_update_result(ctx.obj, table, filter_str=filter_str, updates_json=updates_json))


@table_group.command("delete")
@click.argument("table", required=False)
@click.option("--filter", "filter_str", required=True, help="PostgREST filter (e.g. id=eq.1)")
@click.pass_context
def table_delete(ctx: click.Context, table: str | None, filter_str: str) -> None:
    _set_command(ctx, "table.delete")
    require_mode(ctx, "table.delete")
    _emit_success(ctx, "table.delete", table_delete_result(ctx.obj, table, filter_str=filter_str))


@cli.group("rpc")
def rpc_group() -> None:
    pass


@rpc_group.command("call")
@click.argument("function_name")
@click.option("--params", "params_json", default=None, help="JSON object with function parameters")
@click.pass_context
def rpc_call(ctx: click.Context, function_name: str, params_json: str | None) -> None:
    _set_command(ctx, "rpc.call")
    require_mode(ctx, "rpc.call")
    _emit_success(ctx, "rpc.call", rpc_call_result(ctx.obj, function_name, params_json=params_json))


@cli.group("storage")
def storage_group() -> None:
    pass


@storage_group.command("list")
@click.argument("bucket", required=False)
@click.option("--prefix", default="", show_default=True, help="File path prefix filter")
@click.option("--limit", default=100, show_default=True, type=int)
@click.pass_context
def storage_list(ctx: click.Context, bucket: str | None, prefix: str, limit: int) -> None:
    _set_command(ctx, "storage.list")
    require_mode(ctx, "storage.list")
    _emit_success(ctx, "storage.list", storage_list_result(ctx.obj, bucket, prefix=prefix, limit=limit))


@storage_group.command("download")
@click.argument("bucket", required=False)
@click.option("--path", "file_path", required=True, help="File path within the bucket")
@click.pass_context
def storage_download(ctx: click.Context, bucket: str | None, file_path: str) -> None:
    _set_command(ctx, "storage.download")
    require_mode(ctx, "storage.download")
    _emit_success(ctx, "storage.download", storage_download_result(ctx.obj, bucket, file_path=file_path))
