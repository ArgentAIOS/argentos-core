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
    capabilities_snapshot,
    contact_get_result,
    contact_list_result,
    doctor_snapshot,
    health_snapshot,
    lead_get_result,
    lead_list_result,
    opportunity_get_result,
    opportunity_list_result,
    scaffold_write_result,
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
@click.option("--query", default=None, help="Close search query")
@click.pass_context
def lead_list(ctx: click.Context, limit: int, query: str | None) -> None:
    _set_command(ctx, "lead.list")
    require_mode(ctx, "lead.list")
    _emit_success(ctx, "lead.list", lead_list_result(ctx.obj, limit=limit, query=query))


@lead_group.command("get")
@click.argument("lead_id", required=False)
@click.pass_context
def lead_get(ctx: click.Context, lead_id: str | None) -> None:
    _set_command(ctx, "lead.get")
    require_mode(ctx, "lead.get")
    _emit_success(ctx, "lead.get", lead_get_result(ctx.obj, lead_id))


@lead_group.command("create")
@click.argument("name")
@click.option("--status", default=None)
@click.pass_context
def lead_create(ctx: click.Context, name: str, status: str | None) -> None:
    _set_command(ctx, "lead.create")
    require_mode(ctx, "lead.create")
    _emit_success(ctx, "lead.create", scaffold_write_result(ctx.obj, command_id="lead.create", inputs={"name": name, "status": status}))


@lead_group.command("update")
@click.argument("lead_id")
@click.pass_context
def lead_update(ctx: click.Context, lead_id: str) -> None:
    _set_command(ctx, "lead.update")
    require_mode(ctx, "lead.update")
    _emit_success(ctx, "lead.update", scaffold_write_result(ctx.obj, command_id="lead.update", inputs={"lead_id": lead_id}))


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
@click.argument("contact_id", required=False)
@click.pass_context
def contact_get(ctx: click.Context, contact_id: str | None) -> None:
    _set_command(ctx, "contact.get")
    require_mode(ctx, "contact.get")
    _emit_success(ctx, "contact.get", contact_get_result(ctx.obj, contact_id))


@contact_group.command("create")
@click.argument("name")
@click.option("--lead-id", default=None)
@click.pass_context
def contact_create(ctx: click.Context, name: str, lead_id: str | None) -> None:
    _set_command(ctx, "contact.create")
    require_mode(ctx, "contact.create")
    _emit_success(ctx, "contact.create", scaffold_write_result(ctx.obj, command_id="contact.create", inputs={"name": name, "lead_id": lead_id}))


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
@click.argument("opportunity_id", required=False)
@click.pass_context
def opportunity_get(ctx: click.Context, opportunity_id: str | None) -> None:
    _set_command(ctx, "opportunity.get")
    require_mode(ctx, "opportunity.get")
    _emit_success(ctx, "opportunity.get", opportunity_get_result(ctx.obj, opportunity_id))


@opportunity_group.command("create")
@click.argument("lead_id")
@click.option("--value", default=None, type=float)
@click.pass_context
def opportunity_create(ctx: click.Context, lead_id: str, value: float | None) -> None:
    _set_command(ctx, "opportunity.create")
    require_mode(ctx, "opportunity.create")
    _emit_success(ctx, "opportunity.create", scaffold_write_result(ctx.obj, command_id="opportunity.create", inputs={"lead_id": lead_id, "value": value}))


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
@click.argument("note")
@click.option("--lead-id", default=None)
@click.pass_context
def activity_create(ctx: click.Context, note: str, lead_id: str | None) -> None:
    _set_command(ctx, "activity.create")
    require_mode(ctx, "activity.create")
    _emit_success(ctx, "activity.create", scaffold_write_result(ctx.obj, command_id="activity.create", inputs={"note": note, "lead_id": lead_id}))


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
@click.argument("text")
@click.option("--lead-id", default=None)
@click.pass_context
def task_create(ctx: click.Context, text: str, lead_id: str | None) -> None:
    _set_command(ctx, "task.create")
    require_mode(ctx, "task.create")
    _emit_success(ctx, "task.create", scaffold_write_result(ctx.obj, command_id="task.create", inputs={"text": text, "lead_id": lead_id}))


@cli.group("email")
def email_group() -> None:
    pass


@email_group.command("send")
@click.argument("to")
@click.option("--subject", default=None)
@click.option("--body", default=None)
@click.pass_context
def email_send(ctx: click.Context, to: str, subject: str | None, body: str | None) -> None:
    _set_command(ctx, "email.send")
    require_mode(ctx, "email.send")
    _emit_success(ctx, "email.send", scaffold_write_result(ctx.obj, command_id="email.send", inputs={"to": to, "subject": subject, "body": body}))


@cli.group("sms")
def sms_group() -> None:
    pass


@sms_group.command("send")
@click.argument("to")
@click.option("--text", default=None)
@click.pass_context
def sms_send(ctx: click.Context, to: str, text: str | None) -> None:
    _set_command(ctx, "sms.send")
    require_mode(ctx, "sms.send")
    _emit_success(ctx, "sms.send", scaffold_write_result(ctx.obj, command_id="sms.send", inputs={"to": to, "text": text}))


@cli.group("call")
def call_group() -> None:
    pass


@call_group.command("create")
@click.argument("contact_id")
@click.option("--note", default=None)
@click.pass_context
def call_create(ctx: click.Context, contact_id: str, note: str | None) -> None:
    _set_command(ctx, "call.create")
    require_mode(ctx, "call.create")
    _emit_success(ctx, "call.create", scaffold_write_result(ctx.obj, command_id="call.create", inputs={"contact_id": contact_id, "note": note}))


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
