from __future__ import annotations

from contextlib import nullcontext, redirect_stdout
import sys
import time
from typing import Callable, TypeVar

import click

from . import __version__
from .config import dataset_name, read_argent_config, redacted_config_snapshot, vault_path
from .constants import MODE_ORDER, SEARCH_MODES
from .errors import CliError
from .output import emit, failure, success
from .permissions import require_mode
from .runtime import (
    capabilities_snapshot,
    cognify_result,
    doctor_snapshot,
    health_snapshot,
    ingest_vault_result,
    memify_result,
    prune_result,
    search_result,
)

T = TypeVar("T")


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


def _runtime_stdout_context(ctx: click.Context):
    if ctx.obj.get("json"):
        return redirect_stdout(sys.__stderr__ or sys.stderr)
    return nullcontext()


def _compute_runtime_data(ctx: click.Context, factory: Callable[[], T]) -> T:
    with _runtime_stdout_context(ctx):
        return factory()


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
    require_mode(ctx.obj["mode"], "capabilities")
    _emit_success(ctx, "capabilities", capabilities_snapshot())


@cli.group("config")
def config_group() -> None:
    pass


@config_group.command("show")
@click.pass_context
def config_show(ctx: click.Context) -> None:
    _set_command(ctx, "config.show")
    require_mode(ctx.obj["mode"], "config.show")
    _emit_success(ctx, "config.show", redacted_config_snapshot(ctx.obj))


@cli.command("health")
@click.pass_context
def health(ctx: click.Context) -> None:
    _set_command(ctx, "health")
    require_mode(ctx.obj["mode"], "health")
    _emit_success(ctx, "health", _compute_runtime_data(ctx, lambda: health_snapshot(ctx.obj)))


@cli.command("doctor")
@click.pass_context
def doctor(ctx: click.Context) -> None:
    _set_command(ctx, "doctor")
    require_mode(ctx.obj["mode"], "doctor")
    _emit_success(ctx, "doctor", _compute_runtime_data(ctx, lambda: doctor_snapshot(ctx.obj)))


@cli.command("search")
@click.argument("query")
@click.option("--search-mode", type=click.Choice(SEARCH_MODES), default="GRAPH_COMPLETION", show_default=True)
@click.option("--limit", type=int, default=10, show_default=True)
@click.option("--dataset", default="")
@click.pass_context
def search(ctx: click.Context, query: str, search_mode: str, limit: int, dataset: str) -> None:
    _set_command(ctx, "search")
    require_mode(ctx.obj["mode"], "search")
    cfg = _compute_runtime_data(ctx, read_argent_config)
    _emit_success(
        ctx,
        "search",
        _compute_runtime_data(
            ctx,
            lambda: search_result(
                query=query,
                search_mode=search_mode,
                limit=max(1, limit),
                dataset=dataset_name(cfg, dataset),
            ),
        ),
    )


@cli.command("ingest-vault")
@click.option("--path", "path_value", default="")
@click.option("--dataset", default="")
@click.option("--limit", type=int, default=0, help="Maximum files to ingest; 0 means all")
@click.pass_context
def ingest_vault(ctx: click.Context, path_value: str, dataset: str, limit: int) -> None:
    _set_command(ctx, "ingest-vault")
    require_mode(ctx.obj["mode"], "ingest-vault")
    cfg = _compute_runtime_data(ctx, read_argent_config)
    _emit_success(
        ctx,
        "ingest-vault",
        _compute_runtime_data(
            ctx,
            lambda: ingest_vault_result(
                path_value=vault_path(cfg, path_value),
                dataset=dataset_name(cfg, dataset),
                limit=limit if limit > 0 else None,
            ),
        ),
    )


@cli.command("cognify")
@click.option("--dataset", default="")
@click.pass_context
def cognify(ctx: click.Context, dataset: str) -> None:
    _set_command(ctx, "cognify")
    require_mode(ctx.obj["mode"], "cognify")
    cfg = _compute_runtime_data(ctx, read_argent_config)
    _emit_success(
        ctx,
        "cognify",
        _compute_runtime_data(ctx, lambda: cognify_result(dataset_name(cfg, dataset))),
    )


@cli.command("memify")
@click.option("--dataset", default="")
@click.pass_context
def memify(ctx: click.Context, dataset: str) -> None:
    _set_command(ctx, "memify")
    require_mode(ctx.obj["mode"], "memify")
    cfg = _compute_runtime_data(ctx, read_argent_config)
    _emit_success(
        ctx,
        "memify",
        _compute_runtime_data(ctx, lambda: memify_result(dataset_name(cfg, dataset))),
    )


@cli.command("prune")
@click.option("--yes", is_flag=True, help="Confirm destructive Cognee prune")
@click.pass_context
def prune(ctx: click.Context, yes: bool) -> None:
    _set_command(ctx, "prune")
    require_mode(ctx.obj["mode"], "prune")
    if not yes:
        raise CliError(
            code="CONFIRMATION_REQUIRED",
            message="Pass --yes to prune Cognee data.",
            exit_code=4,
            details={},
        )
    _emit_success(ctx, "prune", _compute_runtime_data(ctx, prune_result))


if __name__ == "__main__":
    cli()
