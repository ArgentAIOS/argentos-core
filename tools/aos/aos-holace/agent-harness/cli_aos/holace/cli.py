from __future__ import annotations

import json
import time

import click

from . import __version__
from .config import config_snapshot
from .constants import MODE_ORDER, PERMISSIONS_PATH
from .errors import ConnectorError
from .output import emit, failure, success
from .runtime import (
    billing_list_result,
    capabilities_snapshot,
    case_get_result,
    case_list_result,
    case_timeline_result,
    client_get_result,
    client_list_result,
    communication_list_result,
    deadline_list_result,
    deadline_statute_result,
    doctor_snapshot,
    document_get_result,
    document_list_result,
    health_snapshot,
    report_case_status_result,
    report_pipeline_result,
    settlement_get_result,
    settlement_list_result,
    settlement_tracker_result,
)


def _mode_allows(actual: str, required: str) -> bool:
    return MODE_ORDER.index(actual) >= MODE_ORDER.index(required)


def _load_permissions() -> dict[str, str]:
    return json.loads(PERMISSIONS_PATH.read_text()).get("permissions", {})


def require_mode(ctx: click.Context, command_id: str) -> None:
    required = _load_permissions().get(command_id, "admin")
    mode = ctx.obj["mode"]
    if _mode_allows(mode, required):
        return
    raise ConnectorError(
        code="PERMISSION_DENIED",
        message=f"Command requires mode={required}",
        exit_code=3,
        details={"required_mode": required, "actual_mode": mode},
    )


class AosGroup(click.Group):
    def invoke(self, ctx: click.Context):
        try:
            return super().invoke(ctx)
        except ConnectorError as err:
            emit(
                failure(
                    command=ctx.obj.get("_command_id", "unknown") if ctx.obj else "unknown",
                    mode=ctx.obj.get("mode", "unknown") if ctx.obj else "unknown",
                    started=ctx.obj.get("started", time.time()) if ctx.obj else time.time(),
                    version=ctx.obj.get("version", __version__) if ctx.obj else __version__,
                    error={"code": err.code, "message": err.message, "details": err.details or {}},
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
                    version=ctx.obj.get("version", __version__) if ctx.obj else __version__,
                    error={"code": "INVALID_USAGE", "message": str(err), "details": {}},
                ),
                as_json=ctx.obj.get("json", True) if ctx.obj else True,
            )
            ctx.exit(2)


def _set_command(ctx: click.Context, command_id: str) -> None:
    ctx.obj["_command_id"] = command_id


def _emit_success(ctx: click.Context, command_id: str, data: dict) -> None:
    emit(
        success(command=command_id, mode=ctx.obj["mode"], started=ctx.obj["started"], version=ctx.obj["version"], data=data),
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
    ctx.obj.update({"json": as_json, "mode": mode, "verbose": verbose, "started": time.time(), "version": __version__, "_command_id": "unknown"})


@cli.command("capabilities")
@click.pass_context
def capabilities(ctx: click.Context) -> None:
    _set_command(ctx, "capabilities")
    require_mode(ctx, "capabilities")
    _emit_success(ctx, "capabilities", capabilities_snapshot())


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


@cli.group("config")
def config_group() -> None:
    pass


@config_group.command("show")
@click.pass_context
def config_show(ctx: click.Context) -> None:
    _set_command(ctx, "config.show")
    require_mode(ctx, "config.show")
    _emit_success(ctx, "config.show", config_snapshot(ctx.obj))


@cli.group("case")
def case_group() -> None:
    pass


@case_group.command("list")
@click.option("--attorney-id", default=None)
@click.option("--client-id", default=None)
@click.option("--case-type", default=None)
@click.option("--limit", default=25, show_default=True, type=int)
@click.pass_context
def case_list(ctx: click.Context, attorney_id: str | None, client_id: str | None, case_type: str | None, limit: int) -> None:
    _set_command(ctx, "case.list")
    require_mode(ctx, "case.list")
    _emit_success(ctx, "case.list", case_list_result(ctx.obj, attorney_id=attorney_id, client_id=client_id, case_type=case_type, limit=limit))


@case_group.command("get")
@click.argument("case_id", required=False)
@click.pass_context
def case_get(ctx: click.Context, case_id: str | None) -> None:
    _set_command(ctx, "case.get")
    require_mode(ctx, "case.get")
    _emit_success(ctx, "case.get", case_get_result(ctx.obj, case_id))


@case_group.command("timeline")
@click.argument("case_id", required=False)
@click.pass_context
def case_timeline(ctx: click.Context, case_id: str | None) -> None:
    _set_command(ctx, "case.timeline")
    require_mode(ctx, "case.timeline")
    _emit_success(ctx, "case.timeline", case_timeline_result(ctx.obj, case_id))


@cli.group("client")
def client_group() -> None:
    pass


@client_group.command("list")
@click.option("--limit", default=50, show_default=True, type=int)
@click.pass_context
def client_list(ctx: click.Context, limit: int) -> None:
    _set_command(ctx, "client.list")
    require_mode(ctx, "client.list")
    _emit_success(ctx, "client.list", client_list_result(ctx.obj, limit=limit))


@client_group.command("get")
@click.argument("client_id", required=False)
@click.pass_context
def client_get(ctx: click.Context, client_id: str | None) -> None:
    _set_command(ctx, "client.get")
    require_mode(ctx, "client.get")
    _emit_success(ctx, "client.get", client_get_result(ctx.obj, client_id))


@cli.group("document")
def document_group() -> None:
    pass


@document_group.command("list")
@click.option("--case-id", default=None)
@click.option("--limit", default=25, show_default=True, type=int)
@click.pass_context
def document_list(ctx: click.Context, case_id: str | None, limit: int) -> None:
    _set_command(ctx, "document.list")
    require_mode(ctx, "document.list")
    _emit_success(ctx, "document.list", document_list_result(ctx.obj, case_id=case_id, limit=limit))


@document_group.command("get")
@click.argument("document_id", required=False)
@click.pass_context
def document_get(ctx: click.Context, document_id: str | None) -> None:
    _set_command(ctx, "document.get")
    require_mode(ctx, "document.get")
    _emit_success(ctx, "document.get", document_get_result(ctx.obj, document_id))


@cli.group("deadline")
def deadline_group() -> None:
    pass


@deadline_group.command("list")
@click.option("--case-id", default=None)
@click.option("--limit", default=20, show_default=True, type=int)
@click.pass_context
def deadline_list(ctx: click.Context, case_id: str | None, limit: int) -> None:
    _set_command(ctx, "deadline.list")
    require_mode(ctx, "deadline.list")
    _emit_success(ctx, "deadline.list", deadline_list_result(ctx.obj, case_id=case_id, limit=limit))


@deadline_group.command("check-statute")
@click.option("--state", "state_code", default=None)
@click.option("--case-type", default=None)
@click.pass_context
def deadline_check_statute(ctx: click.Context, state_code: str | None, case_type: str | None) -> None:
    _set_command(ctx, "deadline.check_statute")
    require_mode(ctx, "deadline.check_statute")
    _emit_success(ctx, "deadline.check_statute", deadline_statute_result(ctx.obj, state=state_code, case_type=case_type))


@cli.group("settlement")
def settlement_group() -> None:
    pass


@settlement_group.command("list")
@click.option("--case-id", default=None)
@click.option("--limit", default=10, show_default=True, type=int)
@click.pass_context
def settlement_list(ctx: click.Context, case_id: str | None, limit: int) -> None:
    _set_command(ctx, "settlement.list")
    require_mode(ctx, "settlement.list")
    _emit_success(ctx, "settlement.list", settlement_list_result(ctx.obj, case_id=case_id, limit=limit))


@settlement_group.command("get")
@click.argument("settlement_id", required=False)
@click.pass_context
def settlement_get(ctx: click.Context, settlement_id: str | None) -> None:
    _set_command(ctx, "settlement.get")
    require_mode(ctx, "settlement.get")
    _emit_success(ctx, "settlement.get", settlement_get_result(ctx.obj, settlement_id))


@settlement_group.command("tracker")
@click.pass_context
def settlement_tracker(ctx: click.Context) -> None:
    _set_command(ctx, "settlement.tracker")
    require_mode(ctx, "settlement.tracker")
    _emit_success(ctx, "settlement.tracker", settlement_tracker_result(ctx.obj))


@cli.group("billing")
def billing_group() -> None:
    pass


@billing_group.command("list")
@click.option("--case-id", default=None)
@click.option("--limit", default=25, show_default=True, type=int)
@click.pass_context
def billing_list(ctx: click.Context, case_id: str | None, limit: int) -> None:
    _set_command(ctx, "billing.list")
    require_mode(ctx, "billing.list")
    _emit_success(ctx, "billing.list", billing_list_result(ctx.obj, case_id=case_id, limit=limit))


@cli.group("communication")
def communication_group() -> None:
    pass


@communication_group.command("list")
@click.option("--case-id", default=None)
@click.option("--limit", default=25, show_default=True, type=int)
@click.pass_context
def communication_list(ctx: click.Context, case_id: str | None, limit: int) -> None:
    _set_command(ctx, "communication.list")
    require_mode(ctx, "communication.list")
    _emit_success(ctx, "communication.list", communication_list_result(ctx.obj, case_id=case_id, limit=limit))


@cli.group("report")
def report_group() -> None:
    pass


@report_group.command("case-status")
@click.option("--case-id", default=None)
@click.pass_context
def report_case_status(ctx: click.Context, case_id: str | None) -> None:
    _set_command(ctx, "report.case_status")
    require_mode(ctx, "report.case_status")
    _emit_success(ctx, "report.case_status", report_case_status_result(ctx.obj, case_id=case_id))


@report_group.command("pipeline")
@click.option("--attorney-id", default=None)
@click.pass_context
def report_pipeline(ctx: click.Context, attorney_id: str | None) -> None:
    _set_command(ctx, "report.pipeline")
    require_mode(ctx, "report.pipeline")
    _emit_success(ctx, "report.pipeline", report_pipeline_result(ctx.obj, attorney_id=attorney_id))
