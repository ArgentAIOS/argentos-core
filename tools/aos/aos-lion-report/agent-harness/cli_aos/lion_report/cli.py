from __future__ import annotations

import json
import time

import click

from . import __version__
from .constants import MODE_ORDER, PERMISSIONS_PATH
from .errors import CliError
from .output import emit, failure, success
from .runtime import (
    analysis_list_result,
    analysis_run_result,
    capabilities_snapshot,
    config_snapshot,
    data_import_result,
    data_query_result,
    data_sources_result,
    doctor_snapshot,
    export_csv_result,
    export_email_result,
    export_pdf_result,
    health_snapshot,
    report_generate_result,
    report_get_result,
    report_list_result,
    report_schedule_result,
    template_get_result,
    template_list_result,
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


@cli.group("report")
def report_group() -> None:
    pass


@report_group.command("list")
@click.option("--report-type", default=None)
@click.option("--date-range", default=None)
@click.option("--limit", default=25, show_default=True, type=int)
@click.pass_context
def report_list(ctx: click.Context, report_type: str | None, date_range: str | None, limit: int) -> None:
    _set_command(ctx, "report.list")
    require_mode(ctx, "report.list")
    _emit_success(ctx, "report.list", report_list_result(ctx.obj, report_type=report_type, date_range=date_range, limit=limit))


@report_group.command("get")
@click.argument("report_id", required=False)
@click.pass_context
def report_get(ctx: click.Context, report_id: str | None) -> None:
    _set_command(ctx, "report.get")
    require_mode(ctx, "report.get")
    _emit_success(ctx, "report.get", report_get_result(ctx.obj, report_id=report_id))


@report_group.command("generate")
@click.option("--report-type", default=None)
@click.option("--template-id", default=None)
@click.option("--date-range", default=None)
@click.option("--data-source", default=None)
@click.pass_context
def report_generate(
    ctx: click.Context,
    report_type: str | None,
    template_id: str | None,
    date_range: str | None,
    data_source: str | None,
) -> None:
    _set_command(ctx, "report.generate")
    require_mode(ctx, "report.generate")
    _emit_success(ctx, "report.generate", report_generate_result(ctx.obj, report_type=report_type, template_id=template_id, date_range=date_range, data_source=data_source))


@report_group.command("schedule")
@click.option("--report-id", default=None)
@click.option("--report-type", default=None)
@click.option("--date-range", default=None)
@click.option("--data-source", default=None)
@click.pass_context
def report_schedule(
    ctx: click.Context,
    report_id: str | None,
    report_type: str | None,
    date_range: str | None,
    data_source: str | None,
) -> None:
    _set_command(ctx, "report.schedule")
    require_mode(ctx, "report.schedule")
    _emit_success(ctx, "report.schedule", report_schedule_result(ctx.obj, report_id=report_id, report_type=report_type, date_range=date_range, data_source=data_source))


@cli.group("data")
def data_group() -> None:
    pass


@data_group.command("list-sources")
@click.pass_context
def data_list_sources(ctx: click.Context) -> None:
    _set_command(ctx, "data.list_sources")
    require_mode(ctx, "data.list_sources")
    _emit_success(ctx, "data.list_sources", data_sources_result(ctx.obj))


@data_group.command("query")
@click.option("--data-source", default=None)
@click.option("--query", "query_text", default=None)
@click.option("--date-range", default=None)
@click.pass_context
def data_query(ctx: click.Context, data_source: str | None, query_text: str | None, date_range: str | None) -> None:
    _set_command(ctx, "data.query")
    require_mode(ctx, "data.query")
    _emit_success(ctx, "data.query", data_query_result(ctx.obj, data_source=data_source, query_text=query_text, date_range=date_range))


@data_group.command("import")
@click.option("--data-source", default=None)
@click.option("--payload-json", default=None)
@click.pass_context
def data_import(ctx: click.Context, data_source: str | None, payload_json: str | None) -> None:
    _set_command(ctx, "data.import")
    require_mode(ctx, "data.import")
    _emit_success(ctx, "data.import", data_import_result(ctx.obj, payload_json=payload_json, data_source=data_source))


@cli.group("analysis")
def analysis_group() -> None:
    pass


@analysis_group.command("run")
@click.option("--payload-json", default=None)
@click.pass_context
def analysis_run(ctx: click.Context, payload_json: str | None) -> None:
    _set_command(ctx, "analysis.run")
    require_mode(ctx, "analysis.run")
    _emit_success(ctx, "analysis.run", analysis_run_result(ctx.obj, payload_json=payload_json))


@analysis_group.command("list")
@click.option("--limit", default=20, show_default=True, type=int)
@click.pass_context
def analysis_list(ctx: click.Context, limit: int) -> None:
    _set_command(ctx, "analysis.list")
    require_mode(ctx, "analysis.list")
    _emit_success(ctx, "analysis.list", analysis_list_result(ctx.obj, limit=limit))


@cli.group("template")
def template_group() -> None:
    pass


@template_group.command("list")
@click.option("--limit", default=20, show_default=True, type=int)
@click.pass_context
def template_list(ctx: click.Context, limit: int) -> None:
    _set_command(ctx, "template.list")
    require_mode(ctx, "template.list")
    _emit_success(ctx, "template.list", template_list_result(ctx.obj, limit=limit))


@template_group.command("get")
@click.argument("template_id", required=False)
@click.pass_context
def template_get(ctx: click.Context, template_id: str | None) -> None:
    _set_command(ctx, "template.get")
    require_mode(ctx, "template.get")
    _emit_success(ctx, "template.get", template_get_result(ctx.obj, template_id=template_id))


@cli.group("export")
def export_group() -> None:
    pass


@export_group.command("pdf")
@click.argument("report_id", required=False)
@click.pass_context
def export_pdf(ctx: click.Context, report_id: str | None) -> None:
    _set_command(ctx, "export.pdf")
    require_mode(ctx, "export.pdf")
    _emit_success(ctx, "export.pdf", export_pdf_result(ctx.obj, report_id=report_id))


@export_group.command("csv")
@click.argument("report_id", required=False)
@click.pass_context
def export_csv(ctx: click.Context, report_id: str | None) -> None:
    _set_command(ctx, "export.csv")
    require_mode(ctx, "export.csv")
    _emit_success(ctx, "export.csv", export_csv_result(ctx.obj, report_id=report_id))


@export_group.command("email")
@click.argument("report_id", required=False)
@click.option("--recipient-email", default=None)
@click.pass_context
def export_email(ctx: click.Context, report_id: str | None, recipient_email: str | None) -> None:
    _set_command(ctx, "export.email")
    require_mode(ctx, "export.email")
    _emit_success(ctx, "export.email", export_email_result(ctx.obj, report_id=report_id, recipient_email=recipient_email))

