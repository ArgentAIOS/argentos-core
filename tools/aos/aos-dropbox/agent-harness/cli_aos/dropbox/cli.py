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
    config_show_result,
    doctor_snapshot,
    file_download_result,
    file_get_result,
    file_list_result,
    folder_list_result,
    health_snapshot,
    search_query_result,
    share_list_result,
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


@cli.group("file")
def file_group() -> None:
    pass


@file_group.command("list")
@click.option("--path", default=None)
@click.option("--cursor", default=None)
@click.option("--limit", default=25, show_default=True, type=int)
@click.pass_context
def file_list(ctx: click.Context, path: str | None, cursor: str | None, limit: int) -> None:
    _set_command(ctx, "file.list")
    require_mode(ctx, "file.list")
    _emit_success(ctx, "file.list", file_list_result(ctx.obj, path=path, cursor=cursor, limit=limit))


@file_group.command("get")
@click.option("--path", default=None)
@click.option("--file-id", default=None)
@click.pass_context
def file_get(ctx: click.Context, path: str | None, file_id: str | None) -> None:
    _set_command(ctx, "file.get")
    require_mode(ctx, "file.get")
    _emit_success(ctx, "file.get", file_get_result(ctx.obj, path=path, file_id=file_id))


@file_group.command("download")
@click.option("--path", default=None)
@click.option("--file-id", default=None)
@click.pass_context
def file_download(ctx: click.Context, path: str | None, file_id: str | None) -> None:
    _set_command(ctx, "file.download")
    require_mode(ctx, "file.download")
    _emit_success(
        ctx,
        "file.download",
        file_download_result(ctx.obj, path=path, file_id=file_id),
    )


@cli.group("folder")
def folder_group() -> None:
    pass


@folder_group.command("list")
@click.option("--path", default=None)
@click.option("--cursor", default=None)
@click.option("--limit", default=25, show_default=True, type=int)
@click.pass_context
def folder_list(ctx: click.Context, path: str | None, cursor: str | None, limit: int) -> None:
    _set_command(ctx, "folder.list")
    require_mode(ctx, "folder.list")
    _emit_success(ctx, "folder.list", folder_list_result(ctx.obj, path=path, cursor=cursor, limit=limit))


@cli.group("share")
def share_group() -> None:
    pass


@share_group.command("list")
@click.option("--path", default=None)
@click.pass_context
def share_list(ctx: click.Context, path: str | None) -> None:
    _set_command(ctx, "share.list")
    require_mode(ctx, "share.list")
    _emit_success(ctx, "share.list", share_list_result(ctx.obj, path=path))


@cli.group("search")
def search_group() -> None:
    pass


@search_group.command("query")
@click.option("--query", "query_text", default=None)
@click.option("--path", default=None)
@click.option("--cursor", default=None)
@click.option("--limit", default=25, show_default=True, type=int)
@click.pass_context
def search_query(ctx: click.Context, query_text: str | None, path: str | None, cursor: str | None, limit: int) -> None:
    _set_command(ctx, "search.query")
    require_mode(ctx, "search.query")
    _emit_success(
        ctx,
        "search.query",
        search_query_result(ctx.obj, query=query_text, path=path, cursor=cursor, limit=limit),
    )
