from __future__ import annotations

import time
from typing import Any

import click

from . import __version__
from .bridge import capabilities_snapshot, config_snapshot, doctor_snapshot, health_snapshot
from .constants import MODE_ORDER
from .errors import CliError
from . import runtime as runtime_module
from .output import emit, failure, success


def _permissions() -> dict[str, str]:
    from .bridge import _permissions as load_permissions

    return load_permissions()


def _mode_allows(actual: str, required: str) -> bool:
    return MODE_ORDER.index(actual) >= MODE_ORDER.index(required)


def require_mode(ctx: click.Context, command_id: str) -> None:
    required = _permissions().get(command_id, "admin")
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
    emit(_success(ctx, "capabilities", capabilities_snapshot()), as_json=ctx.obj["json"])


@cli.command("health")
@click.pass_context
def health(ctx: click.Context) -> None:
    _set_command(ctx, "health")
    require_mode(ctx, "health")
    emit(_success(ctx, "health", health_snapshot(ctx.obj)), as_json=ctx.obj["json"])


@cli.command("doctor")
@click.pass_context
def doctor(ctx: click.Context) -> None:
    _set_command(ctx, "doctor")
    require_mode(ctx, "doctor")
    emit(_success(ctx, "doctor", doctor_snapshot(ctx.obj)), as_json=ctx.obj["json"])


@cli.group("config")
def config_group() -> None:
    pass


@config_group.command("show")
@click.pass_context
def config_show(ctx: click.Context) -> None:
    _set_command(ctx, "config.show")
    require_mode(ctx, "config.show")
    emit(_success(ctx, "config.show", config_snapshot(ctx.obj)), as_json=ctx.obj["json"])


def _scaffold_command(
    ctx: click.Context,
    *,
    command_id: str,
    resource: str,
    operation: str,
    inputs: dict[str, Any],
    consequential: bool = False,
) -> None:
    _set_command(ctx, command_id)
    require_mode(ctx, command_id)
    emit(
        _success(
            ctx,
            command_id,
            runtime_module.scaffold_result(
                ctx.obj,
                command_id=command_id,
                resource=resource,
                operation=operation,
                inputs=inputs,
                consequential=consequential,
            ),
        ),
        as_json=ctx.obj["json"],
    )


def _live_command(
    ctx: click.Context,
    *,
    command_id: str,
    runner,
) -> None:
    _set_command(ctx, command_id)
    require_mode(ctx, command_id)
    emit(_success(ctx, command_id, runner(ctx.obj)), as_json=ctx.obj["json"])


@cli.group("database")
def database_group() -> None:
    pass


@database_group.command("list")
@click.option("--limit", default=10, show_default=True, type=int)
@click.pass_context
def database_list(ctx: click.Context, limit: int) -> None:
    _live_command(ctx, command_id="database.list", runner=lambda ctx_obj: runtime_module.read_database_list(ctx_obj, limit=limit))


@database_group.command("query")
@click.argument("database_id")
@click.option("--filter", "filter_expression", default="", show_default=False)
@click.option("--limit", default=10, show_default=True, type=int)
@click.pass_context
def database_query(ctx: click.Context, database_id: str, filter_expression: str, limit: int) -> None:
    _live_command(
        ctx,
        command_id="database.query",
        runner=lambda ctx_obj: runtime_module.read_database_query(
            ctx_obj,
            database_id=database_id,
            filter_expression=filter_expression or None,
            limit=limit,
        ),
    )


@cli.group("page")
def page_group() -> None:
    pass


@page_group.command("read")
@click.argument("page_id")
@click.pass_context
def page_read(ctx: click.Context, page_id: str) -> None:
    _live_command(ctx, command_id="page.read", runner=lambda ctx_obj: runtime_module.read_page(ctx_obj, page_id=page_id))


@page_group.command("create")
@click.option("--database-id", default="", show_default=False)
@click.option("--parent-page-id", default="", show_default=False)
@click.option("--title", required=True)
@click.pass_context
def page_create(ctx: click.Context, database_id: str, parent_page_id: str, title: str) -> None:
    _scaffold_command(
        ctx,
        command_id="page.create",
        resource="page",
        operation="create",
        inputs={"database_id": database_id or None, "parent_page_id": parent_page_id or None, "title": title},
        consequential=True,
    )


@page_group.command("update")
@click.argument("page_id")
@click.option("--title", default="", show_default=False)
@click.pass_context
def page_update(ctx: click.Context, page_id: str, title: str) -> None:
    _scaffold_command(
        ctx,
        command_id="page.update",
        resource="page",
        operation="update",
        inputs={"page_id": page_id, "title": title or None},
        consequential=True,
    )


@cli.group("block")
def block_group() -> None:
    pass


@block_group.command("read")
@click.argument("block_id")
@click.pass_context
def block_read(ctx: click.Context, block_id: str) -> None:
    _live_command(
        ctx,
        command_id="block.read",
        runner=lambda ctx_obj: runtime_module.read_block(ctx_obj, block_id=block_id),
    )


@block_group.command("append")
@click.argument("block_id")
@click.option("--content", required=True)
@click.pass_context
def block_append(ctx: click.Context, block_id: str, content: str) -> None:
    _scaffold_command(
        ctx,
        command_id="block.append",
        resource="block",
        operation="append",
        inputs={"block_id": block_id, "content": content},
        consequential=True,
    )


@cli.group("search")
def search_group() -> None:
    pass


@search_group.command("query")
@click.argument("query")
@click.option("--limit", default=10, show_default=True, type=int)
@click.pass_context
def search_query(ctx: click.Context, query: str, limit: int) -> None:
    _live_command(
        ctx,
        command_id="search.query",
        runner=lambda ctx_obj: runtime_module.search_query(ctx_obj, query=query, limit=limit),
    )
