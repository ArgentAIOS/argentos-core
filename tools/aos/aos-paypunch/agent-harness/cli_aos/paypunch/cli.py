from __future__ import annotations

import json
import time

import click

from . import __version__
from .client import PayPunchApiError
from .config import config_snapshot
from .constants import MODE_ORDER, PERMISSIONS_PATH
from .errors import ConnectorError
from .output import emit, failure, success
from .runtime import (
    capabilities_snapshot,
    company_get_result,
    company_list_result,
    doctor_snapshot,
    employee_get_result,
    employee_list_result,
    export_csv_result,
    export_quickbooks_iif_result,
    health_snapshot,
    pay_period_current_result,
    pay_period_list_result,
    report_hours_summary_result,
    report_overtime_result,
    timesheet_get_result,
    timesheet_list_result,
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
        except PayPunchApiError as err:
            emit(
                failure(
                    command=ctx.obj.get("_command_id", "unknown") if ctx.obj else "unknown",
                    mode=ctx.obj.get("mode", "unknown") if ctx.obj else "unknown",
                    started=ctx.obj.get("started", time.time()) if ctx.obj else time.time(),
                    version=ctx.obj.get("version", __version__) if ctx.obj else __version__,
                    error={
                        "code": err.code,
                        "message": err.message,
                        "details": err.details or {},
                    },
                ),
                as_json=ctx.obj.get("json", True) if ctx.obj else True,
            )
            ctx.exit(4)
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
        success(
            command=command_id,
            mode=ctx.obj["mode"],
            started=ctx.obj["started"],
            version=ctx.obj["version"],
            data=data,
        ),
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


@cli.group("timesheet")
def timesheet_group() -> None:
    pass


@timesheet_group.command("list")
@click.option("--tenant-id", default=None)
@click.option("--company-id", default=None)
@click.option("--employee-id", default=None)
@click.option("--pay-period", default=None)
@click.option("--limit", default=50, show_default=True, type=int)
@click.pass_context
def timesheet_list(
    ctx: click.Context,
    tenant_id: str | None,
    company_id: str | None,
    employee_id: str | None,
    pay_period: str | None,
    limit: int,
) -> None:
    _set_command(ctx, "timesheet.list")
    require_mode(ctx, "timesheet.list")
    _emit_success(
        ctx,
        "timesheet.list",
        timesheet_list_result(
            ctx.obj,
            tenant_id=tenant_id,
            company_id=company_id,
            employee_id=employee_id,
            pay_period=pay_period,
            limit=limit,
        ),
    )


@timesheet_group.command("get")
@click.argument("timesheet_id", required=False)
@click.pass_context
def timesheet_get(ctx: click.Context, timesheet_id: str | None) -> None:
    _set_command(ctx, "timesheet.get")
    require_mode(ctx, "timesheet.get")
    _emit_success(ctx, "timesheet.get", timesheet_get_result(ctx.obj, timesheet_id))


@cli.group("employee")
def employee_group() -> None:
    pass


@employee_group.command("list")
@click.option("--company-id", default=None)
@click.option("--limit", default=100, show_default=True, type=int)
@click.pass_context
def employee_list(ctx: click.Context, company_id: str | None, limit: int) -> None:
    _set_command(ctx, "employee.list")
    require_mode(ctx, "employee.list")
    _emit_success(ctx, "employee.list", employee_list_result(ctx.obj, company_id=company_id, limit=limit))


@employee_group.command("get")
@click.argument("employee_id", required=False)
@click.pass_context
def employee_get(ctx: click.Context, employee_id: str | None) -> None:
    _set_command(ctx, "employee.get")
    require_mode(ctx, "employee.get")
    _emit_success(ctx, "employee.get", employee_get_result(ctx.obj, employee_id))


@cli.group("company")
def company_group() -> None:
    pass


@company_group.command("list")
@click.option("--tenant-id", default=None)
@click.option("--limit", default=50, show_default=True, type=int)
@click.pass_context
def company_list(ctx: click.Context, tenant_id: str | None, limit: int) -> None:
    _set_command(ctx, "company.list")
    require_mode(ctx, "company.list")
    _emit_success(ctx, "company.list", company_list_result(ctx.obj, tenant_id=tenant_id, limit=limit))


@company_group.command("get")
@click.argument("company_id", required=False)
@click.pass_context
def company_get(ctx: click.Context, company_id: str | None) -> None:
    _set_command(ctx, "company.get")
    require_mode(ctx, "company.get")
    _emit_success(ctx, "company.get", company_get_result(ctx.obj, company_id))


@cli.group("export")
def export_group() -> None:
    pass


@export_group.command("quickbooks-iif")
@click.option("--company-id", default=None)
@click.option("--pay-period", default=None)
@click.pass_context
def export_quickbooks_iif(ctx: click.Context, company_id: str | None, pay_period: str | None) -> None:
    _set_command(ctx, "export.quickbooks_iif")
    require_mode(ctx, "export.quickbooks_iif")
    _emit_success(
        ctx,
        "export.quickbooks_iif",
        export_quickbooks_iif_result(ctx.obj, company_id=company_id, pay_period=pay_period),
    )


@export_group.command("csv")
@click.option("--company-id", default=None)
@click.option("--pay-period", default=None)
@click.pass_context
def export_csv(ctx: click.Context, company_id: str | None, pay_period: str | None) -> None:
    _set_command(ctx, "export.csv")
    require_mode(ctx, "export.csv")
    _emit_success(ctx, "export.csv", export_csv_result(ctx.obj, company_id=company_id, pay_period=pay_period))


@cli.group("pay-period")
def pay_period_group() -> None:
    pass


@pay_period_group.command("list")
@click.option("--company-id", default=None)
@click.option("--limit", default=12, show_default=True, type=int)
@click.pass_context
def pay_period_list(ctx: click.Context, company_id: str | None, limit: int) -> None:
    _set_command(ctx, "pay_period.list")
    require_mode(ctx, "pay_period.list")
    _emit_success(ctx, "pay_period.list", pay_period_list_result(ctx.obj, company_id=company_id, limit=limit))


@pay_period_group.command("current")
@click.option("--company-id", default=None)
@click.pass_context
def pay_period_current(ctx: click.Context, company_id: str | None) -> None:
    _set_command(ctx, "pay_period.current")
    require_mode(ctx, "pay_period.current")
    _emit_success(ctx, "pay_period.current", pay_period_current_result(ctx.obj, company_id=company_id))


@cli.group("report")
def report_group() -> None:
    pass


@report_group.command("hours-summary")
@click.option("--company-id", default=None)
@click.option("--pay-period", default=None)
@click.pass_context
def report_hours_summary(ctx: click.Context, company_id: str | None, pay_period: str | None) -> None:
    _set_command(ctx, "report.hours_summary")
    require_mode(ctx, "report.hours_summary")
    _emit_success(
        ctx,
        "report.hours_summary",
        report_hours_summary_result(ctx.obj, company_id=company_id, pay_period=pay_period),
    )


@report_group.command("overtime")
@click.option("--company-id", default=None)
@click.option("--pay-period", default=None)
@click.pass_context
def report_overtime(ctx: click.Context, company_id: str | None, pay_period: str | None) -> None:
    _set_command(ctx, "report.overtime")
    require_mode(ctx, "report.overtime")
    _emit_success(ctx, "report.overtime", report_overtime_result(ctx.obj, company_id=company_id, pay_period=pay_period))
