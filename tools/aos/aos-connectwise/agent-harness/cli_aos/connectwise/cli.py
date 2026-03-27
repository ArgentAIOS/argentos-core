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
    board_list_result,
    capabilities_snapshot,
    company_get_result,
    company_list_result,
    configuration_get_result,
    configuration_list_result,
    contact_get_result,
    contact_list_result,
    doctor_snapshot,
    health_snapshot,
    member_list_result,
    project_get_result,
    project_list_result,
    scaffold_write_result,
    status_list_result,
    ticket_get_result,
    ticket_list_result,
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
            emit(failure(command=ctx.obj.get("_command_id", "unknown") if ctx.obj else "unknown", mode=ctx.obj.get("mode", "unknown") if ctx.obj else "unknown", started=ctx.obj.get("started", time.time()) if ctx.obj else time.time(), error={"code": err.code, "message": err.message, "details": err.details}), as_json=ctx.obj.get("json", True) if ctx.obj else True)
            ctx.exit(err.exit_code)
        except click.ClickException as err:
            emit(failure(command=ctx.obj.get("_command_id", "unknown") if ctx.obj else "unknown", mode=ctx.obj.get("mode", "unknown") if ctx.obj else "unknown", started=ctx.obj.get("started", time.time()) if ctx.obj else time.time(), error={"code": "INVALID_USAGE", "message": str(err), "details": {}}), as_json=ctx.obj.get("json", True) if ctx.obj else True)
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


@cli.group("ticket")
def ticket_group() -> None:
    pass


@ticket_group.command("list")
@click.option("--board-id", default=None)
@click.option("--status", default=None)
@click.option("--priority", default=None)
@click.option("--limit", default=25, show_default=True, type=int)
@click.pass_context
def ticket_list(ctx: click.Context, board_id: str | None, status: str | None, priority: str | None, limit: int) -> None:
    _set_command(ctx, "ticket.list")
    require_mode(ctx, "ticket.list")
    _emit_success(ctx, "ticket.list", ticket_list_result(ctx.obj, board_id=board_id, status=status, priority=priority, limit=limit))


@ticket_group.command("get")
@click.argument("ticket_id", required=False)
@click.pass_context
def ticket_get(ctx: click.Context, ticket_id: str | None) -> None:
    _set_command(ctx, "ticket.get")
    require_mode(ctx, "ticket.get")
    _emit_success(ctx, "ticket.get", ticket_get_result(ctx.obj, ticket_id=ticket_id))


@ticket_group.command("create")
@click.pass_context
def ticket_create(ctx: click.Context) -> None:
    _set_command(ctx, "ticket.create")
    require_mode(ctx, "ticket.create")
    payload = scaffold_write_result("ticket.create")
    emit(failure(command="ticket.create", mode=ctx.obj["mode"], started=ctx.obj["started"], error={"code": "NOT_IMPLEMENTED", "message": "ticket.create is scaffolded but not implemented yet", "details": payload}), as_json=ctx.obj["json"])
    ctx.exit(10)


@ticket_group.command("update")
@click.pass_context
def ticket_update(ctx: click.Context) -> None:
    _set_command(ctx, "ticket.update")
    require_mode(ctx, "ticket.update")
    payload = scaffold_write_result("ticket.update")
    emit(failure(command="ticket.update", mode=ctx.obj["mode"], started=ctx.obj["started"], error={"code": "NOT_IMPLEMENTED", "message": "ticket.update is scaffolded but not implemented yet", "details": payload}), as_json=ctx.obj["json"])
    ctx.exit(10)


@cli.group("company")
def company_group() -> None:
    pass


@company_group.command("list")
@click.option("--limit", default=25, show_default=True, type=int)
@click.pass_context
def company_list(ctx: click.Context, limit: int) -> None:
    _set_command(ctx, "company.list")
    require_mode(ctx, "company.list")
    _emit_success(ctx, "company.list", company_list_result(ctx.obj, limit=limit))


@company_group.command("get")
@click.argument("company_id", required=False)
@click.pass_context
def company_get(ctx: click.Context, company_id: str | None) -> None:
    _set_command(ctx, "company.get")
    require_mode(ctx, "company.get")
    _emit_success(ctx, "company.get", company_get_result(ctx.obj, company_id=company_id))


@company_group.command("create")
@click.pass_context
def company_create(ctx: click.Context) -> None:
    _set_command(ctx, "company.create")
    require_mode(ctx, "company.create")
    payload = scaffold_write_result("company.create")
    emit(failure(command="company.create", mode=ctx.obj["mode"], started=ctx.obj["started"], error={"code": "NOT_IMPLEMENTED", "message": "company.create is scaffolded but not implemented yet", "details": payload}), as_json=ctx.obj["json"])
    ctx.exit(10)


@cli.group("contact")
def contact_group() -> None:
    pass


@contact_group.command("list")
@click.option("--company-id", default=None)
@click.option("--limit", default=25, show_default=True, type=int)
@click.pass_context
def contact_list(ctx: click.Context, company_id: str | None, limit: int) -> None:
    _set_command(ctx, "contact.list")
    require_mode(ctx, "contact.list")
    _emit_success(ctx, "contact.list", contact_list_result(ctx.obj, company_id=company_id, limit=limit))


@contact_group.command("get")
@click.argument("contact_id", required=False)
@click.pass_context
def contact_get(ctx: click.Context, contact_id: str | None) -> None:
    _set_command(ctx, "contact.get")
    require_mode(ctx, "contact.get")
    _emit_success(ctx, "contact.get", contact_get_result(ctx.obj, contact_id=contact_id))


@contact_group.command("create")
@click.pass_context
def contact_create(ctx: click.Context) -> None:
    _set_command(ctx, "contact.create")
    require_mode(ctx, "contact.create")
    payload = scaffold_write_result("contact.create")
    emit(failure(command="contact.create", mode=ctx.obj["mode"], started=ctx.obj["started"], error={"code": "NOT_IMPLEMENTED", "message": "contact.create is scaffolded but not implemented yet", "details": payload}), as_json=ctx.obj["json"])
    ctx.exit(10)


@cli.group("project")
def project_group() -> None:
    pass


@project_group.command("list")
@click.option("--limit", default=25, show_default=True, type=int)
@click.pass_context
def project_list(ctx: click.Context, limit: int) -> None:
    _set_command(ctx, "project.list")
    require_mode(ctx, "project.list")
    _emit_success(ctx, "project.list", project_list_result(ctx.obj, limit=limit))


@project_group.command("get")
@click.argument("project_id", required=False)
@click.pass_context
def project_get(ctx: click.Context, project_id: str | None) -> None:
    _set_command(ctx, "project.get")
    require_mode(ctx, "project.get")
    _emit_success(ctx, "project.get", project_get_result(ctx.obj, project_id=project_id))


@cli.group("board")
def board_group() -> None:
    pass


@board_group.command("list")
@click.option("--limit", default=25, show_default=True, type=int)
@click.pass_context
def board_list(ctx: click.Context, limit: int) -> None:
    _set_command(ctx, "board.list")
    require_mode(ctx, "board.list")
    _emit_success(ctx, "board.list", board_list_result(ctx.obj, limit=limit))


@cli.group("status")
def status_group() -> None:
    pass


@status_group.command("list")
@click.option("--board-id", default=None)
@click.option("--limit", default=25, show_default=True, type=int)
@click.pass_context
def status_list(ctx: click.Context, board_id: str | None, limit: int) -> None:
    _set_command(ctx, "status.list")
    require_mode(ctx, "status.list")
    _emit_success(ctx, "status.list", status_list_result(ctx.obj, board_id=board_id, limit=limit))


@cli.group("member")
def member_group() -> None:
    pass


@member_group.command("list")
@click.option("--limit", default=25, show_default=True, type=int)
@click.pass_context
def member_list(ctx: click.Context, limit: int) -> None:
    _set_command(ctx, "member.list")
    require_mode(ctx, "member.list")
    _emit_success(ctx, "member.list", member_list_result(ctx.obj, limit=limit))


@cli.group("configuration")
def configuration_group() -> None:
    pass


@configuration_group.command("list")
@click.option("--company-id", default=None)
@click.option("--limit", default=25, show_default=True, type=int)
@click.pass_context
def configuration_list(ctx: click.Context, company_id: str | None, limit: int) -> None:
    _set_command(ctx, "configuration.list")
    require_mode(ctx, "configuration.list")
    _emit_success(ctx, "configuration.list", configuration_list_result(ctx.obj, company_id=company_id, limit=limit))


@configuration_group.command("get")
@click.argument("configuration_id", required=False)
@click.pass_context
def configuration_get(ctx: click.Context, configuration_id: str | None) -> None:
    _set_command(ctx, "configuration.get")
    require_mode(ctx, "configuration.get")
    _emit_success(ctx, "configuration.get", configuration_get_result(ctx.obj, configuration_id=configuration_id))
