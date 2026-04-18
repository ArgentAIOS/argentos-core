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
    analytics_client_health_result,
    analytics_dashboard_result,
    analytics_sla_performance_result,
    asset_create_result,
    asset_get_result,
    asset_list_result,
    audit_create_result,
    audit_list_result,
    capabilities_snapshot,
    client_create_result,
    client_get_result,
    client_list_result,
    client_portal_result,
    client_update_result,
    compliance_check_result,
    compliance_get_result,
    compliance_list_result,
    compliance_report_result,
    contract_get_result,
    contract_list_result,
    contract_renew_result,
    doctor_snapshot,
    health_snapshot,
    report_generate_result,
    report_list_result,
    technician_availability_result,
    technician_get_result,
    technician_list_result,
    ticket_assign_result,
    ticket_create_result,
    ticket_get_result,
    ticket_list_result,
    ticket_resolve_result,
    ticket_update_result,
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


# --- Connector meta ---

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


# --- Client ---

@cli.group("client")
def client_group() -> None:
    pass


@client_group.command("list")
@click.option("--limit", default=25, show_default=True, type=int)
@click.pass_context
def cmd_client_list(ctx: click.Context, limit: int) -> None:
    _set_command(ctx, "client.list")
    require_mode(ctx, "client.list")
    _emit_success(ctx, "client.list", client_list_result(ctx.obj, limit=limit))


@client_group.command("get")
@click.argument("client_id", required=False)
@click.pass_context
def cmd_client_get(ctx: click.Context, client_id: str | None) -> None:
    _set_command(ctx, "client.get")
    require_mode(ctx, "client.get")
    _emit_success(ctx, "client.get", client_get_result(ctx.obj, client_id))


@client_group.command("create")
@click.argument("name")
@click.option("--email", default=None, help="Contact email")
@click.option("--plan", default=None, help="Service plan")
@click.pass_context
def cmd_client_create(ctx: click.Context, name: str, email: str | None, plan: str | None) -> None:
    _set_command(ctx, "client.create")
    require_mode(ctx, "client.create")
    _emit_success(ctx, "client.create", client_create_result(ctx.obj, name=name, contact_email=email, plan=plan))


@client_group.command("update")
@click.argument("client_id", required=False)
@click.option("--name", default=None, help="New name")
@click.option("--email", default=None, help="New contact email")
@click.option("--plan", default=None, help="New service plan")
@click.option("--status", default=None, help="New status")
@click.pass_context
def cmd_client_update(ctx: click.Context, client_id: str | None, name: str | None, email: str | None, plan: str | None, status: str | None) -> None:
    _set_command(ctx, "client.update")
    require_mode(ctx, "client.update")
    updates = {k: v for k, v in {"name": name, "contact_email": email, "plan": plan, "status": status}.items() if v is not None}
    _emit_success(ctx, "client.update", client_update_result(ctx.obj, client_id, updates=updates))


@client_group.command("portal")
@click.argument("client_id", required=False)
@click.pass_context
def cmd_client_portal(ctx: click.Context, client_id: str | None) -> None:
    _set_command(ctx, "client.portal")
    require_mode(ctx, "client.portal")
    _emit_success(ctx, "client.portal", client_portal_result(ctx.obj, client_id))


# --- Ticket ---

@cli.group("ticket")
def ticket_group() -> None:
    pass


@ticket_group.command("list")
@click.option("--client-id", default=None, help="Filter by client")
@click.option("--technician-id", default=None, help="Filter by technician")
@click.option("--priority", default=None, help="Filter by priority")
@click.option("--status", default=None, help="Filter by status")
@click.option("--limit", default=25, show_default=True, type=int)
@click.pass_context
def cmd_ticket_list(ctx: click.Context, client_id: str | None, technician_id: str | None, priority: str | None, status: str | None, limit: int) -> None:
    _set_command(ctx, "ticket.list")
    require_mode(ctx, "ticket.list")
    _emit_success(ctx, "ticket.list", ticket_list_result(ctx.obj, client_id=client_id, technician_id=technician_id, priority=priority, status=status, limit=limit))


@ticket_group.command("get")
@click.argument("ticket_id", required=False)
@click.pass_context
def cmd_ticket_get(ctx: click.Context, ticket_id: str | None) -> None:
    _set_command(ctx, "ticket.get")
    require_mode(ctx, "ticket.get")
    _emit_success(ctx, "ticket.get", ticket_get_result(ctx.obj, ticket_id))


@ticket_group.command("create")
@click.argument("client_id")
@click.argument("subject")
@click.option("--description", default=None, help="Ticket description")
@click.option("--priority", default=None, help="Priority level")
@click.pass_context
def cmd_ticket_create(ctx: click.Context, client_id: str, subject: str, description: str | None, priority: str | None) -> None:
    _set_command(ctx, "ticket.create")
    require_mode(ctx, "ticket.create")
    _emit_success(ctx, "ticket.create", ticket_create_result(ctx.obj, client_id=client_id, subject=subject, description=description, priority=priority))


@ticket_group.command("update")
@click.argument("ticket_id", required=False)
@click.option("--priority", default=None, help="New priority")
@click.option("--status", default=None, help="New status")
@click.option("--subject", default=None, help="New subject")
@click.pass_context
def cmd_ticket_update(ctx: click.Context, ticket_id: str | None, priority: str | None, status: str | None, subject: str | None) -> None:
    _set_command(ctx, "ticket.update")
    require_mode(ctx, "ticket.update")
    updates = {k: v for k, v in {"priority": priority, "status": status, "subject": subject}.items() if v is not None}
    _emit_success(ctx, "ticket.update", ticket_update_result(ctx.obj, ticket_id, updates=updates))


@ticket_group.command("assign")
@click.argument("ticket_id")
@click.argument("technician_id")
@click.pass_context
def cmd_ticket_assign(ctx: click.Context, ticket_id: str, technician_id: str) -> None:
    _set_command(ctx, "ticket.assign")
    require_mode(ctx, "ticket.assign")
    _emit_success(ctx, "ticket.assign", ticket_assign_result(ctx.obj, ticket_id, technician_id=technician_id))


@ticket_group.command("resolve")
@click.argument("ticket_id", required=False)
@click.option("--resolution", default=None, help="Resolution notes")
@click.pass_context
def cmd_ticket_resolve(ctx: click.Context, ticket_id: str | None, resolution: str | None) -> None:
    _set_command(ctx, "ticket.resolve")
    require_mode(ctx, "ticket.resolve")
    _emit_success(ctx, "ticket.resolve", ticket_resolve_result(ctx.obj, ticket_id, resolution=resolution))


# --- Technician ---

@cli.group("technician")
def technician_group() -> None:
    pass


@technician_group.command("list")
@click.option("--limit", default=25, show_default=True, type=int)
@click.pass_context
def cmd_technician_list(ctx: click.Context, limit: int) -> None:
    _set_command(ctx, "technician.list")
    require_mode(ctx, "technician.list")
    _emit_success(ctx, "technician.list", technician_list_result(ctx.obj, limit=limit))


@technician_group.command("get")
@click.argument("technician_id", required=False)
@click.pass_context
def cmd_technician_get(ctx: click.Context, technician_id: str | None) -> None:
    _set_command(ctx, "technician.get")
    require_mode(ctx, "technician.get")
    _emit_success(ctx, "technician.get", technician_get_result(ctx.obj, technician_id))


@technician_group.command("availability")
@click.argument("technician_id", required=False)
@click.pass_context
def cmd_technician_availability(ctx: click.Context, technician_id: str | None) -> None:
    _set_command(ctx, "technician.availability")
    require_mode(ctx, "technician.availability")
    _emit_success(ctx, "technician.availability", technician_availability_result(ctx.obj, technician_id))


# --- Compliance ---

@cli.group("compliance")
def compliance_group() -> None:
    pass


@compliance_group.command("list")
@click.option("--limit", default=25, show_default=True, type=int)
@click.pass_context
def cmd_compliance_list(ctx: click.Context, limit: int) -> None:
    _set_command(ctx, "compliance.list")
    require_mode(ctx, "compliance.list")
    _emit_success(ctx, "compliance.list", compliance_list_result(ctx.obj, limit=limit))


@compliance_group.command("get")
@click.argument("compliance_id", required=False)
@click.pass_context
def cmd_compliance_get(ctx: click.Context, compliance_id: str | None) -> None:
    _set_command(ctx, "compliance.get")
    require_mode(ctx, "compliance.get")
    _emit_success(ctx, "compliance.get", compliance_get_result(ctx.obj, compliance_id))


@compliance_group.command("check")
@click.option("--client-id", default=None, help="Client to check")
@click.option("--compliance-id", default=None, help="Compliance framework")
@click.pass_context
def cmd_compliance_check(ctx: click.Context, client_id: str | None, compliance_id: str | None) -> None:
    _set_command(ctx, "compliance.check")
    require_mode(ctx, "compliance.check")
    _emit_success(ctx, "compliance.check", compliance_check_result(ctx.obj, client_id=client_id, compliance_id=compliance_id))


@compliance_group.command("report")
@click.option("--client-id", default=None, help="Client for report")
@click.option("--compliance-id", default=None, help="Compliance framework")
@click.pass_context
def cmd_compliance_report(ctx: click.Context, client_id: str | None, compliance_id: str | None) -> None:
    _set_command(ctx, "compliance.report")
    require_mode(ctx, "compliance.report")
    _emit_success(ctx, "compliance.report", compliance_report_result(ctx.obj, client_id=client_id, compliance_id=compliance_id))


# --- Asset ---

@cli.group("asset")
def asset_group() -> None:
    pass


@asset_group.command("list")
@click.option("--client-id", default=None, help="Filter by client")
@click.option("--limit", default=25, show_default=True, type=int)
@click.pass_context
def cmd_asset_list(ctx: click.Context, client_id: str | None, limit: int) -> None:
    _set_command(ctx, "asset.list")
    require_mode(ctx, "asset.list")
    _emit_success(ctx, "asset.list", asset_list_result(ctx.obj, client_id=client_id, limit=limit))


@asset_group.command("get")
@click.argument("asset_id")
@click.pass_context
def cmd_asset_get(ctx: click.Context, asset_id: str) -> None:
    _set_command(ctx, "asset.get")
    require_mode(ctx, "asset.get")
    _emit_success(ctx, "asset.get", asset_get_result(ctx.obj, asset_id))


@asset_group.command("create")
@click.argument("client_id")
@click.argument("name")
@click.option("--type", "asset_type", default=None, help="Asset type")
@click.option("--serial", default=None, help="Serial number")
@click.pass_context
def cmd_asset_create(ctx: click.Context, client_id: str, name: str, asset_type: str | None, serial: str | None) -> None:
    _set_command(ctx, "asset.create")
    require_mode(ctx, "asset.create")
    _emit_success(ctx, "asset.create", asset_create_result(ctx.obj, client_id=client_id, name=name, asset_type=asset_type, serial=serial))


# --- Contract ---

@cli.group("contract")
def contract_group() -> None:
    pass


@contract_group.command("list")
@click.option("--client-id", default=None, help="Filter by client")
@click.option("--limit", default=25, show_default=True, type=int)
@click.pass_context
def cmd_contract_list(ctx: click.Context, client_id: str | None, limit: int) -> None:
    _set_command(ctx, "contract.list")
    require_mode(ctx, "contract.list")
    _emit_success(ctx, "contract.list", contract_list_result(ctx.obj, client_id=client_id, limit=limit))


@contract_group.command("get")
@click.argument("contract_id")
@click.pass_context
def cmd_contract_get(ctx: click.Context, contract_id: str) -> None:
    _set_command(ctx, "contract.get")
    require_mode(ctx, "contract.get")
    _emit_success(ctx, "contract.get", contract_get_result(ctx.obj, contract_id))


@contract_group.command("renew")
@click.argument("contract_id")
@click.option("--months", "duration_months", default=None, type=int, help="Renewal duration in months")
@click.pass_context
def cmd_contract_renew(ctx: click.Context, contract_id: str, duration_months: int | None) -> None:
    _set_command(ctx, "contract.renew")
    require_mode(ctx, "contract.renew")
    _emit_success(ctx, "contract.renew", contract_renew_result(ctx.obj, contract_id, duration_months=duration_months))


# --- Analytics ---

@cli.group("analytics")
def analytics_group() -> None:
    pass


@analytics_group.command("dashboard")
@click.option("--report-type", default=None, help="Report type")
@click.option("--date-range", default=None, help="Date range filter")
@click.pass_context
def cmd_analytics_dashboard(ctx: click.Context, report_type: str | None, date_range: str | None) -> None:
    _set_command(ctx, "analytics.dashboard")
    require_mode(ctx, "analytics.dashboard")
    _emit_success(ctx, "analytics.dashboard", analytics_dashboard_result(ctx.obj, report_type=report_type, date_range=date_range))


@analytics_group.command("client-health")
@click.argument("client_id", required=False)
@click.pass_context
def cmd_analytics_client_health(ctx: click.Context, client_id: str | None) -> None:
    _set_command(ctx, "analytics.client_health")
    require_mode(ctx, "analytics.client_health")
    _emit_success(ctx, "analytics.client_health", analytics_client_health_result(ctx.obj, client_id))


@analytics_group.command("sla-performance")
@click.option("--sla-id", default=None, help="SLA agreement ID")
@click.option("--date-range", default=None, help="Date range filter")
@click.pass_context
def cmd_analytics_sla_performance(ctx: click.Context, sla_id: str | None, date_range: str | None) -> None:
    _set_command(ctx, "analytics.sla_performance")
    require_mode(ctx, "analytics.sla_performance")
    _emit_success(ctx, "analytics.sla_performance", analytics_sla_performance_result(ctx.obj, sla_id=sla_id, date_range=date_range))


# --- Report ---

@cli.group("report")
def report_group() -> None:
    pass


@report_group.command("generate")
@click.argument("report_type")
@click.option("--client-id", default=None, help="Scope to client")
@click.option("--date-range", default=None, help="Date range")
@click.pass_context
def cmd_report_generate(ctx: click.Context, report_type: str, client_id: str | None, date_range: str | None) -> None:
    _set_command(ctx, "report.generate")
    require_mode(ctx, "report.generate")
    _emit_success(ctx, "report.generate", report_generate_result(ctx.obj, report_type=report_type, client_id=client_id, date_range=date_range))


@report_group.command("list")
@click.option("--limit", default=25, show_default=True, type=int)
@click.pass_context
def cmd_report_list(ctx: click.Context, limit: int) -> None:
    _set_command(ctx, "report.list")
    require_mode(ctx, "report.list")
    _emit_success(ctx, "report.list", report_list_result(ctx.obj, limit=limit))


# --- Audit ---

@cli.group("audit")
def audit_group() -> None:
    pass


@audit_group.command("list")
@click.option("--date-range", default=None, help="Date range filter")
@click.option("--limit", default=25, show_default=True, type=int)
@click.pass_context
def cmd_audit_list(ctx: click.Context, date_range: str | None, limit: int) -> None:
    _set_command(ctx, "audit.list")
    require_mode(ctx, "audit.list")
    _emit_success(ctx, "audit.list", audit_list_result(ctx.obj, date_range=date_range, limit=limit))


@audit_group.command("create")
@click.argument("action")
@click.argument("resource_type")
@click.argument("resource_id")
@click.option("--details", default=None, help="Additional details")
@click.pass_context
def cmd_audit_create(ctx: click.Context, action: str, resource_type: str, resource_id: str, details: str | None) -> None:
    _set_command(ctx, "audit.create")
    require_mode(ctx, "audit.create")
    _emit_success(ctx, "audit.create", audit_create_result(ctx.obj, action=action, resource_type=resource_type, resource_id=resource_id, details=details))
