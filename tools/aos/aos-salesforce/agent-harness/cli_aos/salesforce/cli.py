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
    account_get_result,
    account_list_result,
    capabilities_snapshot,
    contact_get_result,
    contact_list_result,
    contact_create_result,
    doctor_snapshot,
    health_snapshot,
    lead_get_result,
    lead_create_result,
    lead_update_result,
    lead_list_result,
    opportunity_get_result,
    opportunity_create_result,
    opportunity_update_result,
    opportunity_list_result,
    report_run_result,
    soql_result,
    task_create_result,
    task_list_result,
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


@cli.group("lead")
def lead_group() -> None:
    pass


@lead_group.command("list")
@click.option("--limit", default=10, show_default=True, type=int)
@click.pass_context
def lead_list(ctx: click.Context, limit: int) -> None:
    _set_command(ctx, "lead.list")
    require_mode(ctx, "lead.list")
    _emit_success(ctx, "lead.list", lead_list_result(ctx.obj, limit=limit))


@lead_group.command("get")
@click.argument("record_id", required=False)
@click.pass_context
def lead_get(ctx: click.Context, record_id: str | None) -> None:
    _set_command(ctx, "lead.get")
    require_mode(ctx, "lead.get")
    _emit_success(ctx, "lead.get", lead_get_result(ctx.obj, record_id))


@lead_group.command("create")
@click.argument("name")
@click.option("--company", default=None)
@click.option("--email", default=None)
@click.pass_context
def lead_create(ctx: click.Context, name: str, company: str | None, email: str | None) -> None:
    _set_command(ctx, "lead.create")
    require_mode(ctx, "lead.create")
    _emit_success(ctx, "lead.create", lead_create_result(ctx.obj, name=name, company=company, email=email))


@lead_group.command("update")
@click.argument("record_id")
@click.pass_context
def lead_update(ctx: click.Context, record_id: str) -> None:
    _set_command(ctx, "lead.update")
    require_mode(ctx, "lead.update")
    _emit_success(ctx, "lead.update", lead_update_result(ctx.obj, record_id=record_id))


@cli.group("contact")
def contact_group() -> None:
    pass


@contact_group.command("list")
@click.option("--limit", default=10, show_default=True, type=int)
@click.pass_context
def contact_list(ctx: click.Context, limit: int) -> None:
    _set_command(ctx, "contact.list")
    require_mode(ctx, "contact.list")
    _emit_success(ctx, "contact.list", contact_list_result(ctx.obj, limit=limit))


@contact_group.command("get")
@click.argument("record_id", required=False)
@click.pass_context
def contact_get(ctx: click.Context, record_id: str | None) -> None:
    _set_command(ctx, "contact.get")
    require_mode(ctx, "contact.get")
    _emit_success(ctx, "contact.get", contact_get_result(ctx.obj, record_id))


@contact_group.command("create")
@click.argument("last_name")
@click.option("--email", default=None)
@click.pass_context
def contact_create(ctx: click.Context, last_name: str, email: str | None) -> None:
    _set_command(ctx, "contact.create")
    require_mode(ctx, "contact.create")
    _emit_success(ctx, "contact.create", contact_create_result(ctx.obj, last_name=last_name, email=email))


@cli.group("opportunity")
def opportunity_group() -> None:
    pass


@opportunity_group.command("list")
@click.option("--limit", default=10, show_default=True, type=int)
@click.pass_context
def opportunity_list(ctx: click.Context, limit: int) -> None:
    _set_command(ctx, "opportunity.list")
    require_mode(ctx, "opportunity.list")
    _emit_success(ctx, "opportunity.list", opportunity_list_result(ctx.obj, limit=limit))


@opportunity_group.command("get")
@click.argument("record_id", required=False)
@click.pass_context
def opportunity_get(ctx: click.Context, record_id: str | None) -> None:
    _set_command(ctx, "opportunity.get")
    require_mode(ctx, "opportunity.get")
    _emit_success(ctx, "opportunity.get", opportunity_get_result(ctx.obj, record_id))


@opportunity_group.command("create")
@click.argument("name")
@click.option("--stage", default=None)
@click.option("--amount", default=None, type=float)
@click.pass_context
def opportunity_create(ctx: click.Context, name: str, stage: str | None, amount: float | None) -> None:
    _set_command(ctx, "opportunity.create")
    require_mode(ctx, "opportunity.create")
    _emit_success(ctx, "opportunity.create", opportunity_create_result(ctx.obj, name=name, stage=stage, amount=amount))


@opportunity_group.command("update")
@click.argument("record_id")
@click.pass_context
def opportunity_update(ctx: click.Context, record_id: str) -> None:
    _set_command(ctx, "opportunity.update")
    require_mode(ctx, "opportunity.update")
    _emit_success(ctx, "opportunity.update", opportunity_update_result(ctx.obj, record_id=record_id))


@cli.group("account")
def account_group() -> None:
    pass


@account_group.command("list")
@click.option("--limit", default=10, show_default=True, type=int)
@click.pass_context
def account_list(ctx: click.Context, limit: int) -> None:
    _set_command(ctx, "account.list")
    require_mode(ctx, "account.list")
    _emit_success(ctx, "account.list", account_list_result(ctx.obj, limit=limit))


@account_group.command("get")
@click.argument("record_id", required=False)
@click.pass_context
def account_get(ctx: click.Context, record_id: str | None) -> None:
    _set_command(ctx, "account.get")
    require_mode(ctx, "account.get")
    _emit_success(ctx, "account.get", account_get_result(ctx.obj, record_id))


@cli.group("task")
def task_group() -> None:
    pass


@task_group.command("list")
@click.option("--limit", default=10, show_default=True, type=int)
@click.pass_context
def task_list(ctx: click.Context, limit: int) -> None:
    _set_command(ctx, "task.list")
    require_mode(ctx, "task.list")
    _emit_success(ctx, "task.list", task_list_result(ctx.obj, limit=limit))


@task_group.command("create")
@click.argument("subject")
@click.pass_context
def task_create(ctx: click.Context, subject: str) -> None:
    _set_command(ctx, "task.create")
    require_mode(ctx, "task.create")
    _emit_success(ctx, "task.create", task_create_result(ctx.obj, subject=subject))


@cli.group("report")
def report_group() -> None:
    pass


@report_group.command("run")
@click.argument("report_id", required=False)
@click.pass_context
def report_run(ctx: click.Context, report_id: str | None) -> None:
    _set_command(ctx, "report.run")
    require_mode(ctx, "report.run")
    _emit_success(ctx, "report.run", report_run_result(ctx.obj, report_id))


@cli.group("search")
def search_group() -> None:
    pass


@search_group.command("soql")
@click.argument("query")
@click.pass_context
def search_soql(ctx: click.Context, query: str) -> None:
    _set_command(ctx, "search.soql")
    require_mode(ctx, "search.soql")
    _emit_success(ctx, "search.soql", soql_result(ctx.obj, query))


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
