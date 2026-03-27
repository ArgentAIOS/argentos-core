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
    activity_list_result,
    activity_create_result,
    capabilities_snapshot,
    deal_create_result,
    deal_update_result,
    deal_get_result,
    deal_list_result,
    doctor_snapshot,
    health_snapshot,
    note_create_result,
    organization_create_result,
    organization_get_result,
    organization_list_result,
    person_create_result,
    person_get_result,
    person_list_result,
    pipeline_list_result,
    stage_list_result,
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


@cli.group("deal")
def deal_group() -> None:
    pass


@deal_group.command("list")
@click.option("--limit", default=10, show_default=True, type=int)
@click.pass_context
def deal_list(ctx: click.Context, limit: int) -> None:
    _set_command(ctx, "deal.list")
    require_mode(ctx, "deal.list")
    _emit_success(ctx, "deal.list", deal_list_result(ctx.obj, limit=limit))


@deal_group.command("get")
@click.argument("deal_id", required=False)
@click.pass_context
def deal_get(ctx: click.Context, deal_id: str | None) -> None:
    _set_command(ctx, "deal.get")
    require_mode(ctx, "deal.get")
    _emit_success(ctx, "deal.get", deal_get_result(ctx.obj, deal_id))


@deal_group.command("create")
@click.argument("title")
@click.option("--value", default=None, type=float)
@click.option("--currency", default=None)
@click.pass_context
def deal_create(ctx: click.Context, title: str, value: float | None, currency: str | None) -> None:
    _set_command(ctx, "deal.create")
    require_mode(ctx, "deal.create")
    _emit_success(ctx, "deal.create", deal_create_result(ctx.obj, title=title, value=value, currency=currency))


@deal_group.command("update")
@click.argument("deal_id")
@click.pass_context
def deal_update(ctx: click.Context, deal_id: str) -> None:
    _set_command(ctx, "deal.update")
    require_mode(ctx, "deal.update")
    _emit_success(ctx, "deal.update", deal_update_result(ctx.obj, deal_id=deal_id))


@cli.group("person")
def person_group() -> None:
    pass


@person_group.command("list")
@click.option("--limit", default=10, show_default=True, type=int)
@click.pass_context
def person_list(ctx: click.Context, limit: int) -> None:
    _set_command(ctx, "person.list")
    require_mode(ctx, "person.list")
    _emit_success(ctx, "person.list", person_list_result(ctx.obj, limit=limit))


@person_group.command("get")
@click.argument("person_id", required=False)
@click.pass_context
def person_get(ctx: click.Context, person_id: str | None) -> None:
    _set_command(ctx, "person.get")
    require_mode(ctx, "person.get")
    _emit_success(ctx, "person.get", person_get_result(ctx.obj, person_id))


@person_group.command("create")
@click.argument("name")
@click.option("--email", default=None)
@click.pass_context
def person_create(ctx: click.Context, name: str, email: str | None) -> None:
    _set_command(ctx, "person.create")
    require_mode(ctx, "person.create")
    _emit_success(ctx, "person.create", person_create_result(ctx.obj, name=name, email=email))


@cli.group("organization")
def organization_group() -> None:
    pass


@organization_group.command("list")
@click.option("--limit", default=10, show_default=True, type=int)
@click.pass_context
def organization_list(ctx: click.Context, limit: int) -> None:
    _set_command(ctx, "organization.list")
    require_mode(ctx, "organization.list")
    _emit_success(ctx, "organization.list", organization_list_result(ctx.obj, limit=limit))


@organization_group.command("get")
@click.argument("org_id", required=False)
@click.pass_context
def organization_get(ctx: click.Context, org_id: str | None) -> None:
    _set_command(ctx, "organization.get")
    require_mode(ctx, "organization.get")
    _emit_success(ctx, "organization.get", organization_get_result(ctx.obj, org_id))


@organization_group.command("create")
@click.argument("name")
@click.pass_context
def organization_create(ctx: click.Context, name: str) -> None:
    _set_command(ctx, "organization.create")
    require_mode(ctx, "organization.create")
    _emit_success(ctx, "organization.create", organization_create_result(ctx.obj, name=name))


@cli.group("activity")
def activity_group() -> None:
    pass


@activity_group.command("list")
@click.option("--limit", default=10, show_default=True, type=int)
@click.pass_context
def activity_list(ctx: click.Context, limit: int) -> None:
    _set_command(ctx, "activity.list")
    require_mode(ctx, "activity.list")
    _emit_success(ctx, "activity.list", activity_list_result(ctx.obj, limit=limit))


@activity_group.command("create")
@click.argument("subject")
@click.option("--type", "activity_type", default=None)
@click.pass_context
def activity_create(ctx: click.Context, subject: str, activity_type: str | None) -> None:
    _set_command(ctx, "activity.create")
    require_mode(ctx, "activity.create")
    _emit_success(ctx, "activity.create", activity_create_result(ctx.obj, subject=subject, activity_type=activity_type))


@cli.group("pipeline")
def pipeline_group() -> None:
    pass


@pipeline_group.command("list")
@click.pass_context
def pipeline_list(ctx: click.Context) -> None:
    _set_command(ctx, "pipeline.list")
    require_mode(ctx, "pipeline.list")
    _emit_success(ctx, "pipeline.list", pipeline_list_result(ctx.obj))


@cli.group("stage")
def stage_group() -> None:
    pass


@stage_group.command("list")
@click.argument("pipeline_id", required=False)
@click.pass_context
def stage_list(ctx: click.Context, pipeline_id: str | None) -> None:
    _set_command(ctx, "stage.list")
    require_mode(ctx, "stage.list")
    _emit_success(ctx, "stage.list", stage_list_result(ctx.obj, pipeline_id))


@cli.group("note")
def note_group() -> None:
    pass


@note_group.command("create")
@click.argument("content")
@click.option("--deal-id", default=None)
@click.option("--person-id", default=None)
@click.pass_context
def note_create(ctx: click.Context, content: str, deal_id: str | None, person_id: str | None) -> None:
    _set_command(ctx, "note.create")
    require_mode(ctx, "note.create")
    _emit_success(ctx, "note.create", note_create_result(ctx.obj, content=content, deal_id=deal_id, person_id=person_id))


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
