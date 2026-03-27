from __future__ import annotations

import json
import time

import click

from . import __version__
from .constants import MODE_ORDER, PERMISSIONS_PATH
from .errors import CliError
from .output import emit, failure, success
from .runtime import (
    build_get_result,
    build_list_result,
    build_logs_result,
    cache_list_result,
    cache_stats_result,
    capabilities_snapshot,
    config_show_result,
    doctor_snapshot,
    health_snapshot,
    runner_list_result,
    runner_status_result,
    usage_billing_result,
    usage_summary_result,
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


@cli.group("runner")
def runner_group() -> None:
    pass


@runner_group.command("list")
@click.pass_context
def runner_list(ctx: click.Context) -> None:
    _set_command(ctx, "runner.list")
    require_mode(ctx, "runner.list")
    _emit_success(ctx, "runner.list", runner_list_result(ctx.obj))


@runner_group.command("status")
@click.pass_context
def runner_status(ctx: click.Context) -> None:
    _set_command(ctx, "runner.status")
    require_mode(ctx, "runner.status")
    _emit_success(ctx, "runner.status", runner_status_result(ctx.obj))


@cli.group("build")
def build_group() -> None:
    pass


@build_group.command("list")
@click.option("--repo", default=None)
@click.option("--workflow-name", default=None)
@click.option("--limit", default=10, show_default=True, type=int)
@click.pass_context
def build_list(ctx: click.Context, repo: str | None, workflow_name: str | None, limit: int) -> None:
    _set_command(ctx, "build.list")
    require_mode(ctx, "build.list")
    _emit_success(ctx, "build.list", build_list_result(ctx.obj, repo=repo, workflow_name=workflow_name, limit=limit))


@build_group.command("get")
@click.argument("run_id", required=False)
@click.pass_context
def build_get(ctx: click.Context, run_id: str | None) -> None:
    _set_command(ctx, "build.get")
    require_mode(ctx, "build.get")
    _emit_success(ctx, "build.get", build_get_result(ctx.obj, run_id=run_id))


@build_group.command("logs")
@click.argument("run_id", required=False)
@click.pass_context
def build_logs(ctx: click.Context, run_id: str | None) -> None:
    _set_command(ctx, "build.logs")
    require_mode(ctx, "build.logs")
    _emit_success(ctx, "build.logs", build_logs_result(ctx.obj, run_id=run_id))


@cli.group("cache")
def cache_group() -> None:
    pass


@cache_group.command("list")
@click.option("--repo", default=None)
@click.pass_context
def cache_list(ctx: click.Context, repo: str | None) -> None:
    _set_command(ctx, "cache.list")
    require_mode(ctx, "cache.list")
    _emit_success(ctx, "cache.list", cache_list_result(ctx.obj, repo=repo))


@cache_group.command("stats")
@click.option("--repo", default=None)
@click.pass_context
def cache_stats(ctx: click.Context, repo: str | None) -> None:
    _set_command(ctx, "cache.stats")
    require_mode(ctx, "cache.stats")
    _emit_success(ctx, "cache.stats", cache_stats_result(ctx.obj, repo=repo))


@cli.group("usage")
def usage_group() -> None:
    pass


@usage_group.command("summary")
@click.option("--date-range", default=None)
@click.pass_context
def usage_summary(ctx: click.Context, date_range: str | None) -> None:
    _set_command(ctx, "usage.summary")
    require_mode(ctx, "usage.summary")
    _emit_success(ctx, "usage.summary", usage_summary_result(ctx.obj, date_range=date_range))


@usage_group.command("billing")
@click.option("--date-range", default=None)
@click.pass_context
def usage_billing(ctx: click.Context, date_range: str | None) -> None:
    _set_command(ctx, "usage.billing")
    require_mode(ctx, "usage.billing")
    _emit_success(ctx, "usage.billing", usage_billing_result(ctx.obj, date_range=date_range))


if __name__ == "__main__":
    cli()
