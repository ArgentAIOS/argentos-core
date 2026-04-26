from __future__ import annotations

import json
import time
from typing import Any

import click

from . import __version__
from .config import config_snapshot, resolve_runtime_values
from .constants import MODE_ORDER
from .errors import CliError
from .output import emit, failure, success
from .runtime import (
    alert_list_result,
    capabilities_snapshot,
    change_event_create_result,
    doctor_snapshot,
    escalation_policy_list_result,
    health_snapshot,
    incident_acknowledge_result,
    incident_create_result,
    incident_get_result,
    incident_list_result,
    incident_resolve_result,
    on_call_list_result,
    service_get_result,
    service_list_result,
)


def _mode_allows(actual: str, required: str) -> bool:
    return MODE_ORDER.index(actual) >= MODE_ORDER.index(required)


def _load_permissions() -> dict[str, str]:
    from pathlib import Path

    payload = json.loads((Path(__file__).resolve().parents[2] / "permissions.json").read_text())
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


def _emit_success(ctx: click.Context, command_id: str, data: dict[str, Any]) -> None:
    emit(success(command=command_id, mode=ctx.obj["mode"], started=ctx.obj["started"], data=data), as_json=ctx.obj["json"])


def _runtime_defaults(ctx: click.Context) -> dict[str, Any]:
    return resolve_runtime_values(ctx.obj)


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
    emit(capabilities_snapshot(), as_json=True)


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


@cli.group("incident")
def incident_group() -> None:
    pass


@incident_group.command("list")
@click.option("--limit", default=25, show_default=True, type=int)
@click.option("--status", "statuses", multiple=True, help="Incident status filter")
@click.option("--service-id", default=None, help="Service ID filter")
@click.pass_context
def incident_list(ctx: click.Context, limit: int, statuses: tuple[str, ...], service_id: str | None) -> None:
    _set_command(ctx, "incident.list")
    require_mode(ctx, "incident.list")
    _emit_success(
        ctx,
        "incident.list",
        incident_list_result(ctx.obj, limit=limit, statuses=list(statuses) or None, service_id=service_id),
    )


@incident_group.command("get")
@click.argument("incident_id", required=False)
@click.option("--incident-id", "incident_id_option", default=None, help="Incident ID")
@click.pass_context
def incident_get(ctx: click.Context, incident_id: str | None, incident_id_option: str | None) -> None:
    _set_command(ctx, "incident.get")
    require_mode(ctx, "incident.get")
    resolved = incident_id_option or incident_id or _runtime_defaults(ctx)["incident_id"]
    if not resolved:
        raise CliError(
            code="MISSING_ARGUMENT",
            message="incident.get requires an incident ID",
            exit_code=4,
            details={"argument": "incident_id"},
        )
    _emit_success(ctx, "incident.get", incident_get_result(ctx.obj, resolved))


@incident_group.command("create")
@click.option("--service-id", default=None, help="Service ID")
@click.option("--title", default=None, help="Incident title")
@click.option("--description", default=None, help="Incident description")
@click.option("--urgency", default=None, help="Incident urgency")
@click.option("--escalation-policy-id", default=None, help="Escalation policy ID")
@click.option("--from-email", default=None, help="PagerDuty user email for incident writes")
@click.pass_context
def incident_create(
    ctx: click.Context,
    service_id: str | None,
    title: str | None,
    description: str | None,
    urgency: str | None,
    escalation_policy_id: str | None,
    from_email: str | None,
) -> None:
    _set_command(ctx, "incident.create")
    require_mode(ctx, "incident.create")
    _emit_success(
        ctx,
        "incident.create",
        incident_create_result(
            ctx.obj,
            service_id=service_id,
            title=title,
            description=description,
            urgency=urgency,
            escalation_policy_id=escalation_policy_id,
            from_email=from_email,
        ),
    )


@incident_group.command("acknowledge")
@click.argument("incident_id", required=False)
@click.option("--incident-id", "incident_id_option", default=None, help="Incident ID")
@click.option("--from-email", default=None, help="PagerDuty user email for incident writes")
@click.pass_context
def incident_acknowledge(
    ctx: click.Context,
    incident_id: str | None,
    incident_id_option: str | None,
    from_email: str | None,
) -> None:
    _set_command(ctx, "incident.acknowledge")
    require_mode(ctx, "incident.acknowledge")
    _emit_success(
        ctx,
        "incident.acknowledge",
        incident_acknowledge_result(
            ctx.obj,
            incident_id=incident_id_option or incident_id or _runtime_defaults(ctx)["incident_id"],
            from_email=from_email,
        ),
    )


@incident_group.command("resolve")
@click.argument("incident_id", required=False)
@click.option("--incident-id", "incident_id_option", default=None, help="Incident ID")
@click.option("--resolution", default=None, help="Resolution note")
@click.option("--from-email", default=None, help="PagerDuty user email for incident writes")
@click.pass_context
def incident_resolve(
    ctx: click.Context,
    incident_id: str | None,
    incident_id_option: str | None,
    resolution: str | None,
    from_email: str | None,
) -> None:
    _set_command(ctx, "incident.resolve")
    require_mode(ctx, "incident.resolve")
    _emit_success(
        ctx,
        "incident.resolve",
        incident_resolve_result(
            ctx.obj,
            incident_id=incident_id_option or incident_id or _runtime_defaults(ctx)["incident_id"],
            from_email=from_email,
            resolution=resolution,
        ),
    )


@cli.group("service")
def service_group() -> None:
    pass


@service_group.command("list")
@click.option("--limit", default=25, show_default=True, type=int)
@click.pass_context
def service_list(ctx: click.Context, limit: int) -> None:
    _set_command(ctx, "service.list")
    require_mode(ctx, "service.list")
    _emit_success(ctx, "service.list", service_list_result(ctx.obj, limit=limit))


@service_group.command("get")
@click.argument("service_id", required=False)
@click.option("--service-id", "service_id_option", default=None, help="Service ID")
@click.pass_context
def service_get(ctx: click.Context, service_id: str | None, service_id_option: str | None) -> None:
    _set_command(ctx, "service.get")
    require_mode(ctx, "service.get")
    resolved = service_id_option or service_id or _runtime_defaults(ctx)["service_id"]
    if not resolved:
        raise CliError(
            code="MISSING_ARGUMENT",
            message="service.get requires a service ID",
            exit_code=4,
            details={"argument": "service_id"},
        )
    _emit_success(ctx, "service.get", service_get_result(ctx.obj, resolved))


@cli.group("escalation-policy")
def escalation_policy_group() -> None:
    pass


@escalation_policy_group.command("list")
@click.option("--limit", default=25, show_default=True, type=int)
@click.pass_context
def escalation_policy_list(ctx: click.Context, limit: int) -> None:
    _set_command(ctx, "escalation_policy.list")
    require_mode(ctx, "escalation_policy.list")
    _emit_success(ctx, "escalation_policy.list", escalation_policy_list_result(ctx.obj, limit=limit))


@cli.group("on-call")
def on_call_group() -> None:
    pass


@on_call_group.command("list")
@click.option("--limit", default=25, show_default=True, type=int)
@click.option("--escalation-policy-id", default=None, help="Escalation policy ID")
@click.pass_context
def on_call_list(ctx: click.Context, limit: int, escalation_policy_id: str | None) -> None:
    _set_command(ctx, "on_call.list")
    require_mode(ctx, "on_call.list")
    _emit_success(
        ctx,
        "on_call.list",
        on_call_list_result(ctx.obj, limit=limit, escalation_policy_id=escalation_policy_id),
    )


@cli.group("alert")
def alert_group() -> None:
    pass


@alert_group.command("list")
@click.option("--limit", default=25, show_default=True, type=int)
@click.option("--incident-id", default=None, help="Incident ID")
@click.pass_context
def alert_list(ctx: click.Context, limit: int, incident_id: str | None) -> None:
    _set_command(ctx, "alert.list")
    require_mode(ctx, "alert.list")
    _emit_success(ctx, "alert.list", alert_list_result(ctx.obj, limit=limit, incident_id=incident_id))


@cli.group("change-event")
def change_event_group() -> None:
    pass


@change_event_group.command("create")
@click.option("--summary", default=None, help="Change summary")
@click.option("--description", default=None, help="Change description")
@click.option("--source", default="aos-pagerduty", show_default=True, help="Change source")
@click.pass_context
def change_event_create(
    ctx: click.Context,
    summary: str | None,
    description: str | None,
    source: str,
) -> None:
    _set_command(ctx, "change_event.create")
    require_mode(ctx, "change_event.create")
    _emit_success(
        ctx,
        "change_event.create",
        change_event_create_result(
            ctx.obj,
            summary=summary,
            description=description,
            source=source,
        ),
    )
