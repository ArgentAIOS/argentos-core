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
    config_get_result,
    config_show_result,
    config_update_result,
    doctor_snapshot,
    health_snapshot,
    report_get_result,
    report_list_result,
    review_get_result,
    review_request_result,
    review_status_result,
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
    raise CliError(code="PERMISSION_DENIED", message=f"Command requires mode={required}", exit_code=3, details={"required_mode": required, "actual_mode": mode})


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
    ctx.obj.update({"json": as_json, "mode": mode, "verbose": verbose, "started": time.time(), "version": __version__, "_command_id": "unknown"})


@cli.command("capabilities")
@click.pass_context
def capabilities(ctx: click.Context) -> None:
    _set_command(ctx, "capabilities")
    require_mode(ctx, "capabilities")
    _emit_success(ctx, "capabilities", capabilities_snapshot())


@cli.group("review")
def review_group() -> None:
    pass


@review_group.command("request")
@click.option("--repo", default=None)
@click.option("--pr-number", default=None)
@click.option("--full-review", is_flag=True, help="Request a broad CodeRabbit review")
@click.option("--comment", default=None)
@click.pass_context
def review_request(ctx: click.Context, repo: str | None, pr_number: str | None, full_review: bool, comment: str | None) -> None:
    _set_command(ctx, "review.request")
    require_mode(ctx, "review.request")
    _emit_success(ctx, "review.request", review_request_result(ctx.obj, repo=repo, pr_number=pr_number, full_review=full_review, comment=comment))


@review_group.command("status")
@click.option("--repo", default=None)
@click.option("--review-id", default=None)
@click.pass_context
def review_status(ctx: click.Context, repo: str | None, review_id: str | None) -> None:
    _set_command(ctx, "review.status")
    require_mode(ctx, "review.status")
    _emit_success(ctx, "review.status", review_status_result(ctx.obj, repo=repo, review_id=review_id))


@review_group.command("get")
@click.option("--repo", default=None)
@click.option("--review-id", default=None)
@click.pass_context
def review_get(ctx: click.Context, repo: str | None, review_id: str | None) -> None:
    _set_command(ctx, "review.get")
    require_mode(ctx, "review.get")
    _emit_success(ctx, "review.get", review_get_result(ctx.obj, repo=repo, review_id=review_id))


@cli.group("report")
def report_group() -> None:
    pass


@report_group.command("list")
@click.option("--start-date", default=None)
@click.option("--end-date", default=None)
@click.option("--limit", default=10, show_default=True, type=int)
@click.option("--cursor", default=None)
@click.pass_context
def report_list(ctx: click.Context, start_date: str | None, end_date: str | None, limit: int, cursor: str | None) -> None:
    _set_command(ctx, "report.list")
    require_mode(ctx, "report.list")
    _emit_success(ctx, "report.list", report_list_result(ctx.obj, start_date=start_date, end_date=end_date, limit=limit, cursor=cursor))


@report_group.command("get")
@click.option("--start-date", default=None)
@click.option("--end-date", default=None)
@click.option("--prompt", default=None)
@click.option("--prompt-template", default=None)
@click.pass_context
def report_get(ctx: click.Context, start_date: str | None, end_date: str | None, prompt: str | None, prompt_template: str | None) -> None:
    _set_command(ctx, "report.get")
    require_mode(ctx, "report.get")
    _emit_success(ctx, "report.get", report_get_result(ctx.obj, start_date=start_date, end_date=end_date, prompt=prompt, prompt_template=prompt_template))


@cli.group("config")
def config_group() -> None:
    pass


@config_group.command("show")
@click.pass_context
def config_show(ctx: click.Context) -> None:
    _set_command(ctx, "config.show")
    require_mode(ctx, "config.show")
    _emit_success(ctx, "config.show", config_show_result(ctx.obj))


@config_group.command("get")
@click.pass_context
def config_get(ctx: click.Context) -> None:
    _set_command(ctx, "config.get")
    require_mode(ctx, "config.get")
    _emit_success(ctx, "config.get", config_get_result(ctx.obj))


@config_group.command("update")
@click.option("--content", default=None)
@click.pass_context
def config_update(ctx: click.Context, content: str | None) -> None:
    _set_command(ctx, "config.update")
    require_mode(ctx, "config.update")
    _emit_success(ctx, "config.update", config_update_result(ctx.obj, content=content or ""))


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
